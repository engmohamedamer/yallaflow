import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { buildBehaviorGuidance } from '../src/behavior/guidance.js';
import { createPendingIntake, routeWorkItem } from '../src/behavior/routing.js';
import { checkpointWork, loadWorkProgress, progressFilePath, summarizeProgress } from '../src/core/progress.js';
import { advanceActiveWork } from '../src/core/transitions.js';
import { createWorkItem, initWorkspace, workspacePath } from '../src/core/workspace.js';
import { readYaml } from '../src/core/yaml.js';
import { recordVerification } from '../src/core/evidence.js';
import { exists } from '../src/utils/fs.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));

async function routedWork(workType = 'bug', scope = 'bounded') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-progress-'));
  await initWorkspace(root, 'demo', 'greenfield', 'autonomous');
  const intake = await createPendingIntake(root, `${workType} ${scope} request`);
  const meta = await routeWorkItem(root, intake.id, {
    work_type: workType,
    scope,
    confidence: 'high',
    reason: 'Deterministic progress test route.'
  });
  return { root, meta };
}

async function complete(root, meta, skillId, extra = {}) {
  return checkpointWork(root, meta.id, {
    skillId,
    status: 'completed',
    summary: `${skillId} completed.`,
    evidence: [],
    ...extra
  });
}

test('checkpoint starts a skill and creates the durable ledger', async () => {
  const { root, meta } = await routedWork();
  assert.equal(await exists(progressFilePath(root, meta.id)), false);
  const result = await checkpointWork(root, meta.id, {
    skillId: 'context-discovery',
    status: 'in_progress',
    evidence: []
  });
  assert.equal(result.checkpoint.status, 'in_progress');
  assert.ok(result.checkpoint.startedAt);
  assert.equal(await exists(progressFilePath(root, meta.id)), true);
});

test('checkpoint completes a skill with durable summary and timestamps', async () => {
  const { root, meta } = await routedWork();
  const result = await complete(root, meta, 'context-discovery');
  assert.equal(result.checkpoint.status, 'completed');
  assert.equal(result.checkpoint.summary, 'context-discovery completed.');
  assert.ok(result.checkpoint.startedAt);
  assert.ok(result.checkpoint.completedAt);
});

test('checkpoint progress survives a separate CLI process', async () => {
  const { root, meta } = await routedWork();
  const result = spawnSync(process.execPath, [
    cli, 'checkpoint', meta.id, '--skill', 'context-discovery', '--complete',
    '--summary', 'Repository context located.', '--evidence', 'src/'
  ], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const loaded = await loadWorkProgress(root, meta);
  assert.equal(loaded.ledger.skills['context-discovery'].status, 'completed');
  assert.deepEqual(loaded.ledger.skills['context-discovery'].evidence, ['src/']);
});

test('checkpoint completion rejects unmet skill prerequisites', async () => {
  const { root, meta } = await routedWork('feature', 'architectural');
  await assert.rejects(
    () => complete(root, meta, 'design-exploration'),
    /complete prerequisite skill\(s\) first: context-discovery, requirement-clarification/
  );
});

test('blocked checkpoint is visible in resume', async () => {
  const { root, meta } = await routedWork();
  await checkpointWork(root, meta.id, {
    skillId: 'context-discovery',
    status: 'blocked',
    summary: 'Repository access is unavailable.',
    evidence: []
  });
  const result = spawnSync(process.execPath, [cli, 'resume'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Blocked:\n! context-discovery — Repository access is unavailable\./);
  assert.match(result.stdout, /Resolve the blocker recorded for context-discovery/);
});

test('completed skill is not selected as current work again', async () => {
  const { root, meta } = await routedWork();
  const result = await complete(root, meta, 'context-discovery');
  const summary = summarizeProgress(result.contract, result.ledger);
  assert.equal(summary.current.skillId, 'systematic-debugging');
  assert.equal(summary.current.status, 'pending');
});

test('checkpoint evidence persists structurally', async () => {
  const { root, meta } = await routedWork();
  await complete(root, meta, 'context-discovery', { evidence: ['src/behavior/routing.js', 'test/routing.test.js'] });
  const persisted = await readYaml(progressFilePath(root, meta.id));
  assert.deepEqual(persisted.skills['context-discovery'].evidence, ['src/behavior/routing.js', 'test/routing.test.js']);
});

test('verification checkpoint uses the existing verification evidence gate', async () => {
  const { root, meta } = await routedWork();
  await assert.rejects(
    () => complete(root, meta, 'verification'),
    /fresh successful evidence from `yallaflow verify/
  );
  await recordVerification(root, meta.id, {
    command: 'node --test',
    success: true,
    exitCode: 0,
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:00:01.000Z',
    log: 'verification.log'
  });
  assert.equal((await complete(root, meta, 'verification')).checkpoint.status, 'completed');
});

test('local rulings persist in the work progress ledger', async () => {
  const { root, meta } = await routedWork();
  await checkpointWork(root, meta.id, {
    ruling: {
      decision: 'Reuse the existing upload boundary',
      reason: 'It is the established service interface.',
      costIfWrong: 'The integration may require later refactoring.'
    }
  });
  const persisted = await readYaml(progressFilePath(root, meta.id));
  assert.deepEqual(persisted.rulings[0], {
    decision: 'Reuse the existing upload boundary',
    reason: 'It is the established service interface.',
    costIfWrong: 'The integration may require later refactoring.',
    createdAt: persisted.rulings[0].createdAt
  });
  assert.ok(persisted.rulings[0].createdAt);
});

test('investigation never gains write authorization after all checkpoints complete', async () => {
  const { root, meta } = await routedWork('investigation', 'bounded');
  await complete(root, meta, 'context-discovery');
  await complete(root, meta, 'systematic-debugging');
  const result = await complete(root, meta, 'verification');
  const guidance = buildBehaviorGuidance(meta, 'CONCLUSION', result.ledger);
  assert.equal(guidance.modification.authorized, false);
  assert.equal(guidance.modification.reason, 'work policy is read-only');
});

test('implementation checkpoint cannot start before the workflow write stage', async () => {
  const { root, meta } = await routedWork();
  await assert.rejects(
    () => checkpointWork(root, meta.id, { skillId: 'implementation', status: 'in_progress', evidence: [] }),
    /Cannot start implementation at workflow stage INTAKE/
  );
});

test('bug cannot enter implementation before debugging checkpoint', async () => {
  const { root } = await routedWork();
  for (let index = 0; index < 6; index++) await advanceActiveWork(root);
  await assert.rejects(
    () => advanceActiveWork(root),
    /complete required checkpoint\(s\) first: context-discovery, systematic-debugging/
  );
});

test('bug can enter implementation after required debugging checkpoints', async () => {
  const { root, meta } = await routedWork();
  await complete(root, meta, 'context-discovery');
  await complete(root, meta, 'systematic-debugging', { evidence: ['evidence/root-cause.txt'] });
  for (let index = 0; index < 6; index++) await advanceActiveWork(root);
  assert.equal((await advanceActiveWork(root)).to, 'IMPLEMENTATION');
  const progress = await loadWorkProgress(root, meta);
  assert.equal(buildBehaviorGuidance(meta, 'IMPLEMENTATION', progress.ledger).modification.authorized, true);
});

test('architectural feature requires all pre-implementation skills', async () => {
  const { root, meta } = await routedWork('feature', 'architectural');
  assert.equal((await advanceActiveWork(root)).to, 'DISCOVERY');
  await assert.rejects(() => advanceActiveWork(root), /context-discovery checkpoint is pending/);
  await complete(root, meta, 'context-discovery');
  assert.equal((await advanceActiveWork(root)).to, 'CLARIFICATION');
  await assert.rejects(() => advanceActiveWork(root), /requirement-clarification checkpoint is pending/);
  await complete(root, meta, 'requirement-clarification');
  assert.equal((await advanceActiveWork(root)).to, 'DESIGN');
  await assert.rejects(() => advanceActiveWork(root), /design-exploration checkpoint is pending/);
  await complete(root, meta, 'design-exploration');
  assert.equal((await advanceActiveWork(root)).to, 'SPECIFICATION');
  await assert.rejects(() => advanceActiveWork(root), /specification checkpoint is pending/);
  await complete(root, meta, 'specification');
  assert.equal((await advanceActiveWork(root)).to, 'PLAN');
  await assert.rejects(() => advanceActiveWork(root), /implementation-planning checkpoint is pending/);
  await complete(root, meta, 'implementation-planning');
  assert.equal((await advanceActiveWork(root)).to, 'IMPLEMENTATION');
});

test('v0.2.2 work without a ledger is readable as all pending', async () => {
  const { root, meta } = await routedWork();
  const loaded = await loadWorkProgress(root, meta);
  assert.equal(loaded.exists, false);
  assert.equal(summarizeProgress(loaded.contract, loaded.ledger).pending.length, 4);
});

test('reading and presenting work without a ledger does not create one', async () => {
  const { root, meta } = await routedWork();
  const guide = spawnSync(process.execPath, [cli, 'guide', meta.id], { cwd: root, encoding: 'utf8' });
  const resume = spawnSync(process.execPath, [cli, 'resume'], { cwd: root, encoding: 'utf8' });
  assert.equal(guide.status, 0, guide.stderr);
  assert.equal(resume.status, 0, resume.stderr);
  assert.equal(await exists(progressFilePath(root, meta.id)), false);
});

test('v0.2.1 derived Behavior Contract supports checkpoints without metadata mutation', async () => {
  const { root, meta } = await routedWork();
  const metaFile = path.join(workspacePath(root), 'work', meta.id, 'meta.yaml');
  const legacy = await readYaml(metaFile);
  delete legacy.behaviorContract;
  await writeFile(metaFile, `${JSON.stringify(legacy, null, 2)}\n`);
  const before = await readFile(metaFile, 'utf8');
  const result = await complete(root, legacy, 'context-discovery');
  assert.equal(result.contract.label, 'derived (legacy v0.2.1)');
  assert.equal(await readFile(metaFile, 'utf8'), before);
});

test('v0.1 work still loads without creating a ledger', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-progress-v01-'));
  await initWorkspace(root, 'demo', 'greenfield');
  const meta = await createWorkItem(root, 'bug', 'Legacy bug', 'bounded');
  const loaded = await loadWorkProgress(root, meta);
  assert.equal(loaded.contract.skills.length, 0);
  assert.equal(loaded.exists, false);
  assert.equal(await exists(progressFilePath(root, meta.id)), false);
});

test('guide uses current checkpoint state', async () => {
  const { root, meta } = await routedWork();
  await complete(root, meta, 'context-discovery');
  await checkpointWork(root, meta.id, {
    skillId: 'systematic-debugging',
    status: 'in_progress',
    summary: 'Reproduced the response failure.',
    evidence: ['curl-response.txt']
  });
  const result = spawnSync(process.execPath, [cli, 'guide', meta.id], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /✓ context-discovery/);
  assert.match(result.stdout, /→ systematic-debugging/);
  assert.match(result.stdout, /Complete the systematic-debugging checkpoint/);
});

test('status shows concise skill progress', async () => {
  const { root, meta } = await routedWork();
  await complete(root, meta, 'context-discovery');
  const result = spawnSync(process.execPath, [cli, 'status'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(`${meta.id} — .*\\nbug / bounded\\nStage: INTAKE`));
  assert.match(result.stdout, /Delivery: not ready/);
  assert.match(result.stdout, /Behavior: 1\/4 completed/);
  assert.match(result.stdout, /Current skill: systematic-debugging/);
  assert.match(result.stdout, /Write access: blocked/);
});

test('checkpoint on an unknown skill fails clearly', async () => {
  const { root, meta } = await routedWork();
  await assert.rejects(
    () => checkpointWork(root, meta.id, { skillId: 'missing-skill', status: 'in_progress', evidence: [] }),
    /Unknown skill "missing-skill"/
  );
});

test('checkpoint on a skill outside the Behavior Contract fails clearly', async () => {
  const { root, meta } = await routedWork('feature', 'bounded');
  await assert.rejects(
    () => checkpointWork(root, meta.id, { skillId: 'systematic-debugging', status: 'in_progress', evidence: [] }),
    /outside the Behavior Contract/
  );
});

test('repeated completion is idempotent', async () => {
  const { root, meta } = await routedWork();
  await complete(root, meta, 'context-discovery');
  const before = await readFile(progressFilePath(root, meta.id), 'utf8');
  const result = await complete(root, meta, 'context-discovery', { summary: 'Different summary.', evidence: ['different.txt'] });
  const after = await readFile(progressFilePath(root, meta.id), 'utf8');
  assert.equal(result.unchanged, true);
  assert.equal(after, before);
});

test('progress is never duplicated into state/current', async () => {
  const { root, meta } = await routedWork();
  await complete(root, meta, 'context-discovery');
  const state = await readYaml(path.join(workspacePath(root), 'state', 'current.yaml'));
  assert.deepEqual(Object.keys(state).sort(), ['activeWork', 'schemaVersion', 'stage', 'updatedAt']);
});
