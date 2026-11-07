import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { createPendingIntake, routeWorkItem } from '../src/behavior/routing.js';
import { checkpointWork, progressFilePath } from '../src/core/progress.js';
import { advanceActiveWork, reopenWork } from '../src/core/transitions.js';
import { recordVerification } from '../src/core/evidence.js';
import { reviewKnowledgeNone } from '../src/knowledge/store.js';
import { initWorkspace, workspacePath } from '../src/core/workspace.js';
import { readYaml, writeYaml } from '../src/core/yaml.js';
import { MINIMAL_INTENT, cliRecordIntent } from '../test-support/delivery.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));

async function routedWork(workType = 'bug', scope = 'architectural') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-doctor-'));
  await initWorkspace(root, 'demo', 'greenfield');
  const intake = await createPendingIntake(root, `${workType} ${scope} doctor fixture`);
  const meta = await routeWorkItem(root, intake.id, {
    work_type: workType, scope, confidence: 'high', reason: 'Deterministic doctor test route.'
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
  for (let index = 0; index < 7; index++) await advanceActiveWork(root); // -> IMPLEMENTATION
  await complete(root, meta, 'implementation');
  await advanceActiveWork(root); // -> VERIFICATION
  await recordVerification(root, meta.id, { command: 'node --test', success: true, exitCode: 0 });
  await complete(root, meta, 'verification');
  await complete(root, meta, 'code-review');
  await reviewKnowledgeNone(root, meta.id);
  await advanceActiveWork(root); // -> DONE
}

test('doctor reports a healthy workspace with no work items', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-doctor-empty-'));
  await initWorkspace(root, 'demo', 'greenfield');
  const result = spawnSync(process.execPath, [cli, 'doctor'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PASS lifecycle integrity \(0 work item\(s\) checked\)/);
});

test('doctor detects a DONE stage with an incomplete implementation checkpoint', async () => {
  const { root, meta } = await routedWork();
  await reachDone(root, meta);

  // Simulate a corrupted ledger written outside the CLI (e.g. by hand-editing).
  const ledger = await readYaml(progressFilePath(root, meta.id));
  ledger.skills.implementation = { status: 'in_progress' };
  await writeYaml(progressFilePath(root, meta.id), ledger);

  const result = spawnSync(process.execPath, [cli, 'doctor'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stdout, new RegExp(`FAIL ${meta.id}: stage is DONE but implementation checkpoint is in_progress\\.`));
});

test('doctor detects a completed verification checkpoint with no verification evidence', async () => {
  const { root, meta } = await routedWork();
  await complete(root, meta, 'context-discovery');
  await complete(root, meta, 'systematic-debugging', ['evidence/root-cause.txt']);
  await complete(root, meta, 'implementation-planning');
  for (let index = 0; index < 7; index++) await advanceActiveWork(root); // -> IMPLEMENTATION
  await complete(root, meta, 'implementation');
  await advanceActiveWork(root); // -> VERIFICATION
  await recordVerification(root, meta.id, { command: 'node --test', success: true, exitCode: 0 });
  await complete(root, meta, 'verification');

  // Corrupt: remove the recorded evidence while the checkpoint still claims completed.
  const evidenceFile = path.join(workspacePath(root), 'work', meta.id, 'evidence', 'verification.json');
  await writeYaml(evidenceFile, { schemaVersion: 2, runs: [] });

  const result = spawnSync(process.execPath, [cli, 'doctor'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stdout, new RegExp(`FAIL ${meta.id}: verification checkpoint is completed but no verification evidence exists\\.`));
});

test('doctor detects an impossible DONE state missing required review/knowledge', async () => {
  const { root, meta } = await routedWork();
  await reachDone(root, meta);

  const metaFile = path.join(workspacePath(root), 'work', meta.id, 'meta.yaml');
  const persisted = await readYaml(metaFile);
  const ledger = await readYaml(progressFilePath(root, meta.id));
  ledger.skills['code-review'] = { status: 'pending' };
  await writeYaml(progressFilePath(root, meta.id), ledger);
  persisted.updatedAt = new Date().toISOString();
  await writeYaml(metaFile, persisted);

  const result = spawnSync(process.execPath, [cli, 'doctor'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stdout, new RegExp(`FAIL ${meta.id}: stage is DONE but code-review checkpoint is pending\\.`));
});

test('doctor considers a healthy reopened work item passing', async () => {
  const { root, meta } = await routedWork();
  await reachDone(root, meta);
  await reopenWork(root, meta.id, { toStage: 'implementation', reason: 'Production defect discovered after completion.' });

  const result = spawnSync(process.execPath, [cli, 'doctor'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout);
  assert.match(result.stdout, /PASS lifecycle integrity \(1 work item\(s\) checked\)/);
});

// 1.4.0 (PF-0050): waiting at a gate is the designed state, not an integrity failure;
// only work that moved past a gate without approval is.
test('doctor accepts a completed gated checkpoint awaiting review at its stage, and flags work past an unapproved gate', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-doctor-gate-'));
  await initWorkspace(root, 'demo', 'greenfield');
  const run = (args) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8' });
  const id = /Created (PF-\d+)/.exec(run(['feature', 'Gate fixture', '--scope', 'architectural']).stdout)[1];
  await cliRecordIntent(root, id, MINIMAL_INTENT, (r, args) => spawnSync(process.execPath, [cli, ...args], { cwd: r, encoding: 'utf8' }));
  for (const skill of ['context-discovery', 'requirement-clarification', 'design-exploration']) {
    run(['advance', id]);
    assert.equal(run(['checkpoint', id, '--skill', skill, '--complete', '--summary', 'ok']).status, 0);
  }
  run(['advance', id]); // -> SPECIFICATION
  assert.equal(run(['checkpoint', id, '--skill', 'specification', '--complete', '--summary', 'ok']).status, 0);
  run(['advance', id]); // requests the review and stays at SPECIFICATION
  const reviews = await readYaml(path.join(workspacePath(root), 'work', id, 'reviews.yaml'));
  assert.equal(reviews.gates.specification.status, 'awaiting_review');
  const waiting = run(['doctor']);
  assert.doesNotMatch(waiting.stdout, /FAIL .*specification checkpoint/, 'waiting at the gate is valid');

  const metaFile = path.join(workspacePath(root), 'work', id, 'meta.yaml');
  const meta = await readYaml(metaFile);
  meta.status = 'PLAN'; // forged: moved past the gate without approval
  await writeYaml(metaFile, meta);
  const past = run(['doctor']);
  assert.equal(past.status, 1);
  assert.match(past.stdout, new RegExp(`FAIL ${id}: specification checkpoint is completed but its review is awaiting_review, and the work has moved past that gate\\.`));
});
