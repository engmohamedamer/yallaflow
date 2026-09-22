import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { exists } from '../src/utils/fs.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, `git ${args.join(' ')} failed:\n${result.stderr}`);
  return result;
}

async function tmpRepo(prefix) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'Test']);
  return root;
}

test('existing .yallaflow on the filesystem blocks init', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-init-safety-'));
  const first = spawnSync(process.execPath, [cli, 'init'], { cwd: root, encoding: 'utf8' });
  assert.equal(first.status, 0, first.stderr);
  const second = spawnSync(process.execPath, [cli, 'init'], { cwd: root, encoding: 'utf8' });
  assert.equal(second.status, 1);
  assert.match(second.stderr, /Workspace already exists/);
});

test('legacy .projectflow blocks init', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-init-safety-'));
  await mkdir(path.join(root, '.projectflow'));
  const result = spawnSync(process.execPath, [cli, 'init'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Legacy \.projectflow workspace detected/);
  assert.equal(await exists(path.join(root, '.yallaflow')), false);
});

test('Git-tracked .yallaflow missing from the working tree blocks init', async () => {
  const root = await tmpRepo('yallaflow-init-safety-tracked-');
  const first = spawnSync(process.execPath, [cli, 'init'], { cwd: root, encoding: 'utf8' });
  assert.equal(first.status, 0, first.stderr);
  git(root, ['add', '.yallaflow']);
  git(root, ['commit', '-q', '-m', 'baseline workspace']);

  // Working tree copy is removed, but Git still has it tracked in the index/HEAD.
  await rm(path.join(root, '.yallaflow'), { recursive: true, force: true });
  git(root, ['rm', '-r', '--cached', '-q', '.yallaflow']); // simulate index also losing it, HEAD still has it

  const second = spawnSync(process.execPath, [cli, 'init'], { cwd: root, encoding: 'utf8' });
  assert.equal(second.status, 1);
  assert.match(second.stderr, /tracked by Git but missing from the working tree/);
  assert.match(second.stderr, /No files were changed/);
});

test('a failed init mutates zero files', async () => {
  const root = await tmpRepo('yallaflow-init-safety-nomutation-');
  const first = spawnSync(process.execPath, [cli, 'init'], { cwd: root, encoding: 'utf8' });
  assert.equal(first.status, 0, first.stderr);
  git(root, ['add', '.yallaflow']);
  git(root, ['commit', '-q', '-m', 'baseline workspace']);
  await rm(path.join(root, '.yallaflow'), { recursive: true, force: true });
  git(root, ['rm', '-r', '--cached', '-q', '.yallaflow']);

  const before = await readdir(root);
  const result = spawnSync(process.execPath, [cli, 'init'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 1);
  const after = await readdir(root);
  assert.deepEqual(after.sort(), before.sort());
  assert.equal(await exists(path.join(root, '.yallaflow')), false);
});

test('a project with no Git repository at all still initializes normally', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-init-safety-nogit-'));
  const result = spawnSync(process.execPath, [cli, 'init'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await exists(path.join(root, '.yallaflow')), true);
});
