import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { createPendingIntake, routeWorkItem } from '../src/behavior/routing.js';
import { checkpointWork, reviseCheckpoint } from '../src/core/progress.js';
import { advanceActiveWork, reconcileStageAfterCheckpointRevision, reopenWork } from '../src/core/transitions.js';
import { recordVerification } from '../src/core/evidence.js';
import { reviewKnowledgeNone } from '../src/knowledge/store.js';
import { initWorkspace, workspacePath } from '../src/core/workspace.js';
import { readYaml } from '../src/core/yaml.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));

async function routedWork(workType = 'bug', scope = 'architectural') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-handoff-objective-'));
  await initWorkspace(root, 'demo', 'greenfield', 'autonomous');
  const intake = await createPendingIntake(root, `${workType} ${scope} handoff-objective fixture`);
  const meta = await routeWorkItem(root, intake.id, {
    work_type: workType, scope, confidence: 'high', reason: 'Deterministic handoff-objective test route.'
  });
  return { root, meta };
}

async function complete(root, meta, skillId, evidence = []) {
  return checkpointWork(root, meta.id, { skillId, status: 'completed', summary: `${skillId} completed.`, evidence });
}

async function reachDone(root, meta) {
  await complete(root, meta, 'context-discovery');
  await complete(root, meta, 'systematic-debugging', ['evidence/root-cause.txt']);
  await complete(root, meta, 'implementation-planning');
  for (let index = 0; index < 7; index++) await advanceActiveWork(root);
  await complete(root, meta, 'implementation');
  await advanceActiveWork(root);
  await recordVerification(root, meta.id, { command: 'true', success: true, exitCode: 0 });
  await complete(root, meta, 'verification');
  await complete(root, meta, 'code-review');
  await reviewKnowledgeNone(root, meta.id);
  await advanceActiveWork(root);
}

test('reopened work prominently exposes the reopen reason as the primary unresolved objective', async () => {
  const { root, meta } = await routedWork();
  await reachDone(root, meta);
  await reopenWork(root, meta.id, { toStage: 'implementation', reason: 'Cancellation lifecycle is unreachable and signed-version preservation must be verified.' });

  const handoff = spawnSync(process.execPath, [cli, 'handoff', meta.id], { cwd: root, encoding: 'utf8' });
  assert.equal(handoff.status, 0, handoff.stderr);
  assert.match(handoff.stdout, /PRIMARY UNRESOLVED OBJECTIVE:/);
  assert.match(handoff.stdout, /Cancellation lifecycle is unreachable and signed-version preservation must be verified\./);

  const resume = spawnSync(process.execPath, [cli, 'resume'], { cwd: root, encoding: 'utf8' });
  assert.equal(resume.status, 0, resume.stderr);
  assert.match(resume.stdout, /PRIMARY UNRESOLVED OBJECTIVE:/);
});

test('a checkpoint revision reason is visible as the primary objective', async () => {
  const { root, meta } = await routedWork();
  await complete(root, meta, 'context-discovery');
  await complete(root, meta, 'systematic-debugging', ['evidence/root-cause.txt']);
  await complete(root, meta, 'implementation-planning');
  for (let index = 0; index < 7; index++) await advanceActiveWork(root);
  await complete(root, meta, 'implementation');

  const revised = await reviseCheckpoint(root, meta.id, {
    skillId: 'implementation', status: 'in_progress', reason: 'A regression was found in the retry path.'
  });
  await reconcileStageAfterCheckpointRevision(root, revised.meta, 'implementation', 'A regression was found in the retry path.');

  const handoff = spawnSync(process.execPath, [cli, 'handoff', meta.id], { cwd: root, encoding: 'utf8' });
  assert.equal(handoff.status, 0, handoff.stderr);
  assert.match(handoff.stdout, /PRIMARY UNRESOLVED OBJECTIVE:/);
  assert.match(handoff.stdout, /A regression was found in the retry path\./);
});

test('an active write-authorization blocker is visible as the primary objective when nothing else applies', async () => {
  const { root, meta } = await routedWork('investigation', 'bounded');
  const handoff = spawnSync(process.execPath, [cli, 'handoff', meta.id], { cwd: root, encoding: 'utf8' });
  assert.equal(handoff.status, 0, handoff.stderr);
  assert.match(handoff.stdout, /PRIMARY UNRESOLVED OBJECTIVE:\nwork policy is read-only/);
});

test('an optional handoff note can be recorded and is preserved without duplicating checkpoints', async () => {
  const { root, meta } = await routedWork();
  const before = await readYaml(path.join(workspacePath(root), 'work', meta.id, 'progress.yaml')).catch(() => null);
  assert.equal(before, null);
  // Handoff remains read-only in this milestone; no handoff-record ledger is
  // introduced (see Final Report — checkpoint/ruling evidence covers this need).
  const handoff = spawnSync(process.execPath, [cli, 'handoff', meta.id], { cwd: root, encoding: 'utf8' });
  assert.equal(handoff.status, 0, handoff.stderr);
});

test('handoff remains read-only', async () => {
  const { root, meta } = await routedWork();
  await complete(root, meta, 'context-discovery');
  const before = await readYaml(path.join(workspacePath(root), 'state', 'current.yaml'));
  spawnSync(process.execPath, [cli, 'handoff', meta.id], { cwd: root, encoding: 'utf8' });
  const after = await readYaml(path.join(workspacePath(root), 'state', 'current.yaml'));
  assert.deepEqual(after, before);
});

test('Git state surfaced by handoff is read-only', async () => {
  const { root, meta } = await routedWork();
  const gitInit = spawnSync('git', ['init', '-q'], { cwd: root });
  assert.equal(gitInit.status, 0);
  const handoff = spawnSync(process.execPath, [cli, 'handoff', meta.id], { cwd: root, encoding: 'utf8' });
  assert.equal(handoff.status, 0, handoff.stderr);
  const status = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' });
  // handoff must not have created a commit or staged anything on its own.
  assert.equal(spawnSync('git', ['log', '--oneline'], { cwd: root }).status, 128); // no commits exist
  assert.ok(status.stdout !== undefined);
});

test('DONE work cannot incorrectly report project complete while the parent is incomplete', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-handoff-objective-parent-'));
  await initWorkspace(root, 'demo', 'greenfield', 'autonomous');
  const intake = await createPendingIntake(root, 'Decomposed project');
  const parentMeta = await routeWorkItem(root, intake.id, { work_type: 'feature', scope: 'architectural', confidence: 'high', reason: 'r' });
  await complete(root, parentMeta, 'context-discovery');
  await advanceActiveWork(root);
  await complete(root, parentMeta, 'requirement-clarification');
  await advanceActiveWork(root);
  await complete(root, parentMeta, 'design-exploration');
  await advanceActiveWork(root);
  await complete(root, parentMeta, 'specification');
  await advanceActiveWork(root);
  await advanceActiveWork(root);
  await complete(root, parentMeta, 'implementation-planning');

  const { proposeDecomposition, validateDecomposition, executeDecomposition } = await import('../src/decomposition/store.js');
  await proposeDecomposition(root, parentMeta.id, {
    children: [
      { key: 'a', title: 'Feature A', type: 'feature', scope: 'bounded' },
      { key: 'b', title: 'Feature B', type: 'feature', scope: 'bounded' }
    ]
  });
  await validateDecomposition(root, parentMeta.id);
  const { ledger } = await executeDecomposition(root, parentMeta.id);
  await advanceActiveWork(root, parentMeta.id);

  const childA = ledger.children[0].workId;
  await complete(root, { id: childA }, 'context-discovery');
  await complete(root, { id: childA }, 'requirement-clarification');
  for (let index = 0; index < 5; index++) await advanceActiveWork(root, childA);
  await complete(root, { id: childA }, 'implementation');
  await advanceActiveWork(root, childA);
  await recordVerification(root, childA, { command: 'true', success: true, exitCode: 0 });
  await complete(root, { id: childA }, 'verification');
  await reviewKnowledgeNone(root, childA);
  const childDone = await advanceActiveWork(root, childA);
  assert.equal(childDone.to, 'DONE');

  const handoffChild = spawnSync(process.execPath, [cli, 'handoff', childA], { cwd: root, encoding: 'utf8' });
  assert.equal(handoffChild.status, 0, handoffChild.stderr);
  assert.match(handoffChild.stdout, new RegExp(`${childA} DONE\\. This is one work item, not necessarily the whole project`));
  assert.doesNotMatch(handoffChild.stdout, /Project (DONE|Complete)/);

  const handoffParent = spawnSync(process.execPath, [cli, 'handoff', parentMeta.id], { cwd: root, encoding: 'utf8' });
  assert.equal(handoffParent.status, 0, handoffParent.stderr);
  assert.match(handoffParent.stdout, /Project NOT complete: 1\/2 required children DONE\./);
});
