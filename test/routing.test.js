import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { resolveWorkflowPolicy } from '../src/behavior/policy.js';
import { createPendingIntake, routeWorkItem, validateRoutingDecision } from '../src/behavior/routing.js';
import { initWorkspace, workspacePath } from '../src/core/workspace.js';
import { readYaml } from '../src/core/yaml.js';
import { advanceActiveWork } from '../src/core/transitions.js';
import { reviewKnowledgeNone } from '../src/knowledge/store.js';
import { checkpointWork } from '../src/core/progress.js';
import { recordVerification } from '../src/core/evidence.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));

test('bounded production bug requires debugging and verification', () => {
  const policy = resolveWorkflowPolicy('bug', 'bounded');
  assert.equal(policy.workflow, 'bug');
  assert.equal(policy.readOnly, false);
  assert.ok(policy.requiredCapabilities.includes('systematic-debugging'));
  assert.ok(policy.requiredCapabilities.includes('verify'));
});

test('architectural feature requires brainstorming, planning, and review', () => {
  const policy = resolveWorkflowPolicy('feature', 'architectural');
  assert.ok(policy.requiredCapabilities.includes('brainstorm'));
  assert.ok(policy.requiredCapabilities.includes('plan'));
  assert.ok(policy.requiredCapabilities.includes('review'));
});

test('bounded feature does not require architectural planning', () => {
  const policy = resolveWorkflowPolicy('feature', 'bounded');
  assert.deepEqual(policy.requiredCapabilities, ['discover', 'clarify', 'implement', 'verify']);
  assert.equal(policy.requiredCapabilities.includes('plan'), false);
  assert.equal(policy.requiredCapabilities.includes('brainstorm'), false);
  assert.equal(policy.requiredCapabilities.includes('review'), false);
});

test('investigation remains read-only without implementation authorization', () => {
  const policy = resolveWorkflowPolicy('investigation', 'bounded');
  assert.equal(policy.workflow, 'investigation');
  assert.equal(policy.readOnly, true);
  assert.equal(policy.requiredCapabilities.includes('implement'), false);
});

test('bug spike uses the read-only investigation workflow', () => {
  const policy = resolveWorkflowPolicy('bug', 'spike');
  assert.equal(policy.workflow, 'investigation');
  assert.equal(policy.readOnly, true);
  assert.equal(policy.requiredCapabilities.includes('implement'), false);
});

test('feature spike is rejected instead of silently reinterpreted', () => {
  assert.throws(() => resolveWorkflowPolicy('feature', 'spike'), /Unsupported routing combination: feature \+ spike/);
});

test('routing validation rejects an invalid work type', () => {
  assert.throws(() => validateRoutingDecision({
    work_type: 'task',
    scope: 'bounded',
    confidence: 'high',
    reason: 'Explicit test reason.'
  }), /work_type must be one of/);
});

test('routing validation rejects an invalid scope', () => {
  assert.throws(() => validateRoutingDecision({
    work_type: 'bug',
    scope: 'small',
    confidence: 'high',
    reason: 'Explicit test reason.'
  }), /scope must be one of/);
});

test('routing validation rejects invalid confidence and empty reasons', () => {
  assert.throws(() => validateRoutingDecision({
    work_type: 'bug',
    scope: 'bounded',
    confidence: 'certain',
    reason: 'Explicit test reason.'
  }), /confidence must be one of/);
  assert.throws(() => validateRoutingDecision({
    work_type: 'bug',
    scope: 'bounded',
    confidence: 'high',
    reason: '   '
  }), /reason must be a non-empty string/);
});

test('routing validation rejects unknown fields', () => {
  assert.throws(() => validateRoutingDecision({
    work_type: 'bug',
    scope: 'bounded',
    confidence: 'high',
    reason: 'Explicit test reason.',
    provider: 'example'
  }), /Unknown routing field\(s\): provider/);
});

test('pending intake preserves the raw request and resume identifies routing next', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-routing-'));
  await initWorkspace(root, 'demo', 'greenfield');
  const rawRequest = 'Production upload returns 500';
  const item = await createPendingIntake(root, rawRequest);
  const persisted = await readYaml(path.join(workspacePath(root), 'work', item.id, 'meta.yaml'));
  assert.equal(persisted.rawRequest, rawRequest);
  assert.equal(persisted.type, null);
  assert.equal(persisted.routingStatus, 'pending');

  const result = spawnSync(process.execPath, [cli, 'resume'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Routing: pending/);
  assert.match(result.stdout, /Raw request: Production upload returns 500/);
  assert.match(result.stdout, /Next: classify work type and scope/);

  const verify = spawnSync(process.execPath, [cli, 'verify', '--', 'node', '--version'], { cwd: root, encoding: 'utf8' });
  assert.equal(verify.status, 1);
  assert.match(verify.stderr, /awaiting routing/);
});

test('routing decision survives a separate CLI process', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-routing-'));
  await initWorkspace(root, 'demo', 'greenfield');
  const item = await createPendingIntake(root, 'Production upload returns 500');
  const reason = 'Existing upload flow returns an unexpected 500 response.';
  const result = spawnSync(process.execPath, [
    cli,
    'route',
    item.id,
    '--type', 'bug',
    '--scope', 'bounded',
    '--confidence', 'high',
    '--reason', reason
  ], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);

  const persisted = await readYaml(path.join(workspacePath(root), 'work', item.id, 'meta.yaml'));
  assert.equal(persisted.routingStatus, 'routed');
  assert.equal(persisted.type, 'bug');
  assert.equal(persisted.scope, 'bounded');
  assert.equal(persisted.routingConfidence, 'high');
  assert.equal(persisted.routingReason, reason);
  assert.equal(persisted.workflow, 'bug');
  assert.ok(persisted.requiredCapabilities.includes('systematic-debugging'));
  assert.ok(persisted.routedAt);
  assert.deepEqual(persisted.behaviorContract, {
    registryVersion: 3,
    skills: ['context-discovery', 'systematic-debugging', 'implementation', 'verification']
  });

  const state = await readYaml(path.join(workspacePath(root), 'state', 'current.yaml'));
  assert.deepEqual({ activeWork: state.activeWork, stage: state.stage }, { activeWork: item.id, stage: 'INTAKE' });
  const work = await readFile(path.join(workspacePath(root), 'work', item.id, 'work.md'), 'utf8');
  assert.match(work, /## Routing Decision/);
  assert.match(work, /\*\*Reason:\*\* Existing upload flow returns an unexpected 500 response\./);
});

test('routed bug spike cannot enter an implementation stage', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-routing-'));
  await initWorkspace(root, 'demo', 'greenfield');
  const item = await createPendingIntake(root, 'Diagnose intermittent queue latency');
  await routeWorkItem(root, item.id, {
    work_type: 'bug',
    scope: 'spike',
    confidence: 'medium',
    reason: 'This route authorizes diagnosis only, not a production fix.'
  });

  const stages = [];
  for (let index = 0; index < 6; index++) stages.push((await advanceActiveWork(root)).to);
  await reviewKnowledgeNone(root, item.id);
  // v0.3.6: DONE requires the pinned verification checkpoint for every workflow.
  await assert.rejects(() => advanceActiveWork(root), /verification checkpoint is completed/);
  for (const skillId of ['context-discovery', 'systematic-debugging']) {
    await checkpointWork(root, item.id, { skillId, status: 'completed', summary: 'Done.', evidence: ['notes'] });
  }
  await recordVerification(root, item.id, { command: 'node diagnose.js', success: true, exitCode: 0 });
  await checkpointWork(root, item.id, { skillId: 'verification', status: 'completed', summary: 'Diagnosis reproduced.', evidence: [] });
  stages.push((await advanceActiveWork(root)).to);
  assert.deepEqual(stages, ['QUESTION', 'DISCOVERY', 'EVIDENCE', 'HYPOTHESIS', 'FINDINGS', 'CONCLUSION', 'DONE']);
  assert.equal(stages.includes('IMPLEMENTATION'), false);
});
