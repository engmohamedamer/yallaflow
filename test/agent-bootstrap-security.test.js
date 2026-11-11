// PF-0125 (security): yallaflow init, agent setup and agent refresh never follow a symbolic link
// in a managed bootstrap file (CLAUDE.md, AGENTS.md) or .yallaflow to write outside the project.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, lstat, mkdir, mkdtemp, readdir, readFile, readlink, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { initWorkspace } from '../src/core/workspace.js';
import { BOOTSTRAP_PROVIDERS, BOOTSTRAP_VERSION, inspectBootstrap, renderBootstrapBlock, resolveManagedFile, restoreBootstrapFiles, snapshotBootstrapFiles } from '../src/agent/bootstrap.js';
import { inspectAgentContract } from '../src/agent/contract.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const run = (cwd, args) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });

// A temporary area with a project folder and an "outside" folder standing in for the user's files.
async function area() {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'yf-symlink-')));
  const project = path.join(dir, 'project');
  const outside = path.join(dir, 'outside');
  await mkdir(project); await mkdir(outside);
  await writeFile(path.join(outside, 'bashrc'), 'my shell config\n');
  return { dir, project, outside };
}
const refusedInit = (result) => {
  assert.notEqual(result.status, 0, result.stdout);
  assert.match(`${result.stderr}${result.stdout}`, /No files were changed/);
};

test('init refuses a CLAUDE.md link to a file outside the project; the outside file and the project stay untouched', async () => {
  const { project, outside } = await area();
  await symlink('../outside/bashrc', path.join(project, 'CLAUDE.md'));
  const result = run(project, ['init']);
  refusedInit(result);
  assert.match(result.stderr, /CLAUDE\.md is a link to a file outside this project/);
  assert.equal(await readFile(path.join(outside, 'bashrc'), 'utf8'), 'my shell config\n');
  assert.equal(existsSync(path.join(project, '.yallaflow')), false);
  assert.equal(existsSync(path.join(project, 'AGENTS.md')), false, 'nothing else was written either');
});

test('init refuses a dangling AGENTS.md link (it never creates the link\'s target)', async () => {
  const { project, outside } = await area();
  await symlink('../outside/autostart.desktop', path.join(project, 'AGENTS.md'));
  const result = run(project, ['init']);
  refusedInit(result);
  assert.match(result.stderr, /AGENTS\.md is a link to a file that does not exist/);
  assert.equal(existsSync(path.join(outside, 'autostart.desktop')), false);
  assert.equal(existsSync(path.join(project, '.yallaflow')), false);
});

test('init refuses a link that leaves the project through a linked folder, and a link to a folder', async () => {
  const { project, outside } = await area();
  await symlink('../outside', path.join(project, 'docs'));
  await symlink('docs/bashrc', path.join(project, 'CLAUDE.md'));
  refusedInit(run(project, ['init']));
  assert.equal(await readFile(path.join(outside, 'bashrc'), 'utf8'), 'my shell config\n');
  const second = await area();
  await mkdir(path.join(second.project, 'agents'));
  await symlink('agents', path.join(second.project, 'AGENTS.md'));
  const result = run(second.project, ['init']);
  refusedInit(result);
  assert.match(result.stderr, /AGENTS\.md is a link to something that is not a regular file/);
});

test('init refuses .yallaflow as a link (dangling or to an existing folder) and writes nothing', async () => {
  for (const existing of [false, true]) {
    const { project, outside } = await area();
    if (existing) await mkdir(path.join(outside, 'ws'));
    await symlink('../outside/ws', path.join(project, '.yallaflow'));
    const result = run(project, ['init']);
    refusedInit(result);
    assert.match(result.stderr, /\.yallaflow is a symbolic link/);
    if (existing) assert.deepEqual(await readdir(path.join(outside, 'ws')), [], 'nothing written into the link target');
    else assert.equal(existsSync(path.join(outside, 'ws')), false);
    assert.equal(existsSync(path.join(project, 'CLAUDE.md')), false);
  }
});

test('still supported: CLAUDE.md linked to AGENTS.md and regular files (permissions kept); a link into another folder is refused', async () => {
  const shared = await area();
  await writeFile(path.join(shared.project, 'AGENTS.md'), '# Agents\n');
  await symlink('AGENTS.md', path.join(shared.project, 'CLAUDE.md'));
  assert.equal(run(shared.project, ['init']).status, 0);
  assert.equal(await readlink(path.join(shared.project, 'CLAUDE.md')), 'AGENTS.md', 'the link is kept');
  assert.match(await readFile(path.join(shared.project, 'AGENTS.md'), 'utf8'), /yallaflow-bootstrap:begin provider=/);

  // A link into a subfolder is refused: a process inside the project could swap that subfolder
  // for a link between YallaFlow's check and its write.
  const inside = await area();
  await mkdir(path.join(inside.project, 'docs'));
  await writeFile(path.join(inside.project, 'docs', 'claude.md'), '# Notes\n');
  await symlink('docs/claude.md', path.join(inside.project, 'CLAUDE.md'));
  const refused = run(inside.project, ['init']);
  refusedInit(refused);
  assert.match(refused.stderr, /CLAUDE\.md is a link to a file in another folder/);
  assert.equal(await readFile(path.join(inside.project, 'docs', 'claude.md'), 'utf8'), '# Notes\n');

  const plain = await area();
  await writeFile(path.join(plain.project, 'CLAUDE.md'), '# Ours\n');
  await chmod(path.join(plain.project, 'CLAUDE.md'), 0o600);
  assert.equal(run(plain.project, ['init']).status, 0);
  assert.equal((await stat(path.join(plain.project, 'CLAUDE.md'))).mode & 0o777, 0o600);
  assert.match(await readFile(path.join(plain.project, 'CLAUDE.md'), 'utf8'), /^# Ours\n/);
});

test('agent setup and agent refresh refuse an unsafe link; status explains it', async () => {
  const { project, outside } = await area();
  await initWorkspace(project, 'Shop', 'greenfield', 'adaptive');
  await symlink('../outside/bashrc', path.join(project, 'CLAUDE.md'));
  const setup = run(project, ['agent', 'setup', 'claude']);
  assert.notEqual(setup.status, 0);
  assert.match(`${setup.stderr}${setup.stdout}`, /never writes through it[\s\S]*No files were changed/);
  // An outdated block behind the link: the old refresh would have rewritten the outside file.
  await writeFile(path.join(outside, 'bashrc'), `my shell config\n${renderBootstrapBlock(BOOTSTRAP_PROVIDERS.claude, BOOTSTRAP_VERSION - 1)}`);
  const before = await readFile(path.join(outside, 'bashrc'), 'utf8');
  run(project, ['agent', 'refresh']);
  assert.equal(await readFile(path.join(outside, 'bashrc'), 'utf8'), before, 'refresh never writes through the link');
  const status = await inspectBootstrap(project, BOOTSTRAP_PROVIDERS.claude);
  assert.deepEqual([status.state, status.reason], ['unsafe-link', 'a link to a file outside this project']);
});

test('the init rollback restores only the recorded real file, never through a link that appeared later', async () => {
  const { project, outside } = await area();
  await writeFile(path.join(project, 'CLAUDE.md'), '# Before\n');
  const snapshot = await snapshotBootstrapFiles(project);
  await rm(path.join(project, 'CLAUDE.md'));
  await symlink('../outside/bashrc', path.join(project, 'CLAUDE.md'));
  await restoreBootstrapFiles(snapshot);
  assert.equal(await readFile(path.join(outside, 'bashrc'), 'utf8'), 'my shell config\n');
  const managed = await resolveManagedFile(project, path.join(project, 'CLAUDE.md'));
  assert.equal(managed.safe, false);
});

test('the agent contract .yallaflow/AGENT.md is managed the same way: no write through a link or a linked .yallaflow', async () => {
  const { project, outside } = await area();
  assert.equal(run(project, ['init']).status, 0);
  await rm(path.join(project, '.yallaflow', 'AGENT.md'));
  await symlink('../../outside/evil.sh', path.join(project, '.yallaflow', 'AGENT.md'));
  const refresh = run(project, ['agent', 'refresh']);
  assert.notEqual(refresh.status, 0);
  assert.match(`${refresh.stderr}${refresh.stdout}`, /AGENT\.md is a link to a file that does not exist[\s\S]*No files were changed/);
  assert.equal(existsSync(path.join(outside, 'evil.sh')), false, 'the dangling link target was not created');
  assert.equal((await inspectAgentContract(project)).state, 'unsafe-link');
  // A whole .yallaflow moved out and linked back.
  const second = await area();
  assert.equal(run(second.project, ['init']).status, 0);
  const { rename: move } = await import('node:fs/promises');
  await move(path.join(second.project, '.yallaflow'), path.join(second.outside, 'ws'));
  await symlink('../outside/ws', path.join(second.project, '.yallaflow'));
  await rm(path.join(second.outside, 'ws', 'AGENT.md'));
  const viaLink = run(second.project, ['agent', 'refresh']);
  assert.notEqual(viaLink.status, 0);
  assert.match(`${viaLink.stderr}${viaLink.stdout}`, /inside a linked folder \(\.yallaflow\)/);
  assert.equal(existsSync(path.join(second.outside, 'ws', 'AGENT.md')), false);
});

test('a failed write leaves no temporary file behind', async () => {
  const { project } = await area();
  await writeFile(path.join(project, 'AGENTS.md'), '# Read-only\n');
  await chmod(path.join(project, 'AGENTS.md'), 0o444);
  try {
    run(project, ['init']);
  } finally {
    await chmod(path.join(project, 'AGENTS.md'), 0o644);
  }
  assert.deepEqual((await readdir(project)).filter((name) => name.endsWith('.tmp')), []);
});
