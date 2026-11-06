// v1.2.0 workspace write lock: concurrent agents never corrupt state or share an ID;
// a stale lock is recovered, a live one is waited for and never stolen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, writeFile, mkdir, utimes } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { initWorkspace, workspacePath } from '../src/core/workspace.js';
import { exists } from '../src/utils/fs.js';
import { acquireWorkspaceLock, lockFilePath, readLock } from '../src/utils/lock.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));

function runAsync(root, args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd: root, env: { ...process.env, ...env } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}
const run = (root, args, env = {}) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, ...env } });

async function project() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-lock-'));
  await initWorkspace(root, 'demo', 'greenfield', 'adaptive');
  return root;
}

async function allStateParses(root) {
  const base = workspacePath(root);
  const bad = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name.endsWith('.tmp')) bad.push(`leftover temp file ${path.relative(base, full)}`);
      else if (/\.(yaml|json)$/.test(entry.name)) {
        try { JSON.parse(await readFile(full, 'utf8')); } catch { bad.push(`unparseable ${path.relative(base, full)}`); }
      }
    }
  }
  await walk(base);
  return bad;
}

test('parallel starts allocate distinct work IDs and leave valid state', async () => {
  const root = await project();
  const results = await Promise.all(Array.from({ length: 12 }, (_, index) => runAsync(root, ['start', `Request ${index}`])));
  for (const result of results) assert.equal(result.status, 0, result.stderr);
  const ids = results.map((result) => /Created (PF-\d+)/.exec(result.stdout)[1]);
  assert.equal(new Set(ids).size, 12, `duplicate IDs: ${ids.join(', ')}`);
  assert.equal((await readdir(path.join(workspacePath(root), 'work'))).length, 12);
  assert.deepEqual(await allStateParses(root), []);
  assert.equal(await exists(lockFilePath(root)), false, 'the lock is released');
});

test('parallel mutating commands across items and verifications keep every ledger intact', async () => {
  const root = await project();
  const ids = [];
  for (let index = 0; index < 4; index++) {
    const id = /Created (PF-\d+)/.exec(run(root, ['change', `Change ${index}`, '--scope', 'bounded']).stdout)[1];
    ids.push(id);
  }
  const jobs = [];
  for (const id of ids) {
    jobs.push(runAsync(root, ['question', 'add', id, '--category', 'business', '--text', 'Which customers?']));
    jobs.push(runAsync(root, ['checkpoint', id, '--skill', 'context-discovery', '--complete', '--summary', 'ok']));
    jobs.push(runAsync(root, ['advance', id]));
    for (let k = 0; k < 3; k++) jobs.push(runAsync(root, ['verify', id, '--', process.execPath, '-e', 'process.exit(0)']));
  }
  const results = await Promise.all(jobs);
  for (const result of results) assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(await allStateParses(root), []);
  for (const id of ids) {
    const ledger = JSON.parse(await readFile(path.join(workspacePath(root), 'work', id, 'evidence', 'verification.json'), 'utf8'));
    assert.deepEqual(ledger.runs.map((entry) => entry.id), ['V-001', 'V-002', 'V-003']);
    const questions = JSON.parse(await readFile(path.join(workspacePath(root), 'work', id, 'questions.yaml'), 'utf8'));
    assert.equal(questions.questions.length, 1);
  }
});

test('a stale lock from a dead process is reported, then recovered automatically', async () => {
  const root = await project();
  const dead = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' });
  await mkdir(path.dirname(lockFilePath(root)), { recursive: true });
  await writeFile(lockFilePath(root), JSON.stringify({ pid: Number(dead.stdout), host: os.hostname(), startedAt: '2026-01-01T00:00:00.000Z', command: 'yallaflow advance PF-0001' }));
  assert.equal((await readLock(root)).stale, true);
  assert.match(run(root, ['doctor']).stdout, /WARN workspace lock: stale lock left by `yallaflow advance PF-0001`/);
  const started = run(root, ['start', 'After a crash']);
  assert.equal(started.status, 0, started.stderr);
  assert.equal(await exists(lockFilePath(root)), false);
});

test('doctor --clear-lock removes a stale lock and refuses a live one', async () => {
  const root = await project();
  await mkdir(path.dirname(lockFilePath(root)), { recursive: true });
  await writeFile(lockFilePath(root), JSON.stringify({ pid: process.pid, host: os.hostname(), startedAt: new Date().toISOString(), command: 'yallaflow checkpoint' }));
  const refused = run(root, ['doctor', '--clear-lock']);
  assert.equal(refused.status, 1);
  assert.match(refused.stdout, /Not cleared: the lock is held by a running process/);
  assert.equal(await exists(lockFilePath(root)), true);

  const dead = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' });
  await writeFile(lockFilePath(root), JSON.stringify({ pid: Number(dead.stdout), host: os.hostname(), startedAt: new Date().toISOString(), command: 'yallaflow checkpoint' }));
  const cleared = run(root, ['doctor', '--clear-lock']);
  assert.equal(cleared.status, 0);
  assert.match(cleared.stdout, /Cleared: removed a stale lock/);
  assert.equal(await exists(lockFilePath(root)), false);
});

test('a live holder is waited for; past the timeout the command fails and changes nothing', async () => {
  const root = await project();
  const holder = spawn(process.execPath, ['--input-type=module', '-e', `
    import { acquireWorkspaceLock } from ${JSON.stringify(new URL('../src/utils/lock.js', import.meta.url).href)};
    await acquireWorkspaceLock(${JSON.stringify(root)}, { command: 'yallaflow test-holder' });
    process.stdout.write('held\\n');
    setTimeout(() => process.exit(0), 1500);
  `]);
  await new Promise((resolve) => holder.stdout.once('data', resolve));

  const workDir = path.join(workspacePath(root), 'work');
  const before = await exists(workDir) ? await readdir(workDir) : [];
  const busy = run(root, ['start', 'Too early'], { YALLAFLOW_LOCK_TIMEOUT_MS: '200' });
  assert.equal(busy.status, 1);
  assert.match(busy.stderr, /The workspace is busy: `yallaflow test-holder`/);
  assert.deepEqual(await exists(workDir) ? await readdir(workDir) : [], before, 'nothing was written');

  const waited = await runAsync(root, ['start', 'Waits its turn']);
  assert.equal(waited.status, 0, waited.stderr);
  assert.match(waited.stdout, /Created PF-0001/);
});

test('the lock is re-entrant inside one process and read commands never take it', async () => {
  const root = await project();
  const releaseOuter = await acquireWorkspaceLock(root, { command: 'outer' });
  const releaseInner = await acquireWorkspaceLock(root, { command: 'inner' });
  await releaseInner();
  assert.equal(await exists(lockFilePath(root)), true, 'still held by the outer acquisition');
  const status = run(root, ['status'], { YALLAFLOW_LOCK_TIMEOUT_MS: '0' });
  assert.equal(status.status, 0, 'a read command runs while a writer holds the lock');
  const snapshot = run(root, ['snapshot', '--json'], { YALLAFLOW_LOCK_TIMEOUT_MS: '0' });
  assert.equal(snapshot.status, 0);
  await releaseOuter();
  assert.equal(await exists(lockFilePath(root)), false);
});

test('a single-user workspace has no local/ directory after a command, even a refused one', async () => {
  const root = await project();
  const local = path.join(workspacePath(root), 'local');
  assert.equal(run(root, ['start', 'Something']).status, 0);
  assert.equal(await exists(local), false);
  assert.equal(run(root, ['advance', 'PF-0099']).status, 1);
  assert.equal(await exists(local), false);
});

test('a crash can never leave an empty lock; an unreadable one is stale after 30 s', async () => {
  const root = await project();
  await mkdir(path.dirname(lockFilePath(root)), { recursive: true });
  await writeFile(lockFilePath(root), '');
  const busy = run(root, ['start', 'Too soon'], { YALLAFLOW_LOCK_TIMEOUT_MS: '200' });
  assert.equal(busy.status, 1, 'a fresh unreadable lock may still be being written');
  const old = new Date(Date.now() - 60_000);
  await utimes(lockFilePath(root), old, old);
  const ok = run(root, ['start', 'After a crash mid-create'], { YALLAFLOW_LOCK_TIMEOUT_MS: '2000' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(await exists(lockFilePath(root)), false);
});

test('a reused pid (same pid, different process start) is recognized as stale', { skip: process.platform !== 'linux' }, async () => {
  const root = await project();
  const sleeper = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)']);
  try {
    await mkdir(path.dirname(lockFilePath(root)), { recursive: true });
    await writeFile(lockFilePath(root), JSON.stringify({ pid: sleeper.pid, host: os.hostname(), startedAt: '2026-01-01T00:00:00.000Z', command: 'yallaflow advance PF-0001', start: '1' }));
    const lock = await readLock(root);
    assert.equal(lock.stale, true, 'the live process is not the one that took the lock');
    const ok = run(root, ['start', 'After pid reuse'], { YALLAFLOW_LOCK_TIMEOUT_MS: '2000' });
    assert.equal(ok.status, 0, ok.stderr);
  } finally {
    sleeper.kill();
  }
});

test('the lock records the holder identity, and a positively identified live holder is never cleared', { skip: process.platform !== 'linux' }, async () => {
  const root = await project();
  const holder = spawn(process.execPath, ['--input-type=module', '-e', `
    import { acquireWorkspaceLock } from ${JSON.stringify(new URL('../src/utils/lock.js', import.meta.url).href)};
    await acquireWorkspaceLock(${JSON.stringify(root)}, { command: 'yallaflow test-holder' });
    process.stdout.write('held\\n');
    setTimeout(() => process.exit(0), 3000);
  `]);
  await new Promise((resolve) => holder.stdout.once('data', resolve));
  const lock = await readLock(root);
  assert.ok(lock.boot && lock.start, 'boot id and process start are recorded');
  assert.equal(lock.verified, true);
  const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
  await utimes(lockFilePath(root), old, old);
  const refused = run(root, ['doctor', '--clear-lock']);
  assert.equal(refused.status, 1);
  assert.match(refused.stdout, /held by a running process/);
  await new Promise((resolve) => holder.on('exit', resolve));
});

test('doctor --clear-lock removes an hour-old lock whose holder cannot be identified', async () => {
  const root = await project();
  const sleeper = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)']);
  try {
    await mkdir(path.dirname(lockFilePath(root)), { recursive: true });
    await writeFile(lockFilePath(root), JSON.stringify({ pid: sleeper.pid, host: os.hostname(), startedAt: new Date().toISOString(), command: 'yallaflow advance PF-0001' }));
    const refused = run(root, ['doctor', '--clear-lock']);
    assert.equal(refused.status, 1, 'not yet an hour old');
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await utimes(lockFilePath(root), old, old);
    const cleared = run(root, ['doctor', '--clear-lock']);
    assert.equal(cleared.status, 0, cleared.stdout);
    assert.match(cleared.stdout, /could not be confirmed/);
  } finally {
    sleeper.kill();
  }
});

test('leftover lock temp files from a crash are swept', async () => {
  const root = await project();
  const dir = path.dirname(lockFilePath(root));
  await mkdir(dir, { recursive: true });
  const leftover = path.join(dir, 'lock.99999.deadbeef.new');
  await writeFile(leftover, '{}');
  const old = new Date(Date.now() - 60_000);
  await utimes(leftover, old, old);
  assert.equal(run(root, ['start', 'Sweep']).status, 0);
  assert.equal(await exists(dir), false, 'local/ is empty again and removed');
});

test('a lock taken before the machine last booted is stale on any platform', async () => {
  const root = await project();
  const sleeper = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)']);
  try {
    await mkdir(path.dirname(lockFilePath(root)), { recursive: true });
    await writeFile(lockFilePath(root), JSON.stringify({ pid: sleeper.pid, host: os.hostname(), startedAt: new Date(Date.now() - os.uptime() * 1000 - 3_600_000).toISOString(), command: 'yallaflow advance PF-0001' }));
    assert.equal((await readLock(root)).stale, true);
    assert.equal(run(root, ['start', 'After a reboot'], { YALLAFLOW_LOCK_TIMEOUT_MS: '2000' }).status, 0);
  } finally {
    sleeper.kill();
  }
});

test('release removes only its own lock, never one taken over meanwhile', async () => {
  const root = await project();
  const release = await acquireWorkspaceLock(root, { command: 'mine' });
  const foreign = JSON.stringify({ pid: process.pid, host: os.hostname(), startedAt: new Date().toISOString(), command: 'other', nonce: 'someone-else' });
  await writeFile(lockFilePath(root), foreign);
  await release();
  assert.equal(await readFile(lockFilePath(root), 'utf8'), foreign);
});

test('verify waits to record a finished run and always shows its output (an exited, unreaped holder counts as gone)', async () => {
  const root = await project();
  const id = /Created (PF-\d+)/.exec(run(root, ['change', 'Something', '--scope', 'bounded']).stdout)[1];
  const holder = spawn(process.execPath, ['--input-type=module', '-e', `
    import { acquireWorkspaceLock } from ${JSON.stringify(new URL('../src/utils/lock.js', import.meta.url).href)};
    await acquireWorkspaceLock(${JSON.stringify(root)}, { command: 'yallaflow test-holder' });
    process.stdout.write('held\\n');
    setTimeout(() => process.exit(0), 1500);
  `]);
  await new Promise((resolve) => holder.stdout.once('data', resolve));
  const verified = run(root, ['verify', id, '--', process.execPath, '-e', 'console.log("IMPORTANT-OUTPUT")'], { YALLAFLOW_LOCK_TIMEOUT_MS: '100' });
  assert.equal(verified.status, 0, verified.stderr);
  assert.match(verified.stdout, /IMPORTANT-OUTPUT[\s\S]*Verification PASSED/);
});

test('a lock a crash leaves in a single-user workspace stays out of git status', async () => {
  const root = await project();
  spawnSync('git', ['init', '-q'], { cwd: root });
  spawnSync('git', ['-c', 'user.email=t@e', '-c', 'user.name=t', 'add', '-A'], { cwd: root });
  spawnSync('git', ['-c', 'user.email=t@e', '-c', 'user.name=t', 'commit', '-qm', 'base'], { cwd: root });
  const crasher = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { acquireWorkspaceLock } from ${JSON.stringify(new URL('../src/utils/lock.js', import.meta.url).href)};
    await acquireWorkspaceLock(${JSON.stringify(root)}, { command: 'crashes' });
    process.exit(9); // dies holding the lock
  `]);
  assert.equal(crasher.status, 9);
  assert.equal(await exists(lockFilePath(root)), true);
  assert.equal(spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).stdout, '');
  assert.equal(run(root, ['start', 'Next command cleans up']).status, 0);
  assert.equal(await exists(path.dirname(lockFilePath(root))), false, 'lock, its .gitignore and local/ are gone');
});
