import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { initWorkspace } from '../src/core/workspace.js';
import { detectCollisions } from '../src/core/collisions.js';
import { cli, git } from '../test-support/shared.js';

const work = (root, id, file = '') => path.join(root, '.yallaflow', 'work', id, file);
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));

// Two branches of one single-user workspace each allocate PF-0001. Merging B into A
// keeps A's meta.yaml and work.md (the conflicts are resolved in A's favour) and brings
// B's requirements.yaml in beside them — one directory, two work items.
async function collidedWorkspace({ withSource = false, bothSources = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-split-'));
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.email', 'dev@example.com']);
  git(root, ['config', 'user.name', 'Dev']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  await initWorkspace(root, 'demo', 'greenfield');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init']);

  git(root, ['checkout', '-q', '-b', 'b']);
  cli(root, ['feature', 'Invoice export', '--scope', 'bounded']);
  const requirements = path.join(root, 'requirements.json');
  await writeFile(requirements, JSON.stringify({
    requirements: [{ id: 'REQ-001', statement: 'Invoices export as CSV.', provenance: [{ type: 'request' }] }],
    acceptanceCriteria: [{ id: 'AC-001', requirement: 'REQ-001', statement: 'The CSV has one row per invoice.', provenance: [{ type: 'request' }] }]
  }));
  cli(root, ['requirement', 'record', 'PF-0001', '--file', requirements]);
  if (withSource) {
    const brief = path.join(root, 'export-brief.md');
    await writeFile(brief, '# Export brief\n\nOne CSV row per invoice.\n');
    cli(root, ['intake', 'add', 'PF-0001', brief]);
  }
  git(root, ['add', '.yallaflow']);
  git(root, ['commit', '-q', '-m', 'B: invoice export']);

  git(root, ['checkout', '-q', 'main']);
  git(root, ['checkout', '-q', '-b', 'a']);
  cli(root, ['bug', 'Login button misaligned', '--scope', 'bounded']);
  if (bothSources) {
    const screenshot = path.join(root, 'login-notes.txt');
    await writeFile(screenshot, 'The login button sits 4px too low on Safari.\n');
    cli(root, ['intake', 'add', 'PF-0001', screenshot]);
  }
  git(root, ['add', '.yallaflow']);
  git(root, ['commit', '-q', '-m', 'A: login button']);

  git(root, ['merge', '-q', 'b', '-m', 'merge b'], { ok: false });
  const conflicted = git(root, ['diff', '--name-only', '--diff-filter=U']).stdout.split('\n').filter(Boolean);
  if (conflicted.length) {
    git(root, ['checkout', '--ours', '--', ...conflicted]);
    git(root, ['add', '-A']);
    git(root, ['commit', '-q', '--no-edit']);
  }
  return root;
}

test('doctor names a work ID collision that a merge left in one directory', async () => {
  const root = await collidedWorkspace();
  assert.ok(await readFile(work(root, 'PF-0001', 'requirements.yaml'), 'utf8'), 'B\'s ledger was merged in beside A');
  assert.equal((await readJson(work(root, 'PF-0001', 'meta.yaml'))).title, 'Login button misaligned');

  const { collisions } = await detectCollisions(root, 'work');
  assert.equal(collisions.length, 1);
  assert.equal(collisions[0].id, 'PF-0001');
  assert.equal(collisions[0].current.title, 'Login button misaligned');
  assert.deepEqual(collisions[0].others.map((item) => item.title), ['Invoice export']);

  const doctor = cli(root, ['doctor'], false);
  assert.equal(doctor.status, 1);
  assert.match(doctor.stdout, /FAIL work ID collision: PF-0001 holds 2 work items .*"Invoice export".*yallaflow work split PF-0001/);
});

test('work split --dry-run previews the split and writes nothing', async () => {
  const root = await collidedWorkspace();
  const before = await readdir(path.join(root, '.yallaflow', 'work'));
  const result = cli(root, ['work', 'split', 'PF-0001', '--dry-run']);
  assert.match(result.stdout, /Stays as PF-0001: "Login button misaligned"/);
  assert.match(result.stdout, /Moves to a new ID: "Invoice export"/);
  assert.match(result.stdout, /Taken out of PF-0001 .*requirements\.yaml/);
  assert.match(result.stdout, /Preview only/);
  assert.deepEqual(await readdir(path.join(root, '.yallaflow', 'work')), before);
  assert.equal(git(root, ['status', '--porcelain']).stdout, '');
});

test('work split restores the other work item under a new ID and leaves a healthy workspace', async () => {
  const root = await collidedWorkspace();
  const result = cli(root, ['work', 'split', 'PF-0001']);
  assert.match(result.stdout, /Restored "Invoice export" as PF-0002/);

  const moved = await readJson(work(root, 'PF-0002', 'meta.yaml'));
  assert.equal(moved.id, 'PF-0002');
  assert.equal(moved.title, 'Invoice export');
  assert.equal(moved.renumberedFrom.id, 'PF-0001');
  assert.equal(moved.renumberedFrom.reason, 'work ID collision');
  assert.ok(moved.renumberedFrom.identity, 'records the moved item\'s createdAt');
  assert.match(await readFile(work(root, 'PF-0002', 'work.md'), 'utf8'), /^# PF-0002 — Invoice export[\s\S]*## Renumbered\n\n\*\*From:\*\* PF-0001/);
  assert.equal((await readJson(work(root, 'PF-0002', 'requirements.yaml'))).acceptanceCriteria[0].id, 'AC-001');

  const kept = await readdir(work(root, 'PF-0001'));
  assert.ok(!kept.includes('requirements.yaml'), 'the moved item\'s ledger left PF-0001');
  assert.equal((await readJson(work(root, 'PF-0001', 'meta.yaml'))).title, 'Login button misaligned');

  assert.deepEqual((await detectCollisions(root, 'work')).collisions, []);
  const doctor = cli(root, ['doctor'], false);
  assert.doesNotMatch(doctor.stdout, /work ID collision:/);
  assert.match(doctor.stdout, /PASS ID collisions \(none in Git history\)/);
  assert.equal(doctor.status, 0, doctor.stdout);
});

test('work split refuses, changing nothing, when a file matches neither work item', async () => {
  const root = await collidedWorkspace();
  const ledger = work(root, 'PF-0001', 'requirements.yaml');
  await writeFile(ledger, (await readFile(ledger, 'utf8')).replace('one row per invoice', 'one row per invoice line'));
  const before = await readdir(path.join(root, '.yallaflow', 'work'));
  const result = cli(root, ['work', 'split', 'PF-0001'], false);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /Cannot split: 1 item\(s\) in PF-0001 cannot be attributed to one side/);
  assert.match(result.stdout, /- requirements\.yaml/);
  assert.deepEqual(await readdir(path.join(root, '.yallaflow', 'work')), before);
});

test('work split refuses an ID without a collision', async () => {
  const root = await collidedWorkspace();
  cli(root, ['work', 'split', 'PF-0001']);
  const again = cli(root, ['work', 'split', 'PF-0001'], false);
  assert.notEqual(again.status, 0);
  assert.match(again.stderr, /holds a single work item in Git history/);
});

test('collisions are not checked without Git history', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-split-nogit-'));
  await initWorkspace(root, 'demo', 'greenfield');
  assert.deepEqual(await detectCollisions(root, 'work'), { available: false, collisions: [] });
});

test('work split links the moved item\'s sources to its new ID', async () => {
  const root = await collidedWorkspace({ withSource: true });
  const before = await readJson(path.join(root, '.yallaflow', 'sources', 'SRC-0001', 'source.json'));
  assert.deepEqual(before.linkedWork, ['PF-0001']);

  cli(root, ['work', 'split', 'PF-0001']);

  const after = await readJson(path.join(root, '.yallaflow', 'sources', 'SRC-0001', 'source.json'));
  assert.deepEqual(after.linkedWork, ['PF-0002'], 'the item that stayed never referenced the source');
  assert.deepEqual((await readJson(work(root, 'PF-0002', 'meta.yaml'))).sources.map((ref) => ref.id), ['SRC-0001']);
  const doctor = cli(root, ['doctor'], false);
  assert.equal(doctor.status, 0, doctor.stdout);
});

for (const order of [['source', 'work'], ['work', 'source']]) {
  test(`colliding sources and work items split cleanly (${order.join(' then ')})`, async () => {
    const root = await collidedWorkspace({ withSource: true, bothSources: true });
    const doctorBefore = cli(root, ['doctor'], false);
    assert.match(doctorBefore.stdout, /FAIL source ID collision: SRC-0001 holds 2 sources .*yallaflow source split SRC-0001/);

    for (const kind of order) cli(root, [kind, 'split', kind === 'work' ? 'PF-0001' : 'SRC-0001']);

    const kept = await readJson(path.join(root, '.yallaflow', 'sources', 'SRC-0001', 'source.json'));
    const moved = await readJson(path.join(root, '.yallaflow', 'sources', 'SRC-0002', 'source.json'));
    assert.equal(kept.sourceName, 'login-notes.txt');
    assert.equal(moved.sourceName, 'export-brief.md');
    assert.equal(moved.renumberedFrom.id, 'SRC-0001');
    assert.deepEqual(kept.linkedWork, ['PF-0001']);
    assert.deepEqual(moved.linkedWork, ['PF-0002']);
    assert.deepEqual((await readJson(work(root, 'PF-0002', 'meta.yaml'))).sources.map((ref) => ref.id), ['SRC-0002']);
    assert.deepEqual((await readJson(work(root, 'PF-0001', 'meta.yaml'))).sources.map((ref) => ref.id), ['SRC-0001']);
    assert.deepEqual((await readdir(path.join(root, '.yallaflow', 'sources', 'SRC-0001'))).sort(), ['login-notes.txt', 'source.json']);

    const doctor = cli(root, ['doctor'], false);
    assert.equal(doctor.status, 0, doctor.stdout);
  });
}
