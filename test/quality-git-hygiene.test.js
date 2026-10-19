// v1.1.0 Git hygiene for optional QC/demo (developer decision SRC-0010): generated
// artifacts — media (videos, screenshots, traces) and report.md/report.html — stay out
// of Git by default; qc.json/demo.json stay committed as the durable records. Nothing
// already tracked is ever untracked or deleted, and a clone without the local media is
// told so plainly.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readYaml, writeYaml } from '../src/core/yaml.js';
import { workspacePath } from '../src/core/workspace.js';
import { freshProject, routedBoundedChange, run, writeJsonFile } from '../test-support/optional.js';

const git = (cwd, args, ok = true) => {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (ok) assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  return result;
};

async function projectWithQualityRecords({ commitMedia = false } = {}) {
  const root = await freshProject('yallaflow-hygiene-');
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.email', 'dev@example.com']);
  git(root, ['config', 'user.name', 'Dev']);
  if (commitMedia) {
    const configFile = path.join(workspacePath(root), 'config.yaml');
    await writeYaml(configFile, { ...(await readYaml(configFile)), quality: { ...(await readYaml(configFile)).quality, media: { commit: true } } });
  }
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-hygiene-in-'));
  await writeFile(path.join(dir, 'booking.png'), 'PNG-SCREENSHOT');
  await writeFile(path.join(dir, 'trace.zip'), 'PK-TRACE');
  await writeFile(path.join(dir, 'demo.webm'), 'WEBM-VIDEO');
  const id = routedBoundedChange(root);
  run(root, ['qc', 'plan', id, '--file', await writeJsonFile(dir, 'plan.json', { scenarios: [{ id: 'S-01', kind: 'functional', title: 'Cancel a booking', rationale: 'Pilot flow.' }] })]);
  run(root, ['qc', 'record', id, '--file', await writeJsonFile(dir, 'r.json', { tool: 'playwright-cli', origin: 'agent-driven', scenarios: [{ id: 'S-01', status: 'passed', steps: ['Cancel', 'Dismiss dialog'], artifacts: [path.join(dir, 'booking.png'), path.join(dir, 'trace.zip')] }] })]);
  run(root, ['demo', 'propose', id, '--file', await writeJsonFile(dir, 'scope.json', { scenarios: [{ id: 'D-01', title: 'Cancel', audience: 'business', priority: 1, rationale: 'r', steps: ['s'], record: true }] })]);
  run(root, ['demo', 'approve', id, '--note', 'Approved by the developer: "yes"']);
  run(root, ['demo', 'record', id, '--file', await writeJsonFile(dir, 'd.json', { tool: 'playwright-cli', video: path.join(dir, 'demo.webm'), scenarios: [{ id: 'D-01', status: 'shown' }] })]);
  return { root, id, quality: `.yallaflow/work/${id}/quality` };
}

const wouldTrack = (root, dir) => git(root, ['add', '-A', '--dry-run', '--', dir]).stdout.trim().split('\n').filter(Boolean).map((line) => line.replace(/^add '(.*)'$/, '$1')).sort();
const mediaFiles = (root, quality) => git(root, ['ls-files', '--others', '--ignored', '--exclude-standard', '--', `${quality}/media`]).stdout.trim().split('\n').filter(Boolean);

test('by default only qc.json, demo.json and the ignore rule are committed; media and reports are ignored', async () => {
  const { root, quality } = await projectWithQualityRecords();
  assert.deepEqual(wouldTrack(root, quality), [`${quality}/.gitignore`, `${quality}/demo.json`, `${quality}/qc.json`]);
  const media = mediaFiles(root, quality);
  assert.equal(media.length, 3, 'screenshot, trace and video exist locally');
  for (const file of [...media, `${quality}/report.md`, `${quality}/report.html`]) {
    assert.equal(git(root, ['check-ignore', '-q', file], false).status, 0, `${file} is ignored`);
  }
  assert.ok(existsSync(path.join(root, quality, 'report.html')), 'the local report still exists on this machine');
  assert.equal(existsSync(path.join(root, quality, 'media', '.gitignore')), false, 'one rule file, at quality/');
});

test('the explicit opt-in commits media; reports stay local either way', async () => {
  const { root, quality } = await projectWithQualityRecords({ commitMedia: true });
  const tracked = wouldTrack(root, quality);
  assert.equal(tracked.filter((file) => file.includes('/media/')).length, 3, 'media is committed with quality.media.commit: true');
  assert.ok(!tracked.some((file) => /report\.(md|html)$/.test(file)), 'reports are never committed by default');
});

test('a fresh clone reports missing local media plainly and never claims a report or verified files it does not have', async () => {
  const { root, id, quality } = await projectWithQualityRecords();
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'QC and demo records']);
  const clone = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-hygiene-clone-'));
  git(clone, ['clone', '-q', root, '.']);
  assert.equal(existsSync(path.join(clone, quality, 'qc.json')), true, 'the durable record travels with the repository');
  assert.equal(existsSync(path.join(clone, quality, 'report.md')), false);
  const qc = run(clone, ['qc', 'status', id]).stdout;
  assert.match(qc, /S-01 \[functional, required\] Cancel a booking — passed in QC-001/, 'recorded results remain visible');
  assert.match(qc, /Local media: 0 of 2 recorded file\(s\) are on this machine\. The others are not here \(media is local-only by default \(not committed\)\): their results and hashes are recorded in the ledger, but the files cannot be viewed or re-verified on this machine\./);
  assert.match(qc, /No local report on this machine \(reports are generated locally and not committed\)/);
  assert.doesNotMatch(qc, /^Report: /m);
  assert.match(run(clone, ['demo', 'status', id]).stdout, /Local media: 0 of 1 recorded file\(s\)/);
  const doctor = run(clone, ['doctor']);
  assert.equal(doctor.status, 0);
  assert.doesNotMatch(doctor.stdout, /SHA-256|still tracked/, 'missing local media is not an integrity problem and is never reported as verified');
  // On the original machine everything is present.
  assert.match(run(root, ['qc', 'status', id]).stdout, /Local media: 2 of 2 recorded file\(s\) are on this machine\.\n/);
});

test('files a pre-release build already committed stay tracked and on disk; doctor names the one-time command', async () => {
  const { root, id, quality } = await projectWithQualityRecords();
  // What a pre-release 1.1.0 build left behind: reports committed, no quality/.gitignore.
  const ignoreFile = path.join(root, quality, '.gitignore');
  const rule = await readFile(ignoreFile, 'utf8');
  await writeFile(ignoreFile, '');
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'pre-release layout']);
  await writeFile(ignoreFile, rule);
  const trackedBefore = git(root, ['ls-files', '--', quality]).stdout;
  assert.match(trackedBefore, /report\.md/);
  run(root, ['qc', 'record', id, '--file', await writeJsonFile(await mkdtemp(path.join(os.tmpdir(), 'yallaflow-hygiene-in-')), 'r.json', { tool: 'playwright-cli', origin: 'agent-driven', scenarios: [{ id: 'S-01', status: 'blocked', reason: 'Server down.' }] })]);
  assert.match(git(root, ['ls-files', '--', quality]).stdout, /report\.md/, 'never untracked automatically');
  assert.ok(existsSync(path.join(root, quality, 'report.md')), 'never deleted');
  const doctor = run(root, ['doctor']);
  assert.equal(doctor.status, 0);
  const hint = new RegExp(`WARN ${id}: generated QC/demo files are still tracked by Git .*To stop tracking them, run once: (git rm -r --cached -- .*) \\(local files are kept\\)`).exec(doctor.stdout);
  assert.ok(hint, doctor.stdout);
  // The printed command is valid as printed, and keeps the local files.
  const rm = spawnSync('bash', ['-c', hint[1]], { cwd: root, encoding: 'utf8' });
  assert.equal(rm.status, 0, rm.stderr);
  assert.ok(existsSync(path.join(root, quality, 'report.md')), 'local files are kept');
  assert.doesNotMatch(run(root, ['doctor']).stdout, /still tracked/);
  assert.match(doctor.stdout, /they stay tracked until you untrack them \(Git ignore rules do not apply to tracked files/);
  assert.doesNotMatch(run(root, ['brief']).stdout, /still tracked/, 'session start stays lightweight (no Git scan of quality files)');
});

test('a project\'s own quality/.gitignore is never overwritten', async () => {
  const root = await freshProject('yallaflow-hygiene-');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-hygiene-in-'));
  const id = routedBoundedChange(root);
  const custom = '# team rule\nreport.html\n';
  const qualityDir = path.join(workspacePath(root), 'work', id, 'quality');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(qualityDir, { recursive: true });
  await writeFile(path.join(qualityDir, '.gitignore'), custom);
  run(root, ['qc', 'plan', id, '--file', await writeJsonFile(dir, 'plan.json', { scenarios: [{ id: 'S-01', kind: 'functional', title: 'x', rationale: 'y' }] })]);
  assert.equal(await readFile(path.join(qualityDir, '.gitignore'), 'utf8'), custom);
});

test('the managed ignore rule follows quality.media.commit when it changes, in both directions', async () => {
  const { root, id, quality } = await projectWithQualityRecords();
  const configFile = path.join(workspacePath(root), 'config.yaml');
  const setCommit = async (commit) => writeYaml(configFile, { ...(await readYaml(configFile)), quality: { ...(await readYaml(configFile)).quality, media: { commit } } });
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-hygiene-in-'));
  await writeFile(path.join(dir, 'later.png'), 'LATER');
  const record = async () => run(root, ['qc', 'record', id, '--file', await writeJsonFile(dir, `r-${Date.now()}.json`, { tool: 'playwright-cli', origin: 'agent-driven', scenarios: [{ id: 'S-01', status: 'passed', steps: ['again'], artifacts: [path.join(dir, 'later.png')] }] })]);
  await setCommit(true);
  await record();
  assert.ok(wouldTrack(root, quality).some((file) => file.includes('/media/')), 'an opt-in made after earlier records takes effect');
  assert.ok(!wouldTrack(root, quality).some((file) => /report\.(md|html)$/.test(file)));
  await setCommit(false);
  await record();
  assert.ok(!wouldTrack(root, quality).some((file) => file.includes('/media/')), 'opting back out ignores media again');
});

test('the git rm hint never lists untracked paths or opted-in media', async () => {
  const root = await freshProject('yallaflow-hygiene-');
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.email', 'dev@example.com']);
  git(root, ['config', 'user.name', 'Dev']);
  const configFile = path.join(workspacePath(root), 'config.yaml');
  await writeYaml(configFile, { ...(await readYaml(configFile)), quality: { ...(await readYaml(configFile)).quality, media: { commit: true } } });
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-hygiene-in-'));
  await writeFile(path.join(dir, 'shot.png'), 'SHOT');
  const id = routedBoundedChange(root);
  const quality = `.yallaflow/work/${id}/quality`;
  run(root, ['qc', 'plan', id, '--file', await writeJsonFile(dir, 'plan.json', { scenarios: [{ id: 'S-01', kind: 'functional', title: 'x', rationale: 'y' }] })]);
  run(root, ['qc', 'record', id, '--file', await writeJsonFile(dir, 'r.json', { tool: 'playwright-cli', origin: 'agent-driven', scenarios: [{ id: 'S-01', status: 'passed', steps: ['a'], artifacts: [path.join(dir, 'shot.png')] }] })]);
  git(root, ['add', '-A']);
  git(root, ['add', '-f', `${quality}/report.md`]); // only one report tracked, as an older build might leave
  git(root, ['commit', '-qm', 'records']);
  const doctor = run(root, ['doctor']).stdout;
  const hint = /run once: (git rm -r --cached -- .*) \(local files are kept\)/.exec(doctor);
  assert.ok(hint, doctor);
  assert.equal(hint[1], `git rm -r --cached -- ${quality}/report.md`, 'exactly the tracked generated file; opted-in media is not listed');
  const rm = spawnSync('bash', ['-c', hint[1]], { cwd: root, encoding: 'utf8' });
  assert.equal(rm.status, 0, rm.stderr);
  assert.ok(git(root, ['ls-files', '--', `${quality}/media`]).stdout.trim(), 'opted-in media stays tracked');
});

test('with the opt-in, a pre-release media/.gitignore that still hides media is reported', async () => {
  const { LEGACY_MEDIA_GITIGNORE_HEADER } = await import('../src/quality/constants.js');
  const { root, id, quality } = await projectWithQualityRecords({ commitMedia: true });
  await writeFile(path.join(root, quality, 'media', '.gitignore'), `${LEGACY_MEDIA_GITIGNORE_HEADER}\n*\n!.gitignore\n`);
  assert.match(run(root, ['doctor']).stdout, new RegExp(`WARN ${id}: quality\\.media\\.commit is true, but .*media/\\.gitignore \\(written by a pre-release build\\) still ignores all media`));
});

test('outputs state media availability precisely', async () => {
  const { root, id, quality } = await projectWithQualityRecords();
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-hygiene-in-'));
  await writeFile(path.join(dir, 'x.png'), 'X');
  const out = run(root, ['qc', 'record', id, '--file', await writeJsonFile(dir, 'r.json', { tool: 'playwright-cli', origin: 'agent-driven', scenarios: [{ id: 'S-01', status: 'passed', steps: ['a'], artifacts: [path.join(dir, 'x.png')] }] })]).stdout;
  const folder = /stored with hashes under (\S+)\//.exec(out)[1];
  assert.match(folder, /media\/QC-002-[0-9a-f]{6}$/);
  assert.ok(existsSync(path.join(root, folder)), 'the printed folder exists');
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'records']);
  const clone = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-hygiene-clone-'));
  git(clone, ['clone', '-q', root, '.']);
  for (const step of ['context-discovery', 'requirement-clarification', 'implementation-planning']) run(clone, ['checkpoint', id, '--skill', step, '--complete', '--summary', 'ok']);
  for (let i = 0; i < 6; i++) run(clone, ['advance', id], { ok: false });
  run(clone, ['checkpoint', id, '--skill', 'implementation', '--complete', '--summary', 'done']);
  run(clone, ['advance', id]);
  run(clone, ['verify', id, '--', process.execPath, '-e', 'process.exit(0)']);
  run(clone, ['checkpoint', id, '--skill', 'verification', '--complete', '--summary', 'ok']);
  run(clone, ['knowledge', 'review', id, '--none']);
  run(clone, ['advance', id]);
  const finish = run(clone, ['finish', id]).stdout;
  assert.match(finish, /with a recorded video that is not on this machine/);
  assert.ok(existsSync(path.join(root, quality, 'media')), 'on the original machine the media is present');
});

test('a CRLF checkout of the managed rule is not rewritten', async () => {
  const { ensureQualityGitignore } = await import('../src/quality/artifacts.js');
  const { qualityGitignore } = await import('../src/quality/constants.js');
  const root = await freshProject('yallaflow-hygiene-');
  const id = routedBoundedChange(root);
  const dir = path.join(workspacePath(root), 'work', id, 'quality');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(dir, { recursive: true });
  const crlf = qualityGitignore().replace(/\n/g, '\r\n');
  await writeFile(path.join(dir, '.gitignore'), crlf);
  assert.equal(await ensureQualityGitignore(root, id), false);
  assert.equal(await readFile(path.join(dir, '.gitignore'), 'utf8'), crlf);
});
