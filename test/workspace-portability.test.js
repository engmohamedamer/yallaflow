// v0.3.9 pre-freeze: a committed workspace must survive `git clone`. Git does not store
// empty directories, so the lazy directories `init` creates (work/, decisions/,
// releases/) are absent in a fresh clone — which must be a healthy, usable state.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { LAZY_WORKSPACE_DIRS } from '../src/core/workspace.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));

function run(root, args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8' });
}

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout;
}

async function committedFreshWorkspace() {
  const origin = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-portable-origin-'));
  git(origin, ['init', '-q']);
  git(origin, ['config', 'user.email', 'test@example.com']);
  git(origin, ['config', 'user.name', 'Test']);
  await writeFile(path.join(origin, 'index.js'), 'export {};\n');
  assert.equal(run(origin, ['init']).status, 0);
  git(origin, ['add', '-A']);
  git(origin, ['commit', '-qm', 'Initialize YallaFlow']);
  const clone = path.join(await mkdtemp(path.join(os.tmpdir(), 'yallaflow-portable-clone-')), 'repo');
  git(path.dirname(clone), ['clone', '-q', origin, clone]);
  return { origin, clone };
}

test('init → no ADRs/releases → commit → fresh clone → doctor is healthy', async () => {
  const { origin, clone } = await committedFreshWorkspace();
  // The origin keeps the empty directories init created; the clone cannot have them.
  for (const dir of LAZY_WORKSPACE_DIRS) assert.deepEqual(await readdir(path.join(origin, '.yallaflow', dir)), [], `${dir} empty at init`);
  const cloned = await readdir(path.join(clone, '.yallaflow'));
  for (const dir of LAZY_WORKSPACE_DIRS) assert.ok(!cloned.includes(dir), `${dir} absent in the clone`);

  const doctor = run(clone, ['doctor']);
  assert.equal(doctor.status, 0, doctor.stdout);
  assert.match(doctor.stdout, /Workspace healthy\./);
  for (const dir of LAZY_WORKSPACE_DIRS) assert.match(doctor.stdout, new RegExp(`PASS ${dir} \\(absent — created when first needed\\)`));
  assert.equal(git(clone, ['status', '--porcelain']), '', 'doctor wrote nothing');

  // Read commands work on the clone, and the first work item recreates work/ lazily.
  for (const args of [['brief'], ['status'], ['inspect'], ['context', 'status'], ['upgrade', 'status']]) {
    const result = run(clone, args);
    assert.equal(result.status, 0, `${args.join(' ')}: ${result.stderr}`);
  }
  assert.equal(git(clone, ['status', '--porcelain']), '', 'read commands wrote nothing');
  const start = run(clone, ['start', 'Add an export']);
  assert.equal(start.status, 0, start.stderr);
  assert.match(start.stdout, /Created PF-0001/);
  assert.equal(run(clone, ['doctor']).status, 0);
});

test('absent work/ is a failure only when durable state names active work', async () => {
  const { clone } = await committedFreshWorkspace();
  assert.equal(run(clone, ['start', 'Add an export']).status, 0);
  await rm(path.join(clone, '.yallaflow', 'work'), { recursive: true });
  const doctor = run(clone, ['doctor']);
  assert.equal(doctor.status, 1);
  assert.match(doctor.stdout, /FAIL work \(missing, but state\/current\.yaml names active work PF-0001\)/);
});

test('a lazy path that exists but is not a directory fails doctor', async () => {
  const { clone } = await committedFreshWorkspace();
  await writeFile(path.join(clone, '.yallaflow', 'decisions'), 'not a directory\n');
  const doctor = run(clone, ['doctor']);
  assert.equal(doctor.status, 1);
  assert.match(doctor.stdout, /FAIL decisions\n/);
});
