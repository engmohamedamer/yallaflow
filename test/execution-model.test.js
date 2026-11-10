// PF-0112 M0: the execution model's transitions (pure) and the execution store.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EXECUTION_SCHEMA, afterRestart, applySignal, isLive, newRun, newTask, nextTask, ownerOf, runState, updateTask } from '../src/execution/model.js';
import { executionDir, loadRuns, saveRuns } from '../src/execution/store.js';

const NOW = '2026-11-10T10:00:00.000Z';
const task = (overrides = {}) => ({ ...newTask({ id: 't-aaaaaa', workId: 'PF-0001', provider: 'codex', now: NOW }), ...overrides });
const step = (current, ...signals) => signals.reduce((value, signal) => applySignal(value, typeof signal === 'string' ? { type: signal } : signal, NOW), current);

test('model: a task becomes done only when the item is DONE and the session ended with every process gone (D7)', () => {
  const working = step(task(), 'claim', 'started');
  assert.equal(working.state, 'working');
  assert.equal(working.attempt, 1);
  const doneItem = step(working, 'item-done');
  assert.equal(doneItem.state, 'working', 'DONE alone is not completion');
  assert.equal(step(doneItem, { type: 'session-ended', cleanup: { complete: true } }).state, 'done');
  assert.equal(step(working, { type: 'session-ended', cleanup: { complete: true } }, 'item-done').state, 'done', 'either order');
  const leftovers = step(doneItem, { type: 'session-ended', cleanup: { complete: false, survivors: [123] } });
  assert.equal(leftovers.state, 'failed');
  assert.equal(leftovers.reason, 'cleanup', 'an incomplete cleanup blocks instead of completing');
  const early = step(working, { type: 'session-ended', cleanup: { complete: true } });
  assert.equal(early.state, 'paused', 'a session that ends before DONE waits for the developer');
});

test('model: approvals, reviews, questions and replies block; nothing in the model answers them', () => {
  const working = step(task(), 'claim', 'started');
  assert.deepEqual([step(working, 'permission').state, step(working, 'permission').reason], ['needs-you', 'approval']);
  assert.equal(step(working, 'permission', { type: 'permission-resolved', pending: 1 }).state, 'needs-you', 'still one open');
  assert.equal(step(working, 'permission', { type: 'permission-resolved', pending: 0 }).state, 'working');
  assert.deepEqual([step(working, 'review').state, step(working, 'review').reason], ['needs-you', 'review']);
  assert.deepEqual([step(working, 'question').state, step(working, 'question').reason], ['needs-you', 'question']);
  assert.deepEqual([step(working, 'turn-ended').state, step(working, 'turn-ended').reason], ['needs-you', 'reply']);
  assert.equal(step(working, 'turn-ended', 'turn-started').state, 'working');
  assert.equal(step(working, 'item-done', 'turn-ended').state, 'working', 'an idle agent after DONE is not waiting for a reply');
});

test('model: usage limits pause, crashes fail, held or closed items are skipped', () => {
  const working = step(task(), 'claim', 'started');
  const limited = step(working, { type: 'usage-limit', retryAt: '10:35 PM' });
  assert.deepEqual([limited.state, limited.reason, limited.retryAt], ['paused', 'usage-limit', '10:35 PM']);
  assert.equal(step(working, 'crashed').state, 'failed');
  assert.equal(step(working, { type: 'lifecycle', state: 'on_hold' }).state, 'skipped');
  assert.equal(step(step(working, 'crashed'), 'item-done').state, 'failed', 'a final state stays final');
});

test('model: a restart interrupts live tasks and starts nothing; a claim is write-ahead with an attempt count', () => {
  const live = step(task(), 'claim');
  const queued = task({ id: 't-bbbbbb', workId: 'PF-0002' });
  const run = newRun({ id: 'r-aaaaaa', mode: 'queue', laneRoot: '/repo', tasks: [live, queued], now: NOW });
  const restarted = afterRestart(run, NOW);
  assert.deepEqual(restarted.lanes[0].tasks.map((entry) => entry.state), ['interrupted', 'queued']);
  assert.equal(runState(restarted), 'paused');
  assert.equal(nextTask(restarted.lanes[0]), null, 'an interrupted task blocks the lane until the developer acts');
  assert.equal(step(live, 'claim').attempt, 1, 'a second claim of a starting task does nothing');
  assert.equal(step(restarted.lanes[0].tasks[0], 'claim').attempt, 2, 'resuming an interrupted task is a new attempt');
});

test('model: one live task per lane; ownership is unique across runs (FR4); final states stay final', () => {
  const a = step(task(), 'claim', 'started');
  const b = task({ id: 't-bbbbbb', workId: 'PF-0002' });
  const run = newRun({ id: 'r-aaaaaa', mode: 'queue', laneRoot: '/repo', tasks: [a, b], now: NOW });
  assert.equal(nextTask(run.lanes[0]), null);
  assert.equal(ownerOf([run], 'PF-0001').task.id, a.id);
  assert.equal(ownerOf([run], 'PF-0009'), null);
  const finished = updateTask(run, a.id, (current) => step(current, 'item-done', { type: 'session-ended', cleanup: { complete: true } }), NOW);
  assert.equal(nextTask(finished.lanes[0]).id, b.id);
  assert.equal(ownerOf([finished], 'PF-0001'), null, 'a done task no longer owns its item');
  assert.equal(isLive(step(task(), 'cancel', 'claim')), false, 'a cancelled task is never claimed again');
  assert.throws(() => newTask({ id: 'bad', workId: 'PF-1', provider: 'codex', now: NOW }));
  assert.throws(() => newTask({ id: 't-aaaaaa', workId: 'PF-1', now: NOW }), /provider/);
  assert.throws(() => newTask({ id: 't-aaaaaa', workId: '../x', provider: 'codex', now: NOW }));
  assert.throws(() => newRun({ id: 'r-aaaaaa', mode: 'sideways', laneRoot: '/r', tasks: [], now: NOW }));
});

test('store: atomic save and load; a missing store is empty; an unreadable store is reported and never overwritten', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yf-exec-store-'));
  await mkdir(path.join(root, '.yallaflow'), { recursive: true });
  assert.deepEqual(await loadRuns(root), { state: 'empty', runs: [] });
  const run = newRun({ id: 'r-aaaaaa', mode: 'now', laneRoot: root, tasks: [task()], now: NOW });
  await saveRuns(root, [run]);
  const loaded = await loadRuns(root);
  assert.equal(loaded.state, 'ok');
  assert.deepEqual(loaded.runs, [run]);
  assert.equal(JSON.parse(await readFile(path.join(executionDir(root), 'runs.json'), 'utf8')).schema, EXECUTION_SCHEMA);
  assert.equal(await readFile(path.join(root, '.yallaflow', 'local', '.gitignore'), 'utf8'), '*\n', 'personal runtime state stays out of Git');
  await writeFile(path.join(executionDir(root), 'runs.json'), '{ half written');
  const broken = await loadRuns(root);
  assert.equal(broken.state, 'unreadable');
  assert.match(broken.error, /not valid JSON/);
  await writeFile(path.join(executionDir(root), 'runs.json'), JSON.stringify({ schema: 'other/9', runs: [] }));
  assert.equal((await loadRuns(root)).state, 'unreadable');
});

test('store: a symbolic link in place of the execution folder is refused', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yf-exec-link-'));
  const elsewhere = await mkdtemp(path.join(os.tmpdir(), 'yf-exec-elsewhere-'));
  await mkdir(path.join(root, '.yallaflow', 'local'), { recursive: true });
  await writeFile(path.join(root, '.yallaflow', 'local', '.gitignore'), '*\n');
  await symlink(elsewhere, path.join(root, '.yallaflow', 'local', 'execution'));
  await assert.rejects(saveRuns(root, []));
});

test('permission scope: Codex tool calls name their files and command; paths inside the checkout become relative; sizes are bounded', async () => {
  const { toolScope } = await import('../src/agents/codex.js');
  const { permissionScope } = await import('../src/agents/bridge.js');
  // The shape real codex-acp 2.5.0 sent for an edit (M0 experiment): an absolute path.
  const scope = toolScope({ locations: [{ path: '/repo/notes/probe.txt' }], content: [{ type: 'diff', path: '/repo/src/a.js' }], rawInput: { command: ['npm', 'test'] } });
  assert.deepEqual(scope, { paths: ['/repo/notes/probe.txt', '/repo/src/a.js'], command: 'npm test' });
  assert.deepEqual(permissionScope(scope, '/repo'), { paths: ['notes/probe.txt', 'src/a.js'], command: 'npm test' });
  assert.deepEqual(permissionScope({ paths: ['/elsewhere/x'] }, '/repo'), { paths: ['/elsewhere/x'] }, 'outside the checkout stays absolute');
  assert.deepEqual(toolScope({}), {});
  assert.deepEqual(permissionScope({ paths: [42, '', 'a'], command: '   ' }), { paths: ['a'] });
  // Review L9: what does not fit is counted and shown, never silently dropped; argv quoting stays.
  const many = permissionScope({ paths: Array.from({ length: 80 }, (_, i) => `f${i}`), command: `${'a '.repeat(2500)}rm -rf ~` });
  assert.equal(many.paths.length, 50);
  assert.equal(many.morePaths, 30);
  assert.equal(many.command.length, 4000);
  assert.equal(many.commandCut, 5008 - 4000);
  assert.equal(toolScope({ rawInput: { command: ['bash', '-lc', 'rm -rf x'] } }).command, 'bash -lc "rm -rf x"');
});

test('D15: approval wait per project — 5/15/30/60 minutes, default 5 for existing projects, other values refused, a committed file ignored, an expired request DENIED', async () => {
  const { spawnSync } = await import('node:child_process');
  const { chmod } = await import('node:fs/promises');
  const settings = await import('../src/agents/settings.js');
  const { AgentBridge } = await import('../src/agents/bridge.js');
  const root = await mkdtemp(path.join(os.tmpdir(), 'yf-approval-wait-'));
  spawnSync('git', ['init', '-q'], { cwd: root });
  await mkdir(path.join(root, '.yallaflow'), { recursive: true });
  assert.deepEqual(await settings.readApprovalWait(root), { minutes: 5, saved: false }, 'an existing project keeps today’s 5 minutes');
  for (const minutes of [15, 30, 60, 5]) assert.equal((await settings.writeApprovalWait(root, minutes)).minutes, minutes);
  await assert.rejects(settings.writeApprovalWait(root, 90), /Choose 5, 15, 30, 60/);
  await assert.rejects(settings.writeApprovalWait(root, 0), /Choose/);
  await settings.writeApprovalWait(root, 30);
  assert.deepEqual(await settings.readApprovalWait(root), { minutes: 30, saved: true });
  const file = path.join(root, '.yallaflow', 'local', 'approval.json');
  await writeFile(file, JSON.stringify({ schemaVersion: 1, minutes: 60 }));
  await chmod(file, 0o644);
  assert.match((await settings.readApprovalWait(root)).error, /readable by others/, 'a file YallaFlow did not write (e.g. from a checkout) is ignored');
  assert.equal((await settings.readApprovalWait(root)).minutes, 5);
  const bridge = new AgentBridge({ projects: [{ id: 'aaaaaaaaaa', root, name: 'P' }], broadcast: () => {}, env: {} });
  const project = bridge.project('aaaaaaaaaa');
  assert.equal(bridge.timeoutFor(project), 5 * 60_000);
  bridge.setApprovalWait('aaaaaaaaaa', 30);
  assert.equal(bridge.timeoutFor(project), 30 * 60_000);
  bridge.setApprovalWait('aaaaaaaaaa', 7);
  assert.equal(bridge.timeoutFor(project), 5 * 60_000, 'an unknown value falls back to the default');
  const overridden = new AgentBridge({ projects: [{ id: 'bbbbbbbbbb', root, name: 'Q' }], broadcast: () => {}, env: { YALLAFLOW_AGENT_PERMISSION_TIMEOUT_MS: '400' } });
  overridden.setApprovalWait('bbbbbbbbbb', 60);
  assert.equal(overridden.timeoutFor(overridden.project('bbbbbbbbbb')), 400, 'an explicit override wins');
  project.approvalWaitMs = 30; // a very short wait, to see expiry without waiting minutes
  const keepAlive = setInterval(() => {}, 10); // the bridge's timer is unref'd; keep this test's loop running
  const decision = await bridge.askPermission(project, { title: 'Edit files', kind: 'edit', allow: ['allow'], provider: 'codex' });
  clearInterval(keepAlive);
  assert.equal(decision, 'deny', 'an expired request is denied, never approved');
  assert.ok(project.events.some((event) => event.type === 'permission.resolved' && event.decision === 'deny' && event.by === 'timeout'));
});

test('PF-0115: item-done is applied once; a DONE item whose session stays open is not rewritten on every snapshot', async () => {
  const { applySignal, newTask } = await import('../src/execution/model.js');
  let task = applySignal(applySignal(newTask({ id: 't-aaaaaa', workId: 'PF-0001', provider: 'claude', now: 't0' }), { type: 'claim' }, 't1'), { type: 'started' }, 't2');
  const first = applySignal(task, { type: 'item-done' }, 't3');
  assert.equal(first.itemDone, true);
  assert.equal(applySignal(first, { type: 'item-done' }, 't4'), first, 'the same object: nothing to save, no change event');
  assert.equal(applySignal(first, { type: 'session-ended', cleanup: { complete: true } }, 't5').state, 'done');
});
