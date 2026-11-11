// PF-0069: project setup — the saved agent choice, the first-time setup record and stack
// scan, Start/Stop project with Open links, per-project Claude, and the Setup UI.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { consoleTrustSync } from '../test-support/runtime-trust.js';
import { initWorkspace } from '../src/core/workspace.js';
import { readAgentSettings, writeAgentSettings } from '../src/agents/settings.js';
import { diffStack, markSetup, readSetup, setupPending, summarizeStack } from '../src/console/setup.js';
import { claudeIncluded } from '../src/agents/experimental.js';
import { consoleWith, fakeTools } from '../test-support/agent-fixtures.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const SUPPORTED = process.platform === 'linux' || process.platform === 'darwin';
const run = (root, args, env = {}) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, ...env } });
const lastJson = (result) => JSON.parse(result.stdout.trim().split('\n').at(-1));

async function workspace(name = 'Shop') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yf-setup-'));
  await initWorkspace(root, name, 'greenfield', 'adaptive');
  return root;
}
function freePort() {
  return new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });
}

// ---- agent choice ----
test('agent choice: missing, saved, Claude needs agents, invalid and symlinked files are "nothing chosen"', async () => {
  const root = await workspace();
  assert.deepEqual(await readAgentSettings(root), { chosen: false });
  const saved = await writeAgentSettings(root, { agents: false, claude: true });
  assert.equal(saved.claude, false, 'Claude needs agents on');
  await writeAgentSettings(root, { agents: true, claude: true });
  const read = await readAgentSettings(root);
  assert.deepEqual([read.chosen, read.agents, read.claude], [true, true, true]);
  assert.equal(spawnSync('git', ['check-ignore', '-q', '.yallaflow/local/agents.json'], { cwd: root }).status === 0 || existsSync(path.join(root, '.yallaflow', 'local', '.gitignore')), true, 'git-ignored');
  await assert.rejects(writeAgentSettings(root, { agents: 'yes', claude: false }), /Send/);
  await writeFile(path.join(root, '.yallaflow', 'local', 'agents.json'), '{"schemaVersion":1,"agents":"x"}');
  assert.equal((await readAgentSettings(root)).chosen, false);
  assert.match((await readAgentSettings(root)).error, /invalid/);
  const other = await workspace();
  await mkdir(path.join(other, '.yallaflow', 'local'), { recursive: true });
  await writeFile(path.join(other, 'elsewhere.json'), '{"schemaVersion":1,"agents":true,"claude":true}');
  await symlink(path.join(other, 'elsewhere.json'), path.join(other, '.yallaflow', 'local', 'agents.json'));
  assert.equal((await readAgentSettings(other)).chosen, false, 'a symlink is never followed');
});

// ---- setup record and scan diff ----
test('setup record: stack summary, what changed, steps, skip, and when the guide is offered', async () => {
  const stack = summarizeStack({ stack: { entries: [
    { component: 'Laravel', declared: '^10.0', kind: 'framework', basis: 'declared', path: 'composer.json', locator: 'require' },
    { component: 'PHP', declared: '>=8.1', kind: 'runtime', basis: 'declared', path: 'composer.json' },
    { component: null, kind: 'x' }
  ] } });
  assert.equal(stack.length, 2, 'entries without a component are dropped');
  assert.deepEqual(Object.keys(stack[0]), ['component', 'declared', 'kind', 'basis', 'path']);
  const next = [{ ...stack[0], declared: '^11.0' }, { component: 'Vite', declared: '5.0.0', kind: 'framework', basis: 'declared', path: 'package.json' }];
  const changes = diffStack(stack, next);
  assert.deepEqual(changes.added.map((x) => x.component), ['Vite']);
  assert.deepEqual(changes.removed.map((x) => x.component), ['PHP']);
  assert.deepEqual(changes.changed, [{ component: 'Laravel', kind: 'framework', path: 'composer.json', from: '^10.0', to: '^11.0' }]);
  assert.equal(diffStack(stack, stack).any, false);

  const root = await workspace();
  assert.equal(await readSetup(root), null);
  assert.equal(setupPending(null), true);
  await markSetup(root, { step: 'services', servicesAdded: ['web'] });
  let record = await readSetup(root);
  assert.deepEqual(record.servicesAdded, ['web']);
  assert.equal(setupPending(record), true);
  await markSetup(root, { step: 'stack' });
  await markSetup(root, { step: 'agents' });
  assert.equal(setupPending(await readSetup(root)), false, 'all steps done');
  await assert.rejects(markSetup(root, { step: 'drop-tables' }), /step/);
  await assert.rejects(markSetup(root, { step: 'stack', servicesAdded: ['../x'] }), /service ids/);
  const skipped = await workspace();
  await markSetup(skipped, { step: 'skip' });
  assert.equal(setupPending(await readSetup(skipped)), false, 'skipping is final until run again');
});

// ---- Start / Stop project ----
const SERVER = `const http = require('http');
process.on('SIGTERM', () => process.exit(0));
http.createServer((q, r) => r.end('ok')).listen(Number(process.argv[2]), '127.0.0.1');
`;
function addService(root, id, port, extra = []) {
  const result = run(root, ['runtime', 'add', id, '--name', id, '--cwd', 'web', '--port', String(port), '--ready-port', String(port), ...extra, '--', process.execPath, 'server.js', String(port)]);
  assert.equal(result.status, 0, result.stderr);
}
function trust(root, id) {
  const doc = lastJson(run(root, ['runtime', 'status', '--json']));
  const hash = doc.services.find((s) => s.id === id).definitionHash;
  assert.equal(consoleTrustSync(root, id, hash).status, 0);
}

test('start --all: trusted services in dependency order, untrusted chains skipped with what to review, stop --all reverses', { skip: !SUPPORTED }, async () => {
  const root = await workspace();
  await mkdir(path.join(root, 'web'));
  await writeFile(path.join(root, 'web', 'server.js'), SERVER);
  const [dbPort, apiPort, webPort, toolPort] = [await freePort(), await freePort(), await freePort(), await freePort()];
  addService(root, 'db', dbPort);
  addService(root, 'api', apiPort, ['--depends-on', 'db']);
  addService(root, 'web', webPort, ['--depends-on', 'api']);
  addService(root, 'tool', toolPort);
  for (const id of ['db', 'api', 'web']) trust(root, id);
  try {
    const started = run(root, ['runtime', 'start', '--all', '--json']);
    const doc = lastJson(started);
    assert.equal(doc.ok, true, started.stdout);
    assert.deepEqual(doc.started.map((x) => x.id), ['db', 'api', 'web'], 'dependencies first');
    assert.deepEqual(doc.skipped.map((x) => [x.id, x.blockedBy]), [['tool', 'tool']]);
    assert.ok(doc.skipped[0].review?.definitionHash, 'the review carries the definition to trust');
    const status = lastJson(run(root, ['runtime', 'status', '--json']));
    assert.equal(status.services.find((s) => s.id === 'web').open, '/');
    const again = lastJson(run(root, ['runtime', 'start', '--all', '--json']));
    assert.ok(again.started.every((x) => x.already), 'running services are left as they are');
    const stopped = lastJson(run(root, ['runtime', 'stop', '--all', '--json']));
    assert.deepEqual(stopped.results.map((x) => x.id), ['web', 'api', 'db'], 'reverse order');
  } finally {
    run(root, ['runtime', 'stop', '--all']);
  }
});

test('start --all: a failure stops the sequence and nothing after it starts', { skip: !SUPPORTED }, async () => {
  const root = await workspace();
  await mkdir(path.join(root, 'web'));
  await writeFile(path.join(root, 'web', 'server.js'), SERVER);
  await writeFile(path.join(root, 'web', 'crash.js'), 'process.exit(3);');
  const [a, b] = [await freePort(), await freePort()];
  const bad = run(root, ['runtime', 'add', 'bad', '--name', 'bad', '--cwd', 'web', '--', process.execPath, 'crash.js']);
  assert.equal(bad.status, 0, bad.stderr);
  addService(root, 'after', a, ['--depends-on', 'bad']);
  addService(root, 'solo', b);
  for (const id of ['bad', 'after', 'solo']) trust(root, id);
  try {
    const doc = lastJson(run(root, ['runtime', 'start', '--all', '--json']));
    assert.equal(doc.ok, false);
    assert.equal(doc.failed.id, 'bad');
    assert.ok(!doc.started.some((x) => x.id === 'after'), 'nothing after a failure starts');
  } finally {
    run(root, ['runtime', 'stop', '--all']);
  }
});

test('profile: open is a path on the service port, never a URL', async () => {
  const root = await workspace();
  assert.equal(run(root, ['runtime', 'add', 'svc', '--name', 'S', '--', 'node']).status, 0);
  const file = path.join(root, '.yallaflow', 'runtime.yaml');
  const doc = JSON.parse(await readFile(file, 'utf8'));
  for (const [open, ok] of [['/admin', true], ['/', true], ['/a?b=1#c', true], ['https://evil.example/', false], ['//evil.example', false], ['admin', false], ['/a\\b', false]]) {
    doc.services[0].open = open;
    await writeFile(file, JSON.stringify(doc));
    const doc2 = lastJson(run(root, ['runtime', 'status', '--json']));
    assert.equal(!doc2.profile.error, ok, `${open}: ${doc2.profile.error}`);
    if (!ok) assert.match(doc2.profile.error, /open must be a path on the service's own port/);
  }
});

// ---- console: settings applied at start, live on/off, read-only, routes ----
async function open(root, options) {
  const c = await consoleWith(root, options);
  const auth = { Authorization: `Bearer ${c.server.token}` };
  const raw = (route, body, headers = {}) => fetch(`${c.server.url}api/p/${c.pid}/${route}`, { method: 'POST', headers: { ...auth, Origin: c.origin, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const listed = await (await fetch(`${c.server.url}api/projects`, { headers: auth })).json();
  return {
    ...c, raw,
    agentsEnabled: Boolean(listed.agents?.enabled),
    get: async (route) => (await fetch(`${c.server.url}api/p/${c.pid}/${route}`, { headers: auth })).json(),
    postProject: async (route, body) => { const response = await raw(route, body); const doc = await response.json(); assert.ok(response.ok, JSON.stringify(doc)); return doc; }
  };
}
test('console: a saved choice turns agents and Claude on for that project only; live off removes its bridge file', { skip: !claudeIncluded() }, async () => {
  const chosen = await workspace('Chosen');
  const other = await workspace('Other');
  await writeAgentSettings(chosen, { agents: true, claude: true });
  const tools = await fakeTools();
  const c = await open(chosen, { agentEnv: tools.env, roots: [chosen, other] });
  try {
    const bridgeFile = (root) => path.join(root, '.yallaflow', 'local', 'agent-bridge.json');
    assert.equal(existsSync(bridgeFile(chosen)), true, 'Claude on for the chosen project without flags');
    assert.equal(existsSync(bridgeFile(other)), false, 'other projects keep their own choice');
    const view = await c.get('agents/settings');
    assert.equal(view.applied.agents, true);
    assert.equal(view.applied.claude, true);
    assert.equal(view.checklist.channelConnected, false);
    assert.equal(view.checklist.modeState, 'unknown');
    assert.equal(view.launchCommand, null, 'no command before the launch files are written');
    const launch = await c.postProject('agents/launch-files', {});
    assert.match(launch.command, /^claude 'Run yallaflow brief/);
    assert.equal((await c.get('agents/settings')).launchCommand, launch.command, 'the settings view carries the command once the files are current');
    const off = await c.postProject('agents/settings', { agents: true, claude: false });
    assert.equal(off.applied.claude, false);
    assert.equal(existsSync(bridgeFile(chosen)), false, 'turning Claude off removes the bridge file');
    const on = await c.postProject('agents/settings', { agents: true, claude: true });
    assert.equal(on.applied.claude, true);
    assert.equal(existsSync(bridgeFile(chosen)), true, 'on again without a restart');
    assert.equal((await readAgentSettings(chosen)).claude, true);
  } finally {
    await c.close();
  }
});

test('console: settings and setup routes are guarded; read-only ignores the saved choice and refuses writes', async () => {
  const root = await workspace();
  await writeAgentSettings(root, { agents: true, claude: false });
  const ro = await open(root, { readOnly: true });
  try {
    assert.equal(ro.agentsEnabled, false, 'read-only never turns agents on');
    const write = await ro.raw('agents/settings', { agents: true, claude: false });
    assert.ok([403, 405].includes(write.status), String(write.status));
    assert.ok([403, 405].includes((await ro.raw('setup/scan', {})).status));
    assert.ok([403, 405].includes((await ro.raw('runtime/start-all', {})).status));
    assert.equal((await ro.get('setup')).pending, false, 'no guide in read-only');
  } finally {
    await ro.close();
  }
  const rw = await open(root, {});
  try {
    assert.equal(rw.agentsEnabled, true, 'the saved choice turns agents on');
    assert.equal((await rw.raw('agents/settings', { agents: true })).status, 400);
    assert.equal((await rw.raw('agents/settings', { agents: true, claude: false }, { Origin: 'http://evil.example' })).status, 403);
    assert.equal((await rw.raw('setup/step', { step: 'nope' })).status, 400);
    assert.equal((await rw.get('setup')).pending, true);
    const scan = await rw.postProject('setup/scan', {});
    assert.ok(Array.isArray(scan.record.stack));
    assert.equal(scan.changes, null, 'the first scan has nothing to compare with');
    assert.equal((await rw.postProject('setup/scan', {})).changes.any, false);
    assert.equal(existsSync(path.join(root, '.yallaflow', 'local', 'setup.json')), true);
  } finally {
    await rw.close();
  }
});

// ---- Setup UI over the shipped code ----
const app = await readFile(new URL('../resources/console/app.js', import.meta.url), 'utf8');
const cut = (from, to) => { const start = app.indexOf(from); assert.ok(start >= 0, from); return app.slice(start, app.indexOf(to, start)); };
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function ui({ setupInfo = null, agentSetup = null, readOnly = false, lang = 'en', runtime = null, calls = [] } = {}) {
  // PF-0102: Setup → Agents also shows the Claude Team/Enterprise warning (claudeWarnings).
  const code = cut('  // ---------- project setup: Stack, Run, Agents', '  function viewSetup(') + cut('  // PF-0102: Claude Team/Enterprise accounts', '  // PF-0103: one agent per checkout');
  const context = vm.createContext({ pid: 'p', readOnly, lang, runtime, agentsOn: false, A: (ar, en) => (lang === 'ar' ? ar : en), esc, toast() {}, render() {}, api: async (url) => { calls.push(url); return {}; }, post: async () => ({}), loadRuntime: async () => {}, loadPlan: async () => {} });
  vm.runInContext(`${code}\nsetupInfo = ${JSON.stringify(setupInfo)}; agentSetup = ${JSON.stringify(agentSetup)};\nthis.guide = setupGuide; this.stack = stackSection; this.runS = runSection; this.agents = agentsSection; this.links = openLinks;`, context);
  return context;
}

test('UI: the first-time guide shows the current step, and none once done, skipped or read-only', () => {
  // PF-0123: agents first (the stack and services steps can ask the agent), services optional.
  const first = ui({ setupInfo: { pid: 'p', record: null } }).guide();
  assert.match(first, /First-time project setup[\s\S]*1\. Set up the agent[\s\S]*Go to Agents[\s\S]*2\. Scan the stack[\s\S]*3\. Choose services \(optional\)/);
  assert.match(ui({ setupInfo: { pid: 'p', record: { stack: [], steps: { agents: true } } } }).guide(), /Scan now/);
  const services = ui({ setupInfo: { pid: 'p', record: { stack: [], steps: { agents: true, stack: true } } } }).guide();
  assert.match(services, /No services for now/, 'with no services the step says so instead of "done choosing"');
  // The console keeps the runtime document under .data (loadRuntime).
  assert.match(ui({ runtime: { pid: 'p', data: { services: [{ id: 'web' }] } }, setupInfo: { pid: 'p', record: { stack: [], steps: { agents: true, stack: true } } } }).guide(), /Done choosing services/);
  assert.equal(ui({ setupInfo: { pid: 'p', record: { stack: [], steps: { stack: true, services: true, agents: true } } } }).guide(), '');
  assert.equal(ui({ setupInfo: { pid: 'p', record: { stack: [], steps: { skipped: true } } } }).guide(), '');
  assert.equal(ui({ readOnly: true, setupInfo: { pid: 'p', record: null } }).guide(), '');
  assert.match(ui({ lang: 'ar', setupInfo: { pid: 'p', record: null } }).guide(), /إعداد المشروع لأول مرة/);
});

test('UI: Stack lists the scan with what changed; Run links running services to their own port only', () => {
  const html = ui({ setupInfo: { pid: 'p', record: { scannedAt: '2026-11-08T00:00:00Z', stack: [{ component: 'Laravel', declared: '^11.0', kind: 'framework', basis: 'declared', path: 'composer.json' }], steps: {} }, changes: { any: true, added: [{ component: 'Vite', path: 'package.json' }], removed: [], changed: [{ component: 'Laravel', from: '^10.0', to: '^11.0' }] } } }).stack();
  assert.match(html, /Changed since the last scan/);
  assert.match(html, /\+ Vite/);
  assert.match(html, /~ Laravel \^10\.0 → \^11\.0/);
  assert.match(html, /<td>Laravel<\/td>/);
  assert.match(html, /\.env files are never read/);
  const h = ui();
  assert.equal(h.links({ state: 'running', ports: [{ port: 8000 }], open: '/admin' }), '<a class="btn sm go" href="http://127.0.0.1:8000/admin" target="_blank" rel="noopener noreferrer" data-open-app>Open :8000 ↗</a>');
  assert.match(h.links({ state: 'running', ports: [{ port: 8000 }], open: '//evil.example' }), /href="http:\/\/127\.0\.0\.1:8000\/"/, 'a bad path falls back to /');
  assert.equal(h.links({ state: 'stopped', ports: [{ port: 8000 }] }), '');
  const runHtml = h.runS({ services: [{ id: 'web', name: 'Web', state: 'running', ports: [{ port: 8000 }], open: '/' }] });
  assert.match(runHtml, /data-rt-all="start"/);
  assert.match(runHtml, /Open :8000/);
});

// PF-0077: the Start/Stop/Save message follows the language the page is shown in now.
test('UI: the run message is re-rendered in the current language after a switch', async () => {
  // PF-0102: Setup → Agents also shows the Claude Team/Enterprise warning (claudeWarnings).
  const code = cut('  // ---------- project setup: Stack, Run, Agents', '  function viewSetup(') + cut('  // PF-0102: Claude Team/Enterprise accounts', '  // PF-0103: one agent per checkout');
  const context = vm.createContext({
    pid: 'p', readOnly: false, lang: 'en', runtime: null, agentsOn: false, esc, toast() {}, render() {},
    api: async () => ({}), loadRuntime: async () => {}, loadPlan: async () => {},
    post: async () => ({ started: [{ id: 'web', already: false }], skipped: [], failed: null })
  });
  context.A = (ar, en) => (context.lang === 'ar' ? ar : en);
  vm.runInContext(`${code}\nthis.start = () => runProject('start'); this.runS = runSection;`, context);
  await context.start();
  const svc = { services: [{ id: 'web', name: 'Web', state: 'running', ports: [], trust: { trusted: true } }] };
  assert.match(context.runS(svc), /web: started/);
  context.lang = 'ar';
  const ar = context.runS(svc);
  assert.match(ar, /web: اشتغل/);
  assert.doesNotMatch(ar, /web: started/, 'no English left after switching to Arabic');
});

test('UI: Agents shows detection, the saved choice and a checklist with fixes', () => {
  const data = {
    claudeAvailable: true, saved: { chosen: true, agents: true, claude: true }, applied: { agents: true, claude: true },
    codex: { ready: true, version: '0.50.0', problems: [], auth: null },
    claude: { ready: true, version: '2.1.319', problems: [], auth: { loggedIn: true, method: 'claude.ai', plan: 'team' } },
    checklist: { on: true, owner: true, lockedBy: null, launchFiles: false, channelConnected: false, lastHookAt: null, mode: null, modeState: 'unknown' }
  };
  const html = ui({ agentSetup: { pid: 'p', data } }).agents();
  assert.match(html, /claude\.ai \(team\)/);
  assert.match(html, /name="claude" checked/);
  assert.match(html, /<li class="no"><span aria-hidden="true">✗<\/span> Launch files written<span class="tiny muted"> — Press Write launch files\.<\/span>/);
  assert.match(html, /<li class="ok"><span aria-hidden="true">✓<\/span> This console owns the checkout/);
  const refused = ui({ agentSetup: { pid: 'p', data: { ...data, checklist: { ...data.checklist, mode: 'bypassPermissions', modeState: 'refused', lastHookAt: 'x' } } } }).agents();
  assert.match(refused, /skips every permission/);
  assert.doesNotMatch(ui({ readOnly: true, agentSetup: { pid: 'p', data } }).agents(), /data-agents-settings/);
});

// ---- real-session fixes (PF-0069, portal session 2026-11-08) ----
test('session fix: the stack shows a summary first, root manifests first, and the full table folded', () => {
  const stack = [
    { component: 'PHP', declared: null, kind: 'ecosystem', basis: 'declared', path: 'composer.json' },
    { component: 'Yii2', declared: '>=2.0.1', kind: 'framework', basis: 'declared', path: 'modules/a/composer.json' },
    { component: 'Yii2', declared: '~2.0.14', kind: 'framework', basis: 'declared', path: 'composer.json' },
    { component: 'composer.lock', declared: null, kind: 'lockfile', basis: 'detected', path: 'composer.lock' },
    { component: 'Node.js', declared: null, kind: 'ecosystem', basis: 'declared', path: 'web/blog/theme/package.json' }
  ];
  const html = ui({ setupInfo: { pid: 'p', record: { scannedAt: 'x', stack, steps: {} } } }).stack();
  const summary = html.slice(html.indexOf('stacksum'), html.indexOf('<details'));
  assert.match(summary, /<b>Yii2<\/b> <span class="ltr mono tiny">~2\.0\.14<\/span>/, 'the root composer.json version wins');
  assert.ok(summary.indexOf('Yii2') < summary.indexOf('PHP'), 'framework first');
  assert.doesNotMatch(summary, /composer\.lock|&gt;=2\.0\.1/);
  assert.match(html, /<details[^>]*><summary class="small">Everything found \(5\) — with files<\/summary>/);
});

test('session fix: the launch command shows once the files are current; Codex login is explained; notes in Arabic', async () => {
  const data = {
    claudeAvailable: true, saved: { chosen: true, agents: true, claude: true }, applied: { agents: true, claude: true },
    codex: { ready: true, version: '0.167.0', problems: [], auth: null },
    claude: { ready: true, version: '2.1.319', problems: [], auth: { loggedIn: true, method: 'claude.ai', plan: 'team' } },
    checklist: { on: true, owner: true, lockedBy: null, launchFiles: true, channelConnected: false, lastHookAt: null, mode: null, modeState: 'unknown' },
    launchCommand: "claude 'Run yallaflow brief, then wait.' --mcp-config x"
  };
  const html = ui({ agentSetup: { pid: 'p', data } }).agents();
  assert.match(html, /Run this in a terminal inside the project folder[\s\S]*<pre class="cli" dir="ltr">claude &#39;Run yallaflow brief/, 'no button press needed');
  assert.match(html, /Rewrite launch files/);
  assert.match(html, /checked when a session starts/);
  const connected = ui({ agentSetup: { pid: 'p', data: { ...data, checklist: { ...data.checklist, channelConnected: true } } } }).agents();
  assert.doesNotMatch(connected, /Run this in a terminal/);
  const noFiles = ui({ agentSetup: { pid: 'p', data: { ...data, launchCommand: null, checklist: { ...data.checklist, launchFiles: false } } } }).agents();
  assert.doesNotMatch(noFiles, /<pre class="cli"/);
  assert.match(noFiles, /Channel connected<span class="tiny muted"> — Write the launch files first\./);
  const ar = ui({ lang: 'ar' });
  assert.equal(vm.runInContext("suggestionNote('A package script can run any command; review what it does before trusting it.')", ar), 'سكريبت الـ package ممكن يشغّل أي أمر؛ راجع بيعمل إيه قبل ما توثّقه.');
  assert.equal(vm.runInContext("suggestionNote('Something new.')", ar), 'Something new.');
});

test('session fix: Rescan this machine keeps the Claude probe in the reload that follows', async () => {
  const calls = [];
  const h = ui({ calls });
  await vm.runInContext("setupDo('rescan', async () => {}, { scanAgents: true })", h);
  assert.ok(calls.includes('/api/p/p/agents/settings?scan=1'), calls.join(' '));
  assert.ok(!calls.includes('/api/p/p/agents/settings'), 'no second reload without the probe');
});

// ---- security review fixes (PF-0069) ----
test('review: an agents.json committed to the repository or readable by others is ignored', async () => {
  const root = await workspace();
  await mkdir(path.join(root, '.yallaflow', 'local'), { recursive: true });
  const file = path.join(root, '.yallaflow', 'local', 'agents.json');
  await writeFile(file, '{"schemaVersion":1,"agents":true,"claude":true}', { mode: 0o644 });
  const planted = await readAgentSettings(root);
  assert.equal(planted.chosen, false);
  assert.match(planted.error, /readable by others/);
  await writeAgentSettings(root, { agents: true, claude: false });
  assert.equal((await readAgentSettings(root)).chosen, true, 'YallaFlow writes it 0600');
  assert.equal(spawnSync('git', ['init', '-q'], { cwd: root }).status, 0);
  assert.equal(spawnSync('git', ['add', '-f', '.yallaflow/local/agents.json'], { cwd: root }).status, 0);
  const tracked = await readAgentSettings(root);
  assert.equal(tracked.chosen, false);
  assert.match(tracked.error, /tracked by Git/);
  const c = await open(root, {});
  try {
    assert.equal(c.agentsEnabled, false, 'a tracked choice never turns agents on');
  } finally {
    await c.close();
  }
});

test('review: a read-only console runs no agent probes', async () => {
  const root = await workspace();
  const tools = await fakeTools();
  const c = await open(root, { readOnly: true, agentEnv: tools.env });
  try {
    const view = await c.get('agents/settings?scan=1');
    assert.deepEqual([view.readOnly, view.codex, view.claude, view.checklist], [true, null, null, null]);
  } finally {
    await c.close();
  }
});

test('review: turning Claude off cuts its token at once, releases the checkout, and planted launch files are not ticked', { skip: !claudeIncluded() }, async () => {
  const root = await workspace();
  await writeAgentSettings(root, { agents: true, claude: true });
  const tools = await fakeTools();
  const c = await open(root, { agentEnv: tools.env });
  const lock = path.join(root, '.yallaflow', 'local', 'agent-console.lock');
  try {
    await writeFile(path.join(root, '.yallaflow', 'local', 'agent', 'claude-mcp.json'), '{"mcpServers":{"yallaflow":{"command":"sh","args":["-c","echo planted"]}}}').catch(async () => {
      await mkdir(path.join(root, '.yallaflow', 'local', 'agent'), { recursive: true });
      await writeFile(path.join(root, '.yallaflow', 'local', 'agent', 'claude-mcp.json'), '{"planted":true}');
    });
    assert.equal((await c.get('agents/settings')).checklist.launchFiles, false, 'planted content is not ticked');
    await c.postProject('agents/launch-files', {});
    assert.equal((await c.get('agents/settings')).checklist.launchFiles, true);
    assert.equal(existsSync(lock), true);
    const [off, connect] = await Promise.all([
      c.postProject('agents/settings', { agents: true, claude: false }),
      c.post('connect', { provider: 'claude', workId: 'PF-0001' })
    ]);
    assert.equal(off.applied.claude, false);
    assert.ok([400, 200].includes(connect.status));
    assert.equal((await c.status()).session, null, 'nothing stays linked to a dropped link');
    assert.equal(existsSync(lock), false, 'the checkout is released when no session needs it');
    const bridge = await fetch(`${c.server.url}api/agent-bridge/claude/hello?nonce=${'a'.repeat(32)}&id=${'b'.repeat(16)}`);
    assert.equal(bridge.status, 404, 'no Claude project: the bridge is closed');
  } finally {
    await c.close();
  }
});
