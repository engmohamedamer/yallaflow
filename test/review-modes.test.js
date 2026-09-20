import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { createPendingIntake, routeWorkItem } from '../src/behavior/routing.js';
import { checkpointWork, reviseCheckpoint } from '../src/core/progress.js';
import { advanceActiveWork, reconcileStageAfterCheckpointRevision } from '../src/core/transitions.js';
import { initWorkspace, getConfig } from '../src/core/workspace.js';
import { resolveInteractionPolicy } from '../src/behavior/interaction.js';
import { loadReviews, setGateStatus } from '../src/reviews/store.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));

async function architecturalWork(mode) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-review-modes-'));
  await initWorkspace(root, 'demo', 'greenfield', mode);
  const intake = await createPendingIntake(root, 'Architectural feature');
  const meta = await routeWorkItem(root, intake.id, {
    work_type: 'feature', scope: 'architectural', confidence: 'high', reason: 'Deterministic review-mode test route.'
  });
  return { root, meta };
}

async function complete(root, meta, skillId) {
  return checkpointWork(root, meta.id, { skillId, status: 'completed', summary: `${skillId} completed.`, evidence: [] });
}

async function reachSpecReady(root, meta) {
  await complete(root, meta, 'context-discovery');
  await advanceActiveWork(root);
  await complete(root, meta, 'requirement-clarification');
  await advanceActiveWork(root);
  await complete(root, meta, 'design-exploration');
  await advanceActiveWork(root);
  await complete(root, meta, 'specification');
  await advanceActiveWork(root); // -> SPECIFICATION
}

test('default mode is adaptive', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-review-modes-default-'));
  await initWorkspace(root, 'demo', 'greenfield');
  const config = await getConfig(root);
  const policy = resolveInteractionPolicy(config);
  assert.equal(policy.mode, 'adaptive');
  assert.equal(policy.gates.specification, true);
  assert.equal(policy.gates.plan, true);
  assert.equal(policy.gates.decomposition, true);
  assert.equal(policy.gates.implementation, false);
  assert.equal(policy.gates.verification, false);
});

test('autonomous mode never adds an optional review blocker', async () => {
  const { root, meta } = await architecturalWork('autonomous');
  await reachSpecReady(root, meta);
  const transition = await advanceActiveWork(root); // SPECIFICATION -> PLAN, no gate in autonomous mode
  assert.equal(transition.to, 'PLAN');
});

test('adaptive mode blocks at the configured specification boundary until approved', async () => {
  const { root, meta } = await architecturalWork('adaptive');
  await reachSpecReady(root, meta);
  await assert.rejects(
    () => advanceActiveWork(root),
    /specification review is awaiting_review in the current interaction mode/
  );
  const cliResult = spawnSync(process.execPath, [cli, 'approve', meta.id, '--stage', 'specification', '--note', 'Looks good.'], { cwd: root, encoding: 'utf8' });
  assert.equal(cliResult.status, 0, cliResult.stderr);
  const transition = await advanceActiveWork(root);
  assert.equal(transition.to, 'PLAN');
});

test('gated mode blocks at every configured stage boundary', async () => {
  const { root, meta } = await architecturalWork('gated');
  await complete(root, meta, 'context-discovery');
  await advanceActiveWork(root); // INTAKE -> DISCOVERY (unconditional; INTAKE has no gate)
  await assert.rejects(
    () => advanceActiveWork(root), // DISCOVERY -> CLARIFICATION requires the discovery gate
    /discovery review is awaiting_review/
  );
  await setGateStatus(root, meta.id, 'discovery', 'approved');
  await advanceActiveWork(root); // -> CLARIFICATION
});

test('changes_requested keeps the gate blocked', async () => {
  const { root, meta } = await architecturalWork('adaptive');
  await reachSpecReady(root, meta);
  const cliResult = spawnSync(process.execPath, [
    cli, 'feedback', meta.id, '--stage', 'specification', '--changes-requested', '--note', 'Needs more detail.'
  ], { cwd: root, encoding: 'utf8' });
  assert.equal(cliResult.status, 0, cliResult.stderr);
  await assert.rejects(
    () => advanceActiveWork(root),
    /specification review is changes_requested/
  );
});

test('a material revision invalidates an existing approval, preserving history', async () => {
  const { root, meta } = await architecturalWork('adaptive');
  await reachSpecReady(root, meta);
  await setGateStatus(root, meta.id, 'specification', 'approved', 'Reviewed once.');
  await advanceActiveWork(root); // -> PLAN

  const revised = await reviseCheckpoint(root, meta.id, {
    skillId: 'specification', status: 'blocked', reason: 'Material business decisions remain unresolved.'
  });
  await reconcileStageAfterCheckpointRevision(root, revised.meta, 'specification', 'Material business decisions remain unresolved.');

  const { ledger } = await loadReviews(root, meta.id);
  assert.equal(ledger.gates.specification.status, 'awaiting_review');
  assert.equal(ledger.gates.specification.history.length, 2); // approved, then awaiting_review (invalidated)
  assert.equal(ledger.gates.specification.history[0].status, 'approved');
  assert.equal(ledger.gates.specification.history[1].status, 'awaiting_review');
});

test('hard safety gates cannot be bypassed by autonomous mode', async () => {
  const { root, meta } = await architecturalWork('autonomous');
  await reachSpecReady(root, meta);
  await advanceActiveWork(root); // -> PLAN
  await complete(root, meta, 'implementation-planning');
  await advanceActiveWork(root); // -> IMPLEMENTATION
  // Hard gate: cannot leave IMPLEMENTATION without the implementation checkpoint,
  // no matter the interaction mode.
  await assert.rejects(
    () => advanceActiveWork(root),
    /implementation checkpoint is pending/
  );
});
