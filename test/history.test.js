// 1.4.0 work-history reconciliation (PF-0052). Disposable Git repositories reproduce the
// real divergence: a work ID created on both branches, uncommitted colliding records in the
// other branch's checkout, a project-memory collision with a supersede, and a shared record
// completed only on the other side. Nothing outside the temp folders is touched.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { buildPlan, importLineage, mapIdentity, removeLineage, verifyLineage, verifyMerge } from '../src/history/lineage.js';
import { hashOf } from '../src/history/plan.js';
import { link } from 'node:fs/promises';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const run = (cwd, args) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });
const git = (cwd, args) => {
  const result = spawnSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
};
const created = (result) => /Created (PF-\d+)/.exec(result.stdout)[1];
const ledgerFile = (root) => path.join(root, '.yallaflow', 'context', 'index.yaml');
async function addFact(root, fact, supersede = null) {
  const ledger = JSON.parse(await readFile(ledgerFile(root), 'utf8').catch(() => '{"schemaVersion":2,"facts":[]}'));
  ledger.schemaVersion ??= 2;
  ledger.facts ??= [];
  if (supersede) ledger.facts = ledger.facts.map((entry) => (entry.id === supersede ? { ...entry, state: 'superseded', supersededBy: fact.id } : entry));
  ledger.facts.push({ area: 'project', state: 'current', confidence: 'confirmed', provenance: 'repository', evidence: [], history: [], ...fact });
  await writeFile(ledgerFile(root), JSON.stringify(ledger, null, 2));
}

async function treeHash(dir) {
  const hash = createHash('sha256');
  async function walk(current) {
    for (const entry of (await readdir(current, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) { if (entry.name !== 'objects') await walk(full); }
      else if (entry.isFile()) { hash.update(path.relative(dir, full)); hash.update(await readFile(full)); hash.update(String((await stat(full)).mtimeMs)); }
    }
  }
  await walk(dir);
  return hash.digest('hex');
}

// feature (workspace, a worktree) and main (other side, the original checkout).
async function divergedRepos() {
  const main = await mkdtemp(path.join(os.tmpdir(), 'yf-history-main-'));
  git(main, ['init', '-q', '-b', 'main']);
  run(main, ['init', '--name', 'Repo', '--type', 'greenfield']);
  const shared = created(run(main, ['change', 'Shared item open at the fork', '--scope', 'bounded']));
  await addFact(main, { id: 'CTX-0001', summary: 'Base fact.' });
  await addFact(main, { id: 'CTX-0099', summary: 'Unchanged fact on both sides.' });
  git(main, ['add', '-A']); git(main, ['commit', '-qm', 'base']);
  const feature = path.join(await mkdtemp(path.join(os.tmpdir(), 'yf-history-feature-')), 'wt');
  git(main, ['worktree', 'add', '-q', '-b', 'feature', feature]);
  // feature side
  const fWork = created(run(feature, ['change', 'Feature: lifecycle', '--scope', 'bounded']));
  const fWork2 = created(run(feature, ['change', 'Feature: console management', '--scope', 'bounded']));
  await addFact(feature, { id: 'CTX-0002', summary: 'Feature: lifecycle fact.' });
  git(feature, ['add', '-A']); git(feature, ['commit', '-qm', 'feature work']);
  // main side: a colliding committed item, the shared item completed, a superseding fact
  const mWork = created(run(main, ['change', 'Main: recover proposal', '--scope', 'bounded']));
  const metaFile = path.join(main, '.yallaflow', 'work', shared, 'meta.yaml');
  const meta = JSON.parse(await readFile(metaFile, 'utf8'));
  await writeFile(metaFile, JSON.stringify({ ...meta, status: 'DONE', updatedAt: '2026-11-07T00:00:00.000Z' }, null, 2));
  await addFact(main, { id: 'CTX-0002', summary: 'Main: Codex sessions fact.' }, 'CTX-0001');
  git(main, ['add', '-A']); git(main, ['commit', '-qm', 'main release']);
  // main checkout: an uncommitted, untracked colliding item
  const mUncommitted = created(run(main, ['change', 'Main: publication (uncommitted)', '--scope', 'bounded']));
  return { main, feature, shared, fWork, fWork2, mWork, mUncommitted };
}

test('plan is read-only and classifies collisions, uncommitted records, diverged records and memory', async () => {
  const r = await divergedRepos();
  assert.equal(r.mWork, r.fWork, 'both branches allocated the same ID');
  assert.equal(r.mUncommitted, r.fWork2, 'the uncommitted record collides too');
  const before = [await treeHash(r.main), await treeHash(r.feature)];
  const plan = await buildPlan(r.feature, { label: 'main-v1', fromRef: 'main', fromDir: r.main });
  assert.deepEqual([await treeHash(r.main), await treeHash(r.feature)], before, 'neither checkout (nor its uncommitted files) changed');
  assert.ok(plan.body.inventory.some((entry) => entry.classification === 'identical'));
  const by = Object.fromEntries(plan.body.identities.map((entry) => [`${entry.kind}:${entry.id}`, entry]));
  assert.equal(by[`work:${r.fWork}`].classification, 'colliding');
  assert.equal(by[`work:${r.fWork2}`].classification, 'colliding');
  assert.equal(by[`work:${r.fWork2}`].uncommitted, true);
  assert.equal(by[`work:${r.shared}`].classification, 'diverged-other');
  assert.match(by[`work:${r.shared}`].action, /preserve-workspace-copy/);
  assert.equal(by['fact:CTX-0002'].classification, 'colliding');
  assert.equal(by['fact:CTX-0001'].classification, 'diverged-other');
  assert.match(by['fact:CTX-0002'].action, /no relation is assumed/);
  const sides = new Set(plan.body.preserve.map((entry) => `${entry.side}:${entry.path.split('/').slice(0, 3).join('/')}`));
  for (const expected of [`other:.yallaflow/work/${r.fWork}`, `other:.yallaflow/work/${r.fWork2}`, `workspace:.yallaflow/work/${r.shared}`, 'other:.yallaflow/context/index.yaml', 'workspace:.yallaflow/context/index.yaml']) assert.ok(sides.has(expected), expected);
  assert.ok(plan.body.preserve.some((entry) => entry.origin === 'checkout:uncommitted'));
  assert.deepEqual(plan.body.gitResolution.find((entry) => entry.path.endsWith(r.shared)).take, 'theirs');
  assert.deepEqual(plan.body.gitResolution.find((entry) => entry.path.endsWith(r.fWork)).take, 'ours');
  const human = run(r.feature, ['history', 'plan', '--label', 'main-v1', '--from-ref', 'main', '--from-dir', r.main]);
  assert.equal(human.status, 0, human.stderr);
  assert.match(human.stdout, /dry-run; nothing was written/);
  assert.equal(run(r.feature, ['history', 'plan', '--label', 'x', '--from-ref', 'main', '--out', path.join(r.feature, '.yallaflow', 'p.json')]).status, 1, 'the plan is never written into .yallaflow');
});

test('import is byte-identical, read-only, idempotent, never overwrites, and survives an injected failure', async () => {
  const r = await divergedRepos();
  const plan = await buildPlan(r.feature, { label: 'main-v1', fromRef: 'main', fromDir: r.main });
  await assert.rejects(importLineage(r.feature, plan, { confirm: 'deadbeef', fromDir: r.main }), { code: 'HISTORY_CONFIRM' });
  await assert.rejects(importLineage(r.feature, plan, { confirm: plan.hash, fromDir: r.main, hooks: { afterFile: (i) => { if (i === 2) throw new Error('disk full'); } } }), /disk full/);
  assert.deepEqual(await readdir(path.join(r.feature, '.yallaflow', 'lineages')), [], 'no partial lineage and no staging left');
  const first = await importLineage(r.feature, plan, { confirm: plan.hash.slice(0, 8), fromDir: r.main });
  assert.equal(first.created, true);
  const lineage = path.join(r.feature, '.yallaflow', 'lineages', 'main-v1');
  for (const entry of plan.body.preserve) {
    const copy = path.join(lineage, entry.side, entry.path.replace('.yallaflow/', ''));
    const source = entry.side === 'other' ? path.join(r.main, entry.path) : path.join(r.feature, entry.path);
    assert.deepEqual(await readFile(copy), await readFile(source), `${entry.side} ${entry.path} is byte-identical`);
    assert.equal((await stat(copy)).mode & 0o222, 0, 'preserved files are read-only');
  }
  assert.equal((await importLineage(r.feature, plan, { confirm: plan.hash, fromDir: r.main })).created, false, 'the same plan twice is a no-op');
  const other = await buildPlan(r.feature, { label: 'main-v1', fromRef: 'main' });
  await assert.rejects(importLineage(r.feature, other, { confirm: other.hash }), { code: 'HISTORY_LINEAGE_EXISTS' });
  assert.deepEqual(await readdir(path.join(r.feature, '.yallaflow', 'work')).then((ids) => ids.includes(r.fWork)), true, 'work/ was not touched');
  const shown = run(r.feature, ['history', 'show', `main-v1:${r.fWork}`, '--json']);
  assert.equal(shown.status, 0, shown.stdout + shown.stderr);
  const record = JSON.parse(shown.stdout);
  assert.equal(record.identity.id, r.fWork);
  assert.ok(record.records.length > 0);
  for (const file of record.records) assert.deepEqual(Buffer.from(file.content, 'base64'), await readFile(path.join(r.main, file.path)));
  const fact = JSON.parse(run(r.feature, ['history', 'show', 'main-v1:CTX-0002', '--json']).stdout);
  assert.equal(fact.records.length, 2);
  assert.equal(fact.records.find((entry) => entry.side === 'other').fact.summary, 'Main: Codex sessions fact.');
  const status = run(r.feature, ['doctor']);
  assert.match(status.stdout, /PASS lineage main-v1/);
});

test('a tampered plan, a changed source and a symlink in the other checkout are refused or not followed', async () => {
  const r = await divergedRepos();
  await mkdir(path.join(r.main, '.yallaflow', 'work', 'PF-0099'), { recursive: true });
  await symlink('/etc/passwd', path.join(r.main, '.yallaflow', 'work', 'PF-0099', 'meta.yaml'));
  const plan = await buildPlan(r.feature, { label: 'main-v1', fromRef: 'main', fromDir: r.main });
  assert.ok(plan.body.skipped.some((entry) => entry.path.endsWith('PF-0099/meta.yaml') && /symbolic link/.test(entry.reason)));
  const tampered = JSON.parse(JSON.stringify(plan));
  tampered.body.preserve[0].path = '.yallaflow/../../etc/passwd';
  await assert.rejects(importLineage(r.feature, tampered, { confirm: plan.hash, fromDir: r.main }), { code: 'HISTORY_PLAN_TAMPERED' });
  await writeFile(path.join(r.main, '.yallaflow', 'work', r.mUncommitted, 'work.md'), 'changed after the plan\n');
  await assert.rejects(importLineage(r.feature, plan, { confirm: plan.hash, fromDir: r.main }), { code: 'HISTORY_PLAN_MISMATCH' });
  assert.equal(await lstat(path.join(r.feature, '.yallaflow', 'lineages', 'main-v1')).catch(() => null), null);
});

test('mappings need a cited canonical record and a reason; rollback refuses referenced history; doctor detects tampering', async () => {
  const r = await divergedRepos();
  const plan = await buildPlan(r.feature, { label: 'main-v1', fromRef: 'main', fromDir: r.main });
  await importLineage(r.feature, plan, { confirm: plan.hash, fromDir: r.main });
  const decider = created(run(r.feature, ['change', 'Reconcile main memory', '--scope', 'bounded']));
  await assert.rejects(mapIdentity(r.feature, 'main-v1', 'CTX-0002', { to: 'CTX-0003', relation: 'distinct', work: decider, reason: 'verified independent' }), { code: 'HISTORY_UNKNOWN_TARGET' });
  await addFact(r.feature, { id: 'CTX-0003', summary: 'Main: Codex sessions fact.' });
  await assert.rejects(mapIdentity(r.feature, 'main-v1', 'CTX-0002', { to: 'CTX-0003', relation: 'distinct', work: decider, reason: 'verified independent' }), { code: 'HISTORY_UNCITED' });
  const ledger = JSON.parse(await readFile(ledgerFile(r.feature), 'utf8'));
  ledger.facts.find((fact) => fact.id === 'CTX-0003').evidence.push({ type: 'repository', path: '.yallaflow/lineages/main-v1/other/context/index.yaml' });
  await writeFile(ledgerFile(r.feature), JSON.stringify(ledger, null, 2));
  await assert.rejects(mapIdentity(r.feature, 'main-v1', 'CTX-0002', { to: 'CTX-0003', relation: 'distinct', work: decider, reason: '' }), { code: 'HISTORY_USAGE' });
  const entry = await mapIdentity(r.feature, 'main-v1', 'CTX-0002', { to: 'CTX-0003', relation: 'distinct', work: decider, reason: 'Verified: a different statement from the workspace CTX-0002; kept as its own fact.' });
  assert.equal(entry.to, 'CTX-0003');
  await assert.rejects(mapIdentity(r.feature, 'main-v1', 'CTX-0002', { to: 'CTX-0003', relation: 'distinct', work: decider, reason: 'again, append-only' }), { code: 'HISTORY_MAPPING_EXISTS' });
  await assert.rejects(removeLineage(r.feature, 'main-v1', { confirm: plan.hash }), { code: 'HISTORY_REFERENCED' });

  const preserved = path.join(r.feature, '.yallaflow', 'lineages', 'main-v1', 'other', 'work', r.fWork, 'meta.yaml');
  await chmod(preserved, 0o644);
  await writeFile(preserved, '{"tampered":true}');
  await assert.rejects(verifyLineage(r.feature, 'main-v1'), { code: 'HISTORY_LINEAGE_INVALID' });
  assert.match(run(r.feature, ['doctor']).stdout, /FAIL lineage: .*does not match its recorded hash/);
});

test('rollback removes an intact, unreferenced lineage only', async () => {
  const r = await divergedRepos();
  const plan = await buildPlan(r.feature, { label: 'main-v1', fromRef: 'main', fromDir: r.main });
  await importLineage(r.feature, plan, { confirm: plan.hash, fromDir: r.main });
  await assert.rejects(removeLineage(r.feature, 'main-v1', { confirm: '00000000' }), { code: 'HISTORY_CONFIRM' });
  const refused = run(r.feature, ['history', 'remove', 'main-v1', '--confirm', plan.hash.slice(0, 8), '--json']);
  assert.equal(JSON.parse(refused.stdout).error.code, 'HISTORY_UNRECOVERABLE', 'uncommitted records exist nowhere else');
  const removed = run(r.feature, ['history', 'remove', 'main-v1', '--confirm', plan.hash.slice(0, 8), '--force']);
  assert.equal(removed.status, 0, removed.stderr);
  assert.deepEqual(await readdir(path.join(r.feature, '.yallaflow', 'lineages')), []);
  const again = await importLineage(r.feature, plan, { confirm: plan.hash, fromDir: r.main });
  assert.equal(again.created, true, 'a rolled-back import can be repeated');
});

test('a record taken from the other side keeps its fact references; doctor requires a mapping, work show resolves it', async () => {
  const r = await divergedRepos();
  // On main, the shared item promoted main's CTX-0002 (superseding CTX-0001) — as PF-0039 did.
  const now = '2026-11-07T00:00:00.000Z';
  const knowledge = { version: 1, reviewStatus: 'reviewed', updatedAt: now, reviewedAt: now, candidates: [{ id: 'K-001', kind: 'architecture', source: 'implementation-runtime', summary: 'Main: Codex sessions fact.', evidence: ['runtime: test'], relation: { type: 'supersedes', factId: 'CTX-0001' }, status: 'promoted', createdAt: now, factId: 'CTX-0002', promotedAt: now, target: 'context/architecture.md' }] };
  await writeFile(path.join(r.main, '.yallaflow', 'work', r.shared, 'knowledge.yaml'), JSON.stringify(knowledge));
  git(r.main, ['add', '-A', `.yallaflow/work/${r.shared}`]); git(r.main, ['commit', '-qm', 'shared knowledge']);
  const plan = await buildPlan(r.feature, { label: 'main-v1', fromRef: 'main', fromDir: r.main });
  await importLineage(r.feature, plan, { confirm: plan.hash, fromDir: r.main });
  // The Git merge takes the other side's shared item (owner decision 3).
  for (const name of ['meta.yaml', 'knowledge.yaml']) await writeFile(path.join(r.feature, '.yallaflow', 'work', r.shared, name), await readFile(path.join(r.main, '.yallaflow', 'work', r.shared, name)));
  await assert.rejects(verifyLineage(r.feature, 'main-v1'), (error) => /cites main-v1:CTX-0002, which has no mapping yet/.test(error.message));
  const decider = created(run(r.feature, ['change', 'Reconcile main memory', '--scope', 'bounded']));
  await addFact(r.feature, { id: 'CTX-0003', summary: 'Main: Codex sessions fact.', evidence: [{ type: 'repository', path: '.yallaflow/lineages/main-v1/other/context/index.yaml' }] }, 'CTX-0001');
  await mapIdentity(r.feature, 'main-v1', 'CTX-0002', { to: 'CTX-0003', relation: 'canonical-continuation', work: decider, reason: 'Verified: the same statement, re-established under a new identity.' });
  await assert.rejects(verifyLineage(r.feature, 'main-v1'), /cites main-v1:CTX-0001/, 'the relation target needs a mapping too');
  await mapIdentity(r.feature, 'main-v1', 'CTX-0001', { to: 'CTX-0003', relation: 'supersedes', work: decider, reason: 'Verified: main superseded CTX-0001 and it no longer holds here either.' });
  await verifyLineage(r.feature, 'main-v1');
  const shown = run(r.feature, ['work', 'show', r.shared, '--json']);
  const detail = JSON.parse(shown.stdout);
  assert.equal(detail.error, undefined, shown.stdout);
  assert.deepEqual(detail.knowledge.candidates[0].lineage, { lineage: 'main-v1', originalId: 'CTX-0002', canonicalId: 'CTX-0003', relation: 'canonical-continuation' });
  assert.equal(detail.knowledge.candidates[0].promotedAs, 'CTX-0002', 'the record itself is unchanged');
});

// ---------------------------------------------------------------- security review (PF-0052)
test('review: hard links in the other checkout are not read; secret-looking files stop the import', async () => {
  const r = await divergedRepos();
  const outside = path.join(await mkdtemp(path.join(os.tmpdir(), 'yf-outside-')), 'id_rsa');
  await writeFile(outside, 'PRIVATE-KEY-MATERIAL-OUTSIDE-REPO');
  await link(outside, path.join(r.main, '.yallaflow', 'work', r.mUncommitted, 'notes.md'));
  const plan = await buildPlan(r.feature, { label: 'main-v1', fromRef: 'main', fromDir: r.main });
  assert.ok(plan.body.skipped.some((entry) => entry.path.endsWith('notes.md') && /hard-linked/.test(entry.reason)));
  assert.equal(plan.body.preserve.some((entry) => entry.path.endsWith('notes.md')), false);
  await writeFile(path.join(r.main, '.yallaflow', 'work', r.mUncommitted, 'scratch.md'), 'GITHUB_TOKEN=ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789\n');
  const leaky = await buildPlan(r.feature, { label: 'main-v1', fromRef: 'main', fromDir: r.main });
  assert.ok(leaky.body.preserve.find((entry) => entry.path.endsWith('scratch.md')).secretLike);
  await assert.rejects(importLineage(r.feature, leaky, { confirm: leaky.hash, fromDir: r.main }), { code: 'HISTORY_SECRETS' });
});

test('review: a plan with a recomputed hash but forged identities or commits is refused', async () => {
  const r = await divergedRepos();
  const plan = await buildPlan(r.feature, { label: 'main-v1', fromRef: 'main', fromDir: r.main });
  const forged = JSON.parse(JSON.stringify(plan));
  forged.body.identities.push({ kind: 'work', id: '../../../../etc', classification: 'diverged-other' });
  forged.hash = hashOf(forged.body);
  await assert.rejects(importLineage(r.feature, forged, { confirm: forged.hash, fromDir: r.main }), { code: 'HISTORY_PLAN_TAMPERED' });
  const moving = JSON.parse(JSON.stringify(plan));
  moving.body.other.commit = 'main';
  moving.hash = hashOf(moving.body);
  await assert.rejects(importLineage(r.feature, moving, { confirm: moving.hash, fromDir: r.main }), { code: 'HISTORY_PLAN_TAMPERED' });
  const dropped = JSON.parse(JSON.stringify(plan));
  dropped.body.identities = dropped.body.identities.filter((entry) => entry.kind !== 'fact');
  dropped.hash = hashOf(dropped.body);
  await assert.rejects(importLineage(r.feature, dropped, { confirm: dropped.hash, fromDir: r.main }), { code: 'HISTORY_PLAN_MISMATCH' }, 'the plan is rebuilt and compared');
});

test('review: verify-merge catches a file that only exists on the other side; the plan\'s restore commands fix it', async () => {
  const r = await divergedRepos();
  // Like main's PF-0041/discovery.yaml: a file only the other side's colliding record has.
  await writeFile(path.join(r.main, '.yallaflow', 'work', r.mWork, 'discovery.yaml'), '{"other":"side"}');
  git(r.main, ['add', '-A', `.yallaflow/work/${r.mWork}`]); git(r.main, ['commit', '-qm', 'other-only file']);
  const planFile = path.join(await mkdtemp(path.join(os.tmpdir(), 'yf-plan-')), 'plan.json');
  const plan = await buildPlan(r.feature, { label: 'main-v1', fromRef: 'main', fromDir: r.main });
  await writeFile(planFile, JSON.stringify(plan));
  await importLineage(r.feature, plan, { confirm: plan.hash, fromDir: r.main });
  git(r.feature, ['add', '.yallaflow/lineages']); git(r.feature, ['commit', '-qm', 'lineage']);
  spawnSync('git', ['merge', '--no-ff', '--no-commit', 'main'], { cwd: r.feature });
  spawnSync('git', ['checkout', '--ours', '--', `.yallaflow/work/${r.fWork}`], { cwd: r.feature }); // the naive resolution
  await assert.rejects(verifyMerge(r.feature, plan), (error) => error.code === 'HISTORY_MERGE_MIXED' && /discovery\.yaml is extra/.test(error.message));
  for (const command of plan.body.mergeCommands.filter((c) => c.startsWith('git restore'))) {
    const parts = command.split(' ');
    spawnSync(parts[0], parts.slice(1), { cwd: r.feature });
  }
  const verified = run(r.feature, ['history', 'verify-merge', '--plan', planFile]);
  assert.equal(verified.status, 0, verified.stdout + verified.stderr);
  assert.equal(await lstat(path.join(r.feature, '.yallaflow', 'work', r.fWork, 'discovery.yaml')).catch(() => null), null);
});

test('review: mapping targets are checked by kind and must cite the lineage; symlinked lineage folders and --out tricks are refused', async () => {
  const r = await divergedRepos();
  const plan = await buildPlan(r.feature, { label: 'main-v1', fromRef: 'main', fromDir: r.main });
  await importLineage(r.feature, plan, { confirm: plan.hash, fromDir: r.main });
  const decider = created(run(r.feature, ['change', 'Decide', '--scope', 'bounded']));
  await assert.rejects(mapIdentity(r.feature, 'main-v1', r.fWork, { to: '../context', relation: 'distinct', work: decider, reason: 'traversal attempt here' }), { code: 'HISTORY_UNKNOWN_TARGET' });
  await assert.rejects(mapIdentity(r.feature, 'main-v1', r.fWork, { to: decider, relation: 'distinct', work: decider, reason: 'not cited by the target' }), { code: 'HISTORY_UNCITED' });
  const out = await mkdtemp(path.join(os.tmpdir(), 'yf-out-'));
  await symlink(path.join(r.feature, '.yallaflow'), path.join(out, 'sneaky'));
  assert.equal(run(r.feature, ['history', 'plan', '--label', 'x', '--from-ref', 'main', '--out', path.join(out, 'sneaky', 'plan.json')]).status, 1);
  const lineages = path.join(r.feature, '.yallaflow', 'lineages');
  const { rename: mv } = await import('node:fs/promises');
  const elsewhere = path.join(await mkdtemp(path.join(os.tmpdir(), 'yf-elsewhere-')), 'lineages');
  await mv(lineages, elsewhere);
  await symlink(elsewhere, lineages);
  await assert.rejects(mapIdentity(r.feature, 'main-v1', 'CTX-0002', { to: 'CTX-0001', relation: 'distinct', work: decider, reason: 'through a symlinked folder' }), { code: 'HISTORY_LINEAGE_UNSAFE' });
});


test('review: merge verification checks staged blobs, modes, links and bound plans', async () => {
  const r = await divergedRepos();
  const plan = await buildPlan(r.feature, { label: 'main-v1', fromRef: 'main', fromDir: r.main });
  for (const field of ['gitResolution', 'mergeCommands']) {
    const forged = structuredClone(plan);
    forged.body[field] = [];
    forged.hash = hashOf(forged.body);
    await assert.rejects(importLineage(r.feature, forged, { confirm: forged.hash, fromDir: r.main }), { code: 'HISTORY_PLAN_MISMATCH' });
  }
  await importLineage(r.feature, plan, { confirm: plan.hash, fromDir: r.main });
  for (const command of plan.body.mergeCommands.filter((c) => c.startsWith('git restore'))) {
    const parts = command.split(' ');
    git(r.feature, parts.slice(1));
  }
  await verifyMerge(r.feature, plan);
  const rel = `.yallaflow/work/${r.fWork}/work.md`;
  const file = path.join(r.feature, rel);
  const original = await readFile(file);
  await writeFile(file, 'wrong staged bytes');
  git(r.feature, ['add', '--', rel]);
  await writeFile(file, original);
  await assert.rejects(verifyMerge(r.feature, plan), /index mode\/object differs/);
  git(r.feature, ['restore', `--source=${plan.body.workspace.head}`, '--staged', '--worktree', '--', rel]);
  git(r.feature, ['update-index', '--chmod=+x', '--', rel]);
  await assert.rejects(verifyMerge(r.feature, plan), /index mode\/object differs/);
  git(r.feature, ['restore', `--source=${plan.body.workspace.head}`, '--staged', '--worktree', '--', rel]);
  const extra = path.join(r.feature, `.yallaflow/work/${r.fWork}/extra`);
  await symlink('/etc/passwd', extra);
  await assert.rejects(verifyMerge(r.feature, plan), /extra or unsafe.*symbolic link/);
  await rm(extra);
  await link(file, extra);
  await assert.rejects(verifyMerge(r.feature, plan), /extra or unsafe.*hard-linked/);
  await rm(extra);
  const forged = structuredClone(plan);
  forged.body.gitResolution = [];
  forged.hash = hashOf(forged.body);
  await assert.rejects(verifyMerge(r.feature, forged), /planHash/);
  await verifyMerge(r.feature, plan);
});


test('review: uncommitted shared history is preserved on both sides and deleted identities fail closed', async () => {
  const r = await divergedRepos();
  const relative = `.yallaflow/work/${r.shared}/work.md`;
  await writeFile(path.join(r.main, relative), 'uncommitted shared history');
  const plan = await buildPlan(r.feature, { label: 'main-v1', fromRef: 'main', fromDir: r.main });
  assert.deepEqual(plan.body.preserve.filter((file) => file.path === relative).map((file) => file.side).sort(), ['other', 'workspace']);
  await importLineage(r.feature, plan, { confirm: plan.hash, fromDir: r.main });
  assert.equal(await readFile(path.join(r.feature, '.yallaflow/lineages/main-v1/other/work', r.shared, 'work.md'), 'utf8'), 'uncommitted shared history');
  await rm(path.join(r.main, '.yallaflow/work', r.shared), { recursive: true });
  await assert.rejects(buildPlan(r.feature, { label: 'deleted', fromRef: 'main', fromDir: r.main }), { code: 'HISTORY_DELETED_IDENTITY' });
  await rm(path.join(r.feature, '.yallaflow/work', r.shared), { recursive: true });
  await assert.rejects(buildPlan(r.feature, { label: 'deleted', fromRef: 'main' }), { code: 'HISTORY_DELETED_IDENTITY' });
});

test('review: metadata hard links and dangling preserved fact references are refused atomically', async () => {
  const r = await divergedRepos();
  const plan = await buildPlan(r.feature, { label: 'main-v1', fromRef: 'main', fromDir: r.main });
  await importLineage(r.feature, plan, { confirm: plan.hash, fromDir: r.main });
  const dir = path.join(r.feature, '.yallaflow/lineages/main-v1');
  const outside = path.join(await mkdtemp(path.join(os.tmpdir(), 'yf-meta-link-')), 'copy');
  for (const name of ['manifest.yaml', 'mappings.yaml']) {
    await link(path.join(dir, name), outside);
    await assert.rejects(verifyLineage(r.feature, 'main-v1'), { code: 'HISTORY_LINEAGE_UNSAFE' });
    await rm(outside);
  }
  await writeFile(path.join(r.main, '.yallaflow/work', r.mWork, 'knowledge.yaml'), JSON.stringify({ candidates: [{ id: 'K-001', factId: 'CTX-9999' }] }));
  const broken = await buildPlan(r.feature, { label: 'broken', fromRef: 'main', fromDir: r.main });
  await assert.rejects(importLineage(r.feature, broken, { confirm: broken.hash, fromDir: r.main }), /missing lineage fact CTX-9999/);
  assert.equal(await lstat(path.join(r.feature, '.yallaflow/lineages/broken')).catch(() => null), null);
});

test('review: doctor validates source and ADR mapping targets after creation', async () => {
  const r = await divergedRepos();
  for (const root of [r.main, r.feature]) {
    await mkdir(path.join(root, '.yallaflow/sources/SRC-0099'), { recursive: true });
    await mkdir(path.join(root, '.yallaflow/decisions'), { recursive: true });
    await writeFile(path.join(root, '.yallaflow/sources/SRC-0099/input.md'), root);
    await writeFile(path.join(root, '.yallaflow/decisions/ADR-0099.md'), root);
  }
  git(r.feature, ['add', '.yallaflow/sources', '.yallaflow/decisions']);
  git(r.feature, ['commit', '-qm', 'workspace source and ADR']);
  const plan = await buildPlan(r.feature, { label: 'main-v1', fromRef: 'main', fromDir: r.main });
  await importLineage(r.feature, plan, { confirm: plan.hash, fromDir: r.main });
  const citation = '.yallaflow/lineages/main-v1/other/';
  await mkdir(path.join(r.feature, '.yallaflow/sources/SRC-0100'));
  await writeFile(path.join(r.feature, '.yallaflow/sources/SRC-0100/input.md'), citation);
  await writeFile(path.join(r.feature, '.yallaflow/decisions/ADR-0100.md'), citation);
  await mapIdentity(r.feature, 'main-v1', 'SRC-0099', { to: 'SRC-0100', relation: 'distinct', work: r.fWork, reason: 'Independent source copied with provenance.' });
  await mapIdentity(r.feature, 'main-v1', 'ADR-0099.md', { to: 'ADR-0100.md', relation: 'distinct', work: r.fWork, reason: 'Independent decision with cited provenance.' });
  await rm(path.join(r.feature, '.yallaflow/sources/SRC-0100'), { recursive: true });
  await rm(path.join(r.feature, '.yallaflow/decisions/ADR-0100.md'));
  await assert.rejects(verifyLineage(r.feature, 'main-v1'), (error) => /names a source/.test(error.message) && /names a adr/.test(error.message));
});


test('review: checkout overlays cannot mask committed conflicts or discard dirty workspace targets', async () => {
  const r = await divergedRepos();
  const file = path.join(r.feature, '.yallaflow/work', r.fWork, 'work.md');
  const original = await readFile(file);
  await writeFile(file, 'dirty workspace history');
  await assert.rejects(buildPlan(r.feature, { label: 'dirty', fromRef: 'main', fromDir: r.main }), { code: 'HISTORY_DIRTY_TARGET' });
  await writeFile(file, original);
  const otherDir = path.join(r.main, '.yallaflow/work', r.mWork);
  await rm(otherDir, { recursive: true });
  const { cp } = await import('node:fs/promises');
  await cp(path.dirname(file), otherDir, { recursive: true });
  await assert.rejects(buildPlan(r.feature, { label: 'masked', fromRef: 'main', fromDir: r.main }), { code: 'HISTORY_CHECKOUT_CONFLICT' });
});


test('review: new uncommitted identities absent from both commits remain supported', async () => {
  const r = await divergedRepos();
  for (const [root, id] of [[r.main, 'PF-0098'], [r.feature, 'PF-0099']]) {
    await mkdir(path.join(root, '.yallaflow/work', id));
    await writeFile(path.join(root, '.yallaflow/work', id, 'work.md'), id);
  }
  const plan = await buildPlan(r.feature, { label: 'new-records', fromRef: 'main', fromDir: r.main });
  assert.equal(plan.body.inventory.find((entry) => entry.id === 'PF-0098').classification, 'other-only');
  assert.equal(plan.body.inventory.find((entry) => entry.id === 'PF-0099').classification, 'workspace-only');
  assert.ok(plan.body.preserve.some((entry) => entry.path === '.yallaflow/work/PF-0098/work.md'));
  await importLineage(r.feature, plan, { confirm: plan.hash, fromDir: r.main });
});
