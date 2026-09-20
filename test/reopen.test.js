import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { createPendingIntake, routeWorkItem } from '../src/behavior/routing.js';
import { checkpointWork, loadWorkProgress, reviseCheckpoint } from '../src/core/progress.js';
import { advanceActiveWork, reconcileStageAfterCheckpointRevision, reopenWork } from '../src/core/transitions.js';
import { recordVerification } from '../src/core/evidence.js';
import { reviewKnowledgeNone, proposeKnowledge, loadWorkKnowledge } from '../src/knowledge/store.js';
import { promoteKnowledge } from '../src/knowledge/promotion.js';
import { initWorkspace, workspacePath } from '../src/core/workspace.js';
import { readYaml } from '../src/core/yaml.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));

async function routedWork(workType = 'bug', scope = 'architectural') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-reopen-'));
  await initWorkspace(root, 'demo', 'greenfield');
  const intake = await createPendingIntake(root, `${workType} ${scope} reopen fixture`);
  const meta = await routeWorkItem(root, intake.id, {
    work_type: workType,
    scope,
    confidence: 'high',
    reason: 'Deterministic reopen test route.'
  });
  return { root, meta };
}

async function complete(root, meta, skillId, evidence = []) {
  return checkpointWork(root, meta.id, { skillId, status: 'completed', summary: `${skillId} completed.`, evidence });
}

async function reachImplementation(root, meta) {
  await complete(root, meta, 'context-discovery');
  await complete(root, meta, 'systematic-debugging', ['evidence/root-cause.txt']);
  await complete(root, meta, 'implementation-planning');
  for (let index = 0; index < 7; index++) await advanceActiveWork(root); // -> IMPLEMENTATION
}

async function reachDone(root, meta) {
  await reachImplementation(root, meta);
  await complete(root, meta, 'implementation');
  await advanceActiveWork(root); // -> VERIFICATION
  await recordVerification(root, meta.id, { command: 'node --test', success: true, exitCode: 0 });
  await complete(root, meta, 'verification');
  await complete(root, meta, 'code-review');
  await reviewKnowledgeNone(root, meta.id);
  const result = await advanceActiveWork(root); // -> DONE
  assert.equal(result.to, 'DONE');
}

// --- Stage exit gates -------------------------------------------------------

test('IMPLEMENTATION cannot advance without the implementation checkpoint completed', async () => {
  const { root, meta } = await routedWork();
  await reachImplementation(root, meta);
  await assert.rejects(
    () => advanceActiveWork(root),
    /implementation checkpoint is pending/
  );
  await complete(root, meta, 'implementation');
  assert.equal((await advanceActiveWork(root)).to, 'VERIFICATION');
});

test('VERIFICATION cannot advance without the verification checkpoint completed', async () => {
  const { root, meta } = await routedWork();
  await reachImplementation(root, meta);
  await complete(root, meta, 'implementation');
  await advanceActiveWork(root); // -> VERIFICATION
  await recordVerification(root, meta.id, { command: 'node --test', success: true, exitCode: 0 });
  await assert.rejects(
    () => advanceActiveWork(root),
    /verification checkpoint is pending/
  );
  await complete(root, meta, 'verification');
  await complete(root, meta, 'code-review');
  await reviewKnowledgeNone(root, meta.id);
  assert.equal((await advanceActiveWork(root)).to, 'DONE');
});

test('DONE cannot be reached without the code-review checkpoint completed', async () => {
  const { root, meta } = await routedWork();
  await reachImplementation(root, meta);
  await complete(root, meta, 'implementation');
  await advanceActiveWork(root); // -> VERIFICATION
  await recordVerification(root, meta.id, { command: 'node --test', success: true, exitCode: 0 });
  await complete(root, meta, 'verification');
  await reviewKnowledgeNone(root, meta.id);
  await assert.rejects(
    () => advanceActiveWork(root),
    /Cannot transition to DONE until the code-review checkpoint is completed\./
  );
  await complete(root, meta, 'code-review');
  assert.equal((await advanceActiveWork(root)).to, 'DONE');
});

test('existing pre-implementation architectural gates remain valid', async () => {
  const { root, meta } = await routedWork('feature', 'architectural');
  assert.equal((await advanceActiveWork(root)).to, 'DISCOVERY');
  await assert.rejects(() => advanceActiveWork(root), /context-discovery checkpoint is pending/);
});

// --- Checkpoint revision downstream invalidation ----------------------------

test('revising implementation rolls the stage back and invalidates downstream checkpoints', async () => {
  const { root, meta } = await routedWork();
  await reachImplementation(root, meta);
  await complete(root, meta, 'implementation');
  await advanceActiveWork(root); // -> VERIFICATION
  await recordVerification(root, meta.id, { command: 'node --test', success: true, exitCode: 0 });
  await complete(root, meta, 'verification');
  await complete(root, meta, 'code-review');

  const revised = await reviseCheckpoint(root, meta.id, {
    skillId: 'implementation', status: 'in_progress', reason: 'A production defect requires another implementation pass.'
  });
  assert.equal(revised.ledger.skills.implementation.status, 'in_progress');
  assert.equal(revised.ledger.skills.verification.status, 'pending');
  assert.equal(revised.ledger.skills['code-review'].status, 'pending');
  assert.ok(revised.ledger.history.some((entry) => entry.skill === 'verification' && entry.to === 'pending'));
  assert.ok(revised.ledger.history.some((entry) => entry.skill === 'code-review' && entry.to === 'pending'));

  const stageCorrection = await reconcileStageAfterCheckpointRevision(root, revised.meta, 'implementation');
  assert.deepEqual(stageCorrection, { from: 'VERIFICATION', to: 'IMPLEMENTATION' });

  const metaAfter = await readYaml(path.join(workspacePath(root), 'work', meta.id, 'meta.yaml'));
  assert.equal(metaAfter.status, 'IMPLEMENTATION');
  assert.ok(metaAfter.lastInvalidationAt);

  await assert.rejects(
    () => advanceActiveWork(root),
    /implementation checkpoint is in_progress/
  );
});

test('DONE checkpoint revision is rejected with reopen guidance', async () => {
  const { root, meta } = await routedWork();
  await reachDone(root, meta);
  await assert.rejects(
    () => reviseCheckpoint(root, meta.id, { skillId: 'implementation', status: 'in_progress', reason: 'Needs another pass.' }),
    /is DONE\.\n\nReopen the work before revising completed execution state\.\n\nUse:\nyallaflow reopen/
  );
});

// --- Reopen ------------------------------------------------------------------

test('reopen requires a non-empty reason', async () => {
  const { root, meta } = await routedWork();
  await reachDone(root, meta);
  await assert.rejects(
    () => reopenWork(root, meta.id, { toStage: 'implementation', reason: '' }),
    /Reopen requires a non-empty --reason/
  );
});

test('reopen rejects an invalid target stage', async () => {
  const { root, meta } = await routedWork();
  await reachDone(root, meta);
  await assert.rejects(
    () => reopenWork(root, meta.id, { toStage: 'design', reason: 'Not a supported target.' }),
    /--to must be one of: implementation, verification, review/
  );
});

test('reopen refuses work that is not DONE', async () => {
  const { root, meta } = await routedWork();
  await reachImplementation(root, meta);
  await assert.rejects(
    () => reopenWork(root, meta.id, { toStage: 'implementation', reason: 'Not done yet.' }),
    /is not DONE; only completed work can be reopened/
  );
});

test('reopen to implementation resets downstream checkpoints and reactivates the work', async () => {
  const { root, meta } = await routedWork();
  await reachDone(root, meta);
  const result = await reopenWork(root, meta.id, { toStage: 'implementation', reason: 'Production defect discovered after completion.' });
  assert.deepEqual({ from: result.from, to: result.to }, { from: 'DONE', to: 'IMPLEMENTATION' });

  const progress = await loadWorkProgress(root, meta);
  assert.equal(progress.ledger.skills.implementation.status, 'in_progress');
  assert.equal(progress.ledger.skills.verification.status, 'pending');
  assert.equal(progress.ledger.skills['code-review'].status, 'pending');

  const state = await readYaml(path.join(workspacePath(root), 'state', 'current.yaml'));
  assert.equal(state.activeWork, meta.id);
  assert.equal(state.stage, 'IMPLEMENTATION');

  const metaAfter = await readYaml(path.join(workspacePath(root), 'work', meta.id, 'meta.yaml'));
  assert.equal(metaAfter.status, 'IMPLEMENTATION');
  assert.equal(metaAfter.lifecycleHistory.length, 1);
  assert.deepEqual(
    { action: metaAfter.lifecycleHistory[0].action, fromStage: metaAfter.lifecycleHistory[0].fromStage, toStage: metaAfter.lifecycleHistory[0].toStage },
    { action: 'reopen', fromStage: 'DONE', toStage: 'IMPLEMENTATION' }
  );
  assert.equal(metaAfter.completionHistory.length, 1);
});

test('reopen to verification keeps implementation completed', async () => {
  const { root, meta } = await routedWork();
  await reachDone(root, meta);
  await reopenWork(root, meta.id, { toStage: 'verification', reason: 'A regression was found in testing.' });
  const progress = await loadWorkProgress(root, meta);
  assert.equal(progress.ledger.skills.implementation.status, 'completed');
  assert.equal(progress.ledger.skills.verification.status, 'pending');
  assert.equal(progress.ledger.skills['code-review'].status, 'pending');
  const metaAfter = await readYaml(path.join(workspacePath(root), 'work', meta.id, 'meta.yaml'));
  assert.equal(metaAfter.status, 'VERIFICATION');
});

test('reopen to review keeps implementation and verification completed', async () => {
  const { root, meta } = await routedWork();
  await reachDone(root, meta);
  await reopenWork(root, meta.id, { toStage: 'review', reason: 'Another review pass is required.' });
  const progress = await loadWorkProgress(root, meta);
  assert.equal(progress.ledger.skills.implementation.status, 'completed');
  assert.equal(progress.ledger.skills.verification.status, 'completed');
  assert.equal(progress.ledger.skills['code-review'].status, 'pending');
  const metaAfter = await readYaml(path.join(workspacePath(root), 'work', meta.id, 'meta.yaml'));
  assert.equal(metaAfter.status, 'VERIFICATION');
});

test('reopen preserves prior lifecycle and completion history across multiple reopens', async () => {
  const { root, meta } = await routedWork();
  await reachDone(root, meta);
  await reopenWork(root, meta.id, { toStage: 'implementation', reason: 'First defect.' });
  await complete(root, meta, 'implementation');
  await advanceActiveWork(root); // -> VERIFICATION
  await recordVerification(root, meta.id, { command: 'node --test', success: true, exitCode: 0 });
  await complete(root, meta, 'verification');
  await complete(root, meta, 'code-review');
  await reviewKnowledgeNone(root, meta.id);
  await advanceActiveWork(root); // -> DONE again

  await reopenWork(root, meta.id, { toStage: 'review', reason: 'Second, unrelated review request.' });
  const metaAfter = await readYaml(path.join(workspacePath(root), 'work', meta.id, 'meta.yaml'));
  assert.equal(metaAfter.lifecycleHistory.length, 2);
  assert.equal(metaAfter.completionHistory.length, 2);
});

test('reopen never deletes previously promoted knowledge', async () => {
  const { root, meta } = await routedWork();
  await reachImplementation(root, meta);
  await complete(root, meta, 'implementation');
  await advanceActiveWork(root); // -> VERIFICATION
  await recordVerification(root, meta.id, { command: 'node --test', success: true, exitCode: 0 });
  await complete(root, meta, 'verification');
  await complete(root, meta, 'code-review');
  const proposed = await proposeKnowledge(root, meta.id, {
    kind: 'integration', source: 'implementation-runtime',
    summary: 'The retry policy uses exponential backoff capped at 30s.', evidence: ['work.md']
  });
  await promoteKnowledge(root, meta.id, proposed.candidate.id);
  await advanceActiveWork(root); // -> DONE

  await reopenWork(root, meta.id, { toStage: 'implementation', reason: 'Unrelated defect.' });
  const knowledge = await loadWorkKnowledge(root, meta);
  assert.equal(knowledge.ledger.candidates.length, 1);
  assert.equal(knowledge.ledger.candidates[0].status, 'promoted');
  assert.equal(knowledge.ledger.reviewStatus, 'pending');
});

test('fresh verification is required again before a second DONE, and stale evidence is rejected', async () => {
  const { root, meta } = await routedWork();
  await reachDone(root, meta);
  await reopenWork(root, meta.id, { toStage: 'verification', reason: 'A regression was found.' });

  // The VERIFICATION stage-exit gate fires before DONE-specific evidence checks:
  // the checkpoint itself was reset to pending by the reopen.
  await assert.rejects(
    () => advanceActiveWork(root),
    /verification checkpoint is pending/
  );

  // Evidence recorded before the reopen must not satisfy the post-reopen gate.
  await assert.rejects(
    () => checkpointWork(root, meta.id, { skillId: 'verification', status: 'completed', summary: 'Reusing stale evidence.', evidence: [] }),
    /Completing verification requires evidence recorded after the most recent implementation reopen\/revision/
  );

  await recordVerification(root, meta.id, { command: 'node --test', success: true, exitCode: 0 });
  await complete(root, meta, 'verification');
  await complete(root, meta, 'code-review');
  const result = await advanceActiveWork(root); // -> DONE
  assert.equal(result.to, 'DONE');
});

test('work can reach DONE a second time cleanly through public commands only', async () => {
  const { root, meta } = await routedWork();
  await reachDone(root, meta);

  const reopenResult = spawnSync(process.execPath, [
    cli, 'reopen', meta.id, '--to', 'implementation', '--reason', 'Production defect discovered after completion.'
  ], { cwd: root, encoding: 'utf8' });
  assert.equal(reopenResult.status, 0, reopenResult.stderr);
  assert.match(reopenResult.stdout, /DONE → IMPLEMENTATION/);

  const revise = spawnSync(process.execPath, [
    cli, 'checkpoint', meta.id, '--skill', 'implementation', '--complete', '--summary', 'Fixed the defect.'
  ], { cwd: root, encoding: 'utf8' });
  assert.equal(revise.status, 0, revise.stderr);

  assert.equal((await advanceActiveWork(root)).to, 'VERIFICATION');

  const verify = spawnSync(process.execPath, [cli, 'verify', '--', 'true'], { cwd: root, encoding: 'utf8' });
  assert.equal(verify.status, 0, verify.stderr);

  const completeVerification = spawnSync(process.execPath, [
    cli, 'checkpoint', meta.id, '--skill', 'verification', '--complete', '--summary', 'Fix verified.'
  ], { cwd: root, encoding: 'utf8' });
  assert.equal(completeVerification.status, 0, completeVerification.stderr);

  const completeReview = spawnSync(process.execPath, [
    cli, 'checkpoint', meta.id, '--skill', 'code-review', '--complete', '--summary', 'Reviewed the fix.'
  ], { cwd: root, encoding: 'utf8' });
  assert.equal(completeReview.status, 0, completeReview.stderr);

  const knowledgeReview = spawnSync(process.execPath, [cli, 'knowledge', 'review', meta.id, '--none'], { cwd: root, encoding: 'utf8' });
  assert.equal(knowledgeReview.status, 0, knowledgeReview.stderr);

  const finalAdvance = await advanceActiveWork(root);
  assert.equal(finalAdvance.to, 'DONE');

  const metaAfter = await readYaml(path.join(workspacePath(root), 'work', meta.id, 'meta.yaml'));
  assert.equal(metaAfter.completionHistory.length, 2);
});
