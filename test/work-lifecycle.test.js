// v1.4.0 work lifecycle (PF-0041, owner decision SRC-0028): hold, resume, close without
// delivery, reopen of closed work. The lifecycle status is separate from the workflow
// stage; CLOSED is never DONE; the first hold/close raises the project's minimum version
// only after an explicit confirmation, atomically with the change.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createdWork, driveChangeToDone, freshProject, routedBoundedChange, run, writeJsonFile } from '../test-support/optional.js';
import { frozenCli } from '../test-support/shared.js';
import { closeWork, holdWork, reopenClosedWork, resumeWork } from '../src/core/lifecycle.js';

const ACCEPT = ['--accept-minimum-version', '1.4.0'];
const yf = (root) => path.join(root, '.yallaflow');
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const meta = (root, id) => readJson(path.join(yf(root), 'work', id, 'meta.yaml'));
const config = (root) => readJson(path.join(yf(root), 'config.yaml'));
const active = async (root) => (await readJson(path.join(yf(root), 'state', 'current.yaml'))).activeWork;

async function treeHash(dir, { skip = () => false } = {}) {
  const hash = createHash('sha256');
  async function walk(current) {
    for (const name of (await readdir(current)).sort()) {
      const full = path.join(current, name);
      const rel = path.relative(dir, full);
      if (skip(rel)) continue;
      if ((await stat(full)).isDirectory()) await walk(full);
      else hash.update(`${rel}\0`).update(await readFile(full));
    }
  }
  await walk(dir);
  return hash.digest('hex');
}

// A routed change past discovery, with a checkpoint, a requirement and a verification run.
async function itemWithProgress(root) {
  const id = routedBoundedChange(root, 'Add CSV export of orders');
  run(root, ['checkpoint', id, '--skill', 'context-discovery', '--complete', '--summary', 'ok']);
  run(root, ['verify', id, '--', process.execPath, '-e', 'process.exit(0)']);
  return id;
}

test('hold refuses without confirmation and changes nothing; with it, raises the minimum version and preserves everything; resume returns the same state', async () => {
  const root = await freshProject('yf-lifecycle-hold-');
  const id = await itemWithProgress(root);
  run(root, ['activate', id]);
  const workDir = path.join(yf(root), 'work', id);
  const before = await meta(root, id);
  const progressBefore = await readFile(path.join(workDir, 'progress.yaml'));
  const evidenceBefore = await treeHash(path.join(workDir, 'evidence'));
  const all = await treeHash(yf(root));

  const refused = run(root, ['work', 'hold', id, '--reason', 'Waiting for the client'], { ok: false });
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /require YallaFlow >= 1\.4\.0/);
  assert.match(refused.stderr, /--accept-minimum-version 1\.4\.0/);
  assert.match(refused.stderr, /No files were changed/);
  assert.equal(await treeHash(yf(root)), all, 'the refused operation changed nothing');

  run(root, ['work', 'hold', id, '--reason', 'Waiting for the client', ...ACCEPT]);
  assert.equal((await config(root)).yallaflow.minimumVersion, '1.4.0');
  const held = await meta(root, id);
  assert.equal(held.status, before.status, 'the stage is preserved');
  assert.equal(held.lifecycle.state, 'on_hold');
  assert.equal(await active(root), null, 'holding the active item clears the active focus');
  assert.deepEqual(await readFile(path.join(workDir, 'progress.yaml')), progressBefore, 'checkpoint ledger untouched');
  assert.equal(await treeHash(path.join(workDir, 'evidence')), evidenceBefore, 'evidence untouched');

  run(root, ['work', 'resume', id]);
  const resumed = await meta(root, id);
  assert.equal(resumed.status, before.status);
  assert.equal('lifecycle' in resumed, false, 'open again: no lifecycle block');
  const strip = ({ updatedAt, ...rest }) => rest;
  assert.deepEqual(strip(resumed), strip(before), 'resume returns the same record');
  assert.equal(await active(root), null, 'resume never activates');
  const ledger = await readJson(path.join(workDir, 'lifecycle.yaml'));
  assert.deepEqual(ledger.events.map((event) => [event.action, event.from, event.to, event.stage]), [['hold', 'open', 'on_hold', before.status], ['resume', 'on_hold', 'open', before.status]]);
  assert.match(await readFile(path.join(workDir, 'progress.md'), 'utf8'), /Lifecycle: hold .*stage .* unchanged/);
  // Once the project requires 1.4.0, nothing more is asked.
  run(root, ['work', 'hold', id, '--reason', 'Again']);
});

test('the central guard refuses progress on held and closed work and names the lifting command', async () => {
  const root = await freshProject('yf-lifecycle-guard-');
  const id = await itemWithProgress(root);
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yf-lifecycle-in-'));
  const attachment = await writeJsonFile(dir, 'note.json', { a: 1 });
  const requirements = await writeJsonFile(dir, 'req.json', { requirements: [{ id: 'REQ-001', statement: 'Export orders.', provenance: [{ type: 'request' }] }], acceptanceCriteria: [] });
  run(root, ['work', 'hold', id, '--reason', 'Paused', ...ACCEPT]);
  const attempts = [
    ['advance', id],
    ['checkpoint', id, '--skill', 'requirement-clarification', '--complete', '--summary', 'x'],
    ['checkpoint', 'revise', id, '--skill', 'context-discovery', '--status', 'in_progress', '--reason', 'x'],
    ['verify', id, '--', process.execPath, '-e', 'process.exit(0)'],
    ['activate', id],
    ['intake', 'add', id, attachment],
    ['question', 'add', id, '--text', 'Which format?'],
    ['requirement', 'record', id, '--file', requirements],
    ['request', 'revise', id, '--text', 'Something else', '--reason', 'x'],
    ['knowledge', 'review', id, '--none'],
    // Review finding H1: the id after an option, or as --opt=value, is still found.
    ['question', 'add', '--non-material', id, '--text', 'Flag first'],
    ['question', 'add', '--category=business', id, '--text', 'Equals form'],
    ['feedback', '--changes-requested', id, '--stage', 'specification'],
    ['knowledge', 'review', '--none', id],
    ['approve', `--stage=plan`, id],
    ['intake', 'add', '--reason=x', id, attachment]
  ];
  const all = await treeHash(yf(root), { skip: (rel) => rel.startsWith('local') });
  for (const args of attempts) {
    const result = run(root, args, { ok: false });
    assert.notEqual(result.status, 0, `${args.join(' ')} must be refused`);
    assert.match(result.stderr, new RegExp(`${id} is on hold`), args.join(' '));
    assert.match(result.stderr, new RegExp(`yallaflow work resume ${id}`), args.join(' '));
  }
  assert.equal(await treeHash(yf(root), { skip: (rel) => rel.startsWith('local') }), all, 'no refused command changed anything');
  // Read-only commands keep working.
  for (const args of [['status'], ['brief'], ['guide', id], ['work', 'show', id], ['snapshot', '--json']]) assert.equal(run(root, args, { ok: false }).status, 0, args.join(' '));
  assert.match(run(root, ['guide', id]).stdout, /NOT AUTHORIZED[\s\S]*work resume/);

  // finish and handoff say so instead of "still in progress".
  assert.match(run(root, ['finish', id], { ok: false }).stdout, new RegExp(`${id} is on hold[\\s\\S]*work resume ${id}`));
  assert.match(run(root, ['handoff', id]).stdout, /LIFECYCLE:[\s\S]*on hold/);
  run(root, ['work', 'close', id, '--outcome', 'cancelled', '--reason', 'Dropped']);
  const closed = run(root, ['advance', id], { ok: false });
  assert.match(closed.stderr, new RegExp(`${id} is closed as cancelled`));
  assert.match(closed.stderr, new RegExp(`yallaflow reopen ${id} --reason`));
});

test('close: outcomes, --by rules, never on DONE, never counted as done or delivered', async () => {
  const root = await freshProject('yf-lifecycle-close-');
  const a = routedBoundedChange(root, 'First idea');
  const b = routedBoundedChange(root, 'Second idea');
  const c = routedBoundedChange(root, 'Third idea');
  const done = routedBoundedChange(root, 'Delivered change');
  driveChangeToDone(root, done);

  assert.match(run(root, ['work', 'close', a, '--outcome', 'superseded', '--reason', 'x', ...ACCEPT], { ok: false }).stderr, /--by <work-id> is required/);
  assert.match(run(root, ['work', 'close', a, '--outcome', 'duplicate', '--by', a, '--reason', 'x', ...ACCEPT], { ok: false }).stderr, /by itself/);
  assert.match(run(root, ['work', 'close', a, '--outcome', 'cancelled', '--by', b, '--reason', 'x', ...ACCEPT], { ok: false }).stderr, /--by applies only/);
  assert.match(run(root, ['work', 'close', a, '--outcome', 'done', '--reason', 'x', ...ACCEPT], { ok: false }).stderr, /--outcome must be one of/);
  assert.match(run(root, ['work', 'close', done, '--outcome', 'cancelled', '--reason', 'x', ...ACCEPT], { ok: false }).stderr, /DONE; delivered work can't be closed/);
  assert.match(run(root, ['work', 'hold', done, '--reason', 'x', ...ACCEPT], { ok: false }).stderr, /DONE; finished work can't be put on hold/);

  run(root, ['work', 'close', a, '--outcome', 'cancelled', '--reason', 'Not needed', ...ACCEPT]);
  assert.match(run(root, ['work', 'close', b, '--outcome', 'superseded', '--by', a, '--reason', 'x'], { ok: false }).stderr, /itself closed without delivery/, 'never superseded by closed work');
  run(root, ['work', 'close', b, '--outcome', 'superseded', '--by', c, '--reason', 'Replaced']);
  assert.equal((await meta(root, b)).lifecycle.by, c);
  assert.match(run(root, ['work', 'close', a, '--outcome', 'cancelled', '--reason', 'again'], { ok: false }).stderr, /already closed/);

  const snapshot = JSON.parse(run(root, ['snapshot', '--json']).stdout);
  const byId = Object.fromEntries(snapshot.items.map((item) => [item.id, item]));
  assert.equal(byId[a].state, 'closed');
  assert.equal(byId[b].lifecycle.outcome, 'superseded');
  assert.equal(snapshot.counts.closed, 2);
  assert.equal(snapshot.counts.done, 1, 'closed work is never counted as done');
  assert.ok(byId[a].completion < 100 && byId[b].completion < 100);
  const counted = snapshot.items.filter((item) => item.state !== 'closed');
  assert.equal(snapshot.completion, Math.round(counted.reduce((sum, item) => sum + item.completion, 0) / counted.length), 'closed work is left out of project completion');
  assert.equal(byId[a].nextAction, `yallaflow reopen ${a} --reason "..."`);
  assert.equal(run(root, ['doctor'], { ok: false }).status, 0, run(root, ['doctor'], { ok: false }).stdout);
  assert.match(run(root, ['brief']).stdout, /2 closed without delivery/);
});

test('reopen: closed work returns to its preserved stage (audited, no --to); DONE reopen is unchanged', async () => {
  const root = await freshProject('yf-lifecycle-reopen-');
  const id = await itemWithProgress(root);
  const stage = (await meta(root, id)).status;
  assert.match(run(root, ['reopen', id, '--reason', 'x'], { ok: false }).stderr, /not DONE|--to must be one of/, 'an open item has nothing to reopen');
  run(root, ['work', 'close', id, '--outcome', 'cancelled', '--reason', 'Dropped', ...ACCEPT]);
  assert.match(run(root, ['reopen', id, '--to', 'implementation', '--reason', 'x'], { ok: false }).stderr, /--to does not apply/);
  assert.match(run(root, ['reopen', id], { ok: false }).stderr, /--reason is required/);
  run(root, ['reopen', id, '--reason', 'The client wants it after all']);
  const reopened = await meta(root, id);
  assert.equal(reopened.status, stage);
  assert.equal('lifecycle' in reopened, false);
  assert.deepEqual((await readJson(path.join(yf(root), 'work', id, 'lifecycle.yaml'))).events.map((event) => event.action), ['close', 'reopen']);
  run(root, ['advance', id], { ok: false }); // normal rules apply again (not a lifecycle refusal)
  assert.doesNotMatch(run(root, ['advance', id], { ok: false }).stderr, /is closed|is on hold/);

  const delivered = routedBoundedChange(root, 'Delivered change');
  driveChangeToDone(root, delivered);
  assert.match(run(root, ['reopen', delivered, '--to', 'implementation', '--reason', 'Bug found']).stdout, /DONE → /);
});

test('every write is all-or-nothing: an injected failure after each write leaves every file unchanged', async () => {
  const root = await freshProject('yf-lifecycle-atomic-');
  const id = await itemWithProgress(root);
  run(root, ['activate', id]);
  const all = await treeHash(yf(root));
  for (let failAfter = 0; failAfter < 5; failAfter++) {
    await assert.rejects(holdWork(root, id, { reason: 'x', acceptMinimumVersion: '1.4.0', failAfter }), { code: 'INJECTED' });
    assert.equal(await treeHash(yf(root)), all, `failure after ${failAfter} write(s) restored everything`);
    assert.equal((await config(root)).yallaflow, undefined, 'a failed operation never raises the minimum version');
  }
  await holdWork(root, id, { reason: 'x', acceptMinimumVersion: '1.4.0' });
  const held = await treeHash(yf(root));
  for (let failAfter = 0; failAfter < 3; failAfter++) {
    await assert.rejects(resumeWork(root, id, { failAfter }), { code: 'INJECTED' });
    assert.equal(await treeHash(yf(root)), held);
  }
  await resumeWork(root, id);
  await closeWork(root, id, { outcome: 'cancelled', reason: 'x' });
  const closed = await treeHash(yf(root));
  for (let failAfter = 0; failAfter < 3; failAfter++) {
    await assert.rejects(reopenClosedWork(root, id, { reason: 'x', failAfter }), { code: 'INJECTED' });
    assert.equal(await treeHash(yf(root)), closed);
  }
});

test('Shared Project: the shared policy is preserved and its minimum version is only raised, with the team warning', async () => {
  const root = await freshProject('yf-lifecycle-shared-');
  const { spawnSync } = await import('node:child_process');
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
  run(root, ['shared', 'enable']);
  const before = await config(root);
  assert.equal(before.shared.enabled, true);
  const id = createdWork(run(root, ['start', 'Shared change']).stdout);
  run(root, ['route', id, '--type', 'change', '--scope', 'bounded', '--confidence', 'high', '--reason', 'x']);
  const refused = run(root, ['work', 'hold', id, '--reason', 'x'], { ok: false });
  assert.match(refused.stderr, /Shared Project: the requirement reaches every teammate once this branch is merged/);
  assert.match(refused.stderr, new RegExp(`currently requires >= ${before.yallaflow.minimumVersion.replace(/[.-]/g, '\\$&')}`));
  run(root, ['work', 'hold', id, '--reason', 'x', ...ACCEPT]);
  const after = await config(root);
  assert.equal(after.yallaflow.minimumVersion, '1.4.0');
  assert.deepEqual(after.shared, before.shared, 'the shared policy is untouched');
  assert.equal(after.schemaVersion, before.schemaVersion);
});

test('old records: an existing workspace reads and progresses exactly as before (no lifecycle block, no minimum version)', async () => {
  const fixture = new URL('./fixtures/v1.0.0-agent/', import.meta.url);
  const root = await mkdtemp(path.join(os.tmpdir(), 'yf-lifecycle-old-'));
  if (existsSync(fixture)) await cp(fixture, root, { recursive: true });
  else run(root, ['init', '--type', 'greenfield', '--name', 'old']);
  if (!existsSync(path.join(root, '.yallaflow'))) run(root, ['init', '--type', 'greenfield', '--name', 'old']);
  const id = routedBoundedChange(root, 'Ordinary work');
  driveChangeToDone(root, id);
  const snapshot = JSON.parse(run(root, ['snapshot', '--json']).stdout);
  assert.ok(snapshot.items.every((item) => item.lifecycle === null), 'existing and new records have no lifecycle block');
  assert.equal((await config(root)).yallaflow?.minimumVersion, undefined, 'ordinary work never raises the minimum version');
  assert.equal(run(root, ['doctor'], { ok: false }).status, 0);
});

test('older CLIs read a project that requires 1.4.0 but refuse to change it', async (t) => {
  const older = await frozenCli('v1.1.0');
  if (!older) {
    if (process.env.CI) assert.fail('the v1.1.0 tag is required in CI (fetch tags)');
    return t.skip('v1.1.0 tag not available in this checkout');
  }
  const root = await freshProject('yf-lifecycle-older-');
  const id = await itemWithProgress(root);
  const other = routedBoundedChange(root, 'Other work');
  run(root, ['work', 'close', id, '--outcome', 'cancelled', '--reason', 'Dropped', ...ACCEPT]);
  const all = await treeHash(yf(root), { skip: (rel) => rel.startsWith('local') });
  for (const args of [['advance', other], ['advance', id], ['checkpoint', id, '--skill', 'implementation', '--complete', '--summary', 'x'], ['verify', id, '--', process.execPath, '-e', '0'], ['activate', id], ['start', 'More']]) {
    const result = older(root, args);
    assert.notEqual(result.status, 0, `v1.1.0 ${args.join(' ')} must be refused`);
    assert.match(result.stderr, /cannot be changed with this YallaFlow[\s\S]*requires: >= 1\.4\.0/);
  }
  assert.equal(await treeHash(yf(root), { skip: (rel) => rel.startsWith('local') }), all, 'the older CLI changed nothing');
  for (const args of [['status'], ['brief'], ['guide', other]]) assert.equal(older(root, args).status, 0, `v1.1.0 ${args.join(' ')} still reads`);
});

test('decomposition: held and closed children are never ready, and closed never counts as done', async () => {
  const { nextCommand } = await import('../src/commands/next.js');
  assert.equal(typeof nextCommand, 'function');
  const { childProgressView, readyChildren } = await import('../src/decomposition/store.js');
  assert.deepEqual(readyChildren([{ state: 'held' }, { state: 'closed' }, { state: 'ready', id: 'x' }]).map((child) => child.id), ['x']);
  assert.equal(typeof childProgressView, 'function');
});

test('the understanding baseline and legacy reconciliation are never held or closed (review finding H2/H3)', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yf-lifecycle-baseline-'));
  await writeFile(path.join(root, 'package.json'), '{"name":"x","dependencies":{"express":"4"}}');
  await writeFile(path.join(root, 'index.js'), 'console.log(1)\n');
  run(root, ['init', '--type', 'brownfield', '--name', 'brown']);
  const id = /PF-\d+/.exec(run(root, ['baseline', 'start']).stdout)[0];
  const all = await treeHash(yf(root));
  assert.match(run(root, ['work', 'hold', id, '--reason', 'x', ...ACCEPT], { ok: false }).stderr, /understanding baseline; it can't be put on hold or closed/);
  assert.match(run(root, ['work', 'close', id, '--outcome', 'cancelled', '--reason', 'x', ...ACCEPT], { ok: false }).stderr, /understanding baseline/);
  assert.equal(await treeHash(yf(root)), all);
});
