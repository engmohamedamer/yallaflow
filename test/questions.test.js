import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { createPendingIntake, routeWorkItem } from '../src/behavior/routing.js';
import { checkpointWork } from '../src/core/progress.js';
import { addQuestion, answerQuestion, loadWorkQuestions, questionsFilePath, resolveQuestion } from '../src/questions/store.js';
import { loadWorkReadiness } from '../src/behavior/readiness.js';
import { exists } from '../src/utils/fs.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));

async function routedWork(workType = 'feature', scope = 'architectural') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-questions-'));
  const { initWorkspace } = await import('../src/core/workspace.js');
  await initWorkspace(root, 'demo', 'greenfield');
  const intake = await createPendingIntake(root, `${workType} ${scope} questions fixture`);
  const meta = await routeWorkItem(root, intake.id, {
    work_type: workType,
    scope,
    confidence: 'high',
    reason: 'Deterministic question test route.'
  });
  return { root, meta };
}

test('add business question', async () => {
  const { root, meta } = await routedWork();
  const result = await addQuestion(root, meta.id, {
    category: 'business',
    question: 'Can a contract receive multiple payments?'
  });
  assert.equal(result.entry.id, 'Q-001');
  assert.equal(result.entry.category, 'business');
  assert.equal(result.entry.status, 'open');
  assert.equal(result.entry.material, true);
  assert.equal(await exists(questionsFilePath(root, meta.id)), true);
});

test('answer question', async () => {
  const { root, meta } = await routedWork();
  await addQuestion(root, meta.id, { category: 'business', question: 'Is signing mandatory?' });
  const answered = await answerQuestion(root, meta.id, 'Q-001', 'Yes, signing is mandatory for all contracts.');
  assert.equal(answered.entry.status, 'answered');
  assert.equal(answered.entry.answer, 'Yes, signing is mandatory for all contracts.');
});

test('architecture proposal', async () => {
  const { root, meta } = await routedWork();
  const result = await addQuestion(root, meta.id, {
    category: 'architecture',
    question: 'Which document-generation strategy should be used?',
    proposal: 'Server-generated PDF'
  });
  assert.equal(result.entry.status, 'proposed');
  assert.equal(result.entry.proposal, 'Server-generated PDF');
  await assert.rejects(() => addQuestion(root, meta.id, {
    category: 'business',
    question: 'Not an architecture question.',
    proposal: 'Invalid proposal on a business question.'
  }), /--proposal is only valid for architecture questions/);
});

test('resolved questions persist', async () => {
  const { root, meta } = await routedWork();
  await addQuestion(root, meta.id, { category: 'business', question: 'Can a contract receive multiple payments?' });
  await answerQuestion(root, meta.id, 'Q-001', 'Yes, up to three partial payments.');
  const resolved = await resolveQuestion(root, meta.id, 'Q-001');
  assert.equal(resolved.entry.status, 'resolved');
  assert.equal(resolved.entry.resolution, 'Yes, up to three partial payments.');
  assert.ok(resolved.entry.resolvedAt);

  const reloaded = await loadWorkQuestions(root, meta);
  assert.equal(reloaded.ledger.questions[0].status, 'resolved');
  assert.equal(reloaded.ledger.questions[0].resolution, 'Yes, up to three partial payments.');

  await assert.rejects(() => resolveQuestion(root, meta.id, 'Q-001'), /already resolved/);
});

test('open material questions affect readiness', async () => {
  const { root, meta } = await routedWork();
  await checkpointWork(root, meta.id, {
    skillId: 'context-discovery', status: 'completed', summary: 'Discovery complete.', evidence: []
  });
  await checkpointWork(root, meta.id, {
    skillId: 'requirement-clarification', status: 'completed', summary: 'Clarified.', evidence: []
  });
  await checkpointWork(root, meta.id, {
    skillId: 'design-exploration', status: 'completed', summary: 'Design explored.', evidence: []
  });
  await checkpointWork(root, meta.id, {
    skillId: 'specification', status: 'completed', summary: 'Spec drafted.', evidence: []
  });
  const before = await loadWorkReadiness(root, meta);
  assert.equal(before.specification.status, 'READY');

  await addQuestion(root, meta.id, { category: 'business', question: 'Can a contract receive multiple payments?' });
  const after = await loadWorkReadiness(root, meta);
  assert.equal(after.specification.status, 'BLOCKED');
  assert.ok(after.specification.blockers.some((blocker) => blocker.includes('Q-001')));
  assert.equal(after.questions.materialOpen.length, 1);

  await addQuestion(root, meta.id, { category: 'business', question: 'Non-material aside.', material: false });
  const withNonMaterial = await loadWorkReadiness(root, meta);
  assert.equal(withNonMaterial.questions.materialOpen.length, 1);
});

test('reading questions causes no mutation', async () => {
  const { root, meta } = await routedWork();
  assert.equal(await exists(questionsFilePath(root, meta.id)), false);
  for (const args of [['question', 'list', meta.id], ['guide', meta.id], ['resume']]) {
    const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
  assert.equal(await exists(questionsFilePath(root, meta.id)), false);
});

test('question CLI add, answer, and resolve round-trip', async () => {
  const { root, meta } = await routedWork();
  const add = spawnSync(process.execPath, [
    cli, 'question', 'add', meta.id,
    '--category', 'business',
    '--text', 'Can a contract receive multiple payments?'
  ], { cwd: root, encoding: 'utf8' });
  assert.equal(add.status, 0, add.stderr);
  assert.match(add.stdout, /Added Q-001 \[business\] open/);

  const answer = spawnSync(process.execPath, [
    cli, 'question', 'answer', meta.id, '--id', 'Q-001', '--answer', 'Yes, up to three partial payments.'
  ], { cwd: root, encoding: 'utf8' });
  assert.equal(answer.status, 0, answer.stderr);
  assert.match(answer.stdout, /Q-001: answered/);

  const resolve = spawnSync(process.execPath, [
    cli, 'question', 'resolve', meta.id, '--id', 'Q-001'
  ], { cwd: root, encoding: 'utf8' });
  assert.equal(resolve.status, 0, resolve.stderr);
  assert.match(resolve.stdout, /Q-001: resolved/);

  const list = spawnSync(process.execPath, [cli, 'question', 'list', meta.id], { cwd: root, encoding: 'utf8' });
  assert.equal(list.status, 0, list.stderr);
  assert.match(list.stdout, /open decisions: 0/);
  assert.match(list.stdout, /Resolved: 1/);
});
