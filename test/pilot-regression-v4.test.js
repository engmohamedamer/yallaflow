// v0.3.6 human-pilot regression (PART 25), modelled on the YaSchools Brownfield pilot.
// Every step goes through a public `yallaflow` CLI command; nothing under .yallaflow is
// hand-edited. Repository changes are ordinary file edits + git commits.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { workspacePath } from '../src/core/workspace.js';
import { exists } from '../src/utils/fs.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));

function run(root, args) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, `\`yallaflow ${args.join(' ')}\` failed:\n${result.stderr || result.stdout}`);
  return result;
}

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

async function yaSchools() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-yaschools-'));
  await mkdir(path.join(root, 'common', 'config'), { recursive: true });
  await writeFile(path.join(root, 'composer.json'), JSON.stringify({ require: { 'yiisoft/yii2': '~2.0.45' } }));
  await writeFile(path.join(root, 'common', 'config', 'db.php'), "<?php return ['slaves' => [/* replica configured, not enabled */]];\n");
  await writeFile(path.join(root, 'common', 'config', 'main.php'), "<?php return ['components' => ['queue' => ['class' => 'yii\\\\queue\\\\db\\\\Queue']]];\n");
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'pilot@example.com']);
  git(root, ['config', 'user.name', 'Pilot']);
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'legacy app']);
  run(root, ['init']);
  return root;
}

async function approveBaseline(root, facts, limitations = []) {
  const start = run(root, ['baseline', 'start']);
  const baselineId = /^(PF-\d+)/.exec(start.stdout)[1];
  run(root, ['checkpoint', baselineId, '--skill', 'repository-baseline', '--complete', '--summary', 'Repository discovered.']);
  await writeFile(path.join(root, 'baseline.json'), JSON.stringify({ facts, limitations }));
  run(root, ['baseline', 'draft', baselineId, '--file', 'baseline.json']);
  run(root, ['baseline', 'approve', baselineId, '--note', 'Reviewed by developer.']);
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'approved baseline']);
  return baselineId;
}

// An investigation driven to CONCLUSION through the public CLI (read-only work).
function investigate(root, question) {
  const created = run(root, ['investigate', question, '--scope', 'bounded']);
  const id = /Created (PF-\d+)/.exec(created.stdout)[1];
  for (let i = 0; i < 6; i++) run(root, ['advance', id]);
  return id;
}

async function snapshotWork(root, workId) {
  const dir = path.join(workspacePath(root), 'work', workId);
  const names = (await readdir(dir)).filter((name) => /\.(ya?ml|md)$/.test(name)).sort();
  return Object.fromEntries(await Promise.all(names.map(async (name) => [name, await readFile(path.join(dir, name), 'utf8')])));
}

test('Scenario 1 — read replica becomes active: supersede instead of contradictory append, no re-baseline', async () => {
  const root = await yaSchools();
  const baselineId = await approveBaseline(root, [
    { area: 'database', status: 'confirmed', summary: 'Read replica is configured but inactive.', evidence: ['common/config/db.php'], source: 'repository' },
    { area: 'architecture', status: 'confirmed', summary: 'Background jobs use the Yii2 DB-backed queue.', evidence: ['common/config/main.php'], source: 'repository' }
  ]);
  const baselineRecord = await snapshotWork(root, baselineId);
  assert.match(run(root, ['context', 'show', 'CTX-0001']).stdout, /State: current/);

  // Later work: reporting is moved onto the replica.
  await writeFile(path.join(root, 'common', 'config', 'db.php'), "<?php return ['slaves' => [['dsn' => 'mysql:host=replica']], 'reportingUsesSlave' => true];\n");
  git(root, ['commit', '-qam', 'enable replica for reporting']);

  const status = run(root, ['context', 'status']);
  assert.match(status.stdout, /CTX-0001 \[database\] MAY_BE_STALE \(common\/config\/db\.php changed\)/);
  assert.doesNotMatch(status.stdout, /CTX-0002 \[architecture\] MAY_BE_STALE/); // targeted, not a full rescan

  const workId = investigate(root, 'Does reporting use the read replica?');
  run(root, ['knowledge', 'propose', workId, '--kind', 'database', '--source', 'implementation-runtime',
    '--summary', 'Read replica is active for reporting.', '--evidence', 'common/config/db.php', '--supersedes', 'CTX-0001']);
  run(root, ['knowledge', 'promote', workId, '--candidate', 'K-001']);

  const show = run(root, ['context', 'show', 'CTX-0001']);
  assert.match(show.stdout, /State: superseded/);
  assert.match(show.stdout, /Superseded by: CTX-0003/);
  assert.match(run(root, ['context', 'show', 'CTX-0003']).stdout, /State: current[\s\S]*Supersedes: CTX-0001/);
  assert.match(run(root, ['context', 'history', 'CTX-0003']).stdout, /CTX-0001 \[superseded\] → CTX-0003 \[current\]/);

  const database = await readFile(path.join(workspacePath(root), 'context', 'database.md'), 'utf8');
  assert.match(database, /Read replica is active for reporting\./);
  assert.doesNotMatch(database, /configured but inactive/);

  assert.deepEqual(await snapshotWork(root, baselineId), baselineRecord); // PF-0001 history unchanged
  const work = (await readdir(path.join(workspacePath(root), 'work'))).filter((name) => name.startsWith('PF-'));
  assert.equal(work.length, 2); // no second baseline was needed

  // A fresh agent session reads only current truth.
  const list = run(root, ['context', 'list', '--area', 'database']);
  assert.match(list.stdout, /CTX-0003 \[database\] current\/confirmed FRESH — Read replica is active for reporting\./);
  assert.doesNotMatch(list.stdout, /CTX-0001/);
  assert.match(run(root, ['doctor']).stdout, /Workspace healthy\./);
});

test('Scenario 2 — evidence changes: MAY_BE_STALE → targeted revalidation → reconfirm → fresh', async () => {
  const root = await yaSchools();
  await approveBaseline(root, [
    { area: 'architecture', status: 'confirmed', summary: 'Background jobs use the Yii2 DB-backed queue.', evidence: ['common/config/main.php'], source: 'repository' }
  ]);
  await writeFile(path.join(root, 'common', 'config', 'main.php'), "<?php return ['components' => ['queue' => ['class' => 'yii\\\\queue\\\\db\\\\Queue', 'ttr' => 300]]];\n");
  git(root, ['commit', '-qam', 'raise queue ttr']);

  assert.match(run(root, ['context', 'status']).stdout, /1 may be stale/);
  assert.match(run(root, ['doctor']).stdout, /WARN CTX-0001 may be stale because common\/config\/main\.php changed/);
  assert.match(run(root, ['context', 'affected', '--since', 'HEAD~1']).stdout, /CTX-0001 \[architecture\] MAY_BE_STALE/);

  const workId = investigate(root, 'Is the queue still DB-backed after the TTR change?');
  run(root, ['knowledge', 'propose', workId, '--kind', 'architecture', '--source', 'implementation-runtime',
    '--summary', 'Queue remains DB-backed; only TTR changed.', '--evidence', 'common/config/main.php', '--reconfirms', 'CTX-0001']);
  run(root, ['knowledge', 'promote', workId, '--candidate', 'K-001']);

  const show = run(root, ['context', 'show', 'CTX-0001']);
  assert.match(show.stdout, /Freshness: FRESH/);
  assert.match(show.stdout, /CTX-0001 — Background jobs use the Yii2 DB-backed queue\./);
  assert.match(run(root, ['context', 'status']).stdout, /No facts currently need revalidation\./);
  assert.doesNotMatch(run(root, ['context', 'list', '--all']).stdout, /CTX-0002/); // no duplicate fact
});

test('Scenario 3 — production DB unavailable: runtime-unavailable limitation stays work-scoped', async () => {
  const root = await yaSchools();
  await approveBaseline(root, [
    { area: 'database', status: 'confirmed', summary: 'Read replica is configured but inactive.', evidence: ['common/config/db.php'], source: 'repository' }
  ], [
    { type: 'not-inspected', area: 'tech-stack', summary: 'Lockfile-level dependency versions were not deeply inspected.', reason: 'Time-boxed baseline.' }
  ]);
  const workId = investigate(root, 'How large is the production attendance table?');
  run(root, ['limitation', 'add', workId, '--type', 'runtime-unavailable', '--area', 'database',
    '--summary', 'Production database schema was not inspected.', '--reason', 'No production DB access during this work.']);

  const handoff = run(root, ['handoff', workId]);
  assert.match(handoff.stdout, /Discovery limitations \(PF-0002, work-scoped — not project facts\):/);
  const refused = spawnSync(process.execPath, [cli, 'knowledge', 'propose', workId, '--kind', 'database', '--source', 'implementation-runtime',
    '--summary', 'Production database schema was not inspected.', '--evidence', 'common/config/db.php'], { cwd: root, encoding: 'utf8' });
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /Discovery limitations are work-scoped and cannot become project knowledge/);

  for (const relative of ['context/database.md', 'context/tech-stack.md']) {
    assert.doesNotMatch(await readFile(path.join(workspacePath(root), relative), 'utf8'), /not inspected|not deeply inspected/);
  }
  assert.match(run(root, ['doctor']).stdout, /Workspace healthy\./);
});

test('Scenario 4 — new bounded task: no empty artifact directories; first verify creates evidence/', async () => {
  const root = await yaSchools();
  const start = run(root, ['start', 'Show replica lag on the admin dashboard']);
  const workId = /Created (PF-\d+)/.exec(start.stdout)[1];
  run(root, ['route', workId, '--type', 'feature', '--scope', 'bounded', '--confidence', 'high', '--reason', 'Small UI addition.']);
  const dir = path.join(workspacePath(root), 'work', workId);
  assert.deepEqual((await readdir(dir)).sort(), ['meta.yaml', 'progress.md', 'work.md']);

  run(root, ['checkpoint', workId, '--skill', 'context-discovery', '--complete', '--summary', 'Reused durable database context.']);
  run(root, ['checkpoint', workId, '--skill', 'requirement-clarification', '--complete', '--summary', 'No open questions.']);
  for (let i = 0; i < 5; i++) run(root, ['advance', workId]);
  run(root, ['checkpoint', workId, '--skill', 'implementation', '--complete', '--summary', 'Implemented.']);
  run(root, ['advance', workId]);
  assert.equal(await exists(path.join(dir, 'evidence')), false);
  run(root, ['verify', workId, '--', process.execPath, '-e', 'process.exit(0)']);
  assert.equal(await exists(path.join(dir, 'evidence', 'verification.json')), true);
  for (const lazy of ['attachments', 'execution']) assert.equal(await exists(path.join(dir, lazy)), false);
  run(root, ['checkpoint', workId, '--skill', 'verification', '--complete', '--summary', 'Verified.']);
  run(root, ['knowledge', 'review', workId, '--none']);
  assert.match(run(root, ['advance', workId]).stdout, /→ DONE/);
});
