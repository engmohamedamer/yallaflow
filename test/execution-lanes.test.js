// PF-0112 M2: lanes — preconditions (Shared Project Mode in the base commit, integration
// branch, max lanes), creation with a marker, and the Clean up guards (FR13, A6): no
// session, nothing uncommitted, ignored files only when they are reproducible dependencies,
// merged branch, exact confirmed scope, unchanged Git configuration; the lane's YallaFlow
// records are archived, the branch stays. Temporary repositories, isolated Git config.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const BASE = await mkdtemp(path.join(os.tmpdir(), 'yf-lanes-'));
await mkdir(path.join(BASE, 'home'), { recursive: true });
await writeFile(path.join(BASE, 'gitconfig'), '');
process.env.GIT_CONFIG_GLOBAL = path.join(BASE, 'gitconfig');
process.env.GIT_CONFIG_NOSYSTEM = '1';
process.env.HOME = path.join(BASE, 'home');
const lanes = await import('../src/execution/lanes.js');
const gitops = await import('../src/execution/git-ops.js');
const platformOk = gitops.platformCheck().ok;

const raw = (cwd, args) => spawnSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8', env: process.env });
const ok = (result) => { assert.equal(result.status, 0, result.stderr); return result.stdout.trim(); };
const exists = (file) => lstat(file).then(() => true, () => false);
let counter = 0;
async function project({ shared = true } = {}) {
  const parent = path.join(BASE, `p${++counter}`);
  const home = path.join(parent, 'shop');
  await mkdir(path.join(home, '.yallaflow'), { recursive: true });
  ok(raw(home, ['init', '-q', '-b', 'main']));
  ok(raw(home, ['config', 'user.name', 'Test Dev']));
  ok(raw(home, ['config', 'user.email', 'dev@example.invalid']));
  await writeFile(path.join(home, 'a.txt'), '1\n');
  await writeFile(path.join(home, '.gitignore'), '.env\nnode_modules/\ndist/\n');
  await writeFile(path.join(home, '.yallaflow', '.gitignore'), 'local/\n');
  await writeFile(path.join(home, '.yallaflow', 'config.yaml'), JSON.stringify(shared ? { project: { name: 'Shop' }, shared: { enabled: true, integrationBranch: 'main' } } : { project: { name: 'Shop' } }));
  ok(raw(home, ['add', '-A']));
  ok(raw(home, ['commit', '-qm', 'base']));
  return home;
}

test('preconditions: Shared Project Mode in the committed config, the integration branch, and the lane limit (default 2, max 4)', { skip: !platformOk && 'unverified platform' }, async () => {
  const plain = await project({ shared: false });
  assert.deepEqual((await lanes.lanePreconditions(plain)).blockers.map((entry) => entry.code), ['SHARED_REQUIRED']);
  const home = await project();
  assert.equal((await lanes.lanePreconditions(home)).ok, true);
  ok(raw(home, ['checkout', '-q', '-b', 'feature']));
  assert.deepEqual((await lanes.lanePreconditions(home)).blockers.map((entry) => entry.code), ['NOT_ON_INTEGRATION_BRANCH']);
  ok(raw(home, ['checkout', '-q', 'main']));
  assert.deepEqual((await lanes.lanePreconditions(home, { count: 3 })).blockers.map((entry) => entry.code), ['MAX_LANES']);
  const four = await lanes.lanePreconditions(home, { count: 3, maxLanes: 4 });
  assert.equal(four.ok, true);
  assert.equal(four.experimental, true, 'more than two lanes is experimental');
  assert.equal((await lanes.lanePreconditions(home, { count: 5, maxLanes: 9 })).maxLanes, 4, 'never more than four');
});

test('create: the lane is a sibling <repo>.lanes/<slug> on yf/<slug> with a matching marker; a third lane is refused by default', { skip: !platformOk && 'unverified platform' }, async () => {
  const home = await project();
  const lane = await lanes.createLane(home, { slug: 'csv-export' });
  assert.equal(lane.path, path.join(path.dirname(home), 'shop.lanes', 'csv-export'));
  assert.equal(lane.branch, 'yf/csv-export');
  const marker = await lanes.readMarker(lane.path);
  assert.deepEqual([marker.id, marker.home, marker.createdBy], [lane.id, home, 'yallaflow']);
  assert.equal(ok(raw(lane.path, ['status', '--porcelain'])), '', 'the marker is git-ignored local state');
  await lanes.createLane(home, { slug: 'login-page' });
  await assert.rejects(lanes.createLane(home, { slug: 'third' }), (error) => error.code === 'MAX_LANES');
  await assert.rejects(lanes.createLane(home, { slug: '../escape' }), (error) => error.code === 'GIT_ARG_INVALID');
});

test('cleanup guards: session, uncommitted and untracked work, non-dependency ignored files, unmerged branch, foreign marker', { skip: !platformOk && 'unverified platform' }, async () => {
  const home = await project();
  const lane = await lanes.createLane(home, { slug: 'guards' });
  const codes = async (options) => (await lanes.cleanupCheck(home, lane, options)).blockers.map((entry) => entry.code);
  assert.deepEqual(await codes({ session: { status: 'idle' } }), ['SESSION_ACTIVE'], 'a fresh lane is merged trivially, so only the session blocks');
  await writeFile(path.join(lane.path, 'a.txt'), 'changed\n');
  assert.ok((await codes()).includes('UNCOMMITTED'));
  ok(raw(lane.path, ['commit', '-qam', 'lane work']));
  assert.deepEqual(await codes(), ['NOT_MERGED'], 'a commit only on yf/guards is not merged');
  await writeFile(path.join(lane.path, 'notes.txt'), 'untracked\n');
  assert.ok((await codes()).includes('UNCOMMITTED'));
  await (await import('node:fs/promises')).rm(path.join(lane.path, 'notes.txt'));
  ok(raw(home, ['merge', '-q', '--ff-only', 'yf/guards']));
  assert.deepEqual(await codes(), []);
  await writeFile(path.join(lane.path, '.env'), 'SECRET_TOKEN=keep-me\n');
  assert.deepEqual(await codes(), ['IGNORED_FILES'], 'an ignored .env would be lost');
  await (await import('node:fs/promises')).rm(path.join(lane.path, '.env'));
  await mkdir(path.join(lane.path, 'node_modules', 'x'), { recursive: true });
  await writeFile(path.join(lane.path, 'node_modules', 'x', 'index.js'), 'x\n');
  assert.deepEqual(await codes(), ['IGNORED_FILES'], 'node_modules without package.json and a lockfile is not positively identified');
  await writeFile(path.join(lane.path, 'package.json'), '{}');
  await writeFile(path.join(lane.path, 'package-lock.json'), '{}');
  ok(raw(lane.path, ['add', 'package.json', 'package-lock.json']));
  ok(raw(lane.path, ['commit', '-qm', 'manifest']));
  ok(raw(home, ['merge', '-q', '--ff-only', 'yf/guards']));
  const check = await lanes.cleanupCheck(home, lane);
  assert.deepEqual(check.blockers, []);
  assert.deepEqual(check.deletions, ['node_modules/'], 'reproducible dependencies are listed for confirmation');
  await mkdir(path.join(lane.path, 'dist'), { recursive: true });
  await writeFile(path.join(lane.path, 'dist', 'app.js'), 'built\n');
  assert.deepEqual(await codes(), ['IGNORED_FILES'], 'build output is not a positively identified dependency');
  await (await import('node:fs/promises')).rm(path.join(lane.path, 'dist'), { recursive: true });
  await writeFile(path.join(lane.path, '.yallaflow', 'local', 'execution', 'lane.json'), JSON.stringify({ schema: lanes.MARKER_SCHEMA, id: 'l-forged', home, createdBy: 'yallaflow' }));
  assert.deepEqual(await codes(), ['NOT_OURS']);
});

test('cleanup: exact confirmed scope, unchanged Git configuration; the lane records are archived, the folder removed, the branch kept', { skip: !platformOk && 'unverified platform' }, async () => {
  const home = await project();
  const lane = await lanes.createLane(home, { slug: 'done' });
  await writeFile(path.join(lane.path, '.yallaflow', 'local', 'execution', 'note.json'), '{"keep":true}');
  await writeFile(path.join(lane.path, 'package.json'), '{}');
  await writeFile(path.join(lane.path, 'yarn.lock'), '');
  ok(raw(lane.path, ['add', 'package.json', 'yarn.lock']));
  ok(raw(lane.path, ['commit', '-qm', 'work']));
  ok(raw(home, ['merge', '-q', '--ff-only', 'yf/done']));
  await mkdir(path.join(lane.path, 'node_modules'), { recursive: true });
  await writeFile(path.join(lane.path, 'node_modules', 'm.js'), 'm\n');
  await assert.rejects(lanes.cleanupLane(home, lane.id, { confirmedDeletions: [] }), (error) => error.code === 'SCOPE_CHANGED' && error.deletions[0] === 'node_modules/');
  ok(raw(home, ['config', 'core.hooksPath', '/tmp/elsewhere']));
  await assert.rejects(lanes.cleanupLane(home, lane.id, { confirmedDeletions: ['node_modules/'] }), (error) => error.code === 'CONFIG_CHANGED');
  ok(raw(home, ['config', '--unset', 'core.hooksPath']));
  const result = await lanes.cleanupLane(home, lane.id, { confirmedDeletions: ['node_modules/'] });
  assert.equal(await exists(lane.path), false);
  assert.equal(raw(home, ['rev-parse', '--verify', '-q', 'refs/heads/yf/done']).status, 0, 'the branch stays');
  assert.deepEqual(result.deleted, ['node_modules/']);
  assert.equal(await readFile(path.join(home, result.archived, 'execution', 'note.json'), 'utf8'), '{"keep":true}', "the lane's YallaFlow records were archived, not lost");
  assert.equal((await lanes.readLanes(home)).find((entry) => entry.id === lane.id).state, 'removed');
  await assert.rejects(lanes.cleanupLane(home, lane.id, { confirmedDeletions: [] }), (error) => error.code === 'NOT_FOUND');
});
