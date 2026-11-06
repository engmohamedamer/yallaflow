// v1.2.0 real-project acceptance: one invalid work item never hides a project, doctor
// names a probable merge-related ID collision, and an empty project is not a 0% board.
// Every read here leaves the workspace byte-for-byte unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { initWorkspace } from '../src/core/workspace.js';
import { startConsoleServer } from '../src/console/server.js';
import { loadSchema, validate } from '../test-support/schema.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const SNAPSHOT = loadSchema('snapshot-1.schema.json');
const run = (cwd, args) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });
const git = (cwd, args) => spawnSync('git', ['-c', 'user.email=t@e', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });
const created = (result) => /Created (PF-\d+)/.exec(result.stdout)[1];

async function hashTree(dir) {
  const hash = createHash('sha256');
  const walk = async (current) => {
    for (const entry of (await readdir(current, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else hash.update(full).update(await readFile(full));
    }
  };
  await walk(dir);
  return hash.digest('hex');
}

// Two branches each create PF-0001; the merge keeps the investigation's identity files and
// the change's progress ledger (the Vult PF-0091 shape).
async function mergedCollision() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yf-collide-'));
  git(root, ['init', '-q', '-b', 'main']);
  await initWorkspace(root, 'Vultish', 'greenfield', 'adaptive');
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'base']);
  git(root, ['checkout', '-qb', 'change-branch']);
  const a = created(run(root, ['change', 'Align split payment UI', '--scope', 'bounded']));
  run(root, ['advance', a]);
  run(root, ['checkpoint', a, '--skill', 'context-discovery', '--complete', '--summary', 'Read the split payment forms.']);
  run(root, ['advance', a]);
  run(root, ['checkpoint', a, '--skill', 'requirement-clarification', '--complete', '--summary', 'Rental-style rows.']);
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'change work']);
  git(root, ['checkout', '-q', 'main']);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const b = created(run(root, ['investigate', 'QC renewal of an expired subscription', '--scope', 'bounded']));
  assert.equal(a, b, 'both branches allocate the same plain ID');
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'investigation work']);
  git(root, ['merge', '-q', '--no-edit', 'change-branch']);
  const dir = `.yallaflow/work/${a}`;
  git(root, ['checkout', '--ours', '--', `${dir}/meta.yaml`, `${dir}/work.md`, `${dir}/progress.md`]);
  git(root, ['checkout', '--theirs', '--', `${dir}/progress.yaml`]);
  git(root, ['checkout', '--ours', '--', '.yallaflow/state/current.yaml']);
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'up']);
  const valid = created(run(root, ['change', 'Unrelated healthy work', '--scope', 'bounded']));
  return { root, broken: a, valid };
}

test('a merge-collided work item is listed as invalid and never hides the project', async () => {
  const { root, broken, valid } = await mergedCollision();
  const before = await hashTree(path.join(root, '.yallaflow'));

  const result = run(root, ['snapshot', '--json']);
  assert.equal(result.status, 0, result.stdout);
  const snapshot = JSON.parse(result.stdout);
  assert.deepEqual(validate(SNAPSHOT, snapshot), []);
  assert.deepEqual(snapshot.items.map((item) => item.id), [valid]);
  assert.equal(snapshot.invalid.length, 1);
  assert.equal(snapshot.invalid[0].id, broken);
  assert.equal(snapshot.invalid[0].code, 'WORK_ITEM_INVALID');
  assert.match(snapshot.invalid[0].message, /outside the Behavior Contract/);
  const counted = Object.values(snapshot.counts).reduce((sum, n) => sum + n, 0);
  assert.equal(counted, 1, 'the invalid item is not counted as open, done or proven');

  const show = run(root, ['work', 'show', broken, '--json']);
  assert.equal(show.status, 1);
  assert.equal(JSON.parse(show.stdout).error.code, 'WORK_ITEM_INVALID');

  const doctor = run(root, ['doctor']);
  assert.equal(doctor.status, 1);
  assert.match(doctor.stdout, /Probable work-ID collisions \(1\) — read-only diagnosis; nothing was changed/);
  assert.match(doctor.stdout, new RegExp(`${broken} — QC renewal`));
  assert.match(doctor.stdout, /records steps outside this item's contract \(requirement-clarification, /);
  assert.match(doctor.stdout, /predate the item's creation/);
  assert.match(doctor.stdout, /meta.yaml added in: \w+ .* investigation work/);
  assert.match(doctor.stdout, /progress.yaml added in: \w+ .* change work/);
  assert.match(doctor.stdout, /do not edit them by hand/);

  assert.equal(await hashTree(path.join(root, '.yallaflow')), before, 'snapshot, work show and doctor changed nothing');
});

test('the exact Vult message: a ledger pinned to another registry version', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yf-registry-'));
  await initWorkspace(root, 'Shop', 'greenfield', 'adaptive');
  const id = created(run(root, ['change', 'Copy fix', '--scope', 'bounded']));
  run(root, ['checkpoint', id, '--skill', 'context-discovery', '--start']);
  const file = path.join(root, '.yallaflow', 'work', id, 'progress.yaml');
  const ledger = JSON.parse(await readFile(file, 'utf8'));
  const pinned = ledger.behavior.registryVersion;
  ledger.behavior.registryVersion = pinned - 1;
  await writeFile(file, JSON.stringify(ledger, null, 2)); // the fixture's corruption, written by the test
  const snapshot = JSON.parse(run(root, ['snapshot', '--json']).stdout);
  assert.equal(snapshot.items.length, 0);
  assert.match(snapshot.invalid[0].message, new RegExp(`uses registry v${pinned - 1}, but its Behavior Contract uses registry v${pinned}`));
  assert.match(run(root, ['doctor']).stdout, new RegExp(`progress ledger uses registry v${pinned - 1}, but the pinned Behavior Contract uses v${pinned}`));
});

test('an unreadable meta.yaml is reported, not fatal', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yf-badmeta-'));
  await initWorkspace(root, 'Shop', 'greenfield', 'adaptive');
  const good = created(run(root, ['change', 'Copy fix', '--scope', 'bounded']));
  const bad = created(run(root, ['change', 'Other fix', '--scope', 'bounded']));
  await writeFile(path.join(root, '.yallaflow', 'work', bad, 'meta.yaml'), '{ not json');
  const snapshot = JSON.parse(run(root, ['snapshot', '--json']).stdout);
  assert.deepEqual(validate(SNAPSHOT, snapshot), []);
  assert.deepEqual(snapshot.items.map((item) => item.id), [good]);
  assert.deepEqual(snapshot.invalid.map((item) => item.id), [bad]);
  assert.equal(JSON.parse(run(root, ['work', 'show', good, '--json']).stdout).item.id, good, 'other items stay readable');
});

test('zero work items: no completion is claimed', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yf-empty-'));
  await initWorkspace(root, 'Fresh', 'greenfield', 'adaptive');
  const snapshot = JSON.parse(run(root, ['snapshot', '--json']).stdout);
  assert.deepEqual(validate(SNAPSHOT, snapshot), []);
  assert.deepEqual(snapshot.items, []);
  assert.deepEqual(snapshot.invalid, []);
  assert.equal(snapshot.openCompletion, null);
  run(root, ['start', 'Something new']);
  assert.equal(JSON.parse(run(root, ['snapshot', '--json']).stdout).openCompletion, 0, 'open work is measured on its own');
});

test('console: an invalid item is a data warning in a 200 snapshot, not a failed project', async () => {
  const { root, broken } = await mergedCollision();
  const server = await startConsoleServer({ roots: [root], port: 0 });
  try {
    const projects = await (await fetch(`${server.url}api/projects`, { headers: { Authorization: `Bearer ${server.token}` } })).json();
    const response = await fetch(`${server.url}api/p/${projects.projects[0].id}/snapshot`, { headers: { Authorization: `Bearer ${server.token}` } });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.invalid[0].id, broken);
    assert.equal(body.items.length, 1);
  } finally {
    await server.close();
  }
});

test('console UI: the theme button is matched by its own attribute, never by <html data-theme>', async () => {
  const app = await readFile(fileURLToPath(new URL('../resources/console/app.js', import.meta.url)), 'utf8');
  assert.match(app, /document\.documentElement\.dataset\.theme = theme/, 'the page stores the theme on <html data-theme>');
  // Every delegated click selector must not be an attribute the page puts on <html>/<body>.
  for (const [, list] of app.matchAll(/closest\('([^']+)'\)/g)) {
    assert.ok(!list.split(',').includes('[data-theme]'), `click selector list matches <html data-theme>: ${list}`);
  }
  assert.match(app, /data-theme-toggle aria-label="theme"/);
});
