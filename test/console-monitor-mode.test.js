// PF-0161: Monitor Only is a mode of one project (saved in the user's console project list,
// never in the project). The server is the boundary: for a monitored project every write,
// agent and execution action is refused, no agent probe runs, and opening or reading the
// project writes nothing inside it. The switch to Manage and back is explicit and confirmed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, writeFile, lstat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { addProject, loadRegistry, projectModes, setProjectMode } from '../src/console/registry.js';
import { initWorkspace } from '../src/core/workspace.js';
import { startConsoleServer } from '../src/console/server.js';

const tmp = (prefix) => mkdtemp(path.join(os.tmpdir(), prefix));
// Every file under a folder with its content hash and mode: equal maps mean nothing changed.
async function fingerprint(root) {
  const out = {};
  async function walk(dir) {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { out[`${path.relative(root, full)}/`] = 'dir'; await walk(full); }
      else out[path.relative(root, full)] = `${(await lstat(full)).mode}:${createHash('sha256').update(await readFile(full)).digest('hex')}`;
    }
  }
  await walk(root);
  return out;
}
async function project(name) {
  const dir = path.join(await tmp('yf-monitor-'), name);
  await initWorkspace(dir, name, 'greenfield', 'adaptive');
  await writeFile(path.join(dir, 'package.json'), '{"name":"x","scripts":{"postinstall":"node evil.js"}}\n');
  return dir;
}

test('registry: the mode is a field of one entry; absent means managed; older entries are untouched', async () => {
  const file = path.join(await tmp('yf-monitor-cfg-'), 'console.json');
  const a = await project('a');
  const b = await project('b');
  await addProject(a, file);
  await addProject(b, file, { mode: 'monitor' });
  assert.deepEqual(Object.fromEntries(await projectModes(file)), { [a]: 'manage', [b]: 'monitor' });
  const stored = JSON.parse(await readFile(file, 'utf8'));
  assert.equal('mode' in stored.projects[0], false, 'a managed entry looks exactly as it did before');
  assert.equal(stored.projects[1].mode, 'monitor');
  await setProjectMode(a, 'monitor', file);
  await setProjectMode(b, 'manage', file);
  assert.deepEqual(Object.fromEntries(await projectModes(file)), { [a]: 'monitor', [b]: 'manage' });
  assert.equal('mode' in JSON.parse(await readFile(file, 'utf8')).projects[1], false);
  await assert.rejects(setProjectMode(a, 'admin', file), /mode must be/);
  // adding a saved project again never switches its mode, and a list with a broken mode reads as managed
  await addProject(a, file, { mode: null });
  assert.equal((await projectModes(file)).get(a), 'monitor');
  await writeFile(file, JSON.stringify({ version: 1, projects: [{ root: a, mode: 'weird' }] }));
  assert.equal((await projectModes(file)).get(a), 'manage');
  assert.equal((await loadRegistry(file)).projects.length, 1);
});

test('server boundary: a monitored project refuses every write, agent and execution action, and nothing in it changes', async (t) => {
  const config = await tmp('yf-monitor-cfg-');
  const saved = process.env.YALLAFLOW_CONSOLE_CONFIG;
  process.env.YALLAFLOW_CONSOLE_CONFIG = path.join(config, 'console.json');
  const watched = await project('watched');
  const managed = await project('managed');
  await addProject(watched, undefined, { mode: 'monitor' });
  await addProject(managed);
  const before = await fingerprint(watched);
  const emptyBin = await tmp('yf-monitor-bin-');
  const server = await startConsoleServer({ roots: [watched, managed], port: 0, agents: true, agentEnv: { PATH: emptyBin, HOME: config } });
  t.after(async () => { await server.close(); if (saved === undefined) delete process.env.YALLAFLOW_CONSOLE_CONFIG; else process.env.YALLAFLOW_CONSOLE_CONFIG = saved; });
  const auth = { Authorization: `Bearer ${server.token}` };
  const headers = { ...auth, Origin: server.url.replace(/\/$/, ''), 'Content-Type': 'application/json' };
  const get = async (route) => { const response = await fetch(`${server.url}api/${route}`, { headers: auth }); return { status: response.status, body: await response.json().catch(() => null) }; };
  const post = async (route, body = {}) => { const response = await fetch(`${server.url}api/${route}`, { method: 'POST', headers, body: JSON.stringify(body) }); return { status: response.status, body: await response.json().catch(() => null) }; };

  const listed = (await get('projects')).body.projects;
  const w = listed.find((entry) => entry.root === watched);
  const m = listed.find((entry) => entry.root === managed);
  assert.deepEqual([w.mode, m.mode], ['monitor', 'manage'], 'the mode belongs to each project, not to the console');
  assert.equal((await get('projects')).body.readOnly, false);

  // reads work, with no agent probe and no setup offered
  assert.equal((await get(`p/${w.id}/snapshot`)).status, 200);
  assert.equal((await get(`p/${w.id}/overview`)).status, 200);
  const readiness = (await get(`p/${w.id}/readiness`)).body;
  assert.equal(readiness.steps.find((step) => step.id === 'agent').status, 'unknown', 'no agent step is asked of a monitored project');
  assert.deepEqual((await get(`p/${w.id}/agent`)).body, { enabled: false, monitor: true });
  const settings = (await get(`p/${w.id}/agents/settings?scan=1`)).body;
  assert.deepEqual([settings.readOnly, settings.monitor, settings.codex], [true, true, null]);
  assert.deepEqual((await get(`p/${w.id}/setup`)).body, { record: null, pending: false, readOnly: true });
  assert.deepEqual((await get(`p/${w.id}/lanes`)).body, { lanes: [], preconditions: null });

  // every POST addressed to it is refused at the boundary, whatever the route
  const routes = ['work', 'work/PF-0001/actions/advance', 'work/PF-0001/gates/plan/decision', 'work/PF-0001/sources', 'runtime/services', 'runtime/web/start', 'runtime/web/trust', 'runtime/start-all',
    'git/init', 'open-folder', 'setup/scan', 'setup/step', 'agents/settings', 'agents/launch-files', 'agents/approval-wait', 'agents/open-terminal',
    'runtime/web/reset', 'agent/start', 'agent/message', 'agent/connect', 'agent/activate', 'agent/clear-history', 'execution/run', 'execution/parallel', 'execution/shared-enable', 'execution/merge-approve', 'anything/else'];
  for (const route of routes) {
    const refused = await post(`p/${w.id}/${route}`, { agents: true, claude: false, title: 'x', request: 'x' });
    assert.deepEqual([refused.status, refused.body?.error?.code], [405, 'MONITOR_ONLY'], route);
  }
  // owner review (2026-11-17): "try anyway" never passes the Monitor Only boundary
  const anyway = await post(`p/${w.id}/runtime/web/start`, { skipSetupCheck: true });
  assert.deepEqual([anyway.status, anyway.body?.error?.code], [405, 'MONITOR_ONLY']);
  assert.deepEqual(await fingerprint(watched), before, 'opening, reading and refused writes changed nothing in the project');

  // the managed project in the same console is unaffected
  const choice = await post(`p/${m.id}/agents/settings`, { agents: true, claude: false });
  assert.equal(choice.status, 200);
  assert.notEqual((await get(`p/${m.id}/agent`)).body.monitor, true);

  // the switch is explicit: a confirmed body, as JSON, with the console's Origin
  assert.equal((await post(`p/${w.id}/mode`, { mode: 'manage' })).status, 400);
  assert.equal((await post(`p/${w.id}/mode`, { mode: 'manage', confirm: 'yes' })).status, 400);
  assert.equal((await post(`p/${w.id}/mode`, { mode: 'admin', confirm: true })).status, 400);
  assert.equal((await fetch(`${server.url}api/p/${w.id}/mode`, { method: 'POST', headers: { ...headers, Origin: 'http://evil.example' }, body: JSON.stringify({ mode: 'manage', confirm: true }) })).status, 403);
  assert.deepEqual(await fingerprint(watched), before);
  assert.deepEqual((await post(`p/${w.id}/mode`, { mode: 'manage', confirm: true })).body, { id: w.id, mode: 'manage', changed: true });
  assert.equal((await projectModes()).get(watched), 'manage');
  assert.equal((await get('projects')).body.projects.find((entry) => entry.id === w.id).mode, 'manage');
  assert.equal((await post(`p/${w.id}/agents/settings`, { agents: true, claude: false })).status, 200, 'managed now: the same route works');
  assert.deepEqual((await post(`p/${w.id}/mode`, { mode: 'manage', confirm: true })).body.changed, false);

  // and back: saved, enforced again at once
  assert.deepEqual((await post(`p/${w.id}/mode`, { mode: 'monitor', confirm: true })).body, { id: w.id, mode: 'monitor', changed: true });
  assert.equal((await projectModes()).get(watched), 'monitor');
  assert.equal((await post(`p/${w.id}/agents/settings`, { agents: false, claude: false })).status, 405);
  assert.deepEqual((await get(`p/${w.id}/agent`)).body, { enabled: false, monitor: true });
});

test('opening an existing YallaFlow project for monitoring: saved as monitored, nothing written, no agent needed', async (t) => {
  const config = await tmp('yf-monitor-cfg-');
  const saved = process.env.YALLAFLOW_CONSOLE_CONFIG;
  process.env.YALLAFLOW_CONSOLE_CONFIG = path.join(config, 'console.json');
  const home = await tmp('yf-monitor-home-');
  const first = path.join(home, 'first');
  const second = path.join(home, 'second');
  const plain = path.join(home, 'plain');
  await initWorkspace(first, 'first', 'greenfield', 'adaptive');
  await initWorkspace(second, 'second', 'greenfield', 'adaptive');
  await initWorkspace(path.join(home, 'seed'), 'seed', 'greenfield', 'adaptive');
  await (await import('node:fs/promises')).mkdir(plain);
  await writeFile(path.join(plain, 'composer.json'), '{}');
  const server = await startConsoleServer({ roots: [path.join(home, 'seed')], port: 0, agentEnv: { PATH: await tmp('yf-monitor-bin-'), HOME: home }, folderRoots: undefined });
  t.after(async () => { await server.close(); if (saved === undefined) delete process.env.YALLAFLOW_CONSOLE_CONFIG; else process.env.YALLAFLOW_CONSOLE_CONFIG = saved; });
  const headers = { Authorization: `Bearer ${server.token}`, Origin: server.url.replace(/\/$/, ''), 'Content-Type': 'application/json' };
  const post = async (route, body) => { const response = await fetch(`${server.url}api/${route}`, { method: 'POST', headers, body: JSON.stringify(body) }); return { status: response.status, body: await response.json().catch(() => null) }; };
  const savedHome = process.env.HOME;
  process.env.HOME = home;
  t.after(() => { process.env.HOME = savedHome; });

  const before = await fingerprint(first);
  const opened = await post('projects', { root: first, mode: 'monitor' });
  assert.equal(opened.status, 200, JSON.stringify(opened.body));
  assert.deepEqual([opened.body.mode, opened.body.added], ['monitor', true]);
  assert.deepEqual(await fingerprint(first), before, 'no .yallaflow/local, no scan, no agent file');
  assert.equal((await projectModes()).get(first), 'monitor');
  // opening it again "to manage" does not switch it silently: the switch is its own action
  assert.equal((await post('projects', { root: first })).body.mode, 'monitor');
  assert.equal((await post('projects', { root: second })).body.mode, 'manage');
  // a folder without YallaFlow records cannot be monitored; nothing is created in it
  const refused = await post('projects', { root: plain, mode: 'monitor' });
  assert.deepEqual([refused.status, refused.body.error.code], [422, 'NOT_A_YALLAFLOW_PROJECT']);
  assert.deepEqual(await readdir(plain), ['composer.json']);
  for (const bad of [{ root: first, mode: 'admin' }, { planId: 'NP-20260101000000-abcdef', mode: 'monitor' }, { root: first, mode: 'monitor', extra: 1 }]) assert.equal((await post('projects', bad)).status, 400);
});

// ---- the page (evaluated from the shipped app.js with minimal stand-ins) ----
const app = await readFile(new URL('../resources/console/app.js', import.meta.url), 'utf8');
const cut = (from, to) => { const start = app.indexOf(from); assert.ok(start >= 0, from); const end = app.indexOf(to, start); assert.ok(end > start, to); return app.slice(start, end); };
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function page({ projects, pid, consoleReadOnly = false, lang = 'en', posts = {} } = {}) {
  const calls = { post: [], toasts: [], switched: [], renders: 0 };
  const context = vm.createContext({
    A: (ar, en) => (lang === 'ar' ? ar : en), esc, JSON, Object, Boolean,
    projects, pid,
    post: async (url, body) => { calls.post.push({ url, body: JSON.parse(body) }); if (posts[url]) throw new Error(posts[url]); return { changed: true }; },
    reloadProjects: async () => { const p = context.projects.find((x) => x.id === context.pid); p.mode = calls.post.at(-1).body.mode; },
    switchProject: async (id, view) => { calls.switched.push([id, view]); }, toast: (html) => calls.toasts.push(html), render: () => { calls.renders += 1; }
  });
  vm.runInContext(`let consoleReadOnly = ${consoleReadOnly};\n${cut('  let modeAsk = null;', "  let pid = store.get('project', null);")}\n${cut('  const roText = () =>', '  // PF-0160: the saved preferred agent')}
    globalThis.fx = { monitorProject, viewReadOnly, projectMode, monitorBanner, modeConfirm, switchMode, roText, ask: (v) => { modeAsk = v; }, state: () => ({ modeAsk, modeBusy, modeError }) };`, context);
  return { fx: context.fx, calls, context };
}

test('the page: the mode is per project; a monitored project reads as read-only, the others and the project list do not', () => {
  const projects = [{ id: 'a', mode: 'monitor' }, { id: 'b', mode: 'manage' }, { id: 'c' }];
  const onA = page({ projects, pid: 'a' }).fx;
  assert.equal(onA.monitorProject(), true);
  assert.deepEqual(['map', 'overview', 'settings', 'item', 'run'].map(onA.viewReadOnly), [true, true, true, true, true]);
  assert.deepEqual(['projects', 'new'].map(onA.viewReadOnly), [false, false], 'adding or creating other projects stays possible');
  assert.equal(onA.roText(), 'This project is monitor only.');
  const onB = page({ projects, pid: 'b' }).fx;
  assert.deepEqual([onB.monitorProject(), onB.viewReadOnly('map'), onB.monitorBanner()], [false, false, '']);
  assert.equal(page({ projects, pid: 'c' }).fx.projectMode(), 'manage', 'no saved mode means managed');
  const ro = page({ projects, pid: 'b', consoleReadOnly: true }).fx;
  assert.deepEqual([ro.viewReadOnly('projects'), ro.roText()], [true, 'This console is read-only.']);
});

test('the page: the banner names the mode and its limits, in both languages; the switch asks first', async () => {
  for (const lang of ['en', 'ar']) {
    const { fx } = page({ projects: [{ id: 'a', mode: 'monitor' }], pid: 'a', lang });
    const banner = fx.monitorBanner();
    assert.match(banner, /data-monitor-banner/);
    assert.match(banner, lang === 'en' ? /Monitor only/ : /متابعة فقط/);
    assert.match(banner, lang === 'en' ? /creates no work, records no decisions/ : /لا تنشئ مهاماً/);
    assert.match(banner, lang === 'en' ? /runs no agent/ : /لا تشغّل وكيلاً/);
    assert.match(banner, /data-mode-switch="manage"/);
    assert.ok(!/data-mode-confirm/.test(banner), 'nothing is switched by the first click');
    fx.ask('manage');
    assert.match(fx.monitorBanner(), /data-mode-ask="manage"[\s\S]*data-mode-confirm="manage"/);
    assert.match(fx.monitorBanner(), lang === 'en' ? /needs an agent you choose for this project/ : /تحتاج وكيلاً تختاره لهذا المشروع/);
  }
  const { fx, calls } = page({ projects: [{ id: 'a', mode: 'monitor' }], pid: 'a' });
  await fx.switchMode('admin');
  assert.deepEqual(calls.post, []);
  await fx.switchMode('manage');
  assert.deepEqual(calls.post, [{ url: '/api/p/a/mode', body: { mode: 'manage', confirm: true } }]);
  assert.deepEqual(calls.switched, [['a', 'overview']], 'managing opens where the next step (the agent) is shown');
  assert.equal(fx.monitorProject(), false);
  // a refusal (a live agent session) is shown in place and nothing changes
  const busy = page({ projects: [{ id: 'm', mode: 'manage' }], pid: 'm', posts: { '/api/p/m/mode': 'End the agent session first.' } });
  busy.fx.ask('monitor');
  await busy.fx.switchMode('monitor');
  assert.deepEqual([busy.fx.state().modeError, busy.fx.projectMode(), busy.calls.switched.length], ['End the agent session first.', 'manage', 0]);
  assert.match(busy.fx.modeConfirm('monitor'), /End the agent session first\./);
});

test('the page: an existing YallaFlow project offers Monitor only beside Open; a plain repository is told why it cannot be monitored', () => {
  assert.match(app, /if \(here\?\.yallaflow\) action = `<button type="button" class="btn \$\{watching \? 'go' : 'ghost'\}" data-folder-monitor/);
  assert.match(app, /data-monitor-note>\$\{A\('[^']+', 'Monitor only shows YallaFlow records, and this folder has none yet, so there is nothing to monitor\./);
  assert.match(app, /if \(e\.target\.closest\('\[data-folder-monitor\]'\)\) \{ chooseFolder\('monitor'\); return; \}/);
  assert.match(app, /JSON\.stringify\(\{ root: x\.path, \.\.\.\(mode === 'monitor' \? \{ mode \} : \{\}\) \}\)/);
  assert.match(app, /if \(reg\.mode !== 'monitor'\) \{ try \{ firstTime = /, 'a monitored project is not sent to first-time setup');
  assert.match(app, /data-mode-chip="monitor"/);
  assert.match(app, /readOnly = viewReadOnly\(r\.v\);/);
  assert.match(app, /data-mode-switch="monitor"/, 'Settings → Project offers the way back');
});
