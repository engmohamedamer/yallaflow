// PF-0140: the first hour with an existing project, as the owner walked it. One open step at
// a time; "Review the draft" shows the draft; one approval control per service; and a stack
// already running outside YallaFlow reads as running, with Start off and the reason in words.
// Evaluated from the shipped app.js with minimal stand-ins, like the other console UI tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { initWorkspace } from '../src/core/workspace.js';
import { collectWorkDetail } from '../src/flow/snapshot.js';
import { startBaseline, draftBaseline, approveBaseline } from '../src/baseline/store.js';
import { computeReadiness } from '../src/console/readiness.js';
import { BASELINE_FACTS, cli, writeTeamApp } from '../test-support/shared.js';

const app = await readFile(new URL('../resources/console/app.js', import.meta.url), 'utf8');
const cut = (from, to) => { const start = app.indexOf(from); assert.ok(start >= 0, from); const end = app.indexOf(to, start); assert.ok(end > start, to); return app.slice(start, end); };
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const base = () => ({ A: (_ar, en) => en, L: (v) => (typeof v === 'string' ? v : v.en), esc, fwd: () => '→', encodeURIComponent, JSON, Object, Set, Boolean, Math, pid: 'p1', readOnly: false, agentsOn: true, sxOpen: (_key, dflt = false) => (dflt ? 'open' : '') });

// ---- the draft is on the baseline's page ----
test('work detail carries the baseline draft once it is drafted, and only for a baseline', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yf-first-run-'));
  await writeTeamApp(root);
  await initWorkspace(root, 'Shop', 'brownfield', 'adaptive');
  const { meta } = await startBaseline(root);
  assert.equal((await collectWorkDetail(root, meta.id)).baseline, undefined, 'no draft yet');
  cli(root, ['checkpoint', meta.id, '--skill', 'repository-baseline', '--complete', '--summary', 'Repository discovery complete.']);
  await draftBaseline(root, meta.id, { facts: BASELINE_FACTS, limitations: [{ type: 'not-inspected', area: 'database', summary: 'The production database was not inspected.', reason: 'No access.' }] });
  let { baseline } = await collectWorkDetail(root, meta.id);
  assert.equal(baseline.status, 'draft');
  assert.equal(baseline.facts.length, BASELINE_FACTS.length);
  assert.deepEqual({ ...baseline.facts[0] }, { id: 'BF-001', area: 'project', status: 'confirmed', source: 'repository', summary: BASELINE_FACTS[0].summary, evidence: ['package.json'], note: null });
  assert.equal(baseline.limitations.length, 1);
  assert.equal(baseline.limitations[0].summary, 'The production database was not inspected.');
  await approveBaseline(root, meta.id, 'Approved by the maintainer.');
  ({ baseline } = await collectWorkDetail(root, meta.id));
  assert.equal(baseline.status, 'approved');
});

function draftUi(over = {}) {
  const context = vm.createContext({ ...base(), ...over });
  vm.runInContext(`${cut('  const BASELINE_AREA = {', '  // ---------- item ----------')}\nthis.draft = baselineDraft;`, context);
  return context.draft;
}
const DRAFT = {
  status: 'draft',
  facts: [
    { id: 'BF-001', area: 'project', status: 'confirmed', summary: 'A personal <expense> ledger.', evidence: ['README.md', 'routes/web.php'], note: null },
    { id: 'BF-002', area: 'business-rule', status: 'inferred', summary: 'Totals are monthly.', evidence: ['app/Report.php'], note: 'From one query.' },
    { id: 'BF-003', area: 'project', status: 'unresolved', summary: 'Single-user or hosted is not stated.', evidence: ['README.md'], note: null }
  ],
  limitations: [{ id: 'L-001', summary: 'Tests were not run.', reason: 'Read-only discovery.' }]
};

test('Review the draft shows the facts by area, what is unresolved and what was not inspected', () => {
  const it = { id: 'PF-0001', waitingFor: { kind: 'baseline' } };
  const html = draftUi()(it, { baseline: DRAFT });
  assert.match(html, /data-baseline-draft="draft"/);
  assert.match(html, /Project understanding draft <span class="muted">\(3\)<\/span>/);
  assert.match(html, /1 confirmed[\s\S]*1 inferred[\s\S]*1 unresolved[\s\S]*1 not inspected/);
  assert.equal((html.match(/data-baseline-fact=/g) ?? []).length, 3, 'every fact is on the page');
  assert.match(html, /A personal &lt;expense&gt; ledger\./, 'agent-written text is escaped');
  assert.match(html, /<details class="bdarea" data-sx="bd:PF-0001:project" open><summary><b>Purpose<\/b> <span class="tiny muted">2<\/span>/);
  assert.match(html, /<b>Business rules<\/b>[\s\S]*Totals are monthly\.[\s\S]*From one query\.[\s\S]*app\/Report\.php/);
  assert.match(html, /What the agent could not inspect[\s\S]*Tests were not run\.[\s\S]*Read-only discovery\./);
  assert.match(html, /data-chat-item="PF-0001">Done reviewing: approve or request changes in the chat</, 'the decision stays a message to the agent');
  assert.doesNotMatch(html, /data-agent-say|data-gate=/, 'the page itself never approves');
});

test('the draft panel: nothing without a draft, no decision when read-only, folded once approved', () => {
  const it = { id: 'PF-0001', waitingFor: { kind: 'baseline' } };
  assert.equal(draftUi()(it, { baseline: undefined }), '');
  assert.equal(draftUi()(it, null), '');
  assert.doesNotMatch(draftUi({ readOnly: true })(it, { baseline: DRAFT }), /data-chat-item/);
  assert.doesNotMatch(draftUi({ agentsOn: false })(it, { baseline: DRAFT }), /data-chat-item/);
  const approved = draftUi()({ id: 'PF-0001', waitingFor: null }, { baseline: { ...DRAFT, status: 'approved' } });
  assert.match(approved, /Approved project understanding/);
  assert.doesNotMatch(approved, /<details[^>]* open>/, 'approved knowledge is folded');
  assert.doesNotMatch(approved, /data-chat-item/);
  assert.match(app, /\$\{actionBar\(it\)\}\$\{baselineDraft\(it, d\)\}/, 'rendered on the item page, under the next step');
});

// ---- one open step at a time ----
function readyUi(steps, level) {
  const context = vm.createContext({ ...base(), readiness: { pid: 'p1', data: { level, steps, allows: { agentSessions: true } } }, agentChooser: () => '' });
  vm.runInContext(`${cut('  const READY_TEXT = {', '  // PF-0133: choose the project')}\n${cut('  function readinessAction(st) {', '  // PF-0123: the New gate')}\nthis.card = readinessCard;`, context);
  return context.card;
}
const STEP = { init: { id: 'initialized', status: 'done' }, agent: { id: 'agent', status: 'done', provider: 'codex' }, review: { id: 'understanding', status: 'awaiting-review', baselineId: 'PF-0001' }, understood: { id: 'understanding', status: 'done' }, run: { id: 'runtime', optional: true, status: 'not-configured' } };

test('while a required step is open, the optional run step is not offered beside it', () => {
  const html = readyUi([STEP.init, STEP.agent, STEP.review, STEP.run], 'incomplete')();
  assert.match(html, /href="#\/item\/PF-0001">Review the draft</);
  assert.doesNotMatch(html, /data-run-next|Get the app running|Run the app from here/);
  assert.equal((html.match(/class="btn sm/g) ?? []).length, 1, 'exactly one action');
});

test('once nothing required is left, the Overview card offers running the app, marked optional once', () => {
  const card = readyUi([STEP.init, STEP.agent, STEP.understood, STEP.run], 'ready');
  assert.equal(card(), '', 'the Workspace strip is gone when the project is ready');
  const html = card({ always: true });
  assert.match(html, /Run the app from here <span class="tiny muted">· optional<\/span>/);
  assert.equal((html.match(/optional/g) ?? []).length, 1);
  assert.match(html, /data-run-next="not-configured">Get the app running</);
});

test('readiness counts a stack running outside YallaFlow as running', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yf-first-run-ready-'));
  await initWorkspace(root, 'Shop', 'greenfield', 'adaptive');
  const runtimeStep = async (services) => (await computeReadiness(root, { agent: { checked: true, enabled: true, ready: true }, runtime: { supported: true, services } })).steps.find((step) => step.id === 'runtime');
  assert.equal((await runtimeStep([{ id: 'app', state: 'stopped', runningOutside: ['shop-app-1'] }])).status, 'done');
  assert.equal((await runtimeStep([{ id: 'app', state: 'stopped', runningOutside: null }])).status, 'stopped');
});

// ---- the Run tab ----
function runUi({ services, bulk = [], setupMsg = null, readOnly = false } = {}) {
  const context = vm.createContext({
    ...base(), readOnly, setupBusy: null, setupMsg, runtimeBusy: {}, runtimeLogs: {}, runtimeReview: {}, runtimeErr: {}, failedTail: {},
    runtime: { pid: 'p1', data: { services } }, route: () => ({ v: 'run' }), bulkable: () => services.filter((sv) => bulk.includes(sv.id)),
    reviewPanel: () => '', sharedConfirm: () => '', openLinks: () => ''
  });
  vm.runInContext(`${cut('  const RT_STATE = {', '  // ---------- Analyze → Review and save')}\n${cut('  // PF-0140: up, but not started by YallaFlow', '  // ---------- agent setup on this machine')}\nthis.card = serviceCard; this.section = runSection;`, context);
  return context;
}
const service = (extra = {}) => ({ id: 'app', name: 'Expense ledger', state: 'stopped', definitionHash: 'sha256:app', trust: { trusted: true }, ports: [{ port: 8000, listening: true }], unmanagedPorts: [8000], runningOutside: ['lalaff-app-1'], command: ['docker', 'compose', 'up'], cwd: '.', env: [], overridden: [], stopSignal: 'SIGTERM', stopTimeoutSeconds: 10, ...extra });

test('a trusted service already running outside YallaFlow reads as running, with Start off and why', () => {
  const ui = runUi({ services: [service()] });
  const card = ui.card(service());
  assert.match(card, /data-svc-state="outside"><i><\/i>running outside YallaFlow</);
  assert.doesNotMatch(card, />stopped</, 'never shown as stopped');
  assert.match(card, /data-rt="start" data-id="app" disabled title="Already running outside YallaFlow, so there is nothing to start\.">Start</);
  assert.match(card, /data-outside>Already running outside YallaFlow: <span class="ltr">lalaff-app-1<\/span>\. Open the app from its links\./);
  assert.doesNotMatch(card, /This port is held by a process YallaFlow did not start/, 'its own stack holding the port is not a warning');

  const section = ui.section({ services: [service()] });
  assert.match(section, /<h2>The app is running outside YallaFlow<\/h2>/);
  assert.match(section, /data-rt-all="start" disabled title="Already running outside YallaFlow">/);
  assert.match(section, /so there is nothing to start here: open it from "Open quickly"/);
  assert.match(section, /data-rt-all="stop" disabled/, 'nothing YallaFlow started, so nothing to stop');
});

test('a stopped trusted service keeps Start; a foreign port is still warned about', () => {
  const stopped = service({ runningOutside: null });
  const ui = runUi({ services: [stopped] });
  const card = ui.card(stopped);
  assert.match(card, /data-svc-state="stopped"><i><\/i>stopped</);
  assert.match(card, /data-rt="start" data-id="app"  >Start</);
  assert.match(card, /This port is held by a process YallaFlow did not start/);
  const section = ui.section({ services: [stopped] });
  assert.match(section, /<h2>The project is stopped<\/h2>/);
  assert.match(section, /data-rt-all="start"  >/);
  // One of two outside, one startable: Start project stays on.
  const mixed = [service(), service({ id: 'queue', name: 'Queue', runningOutside: null, unmanagedPorts: [], ports: [] })];
  assert.match(runUi({ services: mixed }).section({ services: mixed }), /data-rt-all="start"  >/);
});

test('a service waiting in the approval card has no second Review and trust on its row', () => {
  const waiting = service({ trust: { trusted: false, reason: 'new' } });
  const inCard = runUi({ services: [waiting], bulk: ['app'] }).card(waiting);
  assert.doesNotMatch(inCard, /data-rt-review=/);
  assert.match(inCard, /data-in-approve-card>Approve it in the card above</);
  assert.match(inCard, /waits for your approval/);
  const own = runUi({ services: [waiting] }).card(waiting);
  assert.match(own, /data-rt-review="app" >Review and trust</, 'a shared or blocked service keeps its own review');
  const approving = runUi({ services: [waiting], bulk: ['app'] }).section({ services: [waiting] }, '', { approving: true });
  assert.match(approving, /Approving in the card above only records the commands; it starts nothing\./);
});

// ---- the approval card ----
const flow = cut('  // ---------- PF-0136: one guided path on the Run tab', '  function viewRun() {');
function approveUi(services) {
  const calls = { post: [], started: 0 };
  const context = vm.createContext({
    ...base(), when: (iso) => String(iso), Promise, Error, setupBusy: null, setupMsg: null, planAwaitAgent: null, route: () => ({ v: 'run' }), render: () => {},
    runtime: { pid: 'p1', data: { services } }, runtimePlan: null, planPick: new Set(), currentPlanView: () => 'scan', confChip: () => '', suggestionNote: (x) => x,
    api: async () => ({ review: { definitionHash: 'sha256:app', effective: { command: ['docker', 'compose', 'up'], folder: '/p', cwd: '.', profile: '.yallaflow/runtime.yaml', env: [], ports: [8000] }, covered: ['compose.yaml'], notCovered: [], blocking: [], shared: null } }),
    post: async (url) => { calls.post.push(url); return {}; },
    setupDo: async (kind, fn) => { context.setupBusy = kind; context.setupMsg = null; try { await fn(); } catch (e) { context.setupMsg = { tone: 'fail', html: e.message }; } context.setupBusy = null; },
    runProject: async () => { calls.started += 1; }, savePlan: async () => {}, autoPickPlan: () => {}
  });
  vm.runInContext(`${flow}\nthis.fx = { loadBulkReviews, runApprove, approveAll };`, context);
  return { context, calls, fx: context.fx };
}

test('approving a stack that already runs outside YallaFlow is one action that starts nothing', async () => {
  const services = [service({ trust: { trusted: false, reason: 'new' } })];
  const w = approveUi(services);
  await w.fx.loadBulkReviews();
  const card = w.fx.runApprove({ services });
  assert.match(card, /data-approve-outside>The app already runs outside YallaFlow, so approving starts nothing/);
  assert.match(card, /data-run-approve="only" >✓ Approve the commands</);
  assert.doesNotMatch(card, /data-run-approve="start"/);
  await w.fx.approveAll(false);
  assert.equal(w.calls.post.length, 1);
  assert.equal(w.calls.started, 0);
  assert.match(w.context.setupMsg.html, /Your approval is recorded for 1 service\. Nothing was started\./);
});

test('a stopped service keeps Approve and start, and starting reports through Start project', async () => {
  const services = [service({ trust: { trusted: false, reason: 'new' }, runningOutside: null })];
  const w = approveUi(services);
  await w.fx.loadBulkReviews();
  const card = w.fx.runApprove({ services });
  assert.match(card, /data-run-approve="start" >▶ Approve and start the app</);
  assert.match(card, /data-run-approve="only" >Approve without starting</);
  await w.fx.approveAll(true);
  assert.equal(w.calls.started, 1);
  assert.equal(w.context.setupMsg, null, 'Start project writes the outcome');
});
