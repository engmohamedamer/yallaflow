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
import { loadWorkReadiness } from '../src/behavior/readiness.js';
import { buildBehaviorGuidance } from '../src/behavior/guidance.js';
import { reviewKnowledgeNone, proposeKnowledge } from '../src/knowledge/store.js';
import { promoteKnowledge } from '../src/knowledge/promotion.js';
import { initWorkspace, workspacePath } from '../src/core/workspace.js';
import { readYaml, writeYaml } from '../src/core/yaml.js';
import { addQuestion } from '../src/questions/store.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));

async function routedWork(workType = 'feature', scope = 'architectural') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-readiness-'));
  await initWorkspace(root, 'demo', 'greenfield');
  const intake = await createPendingIntake(root, `${workType} ${scope} readiness fixture`);
  const meta = await routeWorkItem(root, intake.id, {
    work_type: workType,
    scope,
    confidence: 'high',
    reason: 'Deterministic readiness test route.',
    title: 'Contract Management System'
  });
  return { root, meta };
}

async function complete(root, meta, skillId) {
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
  await advanceActiveWork(root); // -> SPECIFICATION
}

test('SPEC_READY: specification alone yields a spec-ready deliverable', async () => {
  const { root, meta } = await routedWork();
  await reachSpecification(root, meta);
  const readiness = await loadWorkReadiness(root, meta);
  assert.equal(readiness.specification.status, 'READY');
  assert.equal(readiness.plan.status, 'BLOCKED');
  assert.equal(readiness.deliveryStatus, 'SPEC_READY');

  const result = spawnSync(process.execPath, [cli, 'ready', meta.id], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Delivery status: SPEC_READY/);
  assert.match(result.stdout, /Specification readiness: READY/);
  assert.match(result.stdout, /Plan readiness: BLOCKED/);
});

test('PLAN_READY: specification and plan together yield a plan-ready deliverable without implementation', async () => {
  const { root, meta } = await routedWork();
  await reachSpecification(root, meta);
  await advanceActiveWork(root); // -> PLAN
  await complete(root, meta, 'implementation-planning');
  const readiness = await loadWorkReadiness(root, meta);
  assert.equal(readiness.specification.status, 'READY');
  assert.equal(readiness.plan.status, 'READY');
  assert.equal(readiness.deliveryStatus, 'PLAN_READY');
  assert.equal(readiness.implementation.status, 'NOT_STARTED');

  const result = spawnSync(process.execPath, [cli, 'ready', meta.id], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Delivery status: PLAN_READY/);
  assert.match(result.stdout, /Plan readiness: READY/);
  assert.match(result.stdout, /Application implementation: NOT STARTED/);
});

test('plan-ready does not imply implementation authorization', async () => {
  const { root, meta } = await routedWork();
  await reachSpecification(root, meta);
  await advanceActiveWork(root); // -> PLAN
  await complete(root, meta, 'implementation-planning');
  const readiness = await loadWorkReadiness(root, meta);
  assert.equal(readiness.deliveryStatus, 'PLAN_READY');

  const metaOnDisk = await readYaml(path.join(workspacePath(root), 'work', meta.id, 'meta.yaml'));
  const guidance = buildBehaviorGuidance(metaOnDisk, 'PLAN', { skills: {} });
  assert.equal(guidance.modification.authorized, false);

  await assert.rejects(
    () => checkpointWork(root, meta.id, { skillId: 'implementation', status: 'in_progress', evidence: [] }),
    /Cannot start implementation at workflow stage PLAN/
  );
});

test('full implementation DONE remains supported', async () => {
  const { root, meta } = await routedWork();
  await reachSpecification(root, meta);
  await advanceActiveWork(root); // -> PLAN
  await complete(root, meta, 'implementation-planning');
  await advanceActiveWork(root); // -> IMPLEMENTATION
  await complete(root, meta, 'implementation');
  await advanceActiveWork(root); // -> VERIFICATION
  await recordVerification(root, meta.id, {
    command: 'node --test', success: true, exitCode: 0,
    startedAt: '2026-01-01T00:00:00.000Z', finishedAt: '2026-01-01T00:00:01.000Z', log: 'verification.log'
  });
  await complete(root, meta, 'verification');
  await complete(root, meta, 'code-review');
  await reviewKnowledgeNone(root, meta.id);
  const transition = await advanceActiveWork(root); // -> DONE
  assert.equal(transition.to, 'DONE');

  const finalMeta = await readYaml(path.join(workspacePath(root), 'work', meta.id, 'meta.yaml'));
  const readiness = await loadWorkReadiness(root, finalMeta);
  assert.equal(readiness.deliveryStatus, 'DONE');
  assert.equal(readiness.implementation.status, 'COMPLETE');
});

test('old pinned contracts remain unaffected by a newer registry version', async () => {
  const { root, meta } = await routedWork('bug', 'bounded');
  assert.equal(meta.behaviorContract.registryVersion, 2);
  assert.equal(meta.behaviorContract.skills.includes('specification'), false);

  const persisted = await readYaml(path.join(workspacePath(root), 'work', meta.id, 'meta.yaml'));
  persisted.behaviorContract = { registryVersion: 1, skills: ['context-discovery', 'systematic-debugging', 'implementation', 'verification'] };
  await writeYaml(path.join(workspacePath(root), 'work', meta.id, 'meta.yaml'), persisted);
  const reloaded = await readYaml(path.join(workspacePath(root), 'work', meta.id, 'meta.yaml'));
  assert.deepEqual(reloaded.behaviorContract.skills, ['context-discovery', 'systematic-debugging', 'implementation', 'verification']);
  assert.equal(reloaded.behaviorContract.registryVersion, 1);
});

test('new architectural work includes the specification skill in its pinned contract', async () => {
  const { meta } = await routedWork('feature', 'architectural');
  assert.ok(meta.behaviorContract.skills.includes('specification'));
  assert.equal(meta.behaviorContract.registryVersion, 2);
});

test('specification checkpoint persists across restart', async () => {
  const { root, meta } = await routedWork();
  await reachSpecification(root, meta);
  const result = spawnSync(process.execPath, [cli, 'ready', meta.id], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Delivery status: SPEC_READY/);
});

test('knowledge review allowed at stable spec/plan endpoint without implementation evidence', async () => {
  const { root, meta } = await routedWork();
  await reachSpecification(root, meta);
  const proposed = await proposeKnowledge(root, meta.id, {
    kind: 'architecture',
    source: 'design-spec',
    summary: 'Contract lifecycle uses a single payment-log boundary for state transitions.',
    evidence: ['work.md#specification']
  });
  const promoted = await promoteKnowledge(root, meta.id, proposed.candidate.id);
  assert.equal(promoted.target, 'context/architecture.md');
});

test('design/spec knowledge review is refused before a stable delivery endpoint', async () => {
  const { root, meta } = await routedWork();
  await complete(root, meta, 'context-discovery');
  const proposed = await proposeKnowledge(root, meta.id, {
    kind: 'architecture',
    source: 'design-spec',
    summary: 'Premature architecture note.',
    evidence: ['work.md']
  });
  await assert.rejects(
    () => promoteKnowledge(root, meta.id, proposed.candidate.id),
    /requires SPEC_READY or PLAN_READY/
  );
});

test('a concise work title is displayed instead of the raw request', async () => {
  const { root, meta } = await routedWork();
  assert.equal(meta.title, 'Contract Management System');
  const status = spawnSync(process.execPath, [cli, 'status'], { cwd: root, encoding: 'utf8' });
  assert.equal(status.status, 0, status.stderr);
  assert.match(status.stdout, /PF-0001 — Contract Management System/);
  assert.doesNotMatch(status.stdout, /readiness fixture/);

  const resume = spawnSync(process.execPath, [cli, 'resume'], { cwd: root, encoding: 'utf8' });
  assert.equal(resume.status, 0, resume.stderr);
  assert.match(resume.stdout, /PF-0001 — Contract Management System/);

  const workFile = await readYaml(path.join(workspacePath(root), 'work', meta.id, 'meta.yaml'));
  assert.match(workFile.rawRequest, /^feature architectural readiness fixture$/);
});

test('a reviewed design/spec knowledge pass at a stable endpoint does not claim the whole work item is ready for DONE', async () => {
  const { root, meta } = await routedWork();
  await reachSpecification(root, meta); // SPEC_READY; stage SPECIFICATION -> advance moves to PLAN below
  await advanceActiveWork(root); // -> PLAN
  const proposed = await proposeKnowledge(root, meta.id, {
    kind: 'business-rule',
    source: 'design-spec',
    summary: 'A contract moves to Paid only once fully covered by its payment log.',
    evidence: ['work.md#specification']
  });
  await promoteKnowledge(root, meta.id, proposed.candidate.id);

  const guide = spawnSync(process.execPath, [cli, 'guide', meta.id], { cwd: root, encoding: 'utf8' });
  assert.equal(guide.status, 0, guide.stderr);
  assert.match(guide.stdout, /Project knowledge review: REVIEWED/);
  assert.doesNotMatch(guide.stdout, /Advance the reviewed work to DONE/);
  assert.match(guide.stdout, /Start the implementation-planning checkpoint\./);

  const resume = spawnSync(process.execPath, [cli, 'resume'], { cwd: root, encoding: 'utf8' });
  assert.equal(resume.status, 0, resume.stderr);
  assert.doesNotMatch(resume.stdout, /Advance the reviewed work to DONE/);
  assert.match(resume.stdout, /Start the implementation-planning checkpoint\./);
});

test('resume surfaces open decisions and delivery readiness for architectural work', async () => {
  const { root, meta } = await routedWork();
  await reachSpecification(root, meta);
  await addQuestion(root, meta.id, { category: 'business', question: 'Can a contract receive multiple payments?' });
  await addQuestion(root, meta.id, {
    category: 'architecture',
    question: 'Which document-generation strategy should be used?',
    proposal: 'Server-generated PDF'
  });

  const resume = spawnSync(process.execPath, [cli, 'resume'], { cwd: root, encoding: 'utf8' });
  assert.equal(resume.status, 0, resume.stderr);
  assert.match(resume.stdout, /Delivery status: NOT_READY/);
  assert.match(resume.stdout, /Open decisions: 2 \(2 material\)/);
  assert.match(resume.stdout, /Can a contract receive multiple payments\?/);
  assert.match(resume.stdout, /Which document-generation strategy should be used\?/);
  assert.match(resume.stdout, /Resolve 2 material open decision\(s\) before completing/);
});
