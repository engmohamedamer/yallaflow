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
import { createRoutedWork } from '../src/behavior/routing.js';
import { readYaml } from '../src/core/yaml.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));

async function routedWork(workType = 'bug', scope = 'bounded') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-resume-explicit-'));
  await initWorkspace(root, 'demo', 'greenfield');
  const intake = await createPendingIntake(root, `${workType} ${scope} resume fixture`);
  const meta = await routeWorkItem(root, intake.id, {
    work_type: workType, scope, confidence: 'high', reason: 'Deterministic resume test route.'
  });
  return { root, meta };
}

test('resume with no ID inspects the active work item', async () => {
  const { root, meta } = await routedWork();
  const result = spawnSync(process.execPath, [cli, 'resume'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(`^${meta.id} —`));
  assert.doesNotMatch(result.stdout, /inspecting/);
});

test('resume with an explicit ID reads that work item without mutating the active pointer', async () => {
  const { root, meta: first } = await routedWork();
  const second = await createRoutedWork(root, 'Second item', { work_type: 'feature', scope: 'bounded', confidence: 'high', reason: 'Test fixture.', title: 'Second item' });

  const before = await readYaml(path.join(workspacePath(root), 'state', 'current.yaml'));
  assert.equal(before.activeWork, second.id);

  const result = spawnSync(process.execPath, [cli, 'resume', first.id], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(`^${first.id} —`));
  assert.match(result.stdout, new RegExp(`inspecting ${first.id} only`));
  assert.match(result.stdout, new RegExp(`Current workspace focus remains ${second.id}`));

  const after = await readYaml(path.join(workspacePath(root), 'state', 'current.yaml'));
  assert.deepEqual(after, before);
});

test('resume on an unknown work ID fails with an actionable error', async () => {
  const { root } = await routedWork();
  const result = spawnSync(process.execPath, [cli, 'resume', 'PF-9999'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Work item PF-9999 was not found/);
});

test('DONE work can still be inspected explicitly by ID after it is no longer active', async () => {
  const { root, meta } = await routedWork();
  await checkpointWork(root, meta.id, { skillId: 'context-discovery', status: 'completed', summary: 'Discovered.', evidence: [] });
  await checkpointWork(root, meta.id, { skillId: 'systematic-debugging', status: 'completed', summary: 'Root cause found.', evidence: ['evidence/root-cause.txt'] });
  for (let index = 0; index < 7; index++) await advanceActiveWork(root); // -> IMPLEMENTATION
  await checkpointWork(root, meta.id, { skillId: 'implementation', status: 'completed', summary: 'Implemented.', evidence: [] });
  await advanceActiveWork(root); // -> VERIFICATION
  await recordVerification(root, meta.id, { command: 'node --test', success: true, exitCode: 0 });
  await checkpointWork(root, meta.id, { skillId: 'verification', status: 'completed', summary: 'Verified.', evidence: [] });
  await reviewKnowledgeNone(root, meta.id);
  const transition = await advanceActiveWork(root);
  assert.equal(transition.to, 'DONE');

  const state = await readYaml(path.join(workspacePath(root), 'state', 'current.yaml'));
  assert.equal(state.activeWork, null);

  const result = spawnSync(process.execPath, [cli, 'resume', meta.id], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Stage: DONE/);
  assert.match(result.stdout, new RegExp(`inspecting ${meta.id} only`));
  assert.match(result.stdout, /No work item is currently active\./);
});

test('a pending (unrouted) work item can also be inspected explicitly without mutating focus', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-resume-explicit-'));
  await initWorkspace(root, 'demo', 'greenfield');
  const firstPending = await createPendingIntake(root, 'First unrouted request');
  const secondPending = await createPendingIntake(root, 'Second unrouted request');
  const before = await readYaml(path.join(workspacePath(root), 'state', 'current.yaml'));
  assert.equal(before.activeWork, secondPending.id);

  const result = spawnSync(process.execPath, [cli, 'resume', firstPending.id], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Routing: pending/);
  assert.match(result.stdout, new RegExp(`inspecting ${firstPending.id} only`));

  const after = await readYaml(path.join(workspacePath(root), 'state', 'current.yaml'));
  assert.deepEqual(after, before);
});
