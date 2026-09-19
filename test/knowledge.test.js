import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { createPendingIntake, routeWorkItem } from '../src/behavior/routing.js';
import { checkpointWork } from '../src/core/progress.js';
import { recordVerification } from '../src/core/evidence.js';
import { advanceActiveWork } from '../src/core/transitions.js';
import { createWorkItem, initWorkspace, workspacePath } from '../src/core/workspace.js';
import { readYaml } from '../src/core/yaml.js';
import {
  knowledgeFilePath,
  loadWorkKnowledge,
  proposeKnowledge,
  rejectKnowledge,
  reviewKnowledgeNone
} from '../src/knowledge/store.js';
import { promoteKnowledge } from '../src/knowledge/promotion.js';
import { exists } from '../src/utils/fs.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));

async function routedWork(workType = 'bug', scope = 'bounded') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-knowledge-'));
  await initWorkspace(root, 'demo', 'greenfield');
  const intake = await createPendingIntake(root, `${workType} ${scope} knowledge fixture`);
  const meta = await routeWorkItem(root, intake.id, {
    work_type: workType,
    scope,
    confidence: 'high',
    reason: 'Deterministic knowledge test route.'
  });
  return { root, meta };
}

async function complete(root, meta, skillId, evidence = []) {
  return checkpointWork(root, meta.id, {
    skillId,
    status: 'completed',
    summary: `${skillId} completed.`,
    evidence
  });
}

async function prepareBugForReview(root, meta) {
  await complete(root, meta, 'context-discovery');
  await complete(root, meta, 'systematic-debugging', ['evidence/root-cause.txt']);
  for (let index = 0; index < 8; index++) await advanceActiveWork(root);
  await recordVerification(root, meta.id, {
    command: 'node --test',
    success: true,
    exitCode: 0,
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:00:01.000Z',
    log: 'verification.log'
  });
  return readYaml(path.join(workspacePath(root), 'work', meta.id, 'meta.yaml'));
}

test('proposes a work-scoped knowledge candidate', async () => {
  const { root, meta } = await routedWork();
  const result = await proposeKnowledge(root, meta.id, {
    kind: 'integration',
    source: 'implementation-runtime',
    summary: 'Aliyun OSS CORS configuration is required for browser-fetched FilePond image previews.',
    evidence: ['config/filesystems.php']
  });
  assert.equal(result.candidate.id, 'K-001');
  assert.equal(result.candidate.status, 'proposed');
  assert.equal(result.ledger.reviewStatus, 'pending');
  assert.deepEqual(result.meta.knowledgePolicy, { version: 1, reviewRequired: true });
  assert.equal(await exists(knowledgeFilePath(root, meta.id)), true);
});

test('candidate survives restart and can be listed by the CLI', async () => {
  const { root, meta } = await routedWork();
  const propose = spawnSync(process.execPath, [
    cli, 'knowledge', 'propose', meta.id,
    '--kind', 'integration',
    '--source', 'implementation-runtime',
    '--summary', 'Browser previews require OSS CORS headers.',
    '--evidence', 'config/filesystems.php'
  ], { cwd: root, encoding: 'utf8' });
  assert.equal(propose.status, 0, propose.stderr);
  const list = spawnSync(process.execPath, [cli, 'knowledge', 'list', meta.id], { cwd: root, encoding: 'utf8' });
  assert.equal(list.status, 0, list.stderr);
  assert.match(list.stdout, /K-001 \[proposed\] integration \/ implementation-runtime — Browser previews require OSS CORS headers\./);
});

test('knowledge list distinguishes pending review with no candidates', async () => {
  const { root, meta } = await routedWork();
  const result = spawnSync(process.execPath, [cli, 'knowledge', 'list', meta.id], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Review: pending/);
  assert.match(result.stdout, /\(no candidates\)/);
});

test('promotes architecture knowledge to project context', async () => {
  const { root, meta } = await routedWork();
  const proposed = await proposeKnowledge(root, meta.id, {
    kind: 'architecture',
    source: 'implementation-runtime',
    summary: 'Contracts expose QR-based authenticity verification.',
    evidence: ['src/contracts/verification.js']
  });
  await prepareBugForReview(root, meta);
  const result = await promoteKnowledge(root, meta.id, proposed.candidate.id);
  assert.equal(result.target, 'context/architecture.md');
  const content = await readFile(path.join(workspacePath(root), result.target), 'utf8');
  assert.match(content, /Contracts expose QR-based authenticity verification\./);
});

test('promotes OSS CORS integration knowledge without execution noise', async () => {
  const { root, meta } = await routedWork();
  const proposed = await proposeKnowledge(root, meta.id, {
    kind: 'integration',
    source: 'implementation-runtime',
    summary: 'Aliyun OSS CORS configuration is required for browser-fetched FilePond image previews.',
    evidence: ['config/filesystems.php', 'OSS response missing Access-Control-Allow-Origin']
  });
  await prepareBugForReview(root, meta);
  const result = await promoteKnowledge(root, meta.id, proposed.candidate.id);
  assert.equal(result.target, 'context/integrations.md');
  const content = await readFile(path.join(workspacePath(root), result.target), 'utf8');
  assert.doesNotMatch(content, /temporary hypothesis|unsuccessful command/i);
});

test('rejects a temporary knowledge candidate with a reason', async () => {
  const { root, meta } = await routedWork();
  const proposed = await proposeKnowledge(root, meta.id, {
    kind: 'convention',
    source: 'implementation-runtime',
    summary: 'A one-time debug command was used.',
    evidence: ['work log']
  });
  await prepareBugForReview(root, meta);
  const result = await rejectKnowledge(root, meta.id, proposed.candidate.id, 'Temporary implementation detail.');
  assert.equal(result.candidate.status, 'rejected');
  assert.equal(result.candidate.rejectionReason, 'Temporary implementation detail.');
  assert.equal(result.ledger.reviewStatus, 'reviewed');
});

test('rejected candidate cannot be promoted', async () => {
  const { root, meta } = await routedWork();
  const proposed = await proposeKnowledge(root, meta.id, {
    kind: 'environment',
    source: 'implementation-runtime',
    summary: 'Temporary shell state affected one run.',
    evidence: ['work log']
  });
  await prepareBugForReview(root, meta);
  await rejectKnowledge(root, meta.id, proposed.candidate.id, 'Execution noise.');
  await assert.rejects(() => promoteKnowledge(root, meta.id, proposed.candidate.id), /was rejected and cannot be promoted/);
});

test('duplicate promotion of the same candidate is prevented', async () => {
  const { root, meta } = await routedWork();
  const proposed = await proposeKnowledge(root, meta.id, {
    kind: 'database',
    source: 'implementation-runtime',
    summary: 'Contract payment state is stored on the payment log boundary.',
    evidence: ['src/payments/log.js']
  });
  await prepareBugForReview(root, meta);
  await promoteKnowledge(root, meta.id, proposed.candidate.id);
  await assert.rejects(() => promoteKnowledge(root, meta.id, proposed.candidate.id), /already promoted/);
});

test('unknown knowledge kind is rejected deterministically', async () => {
  const { root, meta } = await routedWork();
  await assert.rejects(() => proposeKnowledge(root, meta.id, {
    kind: 'temporary-note',
    summary: 'Not a supported kind.',
    evidence: ['work log']
  }), /kind must be one of/);
});

test('candidate evidence persists across reload', async () => {
  const { root, meta } = await routedWork();
  await proposeKnowledge(root, meta.id, {
    kind: 'business-rule',
    source: 'implementation-runtime',
    summary: 'Contracts support Gold and Silver packages.',
    evidence: ['requirements/contracts.md', 'test/contracts.test.js']
  });
  const loaded = await loadWorkKnowledge(root, meta);
  assert.deepEqual(loaded.ledger.candidates[0].evidence, ['requirements/contracts.md', 'test/contracts.test.js']);
});

test('knowledge review --none records reviewed-none explicitly', async () => {
  const { root, meta } = await routedWork();
  const current = await prepareBugForReview(root, meta);
  const result = await reviewKnowledgeNone(root, current.id);
  assert.equal(result.ledger.reviewStatus, 'reviewed');
  assert.deepEqual(result.ledger.candidates, []);
  assert.ok(result.ledger.reviewedAt);
});

test('pending review is distinct from reviewed with no candidates', async () => {
  const { root, meta } = await routedWork();
  const before = await loadWorkKnowledge(root, meta);
  assert.equal(before.ledger.reviewStatus, 'pending');
  assert.equal(before.exists, false);
  const current = await prepareBugForReview(root, meta);
  await reviewKnowledgeNone(root, current.id);
  const after = await loadWorkKnowledge(root, current);
  assert.equal(after.ledger.reviewStatus, 'reviewed');
  assert.equal(after.exists, true);
});

test('resume shows pending knowledge review near completion', async () => {
  const { root, meta } = await routedWork();
  await prepareBugForReview(root, meta);
  const result = spawnSync(process.execPath, [cli, 'resume'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Verification: passed/);
  assert.match(result.stdout, /Project knowledge review: PENDING/);
  assert.match(result.stdout, /Review completed work for durable project knowledge/);
});

test('guide reminds near-complete work without creating knowledge automatically', async () => {
  const { root, meta } = await routedWork();
  await prepareBugForReview(root, meta);
  const result = spawnSync(process.execPath, [cli, 'guide', meta.id], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Preserve only stable knowledge that will matter to future engineering work/);
  assert.equal(await exists(knowledgeFilePath(root, meta.id)), false);
});

test('knowledge list, guide, and resume reads never create knowledge.yaml', async () => {
  const { root, meta } = await routedWork();
  for (const args of [
    ['knowledge', 'list', meta.id],
    ['guide', meta.id],
    ['resume']
  ]) {
    const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
  assert.equal(await exists(knowledgeFilePath(root, meta.id)), false);
});

test('promoted context knowledge contains source-work traceability', async () => {
  const { root, meta } = await routedWork();
  const proposed = await proposeKnowledge(root, meta.id, {
    kind: 'business-rule',
    source: 'implementation-runtime',
    summary: 'Payment logs may transition a contract to Paid.',
    evidence: ['requirements/payment-state.md']
  });
  await prepareBugForReview(root, meta);
  const promoted = await promoteKnowledge(root, meta.id, proposed.candidate.id);
  const content = await readFile(path.join(workspacePath(root), promoted.target), 'utf8');
  assert.match(content, /Source work:\*\* PF-0001/);
  assert.match(content, /Knowledge ID:\*\* K-001/);
  assert.match(content, /Promoted at:/);
});

test('decision promotion creates an ADR with supplied semantics', async () => {
  const { root, meta } = await routedWork();
  const proposed = await proposeKnowledge(root, meta.id, {
    kind: 'decision',
    source: 'implementation-runtime',
    summary: 'Reuse the existing UploadService boundary',
    evidence: ['src/services/upload.js'],
    context: 'Browser uploads already enter through UploadService.',
    decision: 'Keep UploadService as the upload integration boundary.',
    reason: 'It is the established project boundary.',
    costIfWrong: 'A later integration refactor may be required.'
  });
  await prepareBugForReview(root, meta);
  const result = await promoteKnowledge(root, meta.id, proposed.candidate.id);
  assert.equal(result.target, 'decisions/ADR-PF-0001-K-001.md');
  assert.equal(await exists(path.join(workspacePath(root), result.target)), true);
});

test('promoted ADR retains source work and knowledge identity', async () => {
  const { root, meta } = await routedWork();
  const proposed = await proposeKnowledge(root, meta.id, {
    kind: 'decision',
    source: 'implementation-runtime',
    summary: 'Keep contract authenticity checks at the contract boundary',
    evidence: ['src/contracts/verify.js'],
    context: 'Authenticity is a contract-domain responsibility.',
    decision: 'Expose QR verification from the contract module.',
    reason: 'The contract module owns authenticity rules.',
    costIfWrong: 'The interface may need to move to a shared module.'
  });
  await prepareBugForReview(root, meta);
  const result = await promoteKnowledge(root, meta.id, proposed.candidate.id);
  const adr = await readFile(path.join(workspacePath(root), result.target), 'utf8');
  assert.match(adr, /Source work: PF-0001/);
  assert.match(adr, /Knowledge ID: K-001/);
  assert.match(adr, /## Context/);
  assert.match(adr, /## Risks \/ Cost if wrong/);
});

test('local ruling can seed an ADR candidate without being mutated', async () => {
  const { root, meta } = await routedWork();
  await checkpointWork(root, meta.id, {
    ruling: {
      decision: 'Reuse existing UploadService',
      reason: 'It is the established upload boundary.',
      costIfWrong: 'The upload integration may require refactoring.'
    }
  });
  await prepareBugForReview(root, meta);
  const progressFile = path.join(workspacePath(root), 'work', meta.id, 'progress.yaml');
  const before = await readFile(progressFile, 'utf8');
  const proposed = await proposeKnowledge(root, meta.id, {
    kind: 'decision',
    source: 'implementation-runtime',
    summary: 'Reuse the existing UploadService boundary',
    evidence: ['src/services/upload.js'],
    context: 'Uploads already use UploadService.',
    fromRuling: '1'
  });
  assert.equal(proposed.candidate.decisionDetails.sourceRuling, 1);
  await promoteKnowledge(root, meta.id, proposed.candidate.id);
  assert.equal(await readFile(progressFile, 'utf8'), before);
});

test('legacy work loads without knowledge state or a required policy', async () => {
  const { root, meta } = await routedWork();
  const metaFile = path.join(workspacePath(root), 'work', meta.id, 'meta.yaml');
  const legacy = await readYaml(metaFile);
  delete legacy.knowledgePolicy;
  await writeFile(metaFile, `${JSON.stringify(legacy, null, 2)}\n`);
  const loaded = await loadWorkKnowledge(root, legacy);
  assert.equal(loaded.policy.reviewRequired, false);
  assert.equal(loaded.exists, false);
  assert.equal(await exists(knowledgeFilePath(root, meta.id)), false);
});

test('legacy work is not retroactively blocked at DONE', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-knowledge-legacy-'));
  await initWorkspace(root, 'demo', 'greenfield');
  const item = await createWorkItem(root, 'bug', 'Legacy completion fixture', 'bounded');
  const metaFile = path.join(workspacePath(root), 'work', item.id, 'meta.yaml');
  const legacy = await readYaml(metaFile);
  delete legacy.knowledgePolicy;
  await writeFile(metaFile, `${JSON.stringify(legacy, null, 2)}\n`);
  for (let index = 0; index < 8; index++) await advanceActiveWork(root);
  await recordVerification(root, item.id, { success: true, command: 'node --test', exitCode: 0 });
  assert.equal((await advanceActiveWork(root)).to, 'DONE');
});

test('new-policy work requires knowledge review before DONE', async () => {
  const { root, meta } = await routedWork();
  const current = await prepareBugForReview(root, meta);
  await assert.rejects(() => advanceActiveWork(root), /project knowledge review is complete/);
  await reviewKnowledgeNone(root, current.id);
  const resume = spawnSync(process.execPath, [cli, 'resume'], { cwd: root, encoding: 'utf8' });
  assert.equal(resume.status, 0, resume.stderr);
  assert.match(resume.stdout, /Next engineering objective:\nAdvance the reviewed work to DONE\./);
  assert.equal((await advanceActiveWork(root)).to, 'DONE');
});

test('knowledge state is never duplicated into state/current', async () => {
  const { root, meta } = await routedWork();
  await proposeKnowledge(root, meta.id, {
    kind: 'integration',
    source: 'implementation-runtime',
    summary: 'Browser previews require OSS CORS headers.',
    evidence: ['config/filesystems.php']
  });
  const state = await readYaml(path.join(workspacePath(root), 'state', 'current.yaml'));
  assert.deepEqual(Object.keys(state).sort(), ['activeWork', 'schemaVersion', 'stage', 'updatedAt']);
});
