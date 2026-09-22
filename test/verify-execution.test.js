import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, chmod } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { createPendingIntake, routeWorkItem } from '../src/behavior/routing.js';
import { listVerificationRuns } from '../src/core/evidence.js';
import { initWorkspace, workspacePath } from '../src/core/workspace.js';
import { writeYaml } from '../src/core/yaml.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));

async function routedWork() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-verify-exec-'));
  await initWorkspace(root, 'demo', 'greenfield');
  const intake = await createPendingIntake(root, 'verify execution fixture');
  const meta = await routeWorkItem(root, intake.id, {
    work_type: 'bug', scope: 'bounded', confidence: 'high', reason: 'Deterministic verify execution test route.'
  });
  return { root, meta };
}

test('direct argv preserves an argument containing spaces exactly', async () => {
  const { root, meta } = await routedWork();
  const result = spawnSync(process.execPath, [
    cli, 'verify', '--', 'node', '-e', 'if (process.argv[1] !== "has spaces") process.exit(1)', 'has spaces'
  ], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const runs = await listVerificationRuns(root, meta.id);
  assert.equal(runs[0].executionMode, 'argv');
  assert.deepEqual(runs[0].args, ['-e', 'if (process.argv[1] !== "has spaces") process.exit(1)', 'has spaces']);
});

test('direct argv mode never invokes shell interpretation', async () => {
  const { root } = await routedWork();
  // A shell-only construct (semicolon-separated commands) must be treated as one
  // literal, invalid executable name in argv mode, never as two commands.
  const result = spawnSync(process.execPath, [cli, 'verify', '--', 'true; echo should-not-run'], { cwd: root, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stdout, /should-not-run/);
});

test('explicit --shell mode supports a pipeline', async () => {
  const { root, meta } = await routedWork();
  const result = spawnSync(process.execPath, [cli, 'verify', '--shell', 'echo hello world | grep hello'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /hello world/);
  const runs = await listVerificationRuns(root, meta.id);
  assert.equal(runs[0].executionMode, 'shell');
  assert.equal(runs[0].success, true);
});

test('--script mode executes a script file and records its path', async () => {
  const { root, meta } = await routedWork();
  const scriptPath = path.join(root, 'smoke.sh');
  await writeFile(scriptPath, '#!/bin/sh\necho script-ran\nexit 0\n', 'utf8');
  await chmod(scriptPath, 0o755);
  const result = spawnSync(process.execPath, [cli, 'verify', '--script', 'smoke.sh'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /script-ran/);
  const runs = await listVerificationRuns(root, meta.id);
  assert.equal(runs[0].executionMode, 'script');
  assert.match(runs[0].executable, /smoke\.sh$/);
});

test('a failed verification run is recorded, and a later success does not delete it', async () => {
  const { root, meta } = await routedWork();
  const failed = spawnSync(process.execPath, [cli, 'verify', '--', 'false'], { cwd: root, encoding: 'utf8' });
  assert.equal(failed.status, 1);
  const success = spawnSync(process.execPath, [cli, 'verify', '--', 'true'], { cwd: root, encoding: 'utf8' });
  assert.equal(success.status, 0, success.stderr);
  const runs = await listVerificationRuns(root, meta.id);
  assert.equal(runs.length, 2);
  assert.equal(runs[0].status, 'failed');
  assert.equal(runs[1].status, 'passed');
});

test('stdin is inherited safely: piped input reaches the verification process without hanging', async () => {
  const { root, meta } = await routedWork();
  const result = spawnSync(process.execPath, [
    cli, 'verify', '--', 'node', '-e', 'process.stdin.on("data", (d) => process.stdout.write(d)); process.stdin.on("end", () => process.exit(0));'
  ], { cwd: root, encoding: 'utf8', input: 'from-stdin\n' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /from-stdin/);
  const runs = await listVerificationRuns(root, meta.id);
  assert.equal(runs[0].success, true);
});

test('a legacy (schemaVersion-less) verification ledger remains readable, no migration on read', async () => {
  const { root, meta } = await routedWork();
  const file = path.join(workspacePath(root), 'work', meta.id, 'evidence', 'verification.json');
  await writeYaml(file, { command: 'legacy command', success: true, exitCode: 0, finishedAt: '2026-01-01T00:00:00.000Z' });
  const list = spawnSync(process.execPath, [cli, 'verify', 'list', meta.id], { cwd: root, encoding: 'utf8' });
  assert.equal(list.status, 0, list.stderr);
  assert.match(list.stdout, /V-001 — PASSED/);
  assert.match(list.stdout, /legacy command/);
  const raw = JSON.parse(await (await import('node:fs/promises')).readFile(file, 'utf8'));
  assert.equal(raw.schemaVersion, undefined);
});

test('verify list renders the execution mode for each run', async () => {
  const { root, meta } = await routedWork();
  spawnSync(process.execPath, [cli, 'verify', '--', 'true'], { cwd: root, encoding: 'utf8' });
  spawnSync(process.execPath, [cli, 'verify', '--shell', 'true'], { cwd: root, encoding: 'utf8' });
  const list = spawnSync(process.execPath, [cli, 'verify', 'list', meta.id], { cwd: root, encoding: 'utf8' });
  assert.equal(list.status, 0, list.stderr);
  assert.match(list.stdout, /V-001 — PASSED \[argv\]/);
  assert.match(list.stdout, /V-002 — PASSED \[shell\]/);
});
