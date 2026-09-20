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
