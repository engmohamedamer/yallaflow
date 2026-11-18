// PF-0184: read-only Git Branch Health.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdtemp, readdir, readFile, readlink, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeBranches, describeBranches, previewMerge, validateBranchesConfig } from '../src/core/branches.js';

const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' };
function git(cwd, ...args) {
  const out = spawnSync('git', args, { cwd, encoding: 'utf8', env: GIT_ENV });
  assert.equal(out.status, 0, `git ${args.join(' ')}: ${out.stderr}`);
  return out.stdout.trim();
}
const write = (root, file, text) => writeFile(path.join(root, file), text);

// prod ← hotfix/login (merged); dev has feature A and a conf change that conflicts with the hotfix.
async function scenario() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yf-branches-'));
  git(root, 'init', '-q', '-b', 'prod');
  await write(root, 'app.txt', 'a\n');
  await write(root, 'conf.txt', '1\n');
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'init');
  git(root, 'branch', 'qc');
  git(root, 'branch', 'dev');
  git(root, 'switch', '-q', 'dev');
  await write(root, 'app.txt', 'a\nfeature\n');
  git(root, 'commit', '-qam', 'feature A');
  git(root, 'switch', '-q', '-c', 'hotfix/login', 'prod');
  await write(root, 'conf.txt', '2\n');
  git(root, 'commit', '-qam', 'hotfix login');
  git(root, 'switch', '-q', 'prod');
  git(root, 'merge', '-q', '--no-ff', 'hotfix/login', '-m', 'merge hotfix');
  git(root, 'switch', '-q', 'dev');
  await write(root, 'conf.txt', '3\n');
  git(root, 'commit', '-qam', 'dev changes conf');
  return root;
}

async function snapshot(root) {
  const out = [];
  async function walk(dir) {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full);
      if (entry.isSymbolicLink()) out.push(`${rel} -> ${await readlink(full)}`);
      else if (entry.isDirectory()) { out.push(`${rel}/`); await walk(full); }
      // Git may refresh the modification time of an existing object it meets again while
      // computing a merge (to protect it from cleanup): object files are compared by content.
      else out.push(`${rel} ${createHash('sha256').update(await readFile(full)).digest('hex')}${/(^|\/)\.git\/objects\//.test(full.split(path.sep).join('/')) ? '' : ` ${(await lstat(full)).mtimeMs}`}`);
    }
  }
  await walk(root);
  return out.join('\n');
}

test('dev → qc → prod: readiness, production-only hotfix, back-merge conflict; nothing in the repository changes', async () => {
  const root = await scenario();
  await write(root, 'app.txt', 'uncommitted edit\n'); // a dirty working tree must stay exactly as it is
  const before = await snapshot(root);
  const report = await analyzeBranches(root);
  assert.equal(await snapshot(root), before, 'refs, the index, the working tree and every object are untouched; no object is added');

  assert.deepEqual(report.flow, ['dev', 'qc', 'prod']);
  assert.equal(report.flowSource, 'detected');
  const [devToQc, qcToProd] = report.promotions;
  assert.equal(devToQc.status, 'ready');
  assert.equal(devToQc.waiting, 2);
  assert.equal(devToQc.preview.result, 'clean');
  assert.equal(qcToProd.status, 'up-to-date');
  assert.equal(qcToProd.missingInFrom[0].subject, 'hotfix login');

  const devMissing = report.productionOnly.find((item) => item.branch === 'dev');
  assert.deepEqual(devMissing.commits.map((commit) => commit.subject), ['hotfix login']);
  assert.equal(devMissing.preview.result, 'conflict');
  assert.deepEqual(devMissing.preview.conflicts, ['conf.txt']);
  assert.ok(report.productionOnly.some((item) => item.branch === 'qc' && item.preview.result === 'clean'));
  assert.deepEqual(report.hotfixes, [{ name: 'hotfix/login', inProduction: true, missingFrom: ['dev', 'qc'], unchecked: false }]);
  assert.ok(report.notes.some((note) => /uncommitted changes in this checkout are not included/.test(note)));

  const text = describeBranches(report).join('\n');
  assert.match(text, /Is dev ready for qc\? Ready/);
  assert.match(text, /Potential conflict: merging prod into dev would conflict in conf\.txt/);
  assert.match(text, /hotfix\/login \(in production\) is missing from dev, qc/);
  assert.match(text, /A clean preview does not show that the promoted code works/);
  assert.match(text, /Suggested \(not run\)/);
});

test('a promotion that would conflict, and one where the upper branch has changes the lower lacks', async () => {
  const root = await scenario();
  // qc gets the hotfix by cherry-pick (a different commit, same change): recognised as present.
  git(root, 'switch', '-q', 'qc');
  git(root, 'cherry-pick', '-x', 'hotfix/login');
  const report = await analyzeBranches(root);
  const [devToQc, qcToProd] = report.promotions;
  assert.equal(devToQc.status, 'conflict', 'dev changes conf.txt the other way');
  assert.deepEqual(devToQc.preview.conflicts, ['conf.txt']);
  assert.equal(qcToProd.status, 'ready', 'the cherry-picked hotfix counts as already in prod');
  assert.equal(report.productionOnly.some((item) => item.branch === 'qc'), false, 'patch-equivalent cherry-pick is not reported missing');
  assert.equal(report.hotfixes[0].missingFrom.includes('qc'), false);

  // A fix made directly on qc: dev → qc needs a sync first (no conflict).
  const other = await mkdtemp(path.join(os.tmpdir(), 'yf-branches-sync-'));
  git(other, 'init', '-q', '-b', 'main');
  await write(other, 'a.txt', '1\n');
  git(other, 'add', '.');
  git(other, 'commit', '-qm', 'init');
  git(other, 'branch', 'staging');
  git(other, 'branch', 'develop');
  git(other, 'switch', '-q', 'staging');
  await write(other, 'b.txt', 'fix\n');
  git(other, 'add', '.');
  git(other, 'commit', '-qm', 'fix on staging');
  git(other, 'switch', '-q', 'develop');
  await write(other, 'c.txt', 'feature\n');
  git(other, 'add', '.');
  git(other, 'commit', '-qm', 'feature');
  const synced = await analyzeBranches(other);
  assert.deepEqual(synced.flow, ['develop', 'staging', 'main']);
  assert.equal(synced.promotions[0].status, 'needs-sync');
  assert.match(synced.promotions[0].next[0], /merge staging into develop/);
});

test('configured flow, remote-tracking branches, divergence from upstream and stale fetch information', async () => {
  const origin = await scenario();
  const root = await mkdtemp(path.join(os.tmpdir(), 'yf-branches-clone-'));
  git(root, 'clone', '-q', origin, '.');
  // The clone has local dev (the origin's current branch) and prod; qc exists only as origin/qc.
  git(root, 'switch', '-q', 'prod');
  await write(root, 'local.txt', 'x\n');
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'local only');
  const fetchHead = path.join(root, '.git', 'FETCH_HEAD');
  await writeFile(fetchHead, '');
  const old = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  await utimes(fetchHead, old, old);
  const report = await analyzeBranches(root, { config: { flow: ['dev', 'qc', 'prod'], remote: 'origin' } });
  assert.equal(report.flowSource, 'configured');
  assert.equal(report.branches.find((branch) => branch.name === 'qc').source, 'remote-tracking');
  const prod = report.branches.find((branch) => branch.name === 'prod');
  assert.equal(prod.ahead, 1);
  assert.equal(report.stale, true);
  assert.ok(report.notes.some((note) => /prod has 1 local commit\(s\) not pushed/.test(note)));
  assert.ok(report.notes.some((note) => /YallaFlow never fetches/.test(note)));
  assert.ok(report.notes.some((note) => /qc has no local branch; origin\/qc/.test(note)));

  const missing = await analyzeBranches(root, { config: { flow: ['dev', 'release', 'prod'] } });
  assert.equal(missing.promotions[0].status, 'unknown');
  assert.ok(missing.notes.some((note) => /release does not exist/.test(note)));
});

test('the merge preview writes no object into the repository; no flow and no repository are explained', async () => {
  const root = await scenario();
  const objects = async () => (await snapshot(path.join(root, '.git', 'objects')));
  const before = await objects();
  const conflict = await previewMerge(root, 'refs/heads/dev', 'refs/heads/prod');
  assert.equal(conflict.result, 'conflict');
  assert.equal(await objects(), before, 'merge-tree objects went to a temporary store');

  const plain = await mkdtemp(path.join(os.tmpdir(), 'yf-branches-none-'));
  git(plain, 'init', '-q', '-b', 'feature/x');
  await write(plain, 'a.txt', '1\n');
  git(plain, 'add', '.');
  git(plain, 'commit', '-qm', 'init');
  const none = await analyzeBranches(plain);
  assert.equal(none.available, false);
  assert.match(none.reason, /yallaflow branches configure --flow dev,qc,prod/);
  const notGit = await analyzeBranches(await mkdtemp(path.join(os.tmpdir(), 'yf-branches-nogit-')));
  assert.equal(notGit.available, false);
});

test('branch settings: validation, the configure command, and the CLI report', async () => {
  assert.deepEqual(validateBranchesConfig(undefined), []);
  assert.deepEqual(validateBranchesConfig({ flow: ['dev', 'qc', 'prod'], hotfix: 'hotfix/*', remote: 'origin' }), []);
  assert.ok(validateBranchesConfig({ flow: ['dev'] }).length);
  assert.ok(validateBranchesConfig({ flow: ['dev', 'dev'] }).length);
  assert.ok(validateBranchesConfig({ flow: ['dev', '-x'] }).length);
  assert.ok(validateBranchesConfig({ flow: ['dev', 'qc'], hotfix: '../x' }).length);
  assert.ok(validateBranchesConfig({ flow: ['dev', 'qc'], extra: 1 }).length);

  const root = await scenario();
  const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: root, encoding: 'utf8' });
  const plain = run('branches', '--json');
  assert.equal(plain.status, 0, plain.stderr);
  assert.equal(JSON.parse(plain.stdout).schema, 'yallaflow.branches/1');
  assert.equal(run('init', '--name', 'b', '--type', 'greenfield').status, 0);
  const configured = run('branches', 'configure', '--flow', 'dev,qc,prod', '--hotfix', 'hotfix/*');
  assert.equal(configured.status, 0, configured.stderr);
  const config = JSON.parse(await readFile(path.join(root, '.yallaflow', 'config.yaml'), 'utf8'));
  assert.deepEqual(config.branches, { flow: ['dev', 'qc', 'prod'], hotfix: 'hotfix/*' });
  assert.match(run('branches').stdout, /Flow \(configured\): dev → qc → prod/);
  assert.notEqual(run('branches', 'configure', '--flow', 'dev').status, 0);
  assert.equal(run('branches', 'configure', '--clear').status, 0);
  assert.equal(JSON.parse(await readFile(path.join(root, '.yallaflow', 'config.yaml'), 'utf8')).branches, undefined);
  assert.equal(run('doctor').stdout.includes('branches'), false, 'a valid config passes doctor');
});

// Review fixes (PF-0186).
test('a repository filter is never run; a branch behind its upstream gives "Check first"; remote-only hotfix branches are seen', { skip: process.platform === 'win32' && 'shell-script filter' }, async () => {
  const root = await scenario();
  const marker = path.join(root, '..', `${path.basename(root)}-filter-ran`);
  const script = path.join(root, '..', `${path.basename(root)}-filter.sh`);
  await writeFile(script, `#!/bin/sh\ntouch '${marker}'\ncat\n`, { mode: 0o755 });
  git(root, 'config', 'filter.evil.clean', script);
  await writeFile(path.join(root, '.git', 'info', 'attributes'), '* filter=evil\n');
  const old = new Date('2020-01-01');
  await utimes(path.join(root, 'app.txt'), old, old);
  await analyzeBranches(root);
  await assert.rejects(lstat(marker), /ENOENT/, 'the clean filter did not run');

  const origin = await scenario();
  git(origin, 'branch', 'hotfix/remote-only', 'hotfix/login');
  const clone = await mkdtemp(path.join(os.tmpdir(), 'yf-branches-behind-'));
  git(clone, 'clone', '-q', origin, '.');
  git(clone, 'switch', '-q', 'qc');
  git(clone, 'switch', '-q', 'prod');
  git(origin, 'switch', '-q', 'qc');
  await write(origin, 'qc.txt', 'new on the remote\n');
  git(origin, 'add', '.');
  git(origin, 'commit', '-qm', 'qc moved on');
  git(clone, 'fetch', '-q');
  const report = await analyzeBranches(clone, { config: { flow: ['dev', 'qc', 'prod'], remote: 'origin' } });
  const devToQc = report.promotions[0];
  assert.equal(devToQc.status, 'check-first');
  assert.match(devToQc.summary, /your local qc is 1 commit\(s\) behind origin\/qc/);
  assert.ok(report.hotfixes.some((entry) => entry.name === 'origin/hotfix/remote-only'), JSON.stringify(report.hotfixes));
  assert.match(describeBranches(report).join('\n'), /Check first/);
});

test('a partial clone: Branch Health never asks the remote for missing objects', { skip: process.platform === 'win32' && 'shell-script upload-pack wrapper' }, async () => {
  const origin = await scenario();
  git(origin, 'config', 'uploadpack.allowFilter', 'true');
  const log = path.join(origin, '..', `${path.basename(origin)}-upload-pack.log`);
  const wrapper = path.join(origin, '..', `${path.basename(origin)}-upload-pack.sh`);
  await writeFile(wrapper, `#!/bin/sh\necho called >> '${log}'\nexec git-upload-pack "$@"\n`, { mode: 0o755 });
  const clone = await mkdtemp(path.join(os.tmpdir(), 'yf-branches-partial-'));
  git(clone, 'clone', '-q', '--filter=blob:none', '--no-checkout', '--upload-pack', wrapper, `file://${origin}`, '.');
  git(clone, 'config', 'remote.origin.uploadpack', wrapper);
  await rm(log, { force: true });
  const report = await analyzeBranches(clone, { config: { flow: ['dev', 'qc', 'prod'], remote: 'origin' } });
  assert.equal(report.available, true);
  await assert.rejects(lstat(log), /ENOENT/, 'upload-pack was not started: nothing was fetched');
  const text = describeBranches(report).join('\n');
  assert.doesNotMatch(text, /No production change is missing/, 'never an all-clear it could not check');
});
