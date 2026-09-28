import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { createPendingIntake, routeWorkItem } from '../src/behavior/routing.js';
import { checkpointWork } from '../src/core/progress.js';
import { advanceActiveWork } from '../src/core/transitions.js';
import { recordVerification } from '../src/core/evidence.js';
import { reviewKnowledgeNone } from '../src/knowledge/store.js';
import { initWorkspace, workspacePath } from '../src/core/workspace.js';
import { ensureIntentFor, pinRegistryV4Contract } from '../test-support/delivery.js';
import { readYaml } from '../src/core/yaml.js';
import { executeDecomposition, proposeDecomposition, validateDecomposition } from '../src/decomposition/store.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));

async function routedWork(workType = 'bug', scope = 'bounded') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-handoff-'));
  await initWorkspace(root, 'demo', 'greenfield', 'autonomous');
  const intake = await createPendingIntake(root, `${workType} ${scope} handoff fixture`);
  const meta = await routeWorkItem(root, intake.id, {
    work_type: workType, scope, confidence: 'high', reason: 'Deterministic handoff test route.'
  });
  return { root, meta };
}

async function complete(root, workId, skillId, evidence = []) {
  await ensureIntentFor(root, workId, skillId);
  return checkpointWork(root, workId, { skillId, status: 'completed', summary: `${skillId} completed.`, evidence });
}

test('handoff works for active work', async () => {
  const { root, meta } = await routedWork();
  await complete(root, meta.id, 'context-discovery');
  const result = spawnSync(process.execPath, [cli, 'handoff'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(`^${meta.id} —`));
  assert.match(result.stdout, /Current\/incomplete skill: systematic-debugging/);
  assert.match(result.stdout, /Application code modification: NOT AUTHORIZED/);
});

test('handoff works for DONE work', async () => {
  const { root, meta } = await routedWork();
  await complete(root, meta.id, 'context-discovery');
  await complete(root, meta.id, 'systematic-debugging', ['evidence/root-cause.txt']);
  for (let index = 0; index < 7; index++) await advanceActiveWork(root); // -> IMPLEMENTATION
  await complete(root, meta.id, 'implementation');
  await advanceActiveWork(root); // -> VERIFICATION
  await recordVerification(root, meta.id, { command: 'true', success: true, exitCode: 0 });
  await complete(root, meta.id, 'verification');
  await reviewKnowledgeNone(root, meta.id);
  await advanceActiveWork(root); // -> DONE

  const result = spawnSync(process.execPath, [cli, 'handoff', meta.id], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Stage: DONE/);
  assert.match(result.stdout, /Verification: passed/);
});

test('handoff works for an explicit non-active work ID and is read-only', async () => {
  const { root, meta: first } = await routedWork();
  const secondIntake = await createPendingIntake(root, 'A second unrelated request');
  const before = await readYaml(path.join(workspacePath(root), 'state', 'current.yaml'));
  assert.equal(before.activeWork, secondIntake.id);

  const result = spawnSync(process.execPath, [cli, 'handoff', first.id], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(`^${first.id} —`));
  assert.match(result.stdout, /read-only inspection/);

  const after = await readYaml(path.join(workspacePath(root), 'state', 'current.yaml'));
  assert.deepEqual(after, before);
});

test('handoff includes blockers, open questions, and review-gate state', async () => {
  const { root, meta } = await routedWork('feature', 'architectural');
  await complete(root, meta.id, 'context-discovery');
  const result = spawnSync(process.execPath, [cli, 'handoff', meta.id], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Blockers:/);
  assert.match(result.stdout, /Knowledge review: pending/);
});

test('parent handoff includes child progress, dependencies, and traceability gaps', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-handoff-parent-'));
  await initWorkspace(root, 'demo', 'greenfield', 'autonomous');
  const intake = await createPendingIntake(root, 'Nice Day Contract Hub');
  const meta = await routeWorkItem(root, intake.id, { work_type: 'feature', scope: 'architectural', confidence: 'high', reason: 'r' });
  // Free-form traceability labels (FR-01) are the model for parents without a
  // requirements ledger: a v0.3.7-routed (Registry v4) parent.
  await pinRegistryV4Contract(root, meta.id);
  await complete(root, meta.id, 'context-discovery');
  await advanceActiveWork(root);
  await complete(root, meta.id, 'requirement-clarification');
  await advanceActiveWork(root);
  await complete(root, meta.id, 'design-exploration');
  await advanceActiveWork(root);
  await complete(root, meta.id, 'specification');
  await advanceActiveWork(root);
  await advanceActiveWork(root); // -> PLAN
  await complete(root, meta.id, 'implementation-planning');

  await proposeDecomposition(root, meta.id, {
    children: [
      { key: 'a', title: 'Foundation', type: 'feature', scope: 'bounded', requirements: ['FR-01'] },
      { key: 'b', title: 'Signing', type: 'feature', scope: 'bounded', dependsOn: ['a'] }
    ],
    requirementsUniverse: ['FR-01', 'FR-02']
  });
  await validateDecomposition(root, meta.id);
  await executeDecomposition(root, meta.id);

  const result = spawnSync(process.execPath, [cli, 'handoff', meta.id], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--- Decomposition \(executing\) ---/);
  assert.match(result.stdout, /Next executable candidates:/);
  assert.match(result.stdout, /Unresolved traceability gaps: FR-02/);
});

test('handoff never mutates workspace state or Git', async () => {
  const { root, meta } = await routedWork();
  await complete(root, meta.id, 'context-discovery');
  const before = await readYaml(path.join(workspacePath(root), 'state', 'current.yaml'));
  spawnSync(process.execPath, [cli, 'handoff', meta.id], { cwd: root, encoding: 'utf8' });
  const after = await readYaml(path.join(workspacePath(root), 'state', 'current.yaml'));
  assert.deepEqual(after, before);
});
