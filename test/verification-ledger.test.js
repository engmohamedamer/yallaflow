import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { createPendingIntake, routeWorkItem } from '../src/behavior/routing.js';
import { latestVerification, listVerificationRuns, recordVerification } from '../src/core/evidence.js';
import { initWorkspace, workspacePath } from '../src/core/workspace.js';
import { writeYaml } from '../src/core/yaml.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));

async function routedWork(workType = 'bug', scope = 'bounded') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-verify-ledger-'));
  await initWorkspace(root, 'demo', 'greenfield');
  const intake = await createPendingIntake(root, `${workType} ${scope} verify fixture`);
  const meta = await routeWorkItem(root, intake.id, {
    work_type: workType, scope, confidence: 'high', reason: 'Deterministic verify ledger test route.'
  });
  return { root, meta };
}

test('first verify creates run V-001', async () => {
  const { root, meta } = await routedWork();
  const run = await recordVerification(root, meta.id, { command: 'node --test', success: true, exitCode: 0 });
  assert.equal(run.id, 'V-001');
  const runs = await listVerificationRuns(root, meta.id);
  assert.equal(runs.length, 1);
});

test('second verify appends V-002 and old evidence remains', async () => {
  const { root, meta } = await routedWork();
  await recordVerification(root, meta.id, { command: 'node --test', success: true, exitCode: 0 });
  const second = await recordVerification(root, meta.id, { command: 'npm run check', success: true, exitCode: 0 });
  assert.equal(second.id, 'V-002');
  const runs = await listVerificationRuns(root, meta.id);
  assert.equal(runs.length, 2);
  assert.equal(runs[0].id, 'V-001');
  assert.equal(runs[1].id, 'V-002');
});

test('failed verification is recorded and does not delete history; latest success is what is checked', async () => {
  const { root, meta } = await routedWork();
  await recordVerification(root, meta.id, { command: 'node --test', success: false, exitCode: 1 });
  const latestFailed = await latestVerification(root, meta.id);
  assert.equal(latestFailed.success, false);
  await recordVerification(root, meta.id, { command: 'node --test', success: true, exitCode: 0 });
  const runs = await listVerificationRuns(root, meta.id);
  assert.equal(runs.length, 2);
  assert.equal(runs[0].status, 'failed');
  assert.equal(runs[1].status, 'passed');
  const latest = await latestVerification(root, meta.id);
  assert.equal(latest.success, true);
});

test('legacy single-record evidence file remains readable and is not rewritten by reads', async () => {
  const { root, meta } = await routedWork();
  const file = path.join(workspacePath(root), 'work', meta.id, 'evidence', 'verification.json');
  const legacy = { command: 'node --test', success: true, exitCode: 0, startedAt: '2026-01-01T00:00:00.000Z', finishedAt: '2026-01-01T00:00:01.000Z', log: 'verification.log' };
  await writeYaml(file, legacy);

  const latest = await latestVerification(root, meta.id);
  assert.equal(latest.success, true);
  assert.equal(latest.command, 'node --test');

  const runs = await listVerificationRuns(root, meta.id);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].id, 'V-001');

  const raw = JSON.parse(await (await import('node:fs/promises')).readFile(file, 'utf8'));
  assert.equal(raw.schemaVersion, undefined);
  assert.equal(raw.command, 'node --test');
});

test('a new verify appended after legacy evidence upgrades the file, preserving the legacy run as V-001', async () => {
  const { root, meta } = await routedWork();
  const file = path.join(workspacePath(root), 'work', meta.id, 'evidence', 'verification.json');
  await writeYaml(file, { command: 'legacy check', success: true, exitCode: 0, finishedAt: '2026-01-01T00:00:01.000Z' });

  const appended = await recordVerification(root, meta.id, { command: 'node --test', success: true, exitCode: 0 });
  assert.equal(appended.id, 'V-002');
  const runs = await listVerificationRuns(root, meta.id);
  assert.equal(runs.length, 2);
  assert.equal(runs[0].id, 'V-001');
  assert.equal(runs[0].command, 'legacy check');
  assert.equal(runs[1].command, 'node --test');
});

test('yallaflow verify appends evidence and yallaflow verify list shows every run', async () => {
  const { root, meta } = await routedWork();
  const first = spawnSync(process.execPath, [cli, 'verify', '--', 'true'], { cwd: root, encoding: 'utf8' });
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /Verification PASSED \(exit 0\) — V-001\./);

  const second = spawnSync(process.execPath, [cli, 'verify', '--', 'false'], { cwd: root, encoding: 'utf8' });
  assert.equal(second.status, 1);
  assert.match(second.stdout, /Verification FAILED \(exit 1\) — V-002\./);

  const list = spawnSync(process.execPath, [cli, 'verify', 'list', meta.id], { cwd: root, encoding: 'utf8' });
  assert.equal(list.status, 0, list.stderr);
  assert.match(list.stdout, /V-001 — PASSED/);
  assert.match(list.stdout, /V-002 — FAILED/);
});

test('verify list on a work item with no evidence reports clearly', async () => {
  const { root, meta } = await routedWork();
  const list = spawnSync(process.execPath, [cli, 'verify', 'list', meta.id], { cwd: root, encoding: 'utf8' });
  assert.equal(list.status, 0, list.stderr);
  assert.match(list.stdout, /no verification evidence recorded/);
});
