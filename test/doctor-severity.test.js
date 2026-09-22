// v0.3.5 pre-freeze hardening: an untracked-and-ungitignored `.yallaflow` must be
// informational (WARN), never a workspace-health failure — YallaFlow does not
// mandate a Git/team workflow. Genuine structural corruption remains a hard failure.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, `git ${args.join(' ')} failed:\n${result.stderr}`);
  return result;
}

test('an untracked, ungitignored .yallaflow produces a WARN, not a FAIL, and the workspace still reports healthy', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-doctor-severity-'));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'Test']);
  const init = spawnSync(process.execPath, [cli, 'init'], { cwd: root, encoding: 'utf8' });
  assert.equal(init.status, 0, init.stderr);

  const doctor = spawnSync(process.execPath, [cli, 'doctor'], { cwd: root, encoding: 'utf8' });
  assert.equal(doctor.status, 0, doctor.stdout); // not a failure
  assert.match(doctor.stdout, /WARN \.yallaflow exists but is neither tracked by Git nor gitignored/);
  assert.match(doctor.stdout, /Workspace healthy\./);
  assert.doesNotMatch(doctor.stdout, /FAIL .*\.yallaflow.*tracked/);
});

test('a gitignored .yallaflow produces no warning at all', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-doctor-severity-'));
  git(root, ['init', '-q']);
  await (await import('node:fs/promises')).writeFile(path.join(root, '.gitignore'), '.yallaflow\n', 'utf8');
  const init = spawnSync(process.execPath, [cli, 'init'], { cwd: root, encoding: 'utf8' });
  assert.equal(init.status, 0, init.stderr);

  const doctor = spawnSync(process.execPath, [cli, 'doctor'], { cwd: root, encoding: 'utf8' });
  assert.equal(doctor.status, 0, doctor.stdout);
  assert.doesNotMatch(doctor.stdout, /WARN/);
  assert.match(doctor.stdout, /Workspace healthy\./);
});

test('a tracked .yallaflow produces no warning at all', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-doctor-severity-'));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'Test']);
  const init = spawnSync(process.execPath, [cli, 'init'], { cwd: root, encoding: 'utf8' });
  assert.equal(init.status, 0, init.stderr);
  git(root, ['add', '.yallaflow']);
  git(root, ['commit', '-q', '-m', 'workspace']);

  const doctor = spawnSync(process.execPath, [cli, 'doctor'], { cwd: root, encoding: 'utf8' });
  assert.equal(doctor.status, 0, doctor.stdout);
  assert.doesNotMatch(doctor.stdout, /WARN/);
  assert.match(doctor.stdout, /Workspace healthy\./);
});

test('genuine structural corruption remains a hard FAIL even when Git tracking is fine', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-doctor-severity-'));
  const init = spawnSync(process.execPath, [cli, 'init'], { cwd: root, encoding: 'utf8' });
  assert.equal(init.status, 0, init.stderr);
  await rm(path.join(root, '.yallaflow', 'PROJECT.md'));

  const doctor = spawnSync(process.execPath, [cli, 'doctor'], { cwd: root, encoding: 'utf8' });
  assert.equal(doctor.status, 1);
  assert.match(doctor.stdout, /FAIL PROJECT\.md/);
  assert.doesNotMatch(doctor.stdout, /Workspace healthy\./);
});

test('outside a Git repository, no warning is produced', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-doctor-severity-'));
  const init = spawnSync(process.execPath, [cli, 'init'], { cwd: root, encoding: 'utf8' });
  assert.equal(init.status, 0, init.stderr);
  const doctor = spawnSync(process.execPath, [cli, 'doctor'], { cwd: root, encoding: 'utf8' });
  assert.equal(doctor.status, 0, doctor.stdout);
  assert.doesNotMatch(doctor.stdout, /WARN/);
});
