import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { initWorkspace, listWork } from '../src/core/workspace.js';
import { getCurrentState } from '../src/core/workspace.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));

async function stateHash(root) {
  const [state, work] = await Promise.all([getCurrentState(root), listWork(root)]);
  return JSON.stringify({ state, workIds: work.map((item) => item.id) });
}

test('start --help creates no work and prints help', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-help-safety-'));
  await initWorkspace(root, 'demo', 'greenfield');
  const before = await stateHash(root);
  const result = spawnSync(process.execPath, [cli, 'start', '--help'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage:/);
  assert.match(result.stdout, /yallaflow start \[request\]/);
  const after = await stateHash(root);
  assert.deepEqual(after, before);
});

test('start -h creates no work', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-help-safety-'));
  await initWorkspace(root, 'demo', 'greenfield');
  const before = await stateHash(root);
  const result = spawnSync(process.execPath, [cli, 'start', '-h'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const after = await stateHash(root);
  assert.deepEqual(after, before);
});

test('verify --help never attempts to run a verification command', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-help-safety-'));
  await initWorkspace(root, 'demo', 'greenfield');
  const before = await stateHash(root);
  const result = spawnSync(process.execPath, [cli, 'verify', '--help'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage:/);
  const after = await stateHash(root);
  assert.deepEqual(after, before);
});

test('help is non-mutating across every command namespace', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-help-safety-'));
  await initWorkspace(root, 'demo', 'greenfield');
  const before = await stateHash(root);
  const commands = [
    'init', 'start', 'request', 'intake', 'source', 'route', 'baseline', 'guide', 'ready', 'skill',
    'checkpoint', 'question', 'knowledge', 'decompose', 'progress', 'next', 'approve', 'feedback',
    'handoff', 'feature', 'bug', 'investigate', 'change', 'refactor', 'release',
    'status', 'resume', 'doctor', 'advance', 'verify', 'reopen',
    'context', 'agent', 'limitation', 'upgrade', 'brief', 'inspect'
  ];
  for (const command of commands) {
    const result = spawnSync(process.execPath, [cli, command, '--help'], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, `\`yallaflow ${command} --help\` should exit 0, got ${result.status}:\n${result.stderr}`);
  }
  const after = await stateHash(root);
  assert.deepEqual(after, before);
});

test('an unknown option returns an actionable error without mutating state', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-help-safety-'));
  await initWorkspace(root, 'demo', 'greenfield');
  const before = await stateHash(root);
  const result = spawnSync(process.execPath, [cli, 'feature', '--bogus-flag'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.ok(result.stderr.trim().length > 0);
  const after = await stateHash(root);
  assert.deepEqual(after, before);
});
