// v1.2.0 console phase D: saved projects, worktree visibility (read-only Git), and the
// recorded-data fields insights use.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, stat, writeFile, mkdir, appendFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { initWorkspace } from '../src/core/workspace.js';
import { startConsoleServer } from '../src/console/server.js';
import { loadSchema, validate } from '../test-support/schema.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const run = (cwd, args, env = {}) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', env: { ...process.env, ...env } });
const git = (cwd, args) => spawnSync('git', ['-c', 'user.email=t@e', '-c', 'user.name=t', ...args], { cwd, encoding: 'utf8' });

async function api(server, pathname) {
  const response = await fetch(`${server.url}${pathname.slice(1)}`, { headers: { Authorization: `Bearer ${server.token}` } });
  return { status: response.status, body: await response.json() };
}

test('console add/list/remove keep a user-level project list and never touch the project', async () => {
  const config = path.join(await mkdtemp(path.join(os.tmpdir(), 'yf-cfg-')), 'console.json');
  const root = await mkdtemp(path.join(os.tmpdir(), 'yf-proj-'));
  await initWorkspace(root, 'Shop', 'greenfield', 'adaptive');
  const env = { YALLAFLOW_CONSOLE_CONFIG: config };
  assert.match(run(root, ['console', 'add'], env).stdout, /Added/);
  assert.match(run(root, ['console', 'add', root], env).stdout, /already in the console/);
  assert.equal((await stat(config)).mode & 0o777, 0o600);
  assert.match(run(root, ['console', 'list'], env).stdout, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const refused = run(root, ['console', 'add', path.join(root, 'nope')], env);
  assert.equal(refused.status, 0, 'a subfolder resolves to its workspace');
  assert.equal(run(os.tmpdir(), ['console', 'add', '/definitely/not/here'], env).status, 1);
  assert.match(run(root, ['console', 'remove', root], env).stdout, /Removed/);
  assert.deepEqual(JSON.parse(await readFile(config, 'utf8')).projects, []);
});

test('snapshot items carry recorded completion time and verification counts', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yf-ins-'));
  await initWorkspace(root, 'Shop', 'greenfield', 'adaptive');
  const id = /Created (PF-\d+)/.exec(run(root, ['change', 'Copy fix', '--scope', 'bounded']).stdout)[1];
  run(root, ['verify', id, '--', process.execPath, '-e', 'process.exit(0)']);
  run(root, ['verify', id, '--', process.execPath, '-e', 'process.exit(1)']);
  const snapshot = JSON.parse(run(root, ['snapshot', '--json']).stdout);
  assert.deepEqual(validate(loadSchema('snapshot-1.schema.json'), snapshot), []);
  const item = snapshot.items.find((entry) => entry.id === id);
  assert.deepEqual(item.verificationRuns, { total: 2, passed: 1 });
  assert.equal(item.completedAt, null, 'not DONE, so no completion time');
});

test('worktrees: listed from Git files, changed files and overlaps reported, Git never written', async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'yf-wt-'));
  const root = path.join(base, 'shop');
  await mkdir(path.join(root, 'src'), { recursive: true });
  git(root, ['init', '-q', '-b', 'main']);
  await writeFile(path.join(root, 'src', 'orders.js'), 'export const a = 1;\n');
  await initWorkspace(root, 'Shop', 'greenfield', 'adaptive');
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'base']);
  git(root, ['worktree', 'add', '-q', path.join(base, 'shop-vat'), '-b', 'fix/vat']);
  run(path.join(base, 'shop-vat'), ['change', 'VAT label', '--scope', 'bounded']);
  await appendFile(path.join(root, 'src', 'orders.js'), '// csv\n');
  await appendFile(path.join(base, 'shop-vat', 'src', 'orders.js'), '// vat\n');
  await writeFile(path.join(root, 'src', 'export.js'), 'new\n');

  const hashGit = async () => createHash('sha256').update(await readFile(path.join(root, '.git', 'index'))).update(await readFile(path.join(root, '.git', 'worktrees', 'shop-vat', 'index'))).digest('hex');
  const before = await hashGit();
  const server = await startConsoleServer({ roots: [root], port: 0, missing: ['/gone/project'] });
  try {
    const projects = await api(server, '/api/projects');
    assert.deepEqual(projects.body.unavailable, ['/gone/project']);
    assert.equal(projects.body.projects[0].name, 'Shop', 'the project name comes from its config');
    const team = (await api(server, `/api/p/${projects.body.projects[0].id}/worktrees`)).body;
    assert.equal(team.git, true);
    assert.deepEqual(team.worktrees.map((w) => [path.basename(w.path), w.branch, w.main]), [['shop', 'main', true], ['shop-vat', 'fix/vat', false]]);
    const vat = team.worktrees[1];
    assert.equal(vat.yallaflow, true);
    assert.equal(vat.activeWork.title, 'VAT label', "the worktree's own recorded state");
    assert.deepEqual(team.worktrees[0].changed.map((f) => f.path).sort(), ['src/export.js', 'src/orders.js']);
    assert.deepEqual(team.overlaps, [{ path: 'src/orders.js', worktrees: [root, path.join(base, 'shop-vat')] }]);
    assert.ok(team.worktrees.every((w) => (w.changed ?? []).every((f) => !f.path.startsWith('.yallaflow/'))));
  } finally {
    await server.close();
  }
  assert.equal(await hashGit(), before, 'reading worktrees never refreshes a Git index');
});

test('a planted worktree gitdir is ignored: nothing is read or run outside real worktrees', async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'yf-wtevil-'));
  const root = path.join(base, 'shop');
  const other = path.join(base, 'elsewhere');
  await mkdir(root, { recursive: true });
  await mkdir(other, { recursive: true });
  git(root, ['init', '-q', '-b', 'main']);
  await initWorkspace(root, 'Shop', 'greenfield', 'adaptive');
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'base']);
  git(other, ['init', '-q']);
  await writeFile(path.join(other, 'secret.txt'), 'x');
  const marker = path.join(base, 'FSMON_RAN');
  git(other, ['config', 'core.fsmonitor', `touch ${marker}; false`]);
  await mkdir(path.join(root, '.git', 'worktrees', 'evil'), { recursive: true });
  await writeFile(path.join(root, '.git', 'worktrees', 'evil', 'gitdir'), `${path.join(other, '.git')}\n`);
  const server = await startConsoleServer({ roots: [root], port: 0 });
  try {
    const pid = (await api(server, '/api/projects')).body.projects[0].id;
    const team = (await api(server, `/api/p/${pid}/worktrees`)).body;
    const evil = team.worktrees.find((w) => w.path === other);
    assert.equal(evil.unverified, true);
    assert.equal(evil.changed, null, 'no git status ran there');
    assert.equal(await stat(marker).then(() => true, () => false), false, 'no repository-configured program ran');
  } finally {
    await server.close();
  }
});

test('verify never records a run on work that became DONE while it ran', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yf-vdone-'));
  await initWorkspace(root, 'Shop', 'greenfield', 'adaptive');
  const id = /Created (PF-\d+)/.exec(run(root, ['change', 'Copy fix', '--scope', 'bounded']).stdout)[1];
  const metaFile = path.join(root, '.yallaflow', 'work', id, 'meta.yaml');
  const flip = `const fs=require('fs');const m=JSON.parse(fs.readFileSync(${JSON.stringify(metaFile)}));m.status='DONE';fs.writeFileSync(${JSON.stringify(metaFile)},JSON.stringify(m))`;
  const result = run(root, ['verify', id, '--', process.execPath, '-e', flip]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /became DONE while the verified command ran; this run was not recorded/);
  assert.equal(await stat(path.join(root, '.yallaflow', 'work', id, 'evidence', 'verification.json')).then(() => true, () => false), false);
});
