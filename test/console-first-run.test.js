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
const base = () => ({ A: (_ar, en) => en, L: (v) => (typeof v === 'string' ? v : v.en), esc, fwd: () => '→', encodeURIComponent, JSON, Object, Set, Boolean, Math, pid: 'p1', readOnly: false, agentsOn: true, firstRequest: () => null, firstRequestKey: (id) => `first-request:${id}`, store: { get: (_k, d) => d, set() {} }, sxOpen: (_key, dflt = false) => (dflt ? 'open' : '') });

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
  const context = vm.createContext({ ...base(), newRequestId: () => 'req-00000001', ...over });
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
  // PF-0147: the decision is made here, with a note and an explicit tick (test/console-baseline-decision.test.js).
  assert.match(html, /data-baseline-form data-baseline-item="PF-0001"/);
  assert.match(html, /data-baseline-decide="approve" disabled>Approve understanding</, 'nothing is decided without the note and the tick');
  assert.match(html, /data-chat-item="PF-0001">Or discuss it with the agent</);
  assert.doesNotMatch(html, /data-agent-say|data-gate=/);
});

test('the draft panel: nothing without a draft, no decision when read-only, folded once approved', () => {
  const it = { id: 'PF-0001', waitingFor: { kind: 'baseline' } };
  assert.equal(draftUi()(it, { baseline: undefined }), '');
  assert.equal(draftUi()(it, null), '');
  assert.doesNotMatch(draftUi({ readOnly: true })(it, { baseline: DRAFT }), /data-chat-item|data-baseline-form/);
  const noAgents = draftUi({ agentsOn: false })(it, { baseline: DRAFT });
  assert.doesNotMatch(noAgents, /data-chat-item/);
  assert.match(noAgents, /data-baseline-form/, 'PF-0147: the decision no longer needs an agent chat');
  const approved = draftUi()({ id: 'PF-0001', waitingFor: null }, { baseline: { ...DRAFT, status: 'approved' } });
  assert.match(approved, /Approved project understanding/);
  assert.doesNotMatch(approved, /<details[^>]* open>/, 'approved knowledge is folded');
  assert.doesNotMatch(approved, /data-chat-item|data-baseline-form/);
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
    reviewPanel: () => '', sharedConfirm: () => '', openLinks: () => '',
    // PF-0177: a system that runs services (Linux); the Windows wording is in console-run-windows.test.js.
    runtimeCaps: () => ({ platform: 'linux', lifecycle: true, compose: true, gracefulStop: true, verified: true })
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
  assert.doesNotMatch(section, /data-rt-all="stop"/, 'nothing YallaFlow started, so Stop is not offered');
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

// PF-0144: the highlighted action follows the state, and only applicable actions are offered.
test('the project control follows the state: Start when stopped, Stop when running, both when partly up', () => {
  const svc = (id, state) => service({ id, name: id, state, runningOutside: null, unmanagedPorts: [], ports: [] });
  const section = (services, setupBusy = null) => { const ui = runUi({ services }); ui.setupBusy = setupBusy; return ui.section({ services }); };

  const stopped = section([svc('app', 'stopped')]);
  assert.match(stopped, /class="btn go big" data-rt-all="start"  >▶ Start project</);
  assert.doesNotMatch(stopped, /data-rt-all="stop"/, 'nothing runs, so Stop is not offered');

  const running = section([svc('app', 'running'), svc('queue', 'running')]);
  assert.match(running, /<h2>The project is running<\/h2>/);
  assert.match(running, /class="btn stop big" data-rt-all="stop" >■ Stop project</, 'Stop is the highlighted action');
  assert.doesNotMatch(running, /data-rt-all="start"/, 'everything runs, so Start is not offered');

  const partly = section([svc('app', 'running'), svc('queue', 'stopped')]);
  assert.match(partly, /class="btn go big" data-rt-all="start"  >▶ Start the rest</);
  assert.match(partly, /class="btn  big" data-rt-all="stop" >■ Stop project</, 'Stop stays available, not highlighted');

  const starting = section([svc('app', 'stopped')], 'start');
  assert.match(starting, /data-rt-all="start" disabled >Starting…</);
  assert.doesNotMatch(starting, /data-rt-all="stop"/);
  const stopping = section([svc('app', 'running')], 'stop');
  assert.match(stopping, /data-rt-all="stop" disabled>Stopping…</);
  assert.doesNotMatch(stopping, /data-rt-all="start"/);
});

test('a service row offers one Start or Stop that follows its state; Restart only while it runs', () => {
  const svc = (state) => service({ state, runningOutside: null, unmanagedPorts: [], ports: [] });
  const card = (state) => runUi({ services: [svc(state)] }).card(svc(state));

  const stopped = card('stopped');
  assert.match(stopped, /class="btn sm" data-rt="start" data-id="app"  >Start</, 'Start is not the filled button');
  assert.doesNotMatch(stopped, /data-rt="stop"|data-rt="restart"/);

  const running = card('running');
  assert.match(running, /class="btn sm " data-rt="stop" data-id="app" >Stop</);
  assert.match(running, /class="btn sm ghost" data-rt="restart" data-id="app" >Restart</);
  assert.doesNotMatch(running, /data-rt="start"/);

  // An unmanaged record keeps a quiet Stop beside Start: stopping is how it is cleared.
  const unknown = card('unknown');
  assert.match(unknown, /data-rt="start" data-id="app"  >Start</);
  assert.match(unknown, /class="btn sm ghost" data-rt="stop" data-id="app" >Stop</);
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

// ---- PF-0149: the first request travels with the understanding ask ----
test('the understanding ask carries the first request, and it is forgotten once understanding is under way', () => {
  const required = { id: 'understanding', status: 'required' };
  const stored = [];
  const ui = (steps, over = {}) => { const context = vm.createContext({ ...base(), readiness: { pid: 'p1', data: { level: 'incomplete', steps, allows: { agentSessions: true } } }, agentChooser: () => '', firstRequest: () => 'Add online "payment"', store: { get: (_k, d) => d, set: (key, value) => stored.push([key, value]) }, ...over }); vm.runInContext(`${cut('  const READY_TEXT = {', '  // PF-0133: choose the project')}\n${cut('  function readinessAction(st) {', '  // PF-0123: the New gate')}\nthis.card = readinessCard;`, context); return context.card(); };
  const html = ui([STEP.init, STEP.agent, required]);
  assert.match(html, /data-ready-chat="Establish project understanding for this repository, then show it to me for approval\. My first request after that: &quot;Add online &quot;payment&quot;&quot;\."/);
  assert.equal(stored.length, 0, 'kept while it has not been asked yet');
  assert.doesNotMatch(ui([STEP.init, STEP.agent, required], { firstRequest: () => null }), /My first request/);
  // without agents the same ask is offered to copy
  assert.match(ui([STEP.init, { id: 'agent', status: 'off' }, required], { agentsOn: false, agentsCanEnable: false }), /data-copy="Establish project understanding[^"]*My first request after that/);
  ui([STEP.init, STEP.agent, { id: 'understanding', status: 'in-progress', baselineId: 'PF-0001' }]);
  assert.deepEqual(stored, [['first-request:p1', null]], 'the agent has it as the baseline objective now');
});

// ---- PF-0150: the readiness line says where the understanding stands ----
test('the understanding line shows its step, facts so far, last activity and whether an agent is working', () => {
  const ui = (st, over = {}) => { const context = vm.createContext({ ...base(), ago: () => '2 min ago', agent: null, agentsCanEnable: false, readiness: { pid: 'p1', data: { level: 'incomplete', steps: [STEP.init, STEP.agent, st], allows: { agentSessions: true } } }, agentChooser: () => '', ...over }); vm.runInContext(`${cut('  const READY_TEXT = {', '  // PF-0133: choose the project')}\n${cut('  function readinessAction(st) {', '  // PF-0123: the New gate')}\nthis.card = readinessCard;`, context); return context.card(); };
  const reading = { id: 'understanding', status: 'in-progress', baselineId: 'PF-0001', progress: { step: 'discovery', facts: 0, unresolved: 0, notInspected: 0, lastActivityAt: '2026-11-15T10:00:00Z' } };
  const idle = ui(reading);
  assert.match(idle, /data-understanding-progress="discovery">The agent is reading the project · last activity 2 min ago · <span class="warn">No agent is working on this right now\.<\/span>/);
  assert.match(idle, />Continue with the agent</, 'recovery is the existing action');
  assert.match(ui(reading, { agent: { pid: 'p1', session: { status: 'working' } } }), /<span class="">An agent is working now\.<\/span>/);
  assert.match(ui(reading, { agent: { pid: 'other', session: { status: 'working' } } }), /No agent is working on this right now/, 'another project\'s agent does not count');
  const drafting = ui({ ...reading, progress: { ...reading.progress, step: 'changes-requested', facts: 12, unresolved: 2, notInspected: 3 } });
  assert.match(drafting, /The agent is revising the draft after your changes · 12 facts recorded, 2 not settled · 3 areas not inspected · last activity/);
  const waiting = ui({ id: 'understanding', status: 'awaiting-review', baselineId: 'PF-0001', progress: { step: 'awaiting-review', facts: 1, unresolved: 0, notInspected: 1, lastActivityAt: null } });
  assert.match(waiting, /data-understanding-progress="awaiting-review">The draft is ready for your review · 1 fact recorded · 1 area not inspected<\/p>/);
  assert.doesNotMatch(waiting, /agent is working|No agent/);
  assert.match(waiting, /approve it or request changes on its page, or in the chat with your agent/);
  assert.doesNotMatch(ui({ id: 'understanding', status: 'required' }), /data-understanding-progress/, 'nothing started: no detail line');
  const ar = ui(reading, { A: (arText) => arText, L: (v) => (typeof v === 'string' ? v : v.ar) });
  assert.match(ar, /الوكيل يقرأ المشروع · آخر نشاط 2 min ago · <span class="warn">لا يعمل عليها أي وكيل الآن\./);
});

// ---- PF-0152: the brief comes first; every line opens the facts it rests on ----
const BRIEFED = {
  ...DRAFT,
  digest: 'd'.repeat(64),
  gaps: { notInspected: 1, unresolved: 1, coverageDeclared: true },
  coverage: { inspected: ['README.md', 'routes/'], sampled: ['app/'] },
  brief: {
    summary: { text: 'A personal <expense> ledger.', facts: ['BF-001'] },
    capabilities: [{ text: 'Shows monthly totals.', facts: ['BF-002'] }],
    worthKnowing: [{ text: 'Hosting is not known.', facts: ['BF-003'] }, { text: 'Tests were not run.', facts: [], limitations: ['L-001'] }]
  }
};
test('the review shows the brief first, with citations, an inferred tag, honest coverage, and the fact list folded beneath', () => {
  const it = { id: 'PF-0001', waitingFor: { kind: 'baseline' } };
  const ui = (over = {}) => draftUi({ projectOverview: { pid: 'p1', data: { stack: { entries: [{ kind: 'framework', component: 'Laravel', declared: '^11.0' }, { kind: 'database', component: 'SQLite' }, { kind: 'language', component: 'PHP' }] } } }, ...over })(it, { baseline: BRIEFED });
  const html = ui();
  assert.ok(html.indexOf('data-brief>') < html.indexOf('data-brief-all'), 'the brief is above the facts');
  assert.match(html, /class="briefsum"><span class="grow" dir="auto">A personal &lt;expense&gt; ledger\.<\/span>/, 'agent text is escaped');
  assert.match(html, /<button type="button" class="briefref ltr" data-brief-fact="BF-001"/);
  assert.match(html, /<h4>What it does today<\/h4>[\s\S]*Shows monthly totals\.<\/span><span class="chip wait tiny"[^>]*>inferred<\/span>/, 'a line resting only on inferred facts says so');
  assert.match(html, /<h4>Worth knowing<\/h4>[\s\S]*Hosting is not known\.[\s\S]*Tests were not run\.[\s\S]*<span class="briefref ltr off">L-001<\/span>/);
  assert.match(html, /Built with:<\/span> <span class="ltr">Laravel 11 · SQLite<\/span>/, 'technologies come from the project files');
  assert.match(html, /data-brief-coverage>2 areas read directly · 1 sampled · <b>1 not inspected<\/b>/);
  assert.match(html, /<details class="bdall" data-brief-all data-sx="bd:PF-0001:all" ><summary><b>All 3 facts with their evidence<\/b>/, 'folded until asked for');
  assert.equal((html.match(/data-baseline-fact=/g) ?? []).length, 3, 'every fact is still on the page');
  assert.equal((html.match(/data-brief-wrong=/g) ?? []).length, 4, 'each line can start a change request');
  assert.match(html, /data-baseline-form/);
  // not waiting for a decision, or read-only: no "Not right?"
  assert.doesNotMatch(draftUi({ projectOverview: null })({ id: 'PF-0001', waitingFor: null }, { baseline: { ...BRIEFED, status: 'approved' } }), /data-brief-wrong|data-baseline-form/);
  assert.doesNotMatch(draftUi({ readOnly: true, projectOverview: null })(it, { baseline: BRIEFED }), /data-brief-wrong/);
  // undeclared coverage is said, not hidden
  assert.match(draftUi({ projectOverview: null })(it, { baseline: { ...BRIEFED, coverage: null, gaps: { ...BRIEFED.gaps, coverageDeclared: false } } }), /data-brief-coverage>The agent did not declare what it read\./);
  // Arabic
  const ar = ui({ A: (arText) => arText, L: (v) => (typeof v === 'string' ? v : v.ar) });
  assert.match(ar, /<h4>ما يفعله اليوم<\/h4>/);
  assert.match(ar, /كل المعلومات مع أدلتها \(3\)/);
  assert.match(ar, />مستنتج</);
});

test('a draft without a brief looks exactly as before', () => {
  const it = { id: 'PF-0001', waitingFor: { kind: 'baseline' } };
  const html = draftUi({ projectOverview: null })(it, { baseline: DRAFT });
  assert.doesNotMatch(html, /data-brief>|data-brief-all|briefref/);
  assert.match(html, /<details class="bdarea" data-sx="bd:PF-0001:project" open>/);
});

test('the page opens a cited fact and starts a change request from a line', () => {
  assert.match(app, /const ref = e\.target\.closest\?\.\('\[data-brief-fact\]'\);/);
  assert.match(app, /if \(node\.tagName === 'DETAILS'\) node\.open = true;/);
  assert.match(app, /const quote = A\(`«\$\{wrong\.dataset\.briefWrong\}» غير صحيح: `, `"\$\{wrong\.dataset\.briefWrong\}" is not right: `\);/);
});

test('on the Overview the brief cites project-memory facts and marks lines whose facts need care', () => {
  const context = vm.createContext({ ...base(), projectOverview: null });
  vm.runInContext(`${cut('  const BRIEF_TITLE = {', '  // PF-0147: approve the project understanding')}\nthis.block = briefBlock;`, context);
  const html = context.block({ summary: { text: 'A clinic app.', facts: ['CTX-0001'], care: 'may-be-stale' }, users: [{ text: 'Staff.', facts: ['CTX-0002'], care: 'disputed' }], capabilities: [], components: [], worthKnowing: [{ text: 'Deployment was not looked at.', facts: [], limitations: 1 }] }, { factAttr: (id) => `data-overview-fact="${id}"`, coverage: { declared: true, inspected: 1, sampled: 0, notInspected: 2 } });
  assert.match(html, /A clinic app\.<\/span><span class="chip wait tiny"[^>]*>may be out of date<\/span><span class="briefrefs"><button type="button" class="briefref ltr" data-overview-fact="CTX-0001"/);
  assert.match(html, /Staff\.<\/span><span class="chip you tiny">disputed<\/span>/);
  assert.match(html, /Deployment was not looked at\.[\s\S]*from the discovery limits/);
  assert.match(html, /1 area read directly · 0 sampled · <b>2 not inspected<\/b>/);
  assert.doesNotMatch(html, /data-brief-wrong|inferred/);
  assert.equal(context.block({ users: [], capabilities: [] }), '', 'nothing to show: nothing rendered');
  assert.match(app, /const briefCard = ob \? `<section class="panel ovbrief" data-overview-brief>/);
  assert.match(app, /\$\{notEstablished\}\$\{briefCard\}\$\{summary\}/, 'above the existing cards, on the existing page');
});

// ---- PF-0153: suggested first tasks ----
function tasksUi({ firstTasks, items = [{ id: 'PF-0001', title: 'Repository Baseline' }], lang = 'en', blocked = null, readOnly = false } = {}) {
  const context = vm.createContext({ ...base(), A: (ar, en) => (lang === 'ar' ? ar : en), readOnly, projectOverview: { pid: 'p1', data: { firstTasks } }, items: () => items, createBlockedReason: () => blocked });
  vm.runInContext(`${cut('  const sameTask = ', '  // PF-0147: approve the project understanding')}\nthis.panel = firstTasksPanel;`, context);
  return context.panel;
}
const FIRST = { baselineId: 'PF-0001', request: 'Add online payment', suggestions: [
  { title: 'Find out which database production uses', why: 'It could not be established.', type: 'investigation', facts: ['CTX-0003'] },
  { title: 'Document the deployment', why: 'Deployment scripts were not read.', type: null, facts: [], limitations: 1, care: 'may-be-stale' }
] };

test('Start here: the own request first, then suggestions with their reason and facts; a click only fills Create work', () => {
  const html = tasksUi({ firstTasks: FIRST })();
  assert.ok(html.indexOf('data-first-request') < html.indexOf('data-first-suggestion'));
  assert.match(html, /<b dir="auto">Add online payment<\/b><span class="tiny muted ftwhy">Your own first request/);
  assert.match(html, /data-first-task="Add online payment" >Create…</);
  assert.match(html, /Why:<\/span>|Why: It could not be established\. <span class="briefrefs"><span class="briefref ltr">CTX-0003<\/span>/);
  assert.match(html, /data-first-task="Find out which database production uses\n\nIt could not be established\."/);
  assert.match(html, /Document the deployment<\/b><span class="chip wait tiny">may be out of date<\/span>/);
  assert.match(html, /nothing is created until you review it and press Create/);
  assert.match(html, /data-first-task="" >Write your own task</);
  assert.match(app, /if \(firstTask && !firstTask\.disabled\) \{ openCreate\(firstTask\.dataset\.firstTask\); return; \}/, 'the click opens the existing form');
  assert.match(app, /function openCreate\(prefill = null\) \{/);
  assert.doesNotMatch(cut('  const sameTask = ', '  // PF-0147: approve the project understanding'), /post\(|api\(/, 'the panel never talks to the server');
});

test('suggestions that match existing work are hidden; the Workspace panel steps aside once other work exists', () => {
  const withWork = [{ id: 'PF-0001', title: 'Repository Baseline' }, { id: 'PF-0002', title: 'Document the deployment' }];
  assert.equal(tasksUi({ firstTasks: FIRST, items: withWork })(), '', 'on the Workspace it is first-hour help only');
  const kept = tasksUi({ firstTasks: FIRST, items: withWork })({ always: true });
  assert.doesNotMatch(kept, /data-first-task="Document the deployment/);
  assert.match(kept, /Find out which database production uses/);
  const same = tasksUi({ firstTasks: { ...FIRST, request: 'Find out which database production uses' } })();
  assert.equal((same.match(/Find out which database production uses<\/b>/g) ?? []).length, 1, 'the own request is not repeated as a suggestion');
});

test('nothing reliable to suggest: a plain empty state and the own-task action; hidden in read-only and before approval', () => {
  const empty = tasksUi({ firstTasks: { baselineId: 'PF-0001', request: null, suggestions: [] } })();
  assert.match(empty, /data-first-empty>There are no reliable suggestions from the project understanding\. Start with the task you have in mind\./);
  assert.match(empty, /Write your own task/);
  assert.doesNotMatch(empty, /data-first-suggestion|data-first-request/);
  assert.equal(tasksUi({ firstTasks: undefined })(), '', 'no approved understanding: no panel');
  assert.equal(tasksUi({ firstTasks: FIRST, readOnly: true })(), '');
  assert.match(tasksUi({ firstTasks: FIRST, blocked: 'Understanding first.' })(), /data-first-task="Add online payment" disabled title="Understanding first\."/);
  const ar = tasksUi({ firstTasks: FIRST, lang: 'ar' })();
  assert.match(ar, /ابدأ من هنا/);
  assert.match(ar, /اكتب مهمتك أنت/);
});

test('the draft review lists the proposed first tasks, read-only', () => {
  const it = { id: 'PF-0001', waitingFor: { kind: 'baseline' } };
  const html = draftUi({ projectOverview: null })(it, { baseline: { ...BRIEFED, suggestions: [{ title: 'Add tests for totals', why: 'No test covers them.', facts: ['BF-002'] }] } });
  assert.match(html, /data-draft-suggestions><h4>Suggested first tasks \(offered to you after approval; nothing is created automatically\)<\/h4>[\s\S]*<b>Add tests for totals<\/b>[\s\S]*data-brief-fact="BF-002"/);
  assert.doesNotMatch(html, /data-first-task/);
  assert.doesNotMatch(draftUi({ projectOverview: null })(it, { baseline: BRIEFED }), /data-draft-suggestions/);
});

test('an approval is seen without a reload: the cached overview is read again until understanding is established', () => {
  assert.match(app, /if \(projectOverview\?\.pid === pid && projectOverview\.data && projectOverview\.data\.understanding\?\.state !== 'PROJECT_UNDERSTANDING_ESTABLISHED' && projectOverview\.data\.project\?\.kind !== 'greenfield'\) await loadProjectOverview\(\);/);
});
