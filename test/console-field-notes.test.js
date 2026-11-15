// PF-0143: fixes from the 1.5.2 field notes (a real zero-to-delivery run, Arabic console):
// bugs B1–B5 and gaps G1–G6, with I7 (a finished item's linked Claude Code session).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { stopFrom } from '../src/agents/bridge.js';
import { ExecutionManager } from '../src/execution/manager.js';
import { createPlan } from '../src/newproject/project.js';
import { collectWorkDetail } from '../src/flow/snapshot.js';
import { startConsoleServer } from '../src/console/server.js';
import { openReportFile } from '../src/console/reveal.js';
import { workspacePath } from '../src/core/workspace.js';
import { freshProject, routedBoundedChange, run, writeJsonFile } from '../test-support/optional.js';

const app = await readFile(new URL('../resources/console/app.js', import.meta.url), 'utf8');
const cut = (from, to) => { const start = app.indexOf(from); assert.ok(start >= 0, from); return app.slice(start, app.indexOf(to, start)); };

test('B1: the Agents settings form keeps its ticks across the live redraw until Save', () => {
  assert.match(app, /<form class="wizform" data-agents-settings data-keep="agents-\$\{esc\(pid\)\}"/);
});

test('B2: the wizard expands ~ and ~/… to the home folder, and explains a relative path', () => {
  assert.match(app, /if \(f\.parent === '~' \|\| f\.parent\.startsWith\('~\/'\)\) \{\n\s+try \{ const home = \(await api\('\/api\/fs\/dirs'\)\)\.home;/);
  assert.match(app, /Type a full path that starts with \/ or ~\/ \(for example ~\/code\), or use Choose folder\./);
});

test('B3: the queue Start button names the chosen agent and follows the radio; the toast confirms it', () => {
  assert.match(app, /data-queue-start disabled>\$\{queueStartLabel\('codex'\)\}<\/button>/);
  assert.match(app, /\[data-queue-form\] \[name="provider"\]'\)\) \{ const b = document\.querySelector\('\[data-queue-start\]'\); if \(b\) b\.textContent = queueStartLabel\(e\.target\.value\); \}/);
  assert.match(app, /The queue started with Codex\./);
});

test('B4: a usage limit is recognised in its provider wordings; an error stop leaves the task waiting for the developer', async () => {
  assert.equal(stopFrom('error', 'usage_limit_reached').reason, 'usage_limit');
  assert.equal(stopFrom('error', "You've hit your usage limit. Upgrade to Pro, or try again at 10:49 PM.").retryAt, '10:49 PM');
  assert.equal(stopFrom('error', 'Internal error').reason, 'error');
  const signalFor = ExecutionManager.prototype.signalFor;
  assert.deepEqual(signalFor.call({}, 'p', { type: 'session.stopped', stop: { reason: 'error' } }), { type: 'turn-ended' });
  assert.equal(signalFor.call({}, 'p', { type: 'session.stopped', stop: { reason: 'usage_limit', retryAt: 'x' } }).type, 'usage-limit');
  // The limit text can follow the generic error: a recent error stop is corrected.
  assert.match(app, /PF-0143 \(B4\): a stopped agent \(usage limit, error\) counts in the bell/);
  const bridge = await readFile(new URL('../src/agents/bridge.js', import.meta.url), 'utf8');
  assert.match(bridge, /const LIMIT_AFTER = \/usage\[ _-\]\?limit\|try again \(\?:at\|in\) \\d\/i;/);
  assert.match(bridge, /stop\?\.reason === 'error' && Date\.now\(\) - Date\.parse\(stop\.at\) < 120_000 && LIMIT_AFTER\.test\(said\)/);
});

// The board's agent relation for one item, evaluated with the console's own functions.
function board({ session, item, events = [], pending = [] }) {
  const code = [
    cut('  const PROVIDER =', '  const isForbidden ='),
    cut('  function agentEntries(', '  function toggleChat('),
    cut('  const STOP_LABEL = {', '  function continueText('),
    cut('  function permOutcome(', '  function permCard(')
  ].join('\n');
  const ctx = vm.createContext({
    A: (ar, en) => en, L: (value) => value?.en ?? '', esc: (v) => String(v), pid: 'p', agentsOn: true, store: { get: (key, fallback) => fallback, set() {} },
    agent: { pid: 'p', session, events, pending, history: [] }, byId: (id) => (id === item.id ? item : null)
  });
  vm.runInContext(`${code}\nthis.on = (it) => agentOnItem(it); this.att = () => agentAttention(); this.entries = () => agentEntries(agent.events);`, ctx);
  return ctx;
}

test('B4/I7: a stopped agent waits for the developer; a finished item\'s linked Claude Code session is not "working"', () => {
  const stopped = board({ session: { provider: 'codex', workId: 'PF-0003', status: 'idle' }, item: { id: 'PF-0003', state: 'active' }, events: [{ type: 'turn.started' }, { type: 'session.stopped', provider: 'codex', stop: { reason: 'usage_limit', retryAt: '10:49 PM' } }] });
  assert.equal(stopped.on({ id: 'PF-0003', state: 'active' }), 'reply');
  assert.equal(stopped.att().stop.reason, 'usage_limit');
  const linked = board({ session: { provider: 'claude', workId: 'PF-0001', status: 'connected', connected: true }, item: { id: 'PF-0001', state: 'done' } });
  assert.equal(linked.on({ id: 'PF-0001', state: 'done' }), 'linked');
  assert.equal(linked.on({ id: 'PF-0001', state: 'active' }), 'working');
  assert.match(app, /Claude Code is still linked to it — type \/exit in its terminal when you are done/);
});

test('B5: a queue whose next task waits for another session says so, with what to do', () => {
  const ctx = vm.createContext({ A: (ar, en) => en, esc: (v) => String(v) });
  vm.runInContext(`${cut('  const PROVIDER =', '  const isForbidden =')}\n${cut('  function queueBlock(', '  // The same signal on the Workspace')}\nthis.note = queueWaitNote;`, ctx);
  const run = { state: 'running', lanes: [{ tasks: [{ id: 't1', workId: 'PF-0002', provider: 'codex', state: 'queued' }] }] };
  const note = ctx.note({ session: { provider: 'claude', workId: 'PF-0001' } }, run);
  assert.match(note, /The queue waits for the Claude Code session on PF-0001 to close before it starts PF-0002\. Type \/exit in the Claude Code terminal/);
  assert.equal(ctx.note({ session: null }, run), '');
  assert.equal(ctx.note({ session: { provider: 'codex', workId: 'PF-0002' } }, run), '');
});

test('G1: a PHP module prerequisite is found only when `php -m` lists it; Laravel checks pdo_sqlite', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-g1-'));
  const lister = (modules) => ({ name: 'pdo_sqlite', argv: [process.execPath, '-e', `console.log(${JSON.stringify(modules.join('\n'))})`], module: 'pdo_sqlite', note: 'install hint' });
  const entry = (modules) => [{ id: 'empty', category: 'blank', label: 'Empty', stack: [], generator: null, prerequisites: [lister(modules)], argv: null, network: false, installsDependencies: false, runsPackageScripts: false, marker: null, structure: [], install: null, docs: '' }];
  const env = { ...process.env, YALLAFLOW_CONSOLE_CONFIG: path.join(parent, 'config.json') };
  const yes = await createPlan({ name: 'a', parent, stack: 'empty' }, { catalog: entry(['Core', 'PDO', 'pdo_sqlite']), env });
  assert.deepEqual(yes.body.prerequisites[0], { name: 'pdo_sqlite', found: true, version: 'enabled', module: true, note: 'install hint' });
  const no = await createPlan({ name: 'b', parent, stack: 'empty' }, { catalog: entry(['Core', 'pdo_mysql']), env });
  assert.equal(no.body.prerequisites[0].found, false);
  const { CATALOG } = await import('../src/newproject/catalog.js');
  assert.ok(CATALOG.find((c) => c.id === 'laravel').prerequisites.some((p) => p.module === 'pdo_sqlite'));
  assert.match(app, /Your PHP has no SQLite driver \(pdo_sqlite\)/);
});

test('G2: the Run page says where the agent request went', () => {
  assert.match(app, /planAwaitAgent\.sentTo = \{ provider: sess\.provider, workId: sess\.workId \?\? null \};/);
  assert.match(app, /The request went to the running \$\{PROVIDER\[sentTo\.provider\]/);
  assert.match(app, /The run setup request was sent to this session on/);
});

test('G3: an open request stays in the chat after its event was trimmed; a trimmed resolved request says its outcome', async () => {
  const open = board({ session: { provider: 'codex', workId: 'PF-0001', status: 'working' }, item: { id: 'PF-0001', state: 'active' }, events: [{ type: 'tool.started', toolCallId: 'x', title: 'ls' }], pending: [{ requestId: 'r1', title: 'npm install', kind: 'execute', decisions: ['allow', 'deny'] }] });
  assert.ok(open.entries().some((e) => e.kind === 'perm' && e.requestId === 'r1'));
  const closed = board({ session: { provider: 'codex', workId: 'PF-0001', status: 'working' }, item: { id: 'PF-0001', state: 'active' }, events: [{ type: 'permission.resolved', requestId: 'r2', decision: 'deny', by: 'timeout', title: 'npm install' }] });
  assert.match(closed.entries().at(-1).text, /The permission request «npm install» was denied automatically: no answer in time\./);
  assert.match(await readFile(new URL('../src/agents/bridge.js', import.meta.url), 'utf8'), /agentEvent\('permission\.resolved', \{ requestId, decision, by, title: entry\.request\.title \?\? null \}\)/);
});

test('G4: the Answer dialog shows each question with its text', () => {
  assert.match(app, /<select name="question" data-answer-pick>/);
  assert.match(app, /questions = current\.questions \?\? \[\];/);
});

async function withQc() {
  const root = await freshProject();
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-g5-'));
  const id = routedBoundedChange(root);
  await writeFile(path.join(dir, 'shot.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
  run(root, ['qc', 'plan', id, '--file', await writeJsonFile(dir, 'plan.json', { scenarios: [{ id: 'S-01', kind: 'functional', title: 'Login works', rationale: 'Core flow.' }, { id: 'S-02', kind: 'exploratory', title: 'Odd input', charter: 'Probe.' }] })]);
  run(root, ['qc', 'record', id, '--file', await writeJsonFile(dir, 'result.json', { tool: 'playwright-cli', origin: 'agent-driven', scenarios: [
    { id: 'S-01', status: 'passed', steps: ['Opened /login'], artifacts: [path.join(dir, 'shot.png')] },
    { id: 'S-02', status: 'failed', steps: ['Typed emoji'], actual: 'A 500 page' }
  ] })]);
  return { root, id };
}

test('G5: work show carries the QC runs (additive) and the console opens only that item\'s report', async () => {
  const { root, id } = await withQc();
  const detail = await collectWorkDetail(root, id);
  assert.equal(detail.quality.qc.runs.length, 1);
  assert.equal(detail.quality.qc.runs[0].passed, 1);
  assert.equal(detail.quality.qc.runs[0].failed, 1);
  assert.deepEqual(detail.quality.qc.runs[0].scenarios[1], { id: 'S-02', title: 'Odd input', status: 'failed', note: 'A 500 page' });
  assert.equal(detail.quality.report, `.yallaflow/work/${id}/quality/report.html`);
  const plain = routedBoundedChange(root);
  assert.equal((await collectWorkDetail(root, plain)).quality, undefined);

  const opened = [];
  const server = await startConsoleServer({ roots: [root], openReport: async (file, projectRoot) => { opened.push([file, projectRoot]); return { opened: true }; } });
  try {
    const pid = (await getJson(server, '/api/projects')).projects[0].id;
    assert.equal((await postJson(server, `/api/p/${pid}/work/${id}/quality-report`, {})).status, 200);
    assert.deepEqual(opened, [[path.join(workspacePath(root), 'work', id, 'quality', 'report.html'), root]]);
    assert.notEqual((await postJson(server, `/api/p/${pid}/work/..%2F..%2Fx/quality-report`, {})).status, 200);
    assert.equal(opened.length, 1);
  } finally {
    await server.close();
  }
  await assert.rejects(openReportFile(path.join(workspacePath(root), 'work', plain, 'quality', 'report.html'), root, { spawnFn: () => { throw new Error('must not spawn'); } }), { code: 'REPORT_MISSING' });
  assert.match(app, /data-qc-report="\$\{esc\(it\.id\)\}"/);
});

test('G6: the first hold or close explains the minimum version in the console\'s words', () => {
  assert.match(app, /Its record makes the project require YallaFlow 1\.4\.0 or newer/);
  assert.doesNotMatch(cut("      if (e.code === 'CONFIRM_MINIMUM_VERSION') {", '      } else {'), /esc\(e\.message\)/);
});

function request(server, method, pathname, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port: server.port, path: pathname, method, headers: { Host: `127.0.0.1:${server.port}`, Origin: `http://127.0.0.1:${server.port}`, Authorization: `Bearer ${server.token}`, ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}) } }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') }));
    });
    req.on('error', reject);
    req.end(payload ?? undefined);
  });
}
const getJson = async (server, pathname) => (await request(server, 'GET', pathname)).body;
const postJson = (server, pathname, body) => request(server, 'POST', pathname, body);
