import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { createPendingIntake, routeWorkItem } from '../src/behavior/routing.js';
import { checkpointWork, loadWorkProgress, progressFilePath, reviseCheckpoint } from '../src/core/progress.js';
import { advanceActiveWork, reconcileStageAfterCheckpointRevision } from '../src/core/transitions.js';
import { loadWorkReadiness } from '../src/behavior/readiness.js';
import { initWorkspace, workspacePath } from '../src/core/workspace.js';
import { readYaml } from '../src/core/yaml.js';
import { ensureIntentFor } from '../test-support/delivery.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));

async function routedWork(workType = 'feature', scope = 'architectural') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-checkpoint-correction-'));
  await initWorkspace(root, 'demo', 'greenfield', 'autonomous');
  const intake = await createPendingIntake(root, `${workType} ${scope} correction fixture`);
  const meta = await routeWorkItem(root, intake.id, {
    work_type: workType,
    scope,
    confidence: 'high',
    reason: 'Deterministic checkpoint correction test route.'
  });
  return { root, meta };
}

async function complete(root, meta, skillId) {
  await ensureIntentFor(root, meta.id, skillId);
  return checkpointWork(root, meta.id, { skillId, status: 'completed', summary: `${skillId} completed.`, evidence: [] });
}

async function reachSpecification(root, meta) {
  await complete(root, meta, 'context-discovery');
  await advanceActiveWork(root);
  await complete(root, meta, 'requirement-clarification');
  await advanceActiveWork(root);
  await complete(root, meta, 'design-exploration');
  await advanceActiveWork(root);
  await complete(root, meta, 'specification');
  await advanceActiveWork(root);
}

test('completed checkpoint can be revised explicitly', async () => {
  const { root, meta } = await routedWork();
  await reachSpecification(root, meta);
  const result = await reviseCheckpoint(root, meta.id, {
    skillId: 'specification',
    status: 'blocked',
    reason: 'Material business decisions remain unresolved.'
  });
  assert.equal(result.ledger.skills.specification.status, 'blocked');
  assert.equal(result.ledger.skills.specification.summary, 'Material business decisions remain unresolved.');
});

test('correction history persists', async () => {
  const { root, meta } = await routedWork();
  await reachSpecification(root, meta);
  await reviseCheckpoint(root, meta.id, {
    skillId: 'specification',
    status: 'blocked',
    reason: 'Material business decisions remain unresolved.'
  });
  const loaded = await loadWorkProgress(root, meta);
  assert.equal(loaded.ledger.history.length, 1);
  assert.deepEqual(loaded.ledger.history[0], {
    skill: 'specification',
    from: 'completed',
    to: 'blocked',
    reason: 'Material business decisions remain unresolved.',
    changedAt: loaded.ledger.history[0].changedAt
  });
  assert.ok(loaded.ledger.history[0].changedAt);
});

test('correction without reason rejected', async () => {
  const { root, meta } = await routedWork();
  await reachSpecification(root, meta);
  await assert.rejects(
    () => reviseCheckpoint(root, meta.id, { skillId: 'specification', status: 'blocked', reason: '' }),
    /requires a non-empty --reason/
  );
  const cliResult = spawnSync(process.execPath, [
    cli, 'checkpoint', 'revise', meta.id, '--skill', 'specification', '--status', 'blocked'
  ], { cwd: root, encoding: 'utf8' });
  assert.equal(cliResult.status, 1);
  assert.match(cliResult.stderr, /requires a non-empty --reason/);
});

test('restart preserves corrected state', async () => {
  const { root, meta } = await routedWork();
  await reachSpecification(root, meta);
  const cliResult = spawnSync(process.execPath, [
    cli, 'checkpoint', 'revise', meta.id,
    '--skill', 'specification', '--status', 'blocked',
    '--reason', 'Material business decisions remain unresolved.'
  ], { cwd: root, encoding: 'utf8' });
  assert.equal(cliResult.status, 0, cliResult.stderr);

  const persisted = await readYaml(progressFilePath(root, meta.id));
  assert.equal(persisted.skills.specification.status, 'blocked');
  assert.equal(persisted.history.length, 1);
  assert.equal(persisted.history[0].to, 'blocked');
});

test('corrected checkpoint can revoke readiness', async () => {
  const { root, meta } = await routedWork();
  await reachSpecification(root, meta);
  const before = await loadWorkReadiness(root, meta);
  assert.equal(before.specification.status, 'READY');
  assert.equal(before.deliveryStatus, 'SPEC_READY');

  await reviseCheckpoint(root, meta.id, {
    skillId: 'specification',
    status: 'blocked',
    reason: 'Material business decisions remain unresolved.'
  });
  const after = await loadWorkReadiness(root, meta);
  assert.equal(after.specification.status, 'BLOCKED');
  assert.equal(after.deliveryStatus, null);
});

test('lifecycle never silently contradicts checkpoint state', async () => {
  const { root, meta } = await routedWork();
  await reachSpecification(root, meta);
  const beforeMeta = await readYaml(path.join(workspacePath(root), 'work', meta.id, 'meta.yaml'));
  assert.equal(beforeMeta.status, 'SPECIFICATION');

  const revised = await reviseCheckpoint(root, meta.id, {
    skillId: 'specification',
    status: 'blocked',
    reason: 'Material business decisions remain unresolved.'
  });
  const stageCorrection = await reconcileStageAfterCheckpointRevision(root, revised.meta, 'specification');
  assert.equal(stageCorrection, null);

  const afterMeta = await readYaml(path.join(workspacePath(root), 'work', meta.id, 'meta.yaml'));
  assert.equal(afterMeta.status, 'SPECIFICATION');

  await complete(root, meta, 'design-exploration');
  const alreadyCompleteMeta = await readYaml(path.join(workspacePath(root), 'work', meta.id, 'meta.yaml'));
  assert.equal(alreadyCompleteMeta.status, 'SPECIFICATION');
});

test('reverting an earlier stage checkpoint corrects the current stage backward', async () => {
  const { root, meta } = await routedWork();
  await reachSpecification(root, meta);
  await complete(root, meta, 'implementation-planning');
  await advanceActiveWork(root);
  const beforeMeta = await readYaml(path.join(workspacePath(root), 'work', meta.id, 'meta.yaml'));
  assert.equal(beforeMeta.status, 'PLAN');

  const cliResult = spawnSync(process.execPath, [
    cli, 'checkpoint', 'revise', meta.id,
    '--skill', 'design-exploration', '--status', 'blocked',
    '--reason', 'A boundary decision needs revisiting.'
  ], { cwd: root, encoding: 'utf8' });
  assert.equal(cliResult.status, 0, cliResult.stderr);
  assert.match(cliResult.stdout, /Stage corrected: PLAN → DESIGN/);

  const afterMeta = await readYaml(path.join(workspacePath(root), 'work', meta.id, 'meta.yaml'));
  assert.equal(afterMeta.status, 'DESIGN');
  const state = await readYaml(path.join(workspacePath(root), 'state', 'current.yaml'));
  assert.equal(state.stage, 'DESIGN');

  // Stage (where work currently is) and delivery readiness (what deliverable is ready) are
  // deliberately independent: the specification and plan checkpoints themselves were not
  // revised, so the documents they represent remain a valid, ready deliverable even while
  // the workflow stage has been corrected backward to reflect design being revisited.
  const readiness = await loadWorkReadiness(root, { ...meta, status: afterMeta.status });
  assert.equal(readiness.plan.status, 'READY');
  assert.equal(readiness.deliveryStatus, 'PLAN_READY');
});
