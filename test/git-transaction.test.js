// PF-0112 M3a: permanent regression tests for the Git transaction safety properties that
// the M3a experiments proved on real Git (evidence on PF-0112). They run raw Git in
// throwaway repositories under this test's own temporary directory, with an isolated Git
// environment (no global or system configuration, no user hooks, no signing agent), and
// they never touch the YallaFlow checkout. When src/execution/git-ops.js exists (after
// Checkpoint C), the same properties are asserted again through it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const BASE = await mkdtemp(path.join(os.tmpdir(), 'yf-git-tx-'));
const ISO = path.join(BASE, 'iso');
await mkdir(path.join(ISO, 'home'), { recursive: true });
await writeFile(path.join(ISO, 'gitconfig'), '');
// Library code used by E4 (and the shared test helpers) spawns Git with process.env: isolate
// this test process from the developer's global and system Git configuration as well.
process.env.GIT_CONFIG_GLOBAL = path.join(ISO, 'gitconfig');
process.env.GIT_CONFIG_NOSYSTEM = '1';
for (const key of Object.keys(process.env)) if (/^(GIT_DIR|GIT_WORK_TREE|GIT_INDEX_FILE|GIT_CONFIG_PARAMETERS|GIT_CONFIG_COUNT|GIT_EXTERNAL_DIFF)$/.test(key)) delete process.env[key];

// The hardened invocation the M3a design uses for every YallaFlow Git call.
const HARD = ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', '-c', 'gc.auto=0', '-c', 'maintenance.auto=false', '--literal-pathspecs', '--no-pager'];
const STRIP = /^(GIT_\w+|PAGER|EDITOR|VISUAL|SSH_ASKPASS|SSH_AUTH_SOCK|GPG_AGENT_INFO)$/;
function isolatedEnv(extra = {}) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) if (!STRIP.test(key)) env[key] = value;
  return {
    ...env, HOME: path.join(ISO, 'home'), XDG_CONFIG_HOME: path.join(ISO, 'home'), GIT_CONFIG_GLOBAL: path.join(ISO, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat', GIT_EDITOR: ':', LC_ALL: 'C', ...extra
  };
}
function inside(dir) {
  const resolved = path.resolve(dir);
  assert.ok(resolved.startsWith(BASE + path.sep), `refusing to run git outside the test directory: ${dir}`);
}
function raw(cwd, args, { env = {} } = {}) {
  inside(cwd);
  const result = spawnSync('git', args, { cwd, env: isolatedEnv(env), encoding: 'buffer', maxBuffer: 64 << 20 });
  return { status: result.status, out: result.stdout, stdout: result.stdout.toString('utf8'), stderr: result.stderr.toString('utf8') };
}
const hard = (cwd, args, options) => raw(cwd, [...HARD, ...args], options);
function ok(result, what) {
  assert.equal(result.status, 0, `${what}: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}
const hash = async (file) => { try { return createHash('sha256').update(await readFile(file)).digest('hex'); } catch { return null; } };
const exists = async (file) => { try { await lstat(file); return true; } catch { return false; } };
async function put(file, content, mode) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
  if (mode) await chmod(file, mode);
}
let counter = 0;
async function repo(files = {}) {
  const dir = path.join(BASE, `r${++counter}`);
  await mkdir(dir, { recursive: true });
  ok(raw(dir, ['init', '-q', '-b', 'main']), 'init');
  ok(raw(dir, ['config', 'user.name', 'Test Dev']), 'config');
  ok(raw(dir, ['config', 'user.email', 'dev@example.invalid']), 'config');
  ok(raw(dir, ['config', 'commit.gpgSign', 'false']), 'config');
  ok(raw(dir, ['config', 'gc.auto', '0']), 'config');
  ok(raw(dir, ['config', 'maintenance.auto', 'false']), 'config');
  for (const [relative, content] of Object.entries(files)) await put(path.join(dir, relative), content);
  if (Object.keys(files).length) {
    ok(raw(dir, ['add', '-A']), 'add');
    ok(raw(dir, ['commit', '-q', '-m', 'base']), 'commit');
  }
  return dir;
}
async function lane(home, name) {
  const dir = path.join(BASE, `lane-${name}-${++counter}`);
  ok(hard(home, ['worktree', 'add', '-q', '-b', `yf/${name}`, dir, ok(raw(home, ['rev-parse', 'HEAD']), 'rev-parse')]), 'worktree add');
  return dir;
}
async function pathspecFile(paths) {
  const file = path.join(BASE, `ps-${randomBytes(4).toString('hex')}`);
  await writeFile(file, Buffer.from(paths.map((entry) => `${entry}\0`).join('')));
  return file;
}
async function messageFile(text) {
  const file = path.join(BASE, `msg-${randomBytes(4).toString('hex')}`);
  await writeFile(file, text);
  return file;
}
// Approved tree A = HEAD + the approved paths, built in a private temporary index.
async function approvedTree(dir, paths) {
  const index = path.join(BASE, `idx-${randomBytes(6).toString('hex')}`);
  const env = { GIT_INDEX_FILE: index };
  ok(hard(dir, ['read-tree', 'HEAD'], { env }), 'read-tree');
  ok(hard(dir, ['add', '-A', `--pathspec-from-file=${await pathspecFile(paths)}`, '--pathspec-file-nul'], { env }), 'add (temp index)');
  const tree = ok(hard(dir, ['write-tree'], { env }), 'write-tree (temp index)');
  await rm(index, { force: true });
  return tree;
}
// E1: staging is not idempotent for deletions (a path already removed from both the work
// tree and the index makes `add` fail), so only approved paths still present in one of them
// are staged; the tree-equality check proves the result.
async function stageable(dir, paths) {
  const inIndex = new Set(hard(dir, ['ls-files', '-z', '--cached']).stdout.split('\0').filter(Boolean));
  const keep = [];
  for (const entry of paths) if (inIndex.has(entry) || await exists(path.join(dir, entry))) keep.push(entry);
  return keep;
}
// Verify-before-commit: stage the approved paths, require the index tree to equal A,
// commit the verified index, then require HEAD's tree to equal A.
async function commitVerified(dir, paths, message = 'commit') {
  const approved = await approvedTree(dir, paths);
  ok(hard(dir, ['add', '-A', `--pathspec-from-file=${await pathspecFile(await stageable(dir, paths))}`, '--pathspec-file-nul']), 'add');
  const indexTree = ok(hard(dir, ['write-tree']), 'write-tree');
  if (indexTree !== approved) return { committed: false, approved, indexTree };
  ok(hard(dir, ['commit', '-q', '--cleanup=verbatim', '-F', await messageFile(message)]), 'commit');
  return { committed: true, approved, head: ok(raw(dir, ['rev-parse', 'HEAD']), 'rev-parse'), headTree: ok(raw(dir, ['rev-parse', 'HEAD^{tree}']), 'rev-parse') };
}
// merge-tree classification (E9): Git 2.43 exits 1 both for a conflict and for an
// invalid commit, so a conflict also needs a valid tree id on stdout.
function classifyMergeTree(dir, result) {
  const tree = result.out.toString('utf8').split('\0')[0]?.trim() ?? '';
  const isTree = /^[0-9a-f]{40,64}$/.test(tree) && raw(dir, ['cat-file', '-e', `${tree}^{tree}`]).status === 0;
  if (result.status === 0 && isTree) return 'clean';
  if (result.status === 1 && isTree) return 'conflict';
  return 'error';
}
const mergeTree = (dir, a, b) => hard(dir, ['merge-tree', '--write-tree', '--name-only', '--no-messages', '-z', a, b]);
const gitVersion = () => (/git version (\d+)\.(\d+)/.exec(spawnSync('git', ['--version'], { encoding: 'utf8' }).stdout ?? '') ?? []).slice(1).map(Number);
const [major, minor] = gitVersion();
const modernGit = major > 2 || (major === 2 && minor >= 38);

test('E8: literal pathspecs stage exactly the approved names; without them a name is read as pathspec magic', async () => {
  const names = ['*.js', 'a.js', 'b.js', 'a?b', 'axb', '[x]', 'x', ':(top)y', 'y', '-n', 'with space', 'new\nline'];
  const dir = await repo({ 'keep.txt': 'k\n' });
  for (const name of names) await put(path.join(dir, name), `${name}\n`);
  const approved = ['*.js', 'a?b', '[x]', ':(top)y', '-n', 'with space', 'new\nline'];
  const file = await pathspecFile(approved);
  ok(raw(dir, ['add', `--pathspec-from-file=${file}`, '--pathspec-file-nul']), 'control add');
  const control = raw(dir, ['diff', '--cached', '--name-only', '-z']).stdout.split('\0').filter(Boolean);
  assert.ok(control.includes('y') && !control.includes(':(top)y'), 'control: without --literal-pathspecs ":(top)y" stages the unrelated "y"');
  ok(raw(dir, ['rm', '-q', '--cached', '-r', '--', '.']), 'unstage');
  ok(raw(dir, ['add', 'keep.txt']), 're-add');
  ok(hard(dir, ['add', '-A', `--pathspec-from-file=${file}`, '--pathspec-file-nul']), 'literal add');
  const staged = raw(dir, ['diff', '--cached', '--name-only', '-z']).stdout.split('\0').filter(Boolean).sort();
  assert.deepEqual(staged, [...approved].sort());
});

test('E9: merge-tree is object-only and its result is classified by exit code plus a valid tree id', { skip: !modernGit && 'needs Git >= 2.38' }, async () => {
  const home = await repo({ 'f.txt': 'base\n', 'g.txt': 'g\n' });
  const clean = await lane(home, 'clean');
  await put(path.join(clean, 'g.txt'), 'g lane\n');
  const cleanCommit = await commitVerified(clean, ['g.txt']);
  const side = await lane(home, 'side');
  await put(path.join(side, 'f.txt'), 'lane side\n');
  const sideCommit = await commitVerified(side, ['f.txt']);
  await put(path.join(home, 'f.txt'), 'main side\n');
  ok(raw(home, ['commit', '-qam', 'main side']), 'commit');
  assert.equal(classifyMergeTree(home, mergeTree(home, 'main', cleanCommit.head)), 'clean');
  const conflict = mergeTree(home, 'main', sideCommit.head);
  assert.equal(classifyMergeTree(home, conflict), 'conflict');
  assert.ok(conflict.out.toString('utf8').split('\0').includes('f.txt'));
  const invalid = mergeTree(home, 'main', 'deadbeef'.repeat(5));
  assert.equal(invalid.status, 1, 'Git 2.43 exits 1 for an invalid commit too (manual mismatch recorded on PF-0112)');
  assert.equal(classifyMergeTree(home, invalid), 'error');
  assert.notEqual(raw(home, ['cat-file', '-e', `${'deadbeef'.repeat(5)}^{commit}`]).status, 0, 'pre-validation refuses an invalid commit');
  assert.equal(raw(home, ['status', '--porcelain']).stdout, '', 'merge-tree touched neither the working tree nor the index');
});

test('E13: verify-before-commit records the approved tree, the exact message and the developer identity', async () => {
  const dir = await repo({ 'a.txt': '1\n' });
  await put(path.join(dir, 'a.txt'), '2\n');
  const message = 'PF-0001: Title\n\n# not a comment, keep me\ntrailing spaces   \n\nYallaFlow-Work: PF-0001\n';
  const result = await commitVerified(dir, ['a.txt'], message);
  assert.ok(result.committed);
  assert.equal(result.headTree, result.approved);
  const body = raw(dir, ['cat-file', '-p', 'HEAD']).stdout;
  assert.equal(body.slice(body.indexOf('\n\n') + 2), message);
  assert.match(body, /^author Test Dev <dev@example\.invalid>/m);
  assert.match(body, /^committer Test Dev <dev@example\.invalid>/m);
});

async function markerLines(file) {
  try { return (await readFile(file, 'utf8')).split('\n').filter(Boolean); } catch { return []; }
}
const MARKS = path.join(BASE, 'markers');
await mkdir(MARKS, { recursive: true });

for (const variant of ['plain', 'autocrlf']) {
  test(`E1 (${variant}): temp-index tree equals real-index tree; the real index is untouched; staging is idempotent only with absent paths skipped`, async () => {
    const home = await repo({ 'a.txt': 'a\n', 'bin.dat': randomBytes(2048), 'run.sh': '#!/bin/sh\n', 'del.txt': 'x\n', 'ren.txt': 'rename me\n', 'crlf.txt': 'l1\nl2\n', 'ünï.txt': 'u\n', '.gitattributes': '*.txt text=auto\n*.dat binary\n' });
    if (variant === 'autocrlf') ok(raw(home, ['config', 'core.autocrlf', 'true']), 'config');
    const dir = await lane(home, `e1${variant}`);
    await put(path.join(dir, 'a.txt'), 'a changed\n');
    await put(path.join(dir, 'bin.dat'), randomBytes(2048));
    await chmod(path.join(dir, 'run.sh'), 0o755);
    await rm(path.join(dir, 'del.txt'));
    await rm(path.join(dir, 'ren.txt'));
    await put(path.join(dir, 'ren2.txt'), 'rename me\n');
    await put(path.join(dir, 'crlf.txt'), 'l1\r\nl2 changed\r\n');
    await put(path.join(dir, 'empty.txt'), '');
    await symlink('a.txt', path.join(dir, 'link.txt'));
    const paths = ['a.txt', 'bin.dat', 'run.sh', 'del.txt', 'ren.txt', 'ren2.txt', 'crlf.txt', 'empty.txt', 'link.txt'];
    const indexFile = path.resolve(dir, ok(raw(dir, ['rev-parse', '--git-path', 'index']), 'git-path'));
    const before = await hash(indexFile);
    const approved = await approvedTree(dir, paths);
    assert.equal(await hash(indexFile), before, 'building the approved tree never touches the real index');
    ok(hard(dir, ['add', '-A', `--pathspec-from-file=${await pathspecFile(paths)}`, '--pathspec-file-nul']), 'add');
    assert.equal(ok(hard(dir, ['write-tree']), 'write-tree'), approved);
    const naive = hard(dir, ['add', '-A', `--pathspec-from-file=${await pathspecFile(paths)}`, '--pathspec-file-nul']);
    assert.notEqual(naive.status, 0, 're-staging a deletion that is already staged fails (not idempotent)');
    ok(hard(dir, ['add', '-A', `--pathspec-from-file=${await pathspecFile(await stageable(dir, paths))}`, '--pathspec-file-nul']), 'idempotent add');
    assert.equal(ok(hard(dir, ['write-tree']), 'write-tree'), approved);
    const result = await commitVerified(dir, paths);
    assert.ok(result.committed);
    assert.equal(result.headTree, approved);
  });
}

test('E2: an extra staged entry makes the index tree differ from the approved tree, so nothing is committed', async () => {
  const home = await repo({ 'a.txt': '1\n', 'b.txt': '2\n' });
  const dir = await lane(home, 'e2');
  await put(path.join(dir, 'a.txt'), 'A\n');
  await put(path.join(dir, 'b.txt'), 'B\n');
  await put(path.join(dir, 'c.txt'), 'agent debris\n');
  ok(raw(dir, ['add', 'c.txt']), 'agent stages c.txt');
  const head = ok(raw(dir, ['rev-parse', 'HEAD']), 'rev-parse');
  const result = await commitVerified(dir, ['a.txt', 'b.txt']);
  assert.equal(result.committed, false);
  assert.notEqual(result.indexTree, result.approved);
  assert.equal(ok(raw(dir, ['rev-parse', 'HEAD']), 'rev-parse'), head);
  const other = await lane(home, 'e2b');
  await put(path.join(other, 'a.txt'), 'A\n');
  await put(path.join(other, 'notes.txt'), 'unticked\n');
  const clean = await commitVerified(other, ['a.txt']);
  assert.ok(clean.committed);
  assert.deepEqual(ok(raw(other, ['diff', '--name-only', 'HEAD^', 'HEAD']), 'diff').split('\n'), ['a.txt'], 'an unticked untracked file is not committed');
});

async function ffScenario(name) {
  const home = await repo({ 'f1.txt': 'one\n', 'u1.txt': 'unrelated\n', '.gitignore': '*.log\n' });
  const dir = await lane(home, name);
  await put(path.join(dir, 'f1.txt'), 'one from lane\n');
  await put(path.join(dir, 'new.txt'), 'new from lane\n');
  await put(path.join(dir, 'gen.txt'), 'tracked by lane\n');
  const { head } = await commitVerified(dir, ['f1.txt', 'new.txt', 'gen.txt']);
  await put(path.join(home, '.git/info/exclude'), 'gen.txt\n');
  return { home, M: head, base: ok(raw(home, ['rev-parse', 'HEAD']), 'rev-parse') };
}
const ff = (home, oid) => hard(home, ['merge', '--ff-only', '-q', oid]);
const headOf = (dir) => ok(raw(dir, ['rev-parse', 'HEAD']), 'rev-parse');

test('E3: a fast-forward keeps unrelated modified, untracked and ignored files byte-identical', async () => {
  const { home, M } = await ffScenario('e3a');
  await put(path.join(home, 'u1.txt'), 'my local edit\n');
  await put(path.join(home, 'u2.txt'), 'my untracked\n');
  await put(path.join(home, 'u3.log'), 'my ignored\n');
  const files = ['u1.txt', 'u2.txt', 'u3.log'].map((entry) => path.join(home, entry));
  const before = await Promise.all(files.map(hash));
  ok(ff(home, M), 'ff');
  assert.equal(headOf(home), M);
  assert.deepEqual(await Promise.all(files.map(hash)), before);
});

test('E3: a fast-forward refuses, changing nothing, for an overlapping edit, an untracked file at an added path, and assume-unchanged/skip-worktree edits', async () => {
  const cases = [
    ['overlap', async (home) => put(path.join(home, 'f1.txt'), 'my edit\n'), 'f1.txt'],
    ['untracked-at-added-path', async (home) => put(path.join(home, 'new.txt'), 'mine\n'), 'new.txt'],
    ['assume-unchanged', async (home) => { ok(raw(home, ['update-index', '--assume-unchanged', 'f1.txt']), 'assume'); await put(path.join(home, 'f1.txt'), 'hidden edit\n'); }, 'f1.txt'],
    ['skip-worktree', async (home) => { ok(raw(home, ['update-index', '--skip-worktree', 'f1.txt']), 'skip'); await put(path.join(home, 'f1.txt'), 'hidden edit\n'); }, 'f1.txt']
  ];
  for (const [name, setup, file] of cases) {
    const { home, M, base } = await ffScenario(`e3${name}`);
    await setup(home);
    const before = await hash(path.join(home, file));
    assert.notEqual(ff(home, M).status, 0, `${name}: refused`);
    assert.equal(headOf(home), base, `${name}: HEAD unchanged`);
    assert.equal(await hash(path.join(home, file)), before, `${name}: local file unchanged`);
  }
});

test('E3 canary: Git still overwrites an IGNORED file at a path the fast-forward adds (the lstat pre-check stays mandatory)', async () => {
  const { home, M } = await ffScenario('e3d');
  await put(path.join(home, 'gen.txt'), 'my ignored local file\n');
  const before = await hash(path.join(home, 'gen.txt'));
  ok(ff(home, M), 'ff');
  assert.notEqual(await hash(path.join(home, 'gen.txt')), before, 'if this fails, Git now protects ignored files; the pre-check stays anyway');
});

test('E4: knowledge integration is deterministic: the dry run on the merged tree in a lane equals the real run on the integration branch', async () => {
  const { initWorkspace } = await import('../src/core/workspace.js');
  const helpers = await import('../test-support/shared.js');
  const { writeLocalIdentity } = await import('../src/shared/identity.js');
  const { integrateSharedMemory } = await import('../src/shared/memory.js');
  const home = await repo();
  await helpers.writeTeamApp(home);
  ok(raw(home, ['add', '-A']), 'add');
  ok(raw(home, ['commit', '-qm', 'app']), 'commit');
  await initWorkspace(home, 'Invoicing', 'brownfield');
  await helpers.approveTeamBaseline(home);
  ok(raw(home, ['add', '-A']), 'add');
  ok(raw(home, ['commit', '-qm', 'baseline']), 'commit');
  helpers.cli(home, ['shared', 'enable', '--integration-branch', 'main']);
  await writeLocalIdentity(home, 'MMMMMMMMMM');
  ok(raw(home, ['add', '-A']), 'add');
  ok(raw(home, ['commit', '-qm', 'shared']), 'commit');
  const PAST = { introduce: 'introduced', supersede: 'superseded', reconfirm: 'reconfirmed', dispute: 'disputed', 'merge-duplicate': 'merged-duplicate' };
  const key = (items) => items.map((item) => `${item.workId} ${item.candidateId} ${PAST[item.action] ?? item.action}`).sort();
  async function mergeLane(name, tag, knowledge, moveMain) {
    const dir = await lane(home, name);
    await writeLocalIdentity(dir, tag);
    const workId = await helpers.investigation(dir, `Lane ${name}`);
    await helpers.learn(dir, workId, knowledge);
    await helpers.complete(dir, workId);
    const changed = hard(dir, ['status', '--porcelain=v1', '-z', '--untracked-files=all']).stdout.split('\0').filter((entry) => entry.length > 3).map((entry) => entry.slice(3));
    const lane1 = await commitVerified(dir, changed);
    assert.ok(lane1.committed);
    await moveMain();
    const target = headOf(home);
    const merged = mergeTree(home, target, lane1.head);
    assert.equal(classifyMergeTree(home, merged), 'clean');
    const M = ok(hard(home, ['commit-tree', merged.out.toString('utf8').split('\0')[0].trim(), '-p', target, '-p', lane1.head, '-F', await messageFile(`Merge yf/${name}`)]), 'commit-tree');
    ok(ff(dir, M), 'ff lane');
    const dry = await integrateSharedMemory(dir, { dryRun: true });
    ok(ff(home, M), 'ff home');
    const clones = path.join(BASE, 'clones');
    await mkdir(clones, { recursive: true });
    const twin = path.join(clones, `twin-${name}`);
    ok(raw(clones, ['clone', '-q', '--no-local', home, twin]), 'clone');
    await writeLocalIdentity(twin, 'TTTTTTTTTT');
    const real = await integrateSharedMemory(home, {});
    await integrateSharedMemory(twin, {});
    return { dry, real, twin };
  }
  const a = await mergeLane('lanea', 'AAAAAAAAAA', { kind: 'business-rule', summary: 'Refund approvals above 1000 need a manager.', evidence: ['backend/refunds/policy.js'] },
    async () => { await put(path.join(home, 'src/a.js'), '10;\n'); ok(raw(home, ['commit', '-qam', 'main moved']), 'commit'); });
  assert.deepEqual(key(a.real.applied), key(a.dry.applicable));
  assert.equal(a.dry.blocked.length + a.real.blocked.length, 0);
  const index = '.yallaflow/context/index.yaml';
  assert.equal(await hash(path.join(home, index)), await hash(path.join(a.twin, index)), 'byte-identical integration in an independent clone');
  ok(raw(home, ['add', '-A', '.yallaflow']), 'add');
  ok(raw(home, ['commit', '-qm', 'knowledge A']), 'commit');
  const b = await mergeLane('laneb', 'BBBBBBBBBB', { kind: 'business-rule', summary: 'Refunds are allowed within 45 days.', evidence: ['backend/refunds/policy.js'], supersedes: 'CTX-0004' }, async () => {
    const workId = await helpers.investigation(home, 'Main refund window');
    await helpers.learn(home, workId, { kind: 'business-rule', summary: 'Refunds are allowed within 60 days, per finance.', evidence: ['backend/refunds/policy.js'], supersedes: 'CTX-0004' });
    await helpers.complete(home, workId);
    ok(raw(home, ['add', '-A']), 'add');
    ok(raw(home, ['commit', '-qm', 'main supersedes CTX-0004']), 'commit');
  });
  assert.ok(b.dry.blocked.length > 0, 'a parallel change of the same fact is blocked in the dry run');
  assert.deepEqual(key(b.real.blocked), key(b.dry.blocked), 'and blocked identically in the real run');
});

test('E5: with core.hooksPath=/dev/null no hook runs for worktree add, add, write-tree, commit, merge-tree, commit-tree, fast-forward or worktree remove', async () => {
  const hooks = ['post-checkout', 'pre-commit', 'prepare-commit-msg', 'commit-msg', 'post-commit', 'post-merge', 'reference-transaction', 'pre-merge-commit', 'post-rewrite', 'pre-auto-gc', 'post-index-change'];
  const home = await repo({ 'a.txt': '1\n' });
  const mark = path.join(MARKS, 'e5');
  const plant = async (dir) => { for (const hook of hooks) await put(path.join(dir, hook), `#!/bin/sh\necho ${hook} >> "${mark}"\n`, 0o755); };
  await plant(path.join(home, '.git/hooks'));
  await put(path.join(home, 'a.txt'), 'control\n');
  ok(raw(home, ['commit', '-qam', 'control']), 'control commit');
  assert.ok((await markerLines(mark)).length > 0, 'control: the planted hooks do run without isolation');
  for (const variant of ['git-hooks', 'core.hooksPath']) {
    await rm(mark, { force: true });
    if (variant === 'core.hooksPath') { await plant(path.join(home, '.husky')); ok(raw(home, ['config', 'core.hooksPath', '.husky']), 'config'); }
    const dir = await lane(home, `e5${variant.replace(/\W/g, '')}`);
    await put(path.join(dir, 'a.txt'), `lane ${variant}\n`);
    const { head } = await commitVerified(dir, ['a.txt']);
    const target = headOf(home);
    const tree = mergeTree(home, target, head).out.toString('utf8').split('\0')[0].trim();
    const M = ok(hard(home, ['commit-tree', tree, '-p', target, '-p', head, '-F', await messageFile('merge')]), 'commit-tree');
    ok(ff(dir, M), 'ff lane');
    ok(ff(home, M), 'ff home');
    ok(hard(home, ['worktree', 'remove', dir]), 'worktree remove');
    assert.deepEqual(await markerLines(mark), [], `${variant}: no hook ran`);
  }
});

const sshKeygen = spawnSync('ssh-keygen', ['-?'], { encoding: 'utf8' }).error ? null : 'ssh-keygen';
test('E6: commit-tree ignores commit.gpgSign (so -S must be explicit); -S signs; a failing signer changes nothing', { skip: !sshKeygen && 'ssh-keygen not available' }, async () => {
  const key = path.join(BASE, 'signing-key');
  assert.equal(spawnSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'test', '-f', key], { env: isolatedEnv() }).status, 0);
  const dir = await repo({ 'a.txt': '1\n' });
  for (const [name, value] of [['gpg.format', 'ssh'], ['user.signingkey', `${key}.pub`], ['commit.gpgSign', 'true']]) ok(raw(dir, ['config', name, value]), 'config');
  await put(path.join(dir, 'a.txt'), '2\n');
  const result = await commitVerified(dir, ['a.txt']);
  assert.ok(result.committed);
  assert.match(raw(dir, ['cat-file', '-p', 'HEAD']).stdout, /^gpgsig /m, 'commit honours commit.gpgSign');
  const tree = ok(raw(dir, ['rev-parse', 'HEAD^{tree}']), 'rev-parse');
  const message = await messageFile('ct');
  const unsigned = ok(hard(dir, ['commit-tree', tree, '-p', 'HEAD', '-F', message]), 'commit-tree');
  assert.doesNotMatch(raw(dir, ['cat-file', '-p', unsigned]).stdout, /^gpgsig /m, 'canary: commit-tree does not honour commit.gpgSign');
  const signed = ok(hard(dir, ['commit-tree', tree, '-p', 'HEAD', '-S', '-F', message]), 'commit-tree -S');
  assert.match(raw(dir, ['cat-file', '-p', signed]).stdout, /^gpgsig /m);
  ok(raw(dir, ['config', 'gpg.ssh.program', '/bin/false']), 'config');
  const head = headOf(dir);
  await put(path.join(dir, 'a.txt'), '3\n');
  ok(hard(dir, ['add', '-A', `--pathspec-from-file=${await pathspecFile(['a.txt'])}`, '--pathspec-file-nul']), 'add');
  assert.notEqual(hard(dir, ['commit', '-q', '-F', message]).status, 0);
  assert.equal(headOf(dir), head, 'a failing signer leaves HEAD unchanged');
  const failed = hard(dir, ['commit-tree', tree, '-p', 'HEAD', '-S', '-F', message]);
  assert.notEqual(failed.status, 0);
  assert.equal(failed.stdout.trim(), '', 'no object id is produced');
});

test('E10 canary: clean/smudge filters run during worktree add, add/commit and fast-forward (filter trust policy stays required)', async () => {
  const mark = path.join(MARKS, 'e10');
  const home = await repo({ 'plain.txt': 'p\n' });
  ok(raw(home, ['config', 'filter.mark.clean', `sh -c 'echo clean >> "${mark}"; cat'`]), 'config');
  ok(raw(home, ['config', 'filter.mark.smudge', `sh -c 'echo smudge >> "${mark}"; cat'`]), 'config');
  await put(path.join(home, '.gitattributes'), '*.dat filter=mark\n');
  await put(path.join(home, 'a.dat'), 'data\n');
  ok(raw(home, ['add', '-A']), 'add');
  ok(raw(home, ['commit', '-qm', 'filters']), 'commit');
  await rm(mark, { force: true });
  const dir = await lane(home, 'e10');
  assert.ok((await markerLines(mark)).includes('smudge'), 'worktree add runs smudge');
  await rm(mark, { force: true });
  await put(path.join(dir, 'a.dat'), 'data lane\n');
  const { head } = await commitVerified(dir, ['a.dat']);
  assert.ok((await markerLines(mark)).includes('clean'), 'add runs clean');
  await rm(mark, { force: true });
  ok(ff(home, head), 'ff');
  assert.ok((await markerLines(mark)).includes('smudge'), 'fast-forward runs smudge');
});

test('E11: merge-tree runs custom merge drivers (canary); diff helpers never run with --no-ext-diff --no-textconv or name-only forms', async () => {
  const mark = path.join(MARKS, 'e11');
  const home = await repo({ 'x.mrg': 'l1\nl2\nl3\nl4\nl5\nl6\n', 'd.tc': 'tc\n' });
  ok(raw(home, ['config', 'merge.mark.driver', `sh -c 'echo driver >> "${mark}"; exit 1' -- %O %A %B`]), 'config');
  await put(path.join(home, '.gitattributes'), '*.mrg merge=mark\n*.tc diff=tc\n');
  ok(raw(home, ['add', '-A']), 'add');
  ok(raw(home, ['commit', '-qm', 'attributes']), 'commit');
  const dir = await lane(home, 'e11');
  await put(path.join(dir, 'x.mrg'), 'l1 lane\nl2\nl3\nl4\nl5\nl6\n');
  const { head } = await commitVerified(dir, ['x.mrg']);
  await put(path.join(home, 'x.mrg'), 'l1\nl2\nl3\nl4\nl5\nl6 main\n');
  ok(raw(home, ['commit', '-qam', 'main']), 'commit');
  await rm(mark, { force: true });
  mergeTree(home, 'main', head);
  assert.ok((await markerLines(mark)).includes('driver'), 'canary: merge-tree executes the configured merge driver');
  ok(raw(home, ['config', 'diff.external', `sh -c 'echo extdiff >> "${mark}"'`]), 'config');
  ok(raw(home, ['config', 'diff.tc.textconv', `sh -c 'echo textconv >> "${mark}"; cat "$0"'`]), 'config');
  await put(path.join(home, 'd.tc'), 'tc changed\n');
  await rm(mark, { force: true });
  raw(home, ['diff']);
  assert.ok((await markerLines(mark)).length > 0, 'control: plain diff runs the helpers');
  await rm(mark, { force: true });
  hard(home, ['diff', '--no-ext-diff', '--no-textconv']);
  hard(home, ['diff', '--name-only']);
  hard(home, ['diff', '--name-status', 'HEAD']);
  hard(home, ['diff', '--quiet']);
  hard(home, ['diff', '--no-ext-diff', '--no-textconv'], { env: { GIT_EXTERNAL_DIFF: `sh -c 'echo envdiff >> "${mark}"'` } });
  assert.deepEqual(await markerLines(mark), []);
});

test('E12: a sanitised environment runs no inherited editor/pager/diff helper, acts only on the intended repository, and the config fingerprint tracks includes', async () => {
  const mark = path.join(MARKS, 'e12');
  const evil = path.join(BASE, 'evil.sh');
  await put(evil, `#!/bin/sh\necho "evil $*" >> "${mark}"\nexit 0\n`, 0o755);
  const other = await repo({ 'o.txt': 'other\n' });
  const otherHead = headOf(other);
  const otherIndex = await hash(path.join(other, '.git/index'));
  const dir = await repo({ 'a.txt': '1\n' });
  const include = path.join(BASE, 'extra.cfg');
  await put(include, '[alias]\n\tst = status\n');
  for (const [name, value] of [['core.pager', evil], ['core.editor', evil], ['core.askPass', evil], ['credential.helper', evil], ['core.sshCommand', evil], ['include.path', include]]) ok(raw(dir, ['config', name, value]), 'config');
  await put(path.join(dir, 'ctl.txt'), 'ctl\n');
  ok(raw(dir, ['add', 'ctl.txt']), 'add');
  raw(dir, ['commit', '-q'], { env: { GIT_EDITOR: evil } });
  raw(dir, ['diff', '--cached'], { env: { GIT_EXTERNAL_DIFF: evil } });
  assert.ok((await markerLines(mark)).length >= 2, 'control: the helpers run when inherited');
  await rm(mark, { force: true });
  // The hostile parent environment is removed by the same STRIP rule git-ops will use.
  const hostile = { GIT_DIR: path.join(other, '.git'), GIT_WORK_TREE: other, GIT_INDEX_FILE: path.join(other, '.git/index'), GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.pager', GIT_CONFIG_VALUE_0: evil, GIT_PAGER: evil, GIT_EDITOR: evil, GIT_EXTERNAL_DIFF: evil, GIT_SSH_COMMAND: evil, PAGER: evil, EDITOR: evil };
  const saved = { ...process.env };
  Object.assign(process.env, hostile);
  try {
    await put(path.join(dir, 'a.txt'), '2\n');
    hard(dir, ['status', '--porcelain']);
    hard(dir, ['diff', '--no-ext-diff', '--no-textconv', '--cached']);
    ok(hard(dir, ['add', '-A', `--pathspec-from-file=${await pathspecFile(['a.txt'])}`, '--pathspec-file-nul']), 'add');
    ok(hard(dir, ['commit', '-q', '-F', await messageFile('sanitised')]), 'commit');
  } finally {
    for (const key of Object.keys(hostile)) delete process.env[key];
    Object.assign(process.env, saved);
  }
  assert.deepEqual(await markerLines(mark), [], 'no inherited helper ran');
  assert.equal(headOf(other), otherHead, 'the other repository was not touched');
  assert.equal(await hash(path.join(other, '.git/index')), otherIndex);
  const fingerprint = () => createHash('sha256').update(hard(dir, ['config', '--list', '--show-origin', '--show-scope', '-z']).out).digest('hex');
  const first = fingerprint();
  await put(include, '[alias]\n\tst = status\n[filter "x"]\n\tclean = cat\n');
  const second = fingerprint();
  ok(raw(dir, ['config', 'merge.y.driver', 'true']), 'config');
  assert.notEqual(first, second, 'an included file change changes the fingerprint');
  assert.notEqual(second, fingerprint(), 'a repository config change changes the fingerprint');
});

test('E14: a checkout left inconsistent by a concurrent Git process (HEAD at one target, index carrying another) is detected by index tree != HEAD tree', async () => {
  const home = await repo({ 'a.txt': '1\n' });
  const dir = await lane(home, 'e14');
  const commits = [];
  for (const index of [0, 1]) {
    await put(path.join(dir, `n${index}.txt`), `${index}\n`);
    commits.push((await commitVerified(dir, [`n${index}.txt`])).head);
  }
  ok(ff(home, commits[0]), 'ff');
  assert.equal(ok(hard(home, ['write-tree']), 'write-tree'), ok(raw(home, ['rev-parse', 'HEAD^{tree}']), 'rev-parse'), 'consistent after a lone fast-forward');
  // The state E14 observed after two concurrent fast-forwards: the loser updated index and files, then failed on the ref lock.
  ok(raw(home, ['read-tree', '-m', '-u', 'HEAD', commits[1]]), 'simulate the losing process');
  assert.equal(headOf(home), commits[0]);
  assert.notEqual(ok(hard(home, ['write-tree']), 'write-tree'), ok(raw(home, ['rev-parse', 'HEAD^{tree}']), 'rev-parse'), 'the post-step check detects it');
  await put(path.join(home, '.git/index.lock'), '');
  assert.notEqual(hard(home, ['add', '-A', `--pathspec-from-file=${await pathspecFile(['a.txt'])}`, '--pathspec-file-nul']).status, 0, 'a present index.lock makes Git refuse');
  assert.ok(await exists(path.join(home, '.git/index.lock')), 'and Git leaves the lock in place');
});

test('E15: worktree remove refuses modified or untracked lanes, keeps the branch, and DELETES ignored files (the ignored-file guard stays mandatory)', async () => {
  const home = await repo({ 'a.txt': '1\n', '.gitignore': '.env\nnode_modules/\n' });
  const cases = [
    ['clean', async () => {}, true],
    ['modified', async (dir) => put(path.join(dir, 'a.txt'), 'changed\n'), false],
    ['untracked', async (dir) => put(path.join(dir, 'new.txt'), 'untracked\n'), false],
    ['ignored-env', async (dir) => put(path.join(dir, '.env'), 'SECRET_TOKEN=keep-me\n'), true]
  ];
  for (const [name, setup, removed] of cases) {
    const dir = await lane(home, `e15${name.replace(/\W/g, '')}`);
    await setup(dir);
    const result = hard(home, ['worktree', 'remove', dir]);
    assert.equal(result.status === 0, removed, `${name}: removal ${removed ? 'happens' : 'is refused'}`);
    assert.equal(!(await exists(dir)), removed);
    assert.equal(raw(home, ['rev-parse', '--verify', '-q', `yf/e15${name.replace(/\W/g, '')}`]).status, 0, `${name}: branch kept`);
  }
});

test.after(async () => {
  await rm(BASE, { recursive: true, force: true });
});

const gpgAvailable = !spawnSync('gpg', ['--version'], { encoding: 'utf8' }).error;
test('A5 / AC-047: OpenPGP signing with a throwaway key in an isolated GNUPGHOME — commit signs by config, commit-tree only with -S, a failing signer changes nothing', { skip: !gpgAvailable && 'gpg not available: the OpenPGP signing path stays blocked where this test cannot run' }, async () => {
  const gnupg = path.join(BASE, 'gnupg');
  await mkdir(gnupg, { recursive: true, mode: 0o700 });
  const env = { ...isolatedEnv(), GNUPGHOME: gnupg };
  const generated = spawnSync('gpg', ['--batch', '--pinentry-mode', 'loopback', '--passphrase', '', '--quick-gen-key', 'YallaFlow Test <test@example.invalid>', 'ed25519', 'sign', 'never'], { env, encoding: 'utf8' });
  assert.equal(generated.status, 0, generated.stderr);
  const fingerprint = (/^fpr:+([0-9A-F]+):/m.exec(spawnSync('gpg', ['--batch', '--with-colons', '--list-secret-keys'], { env, encoding: 'utf8' }).stdout) ?? [])[1];
  assert.ok(fingerprint);
  try {
    const dir = await repo({ 'a.txt': '1\n' });
    for (const [name, value] of [['user.signingkey', fingerprint], ['commit.gpgSign', 'true']]) ok(raw(dir, ['config', name, value]), 'config');
    const signedRaw = (cwd, args) => { const result = spawnSync('git', [...HARD, ...args], { cwd, env, encoding: 'utf8' }); return { status: result.status, stdout: result.stdout }; };
    await put(path.join(dir, 'a.txt'), '2\n');
    ok(signedRaw(dir, ['add', '-A', '--', 'a.txt']), 'add');
    ok(signedRaw(dir, ['commit', '-q', '--cleanup=verbatim', '-m', 'signed']), 'commit');
    assert.match(raw(dir, ['cat-file', '-p', 'HEAD']).stdout, /^gpgsig -----BEGIN PGP SIGNATURE-----/m);
    assert.equal(spawnSync('git', ['verify-commit', 'HEAD'], { cwd: dir, env, encoding: 'utf8' }).status, 0, 'the signature verifies');
    const tree = ok(raw(dir, ['rev-parse', 'HEAD^{tree}']), 'rev-parse');
    const unsigned = ok(signedRaw(dir, ['commit-tree', tree, '-p', 'HEAD', '-m', 'ct']), 'commit-tree');
    assert.doesNotMatch(raw(dir, ['cat-file', '-p', unsigned]).stdout, /^gpgsig /m, 'commit-tree ignores commit.gpgSign');
    const signed = ok(signedRaw(dir, ['commit-tree', tree, '-p', 'HEAD', '-S', '-m', 'ct']), 'commit-tree -S');
    assert.match(raw(dir, ['cat-file', '-p', signed]).stdout, /^gpgsig -----BEGIN PGP SIGNATURE-----/m);
    ok(raw(dir, ['config', 'gpg.program', '/bin/false']), 'config');
    const head = ok(raw(dir, ['rev-parse', 'HEAD']), 'rev-parse');
    await put(path.join(dir, 'a.txt'), '3\n');
    ok(signedRaw(dir, ['add', '-A', '--', 'a.txt']), 'add');
    assert.notEqual(signedRaw(dir, ['commit', '-q', '-m', 'x']).status, 0);
    assert.equal(ok(raw(dir, ['rev-parse', 'HEAD']), 'rev-parse'), head, 'a failing signer leaves HEAD unchanged');
  } finally {
    spawnSync('gpgconf', ['--kill', 'gpg-agent'], { env });
  }
});
