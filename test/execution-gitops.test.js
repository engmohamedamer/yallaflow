// PF-0112 M2: the Git execution layer (src/execution/git-ops.js) — strict argument
// validation (AC-050), the verified-platform gate (AC-045), blocking repository-defined
// filters and merge drivers (AC-046), G1–G3 behaviour, hook isolation, and the merge-tree
// classification (E9). Temporary repositories only; Git configuration isolated.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, lstat, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const BASE = await mkdtemp(path.join(os.tmpdir(), 'yf-gitops-'));
await mkdir(path.join(BASE, 'home'), { recursive: true });
await writeFile(path.join(BASE, 'gitconfig'), '');
process.env.GIT_CONFIG_GLOBAL = path.join(BASE, 'gitconfig'); // kept by gitEnv: the developer's choice of config files
process.env.GIT_CONFIG_NOSYSTEM = '1';
process.env.HOME = path.join(BASE, 'home');
const ops = await import('../src/execution/git-ops.js');

const raw = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf8', env: process.env });
const ok = (result) => { assert.equal(result.status, 0, result.stderr); return result.stdout.trim(); };
const exists = (file) => lstat(file).then(() => true, () => false);
let counter = 0;
async function repo(files = { 'a.txt': '1\n' }) {
  const dir = path.join(BASE, `r${++counter}`);
  await mkdir(dir, { recursive: true });
  ok(raw(dir, ['init', '-q', '-b', 'main']));
  ok(raw(dir, ['config', 'user.name', 'Test Dev']));
  ok(raw(dir, ['config', 'user.email', 'dev@example.invalid']));
  for (const [file, content] of Object.entries(files)) { await mkdir(path.dirname(path.join(dir, file)), { recursive: true }); await writeFile(path.join(dir, file), content); }
  ok(raw(dir, ['add', '-A']));
  ok(raw(dir, ['commit', '-qm', 'base']));
  const lanes = path.join(BASE, `r${counter}.lanes`);
  await mkdir(lanes, { recursive: true });
  return { dir, lanes, base: ok(raw(dir, ['rev-parse', 'HEAD'])) };
}
const platformOk = ops.platformCheck().ok;

test('AC-050: every operation rejects malformed, option-like, relative, out-of-root and unknown arguments before Git runs', async () => {
  const { dir, lanes, base } = await repo();
  const bad = async (fn, pattern = /GIT_ARG_INVALID|must|uses lowercase|object id|not a commit|real folder|absolute/) => assert.rejects(fn, (error) => error.code === 'GIT_ARG_INVALID' && pattern.test(`${error.code} ${error.message}`));
  for (const slug of ['', '-x', '--force', '../x', 'a/b', 'A', 'a b', 'x'.repeat(60), 'a..b', '.x', 'é']) await bad(() => ops.createLaneWorktree({ home: dir, lanesRoot: lanes, slug, base }));
  for (const oid of ['HEAD', 'main', base.slice(0, 12), `${base}x`, `-${base.slice(1)}`, 'f'.repeat(40)]) await bad(() => ops.createLaneWorktree({ home: dir, lanesRoot: lanes, slug: 'ok', base: oid }));
  for (const root of ['relative/lanes', `${lanes}/../${path.basename(lanes)}/missing`, '']) await bad(() => ops.createLaneWorktree({ home: dir, lanesRoot: root, slug: 'ok', base }));
  const link = path.join(BASE, `link${counter}`);
  await symlink(lanes, link);
  await bad(() => ops.createLaneWorktree({ home: dir, lanesRoot: link, slug: 'ok', base }));
  await bad(() => ops.removeLaneWorktree({ home: dir, lane: dir }), /main checkout/);
  await bad(() => ops.removeLaneWorktree({ home: dir, lane: lanes }), /not a worktree/);
  assert.throws(() => ops.previewMerge(dir, base, 'deadbeef'.repeat(5)), (error) => error.code === 'GIT_ARG_INVALID');
  assert.throws(() => ops.previewMerge(dir, '--all', base), (error) => error.code === 'GIT_ARG_INVALID');
  assert.equal(ok(raw(dir, ['worktree', 'list', '--porcelain'])).split('\n').filter((line) => line.startsWith('worktree ')).length, 1, 'no worktree was created by any refused call');
});

test('AC-045: automated Git mutation fails closed on an unverified platform or Git version', () => {
  assert.deepEqual(ops.platformCheck({ platform: 'linux', version: { major: 2, minor: 43, text: '2.43' } }).ok, true);
  assert.match(ops.platformCheck({ platform: 'darwin', version: { major: 2, minor: 43, text: '2.43' } }).reason, /Linux only/);
  assert.match(ops.platformCheck({ platform: 'win32', version: { major: 2, minor: 43, text: '2.43' } }).reason, /Linux only/);
  assert.match(ops.platformCheck({ platform: 'linux', version: { major: 2, minor: 37, text: '2.37' } }).reason, /older than 2\.38/);
  assert.match(ops.platformCheck({ platform: 'linux', version: { major: 2, minor: 45, text: '2.45' } }).reason, /verified with Git 2\.43/);
  assert.match(ops.platformCheck({ platform: 'linux', version: null }).reason, /not available/);
});

test('G1/G2: a lane is created at the exact base on yf/<slug> with hooks off; removal keeps the branch; existing paths and branches are refused', { skip: !platformOk && 'unverified platform (fails closed by design)' }, async () => {
  const { dir, lanes, base } = await repo();
  const mark = path.join(BASE, 'hook-mark');
  for (const hook of ['post-checkout', 'reference-transaction', 'post-index-change']) { await writeFile(path.join(dir, '.git', 'hooks', hook), `#!/bin/sh\necho ${hook} >> "${mark}"\n`); await chmod(path.join(dir, '.git', 'hooks', hook), 0o755); }
  const lane = await ops.createLaneWorktree({ home: dir, lanesRoot: lanes, slug: 'csv-export', base });
  assert.deepEqual(lane, { path: path.join(lanes, 'csv-export'), branch: 'yf/csv-export', base });
  assert.equal(ok(raw(lane.path, ['rev-parse', 'HEAD'])), base);
  assert.equal(ok(raw(lane.path, ['symbolic-ref', '--short', 'HEAD'])), 'yf/csv-export');
  assert.equal(await exists(mark), false, 'no hook ran');
  await assert.rejects(ops.createLaneWorktree({ home: dir, lanesRoot: lanes, slug: 'csv-export', base }), (error) => error.code === 'LANE_EXISTS');
  ok(raw(dir, ['branch', 'yf/taken']));
  await assert.rejects(ops.createLaneWorktree({ home: dir, lanesRoot: lanes, slug: 'taken', base }), (error) => error.code === 'BRANCH_EXISTS');
  await writeFile(path.join(lane.path, 'dirty.txt'), 'x\n');
  await assert.rejects(ops.removeLaneWorktree({ home: dir, lane: lane.path }), (error) => error.code === 'SCOPE_CHANGED', 'a lane with untracked files is refused before Git runs (and Git itself would refuse without --force)');
  assert.equal(await exists(lane.path), true);
  await (await import('node:fs/promises')).rm(path.join(lane.path, 'dirty.txt'));
  // The test's own unisolated `git branch yf/taken` above fires reference-transaction; start the removal check clean.
  await (await import('node:fs/promises')).rm(mark, { force: true });
  await ops.removeLaneWorktree({ home: dir, lane: lane.path });
  assert.equal(await exists(lane.path), false);
  assert.equal(raw(dir, ['rev-parse', '--verify', '-q', 'refs/heads/yf/csv-export']).status, 0, 'the branch stays');
  assert.deepEqual(await readFile(mark, 'utf8').then((text) => text.trim().split('\n'), () => []), [], 'no hook ran during removal');
});

test('AC-046: repository-defined filters and merge drivers block automated lanes before any Git mutation; built-in attributes do not', { skip: !platformOk && 'unverified platform' }, async () => {
  const mark = path.join(BASE, 'driver-mark');
  const filtered = await repo({ 'a.dat': 'data\n', '.gitattributes': '*.dat filter=mark\n*.txt text eol=lf\n' });
  ok(raw(filtered.dir, ['config', 'filter.mark.smudge', `sh -c 'echo smudge >> "${mark}"; cat'`]));
  await assert.rejects(ops.createLaneWorktree({ home: filtered.dir, lanesRoot: filtered.lanes, slug: 'x', base: filtered.base }), (error) => error.code === 'GIT_EXTERNAL_DRIVERS' && /filter "mark"/.test(error.message));
  assert.equal(await exists(mark), false, 'the filter never ran');
  assert.equal(await exists(path.join(filtered.lanes, 'x')), false);
  const merged = await repo({ 'x.mrg': 'x\n', '.gitattributes': '*.mrg merge=mark\n' });
  ok(raw(merged.dir, ['config', 'merge.mark.driver', `sh -c 'echo driver >> "${mark}"' -- %O %A %B`]));
  await assert.rejects(ops.createLaneWorktree({ home: merged.dir, lanesRoot: merged.lanes, slug: 'x', base: merged.base }), (error) => error.code === 'GIT_EXTERNAL_DRIVERS' && /merge driver "mark"/.test(error.message));
  // A driver configured globally but not referenced by this repository does not block (e.g. git-lfs installed).
  const plain = await repo({ 'a.txt': '1\n', '.gitattributes': '*.txt text eol=lf\n*.bin binary\n*.md merge=union\n' });
  ok(raw(plain.dir, ['config', 'filter.lfs.smudge', 'git-lfs smudge -- %f']));
  assert.deepEqual(await ops.externalDrivers(plain.dir), { filters: [], mergeDrivers: [] });
  // Referenced only from the base commit's tree, or from info/attributes, still counts.
  const hidden = await repo({ 'a.txt': '1\n' });
  ok(raw(hidden.dir, ['config', 'filter.mark.clean', 'cat']));
  await writeFile(path.join(hidden.dir, '.git', 'info', 'attributes'), '*.txt filter=mark\n');
  assert.deepEqual((await ops.externalDrivers(hidden.dir)).filters, ['mark']);
});

test('G3: merge preview is object-only and classifies no-conflict, conflict and error (E9)', async () => {
  const { dir, base } = await repo({ 'f.txt': 'base\n', 'g.txt': 'g\n' });
  ok(raw(dir, ['checkout', '-q', '-b', 'side']));
  await writeFile(path.join(dir, 'f.txt'), 'side\n');
  ok(raw(dir, ['commit', '-qam', 'side']));
  const side = ok(raw(dir, ['rev-parse', 'HEAD']));
  ok(raw(dir, ['checkout', '-q', 'main']));
  ok(raw(dir, ['checkout', '-q', '-b', 'other']));
  await writeFile(path.join(dir, 'g.txt'), 'other\n');
  ok(raw(dir, ['commit', '-qam', 'other']));
  const other = ok(raw(dir, ['rev-parse', 'HEAD']));
  ok(raw(dir, ['checkout', '-q', 'main']));
  await writeFile(path.join(dir, 'f.txt'), 'main\n');
  ok(raw(dir, ['commit', '-qam', 'main']));
  const main = ok(raw(dir, ['rev-parse', 'HEAD']));
  const before = await readFile(path.join(dir, '.git', 'index'));
  assert.equal(ops.previewMerge(dir, main, other).result, 'no-conflict');
  const conflict = ops.previewMerge(dir, main, side);
  assert.equal(conflict.result, 'conflict');
  assert.deepEqual(conflict.conflicts, ['f.txt']);
  assert.ok(ops.isAncestor(dir, base, main));
  assert.equal(raw(dir, ['status', '--porcelain']).stdout, '', 'no working tree change');
  assert.deepEqual(await readFile(path.join(dir, '.git', 'index')), before, 'no index change');
});

test('the sanitised environment keeps the developer config-file choice and removes redirection and helpers', () => {
  const env = ops.gitEnv({ PATH: '/bin', HOME: '/h', GIT_CONFIG_GLOBAL: '/c', GIT_CONFIG_NOSYSTEM: '1', GIT_DIR: '/x', GIT_WORK_TREE: '/y', GIT_INDEX_FILE: '/z', GIT_CONFIG_COUNT: '1', GIT_EXTERNAL_DIFF: 'evil', GIT_PAGER: 'evil', PAGER: 'evil', EDITOR: 'evil', SSH_AUTH_SOCK: '/s', LANG: 'ar_EG.UTF-8' });
  assert.deepEqual(env, { PATH: '/bin', HOME: '/h', GIT_CONFIG_GLOBAL: '/c', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat', GIT_EDITOR: ':', LC_ALL: 'C' });
});

test('NUL-separated output is read untrimmed: a modified first entry (" M path") and a file name starting with a space keep their exact paths (M3 demo finding)', async () => {
  const { dir, base } = await repo({ 'a.txt': '1\n', ' lead.txt': 'x\n' });
  await writeFile(path.join(dir, 'a.txt'), '2\n');
  await writeFile(path.join(dir, ' lead.txt'), 'y\n');
  await writeFile(path.join(dir, ' new space.txt'), 'z\n');
  const entries = ops.statusEntries(dir).map((entry) => `${entry.code}|${entry.path}`).sort();
  assert.deepEqual(entries, [' M| lead.txt', ' M|a.txt', '??| new space.txt']);
  ok(raw(dir, ['add', '-A']));
  ok(raw(dir, ['commit', '-qm', 'next']));
  assert.deepEqual(ops.changedBetween(dir, base, ok(raw(dir, ['rev-parse', 'HEAD']))).sort(), [' lead.txt', ' new space.txt', 'a.txt']);
});
