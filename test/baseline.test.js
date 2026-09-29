import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { checkpointWork } from '../src/core/progress.js';
import { getCurrentState, initWorkspace, workspacePath } from '../src/core/workspace.js';
import { readYaml } from '../src/core/yaml.js';
import { approveBaseline, draftBaseline, findBaselineWork, loadBaseline, startBaseline } from '../src/baseline/store.js';
import { loadReviews } from '../src/reviews/store.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));

async function freshRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-baseline-'));
  await initWorkspace(root, 'demo', 'brownfield');
  return root;
}

async function completeCheckpoint(root, workId) {
  return checkpointWork(root, workId, { skillId: 'repository-baseline', status: 'completed', summary: 'Discovery complete.', evidence: [] });
}

const SAMPLE_FACTS = {
  facts: [
    { area: 'tech-stack', status: 'confirmed', summary: 'Node.js project.', evidence: ['package.json'], source: 'repository' },
    { area: 'database', status: 'inferred', summary: 'Likely uses PostgreSQL.', evidence: ['compose.yaml'], source: 'repository' },
    { area: 'project', status: 'unresolved', summary: 'Production hosting cannot be established.', evidence: ['.env.example'], source: 'repository' }
  ]
};

test('a brownfield baseline can be started with no active work', async () => {
  const root = await freshRoot();
  const state = await getCurrentState(root);
  assert.equal(state.activeWork, null);
  const { meta, created } = await startBaseline(root);
  assert.equal(created, true);
  assert.equal(meta.type, 'investigation');
  assert.equal(meta.baseline, true);
});

test('baseline discovery is read-only', async () => {
  const root = await freshRoot();
  const { meta } = await startBaseline(root);
  assert.equal(meta.readOnly, true);
  const result = spawnSync(process.execPath, [cli, 'guide', meta.id], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /NOT AUTHORIZED/);
});

test('baseline reuses normal YallaFlow work primitives (checkpoint, work item, progress ledger)', async () => {
  const root = await freshRoot();
  const { meta } = await startBaseline(root);
  const result = await completeCheckpoint(root, meta.id);
  assert.equal(result.checkpoint.status, 'completed');
  assert.equal(await findBaselineWork(root).then((w) => w.id), meta.id);
});

test('draft requires the repository-baseline checkpoint to be completed first', async () => {
  const root = await freshRoot();
  const { meta } = await startBaseline(root);
  await assert.rejects(() => draftBaseline(root, meta.id, SAMPLE_FACTS), /Complete the repository-baseline checkpoint/);
});

test('a confirmed fact requires evidence', async () => {
  const root = await freshRoot();
  const { meta } = await startBaseline(root);
  await completeCheckpoint(root, meta.id);
  await assert.rejects(
    () => draftBaseline(root, meta.id, { facts: [{ area: 'tech-stack', status: 'confirmed', summary: 'Node.js.', evidence: [], source: 'repository' }] }),
    /evidence must be a non-empty array/
  );
});

test('an inferred fact requires evidence', async () => {
  const root = await freshRoot();
  const { meta } = await startBaseline(root);
  await completeCheckpoint(root, meta.id);
  await assert.rejects(
    () => draftBaseline(root, meta.id, { facts: [{ area: 'database', status: 'inferred', summary: 'Probably Postgres.', evidence: [], source: 'repository' }] }),
    /evidence must be a non-empty array/
  );
});

test('an unresolved fact is representable', async () => {
  const root = await freshRoot();
  const { meta } = await startBaseline(root);
  await completeCheckpoint(root, meta.id);
  const { ledger } = await draftBaseline(root, meta.id, SAMPLE_FACTS);
  const unresolved = ledger.facts.find((fact) => fact.status === 'unresolved');
  assert.ok(unresolved);
  assert.equal(unresolved.area, 'project');
});

test('repository/runtime/user-confirmed provenance is preserved', async () => {
  const root = await freshRoot();
  const { meta } = await startBaseline(root);
  await completeCheckpoint(root, meta.id);
  const { ledger } = await draftBaseline(root, meta.id, {
    facts: [
      { area: 'environment', status: 'confirmed', summary: 'Docker daemon reachable.', evidence: ['docker info output'], source: 'runtime' },
      { area: 'business-rule', status: 'confirmed', summary: 'Refunds require manager approval.', evidence: ['user confirmation'], source: 'user-confirmed' }
    ]
  });
  assert.equal(ledger.facts[0].source, 'runtime');
  assert.equal(ledger.facts[1].source, 'user-confirmed');
});

test('a draft baseline does not mutate durable project context until approved', async () => {
  const root = await freshRoot();
  const { meta } = await startBaseline(root);
  await completeCheckpoint(root, meta.id);
  await draftBaseline(root, meta.id, SAMPLE_FACTS);
  const techStack = await readFile(path.join(workspacePath(root), 'context', 'tech-stack.md'), 'utf8');
  assert.doesNotMatch(techStack, /Node\.js project\./);
  const project = await readFile(path.join(workspacePath(root), 'PROJECT.md'), 'utf8');
  assert.doesNotMatch(project, /Production hosting/);
});

test('baseline approval promotes drafted facts into durable project docs', async () => {
  const root = await freshRoot();
  const { meta } = await startBaseline(root);
  await completeCheckpoint(root, meta.id);
  await draftBaseline(root, meta.id, SAMPLE_FACTS);
  const { ledger } = await approveBaseline(root, meta.id, 'Reviewed.');
  assert.equal(ledger.status, 'approved');
  const { ledger: reviewLedger } = await loadReviews(root, meta.id);
  assert.equal(reviewLedger.gates.baseline.status, 'approved');
});

test('changes-requested does not promote a stale draft', async () => {
  const root = await freshRoot();
  const { meta } = await startBaseline(root);
  await completeCheckpoint(root, meta.id);
  await draftBaseline(root, meta.id, SAMPLE_FACTS);
  const feedback = spawnSync(process.execPath, [cli, 'baseline', 'feedback', meta.id, '--changes-requested', '--note', 'Need more evidence.'], { cwd: root, encoding: 'utf8' });
  assert.equal(feedback.status, 0, feedback.stderr);
  const { ledger } = await loadBaseline(root, meta.id);
  assert.equal(ledger.status, 'draft');
  const techStack = await readFile(path.join(workspacePath(root), 'context', 'tech-stack.md'), 'utf8');
  assert.doesNotMatch(techStack, /Node\.js project\./);
});

test('PROJECT.md is updated after approval', async () => {
  const root = await freshRoot();
  const { meta } = await startBaseline(root);
  await completeCheckpoint(root, meta.id);
  await draftBaseline(root, meta.id, SAMPLE_FACTS);
  await approveBaseline(root, meta.id);
  const project = await readFile(path.join(workspacePath(root), 'PROJECT.md'), 'utf8');
  assert.match(project, /Production hosting cannot be established/);
  assert.match(project, /\*\*Confidence:\*\* unresolved/);
});

test('context docs are populated after approval, and prior deterministic content is preserved', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-baseline-'));
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'demo' }), 'utf8');
  // v0.3.9: a manifest alone is not Brownfield; one recognized source file corroborates it.
  await writeFile(path.join(root, 'index.js'), 'export {};\n', 'utf8');
  const init = spawnSync(process.execPath, [cli, 'init'], { cwd: root, encoding: 'utf8' });
  assert.equal(init.status, 0, init.stderr);
  const { meta } = await startBaseline(root);
  await completeCheckpoint(root, meta.id);
  await draftBaseline(root, meta.id, SAMPLE_FACTS);
  await approveBaseline(root, meta.id);
  const techStack = await readFile(path.join(workspacePath(root), 'context', 'tech-stack.md'), 'utf8');
  assert.match(techStack, /Deterministically discovered during YallaFlow bootstrap/);
  assert.match(techStack, /Node\.js project\./);
  const database = await readFile(path.join(workspacePath(root), 'context', 'database.md'), 'utf8');
  assert.match(database, /Likely uses PostgreSQL/);
  assert.match(database, /\*\*Confidence:\*\* inferred/);
});

test('a fresh agent can consume an approved baseline without rediscovery', async () => {
  const root = await freshRoot();
  const { meta } = await startBaseline(root);
  await completeCheckpoint(root, meta.id);
  await draftBaseline(root, meta.id, SAMPLE_FACTS);
  await approveBaseline(root, meta.id);
  const doctor = spawnSync(process.execPath, [cli, 'doctor'], { cwd: root, encoding: 'utf8' });
  assert.equal(doctor.status, 0, doctor.stdout);
  const meta2 = await readYaml(path.join(workspacePath(root), 'work', meta.id, 'meta.yaml'));
  assert.equal(meta2.status, 'DONE');
});

test('baseline never treats prior chat/conversation text as evidence — evidence must be explicit references', async () => {
  const root = await freshRoot();
  const { meta } = await startBaseline(root);
  await completeCheckpoint(root, meta.id);
  await assert.rejects(
    () => draftBaseline(root, meta.id, { facts: [{ area: 'architecture', status: 'confirmed', summary: 'X', source: 'repository' }] }),
    /evidence must be a non-empty array/
  );
});

test('greenfield projects are unaffected by the baseline subsystem', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-baseline-greenfield-'));
  await initWorkspace(root, 'demo', 'greenfield');
  const found = await findBaselineWork(root);
  assert.equal(found, null);
  const result = spawnSync(process.execPath, [cli, 'status'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Work items: 0/);
});

test('starting a baseline after one is already approved is refused, with no workspace mutation', async () => {
  const root = await freshRoot();
  const { meta } = await startBaseline(root);
  await completeCheckpoint(root, meta.id);
  await draftBaseline(root, meta.id, SAMPLE_FACTS);
  await approveBaseline(root, meta.id);

  const before = JSON.stringify(await readYaml(path.join(workspacePath(root), 'work', meta.id, 'baseline.yaml')));
  const techStackBefore = await readFile(path.join(workspacePath(root), 'context', 'tech-stack.md'), 'utf8');

  await assert.rejects(
    () => startBaseline(root),
    /An approved Brownfield Baseline already exists\.\n\nBaseline refresh is not supported in this release\./
  );

  const after = JSON.stringify(await readYaml(path.join(workspacePath(root), 'work', meta.id, 'baseline.yaml')));
  const techStackAfter = await readFile(path.join(workspacePath(root), 'context', 'tech-stack.md'), 'utf8');
  assert.equal(after, before);
  assert.equal(techStackAfter, techStackBefore);

  // No duplicate baseline work item, and no competing second source of truth.
  const work = await (await import('../src/core/workspace.js')).listWork(root);
  assert.equal(work.filter((item) => item.baseline === true).length, 1);
});

test('CLI: baseline start after approval is refused with an actionable message', async () => {
  const root = await freshRoot();
  const start = spawnSync(process.execPath, [cli, 'baseline', 'start'], { cwd: root, encoding: 'utf8' });
  const workId = /^(PF-\d+)/.exec(start.stdout)[1];
  spawnSync(process.execPath, [cli, 'checkpoint', workId, '--skill', 'repository-baseline', '--complete', '--summary', 'x'], { cwd: root });
  await writeFile(path.join(root, 'baseline.json'), JSON.stringify(SAMPLE_FACTS), 'utf8');
  spawnSync(process.execPath, [cli, 'baseline', 'draft', workId, '--file', 'baseline.json'], { cwd: root });
  spawnSync(process.execPath, [cli, 'baseline', 'approve', workId], { cwd: root });

  const second = spawnSync(process.execPath, [cli, 'baseline', 'start'], { cwd: root, encoding: 'utf8' });
  assert.equal(second.status, 1);
  assert.match(second.stderr, /An approved Brownfield Baseline already exists/);
  assert.match(second.stderr, /Baseline refresh is not supported in this release/);
  assert.match(second.stderr, /Use normal YallaFlow work and knowledge promotion/);

  const doctor = spawnSync(process.execPath, [cli, 'doctor'], { cwd: root, encoding: 'utf8' });
  assert.equal(doctor.status, 0, doctor.stdout);
});

test('CLI: baseline start is idempotent and resumes the existing work item', async () => {
  const root = await freshRoot();
  const first = spawnSync(process.execPath, [cli, 'baseline', 'start'], { cwd: root, encoding: 'utf8' });
  assert.equal(first.status, 0, first.stderr);
  const workId = /^(PF-\d+)/.exec(first.stdout)[1];
  const second = spawnSync(process.execPath, [cli, 'baseline', 'start'], { cwd: root, encoding: 'utf8' });
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, new RegExp(workId));
  const work = await (await import('../src/core/workspace.js')).listWork(root);
  assert.equal(work.length, 1);
});

test('CLI: full baseline flow end to end from a real JSON file', async () => {
  const root = await freshRoot();
  const start = spawnSync(process.execPath, [cli, 'baseline', 'start'], { cwd: root, encoding: 'utf8' });
  assert.equal(start.status, 0, start.stderr);
  const workId = /^(PF-\d+)/.exec(start.stdout)[1];
  const checkpoint = spawnSync(process.execPath, [
    cli, 'checkpoint', workId, '--skill', 'repository-baseline', '--complete', '--summary', 'Discovered.'
  ], { cwd: root, encoding: 'utf8' });
  assert.equal(checkpoint.status, 0, checkpoint.stderr);

  await writeFile(path.join(root, 'baseline.json'), JSON.stringify(SAMPLE_FACTS), 'utf8');
  const draft = spawnSync(process.execPath, [cli, 'baseline', 'draft', workId, '--file', 'baseline.json'], { cwd: root, encoding: 'utf8' });
  assert.equal(draft.status, 0, draft.stderr);

  const status = spawnSync(process.execPath, [cli, 'baseline', 'status', workId], { cwd: root, encoding: 'utf8' });
  assert.equal(status.status, 0, status.stderr);
  assert.match(status.stdout, /Baseline status: draft/);

  const approve = spawnSync(process.execPath, [cli, 'baseline', 'approve', workId], { cwd: root, encoding: 'utf8' });
  assert.equal(approve.status, 0, approve.stderr);
  assert.match(approve.stdout, /DONE/);

  const doctor = spawnSync(process.execPath, [cli, 'doctor'], { cwd: root, encoding: 'utf8' });
  assert.equal(doctor.status, 0, doctor.stdout);
  assert.match(doctor.stdout, /Workspace healthy\./);
});
