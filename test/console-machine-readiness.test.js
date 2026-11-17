// PF-0160: machine readiness is derived from the machine setup's own checks, never stored.
// For each agent: installed, signed in and connection are separate states; Claude Code is
// experimental everywhere and "not verified" where YallaFlow has not run it; a saved preferred
// agent is preselected, never enabled without the developer's click.
// Windows and macOS here are SIMULATED platform values: nothing proves real-machine behavior.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { computeMachineReadiness, MACHINE_READINESS_SCHEMA } from '../src/agents/machine-readiness.js';
import { initWorkspace } from '../src/core/workspace.js';
import { startConsoleServer } from '../src/console/server.js';
import { savePreferences } from '../src/console/preferences.js';

const codex = (over = {}) => ({ cli: null, adapter: null, problems: ['Codex CLI (`codex`) is not installed or not on PATH.'], login: { loggedIn: false, method: null, checked: false, subscription: false }, installed: false, ready: false, install: { command: 'npm install -g …' }, verified: null, ...over });
const codexIn = (over = {}) => codex({ cli: { version: '0.167.0' }, adapter: { version: '2.5.0' }, problems: [], installed: true, install: null, ...over });
const claude = (over = {}) => ({ installed: false, version: null, connectionIncluded: true, ...over });
const status = (platform, c, k) => ({ platform, supportedPlatform: ['linux', 'darwin'].includes(platform), codex: c, claude: k });

test('Codex: installed, signed in and connection are three separate states with one next step', () => {
  const step = (c) => { const view = computeMachineReadiness(status('linux', c, claude())).agents.codex; return [view.installed, view.authenticated, view.connection, view.ready, view.next]; };
  assert.deepEqual(step(codex()), [false, null, 'unavailable', false, 'install']);
  assert.deepEqual(step(codex({ install: null })), [false, null, 'unavailable', false, 'install-manually']);
  assert.deepEqual(step(codexIn({ login: { loggedIn: false, method: null, checked: true, subscription: false } })), [true, false, 'not-tested', false, 'sign-in']);
  assert.deepEqual(step(codexIn({ login: { loggedIn: false, method: null, checked: false, subscription: false } })), [true, null, 'not-tested', false, 'sign-in'], 'an unknown sign-in is not "signed in"');
  const apiKey = computeMachineReadiness(status('linux', codexIn({ login: { loggedIn: true, method: 'api-key', checked: true, subscription: false } }), claude())).agents.codex;
  assert.deepEqual([apiKey.authenticated, apiKey.authProblem, apiKey.ready], [false, 'api-key', false], 'an API-key sign-in never counts');
  const signedIn = { loggedIn: true, method: 'chatgpt', checked: true, subscription: true };
  assert.deepEqual(step(codexIn({ login: signedIn })), [true, true, 'not-tested', true, 'verify']);
  assert.deepEqual(step(codexIn({ login: signedIn, verified: { ok: false, code: 'CONNECTION_FAILED' } })), [true, true, 'failed', true, 'verify']);
  assert.deepEqual(step(codexIn({ login: signedIn, verified: { ok: true } })), [true, true, 'verified', true, null]);
});

test('Claude Code: experimental everywhere, never "verified" ahead of a session, and shown on every system', () => {
  const ready = claude({ installed: true, version: '2.1.240', ready: true, problems: [], auth: { loggedIn: true, method: 'claude.ai', plan: 'max' } });
  for (const platform of ['linux', 'darwin', 'win32']) {
    const view = computeMachineReadiness(status(platform, codex(), ready)).agents.claude;
    assert.equal(view.stability, 'experimental');
    assert.equal(view.connection, 'session-only', 'no upfront test exists for Claude Code');
    assert.deepEqual([view.installed, view.authenticated, view.ready], [true, true, true]);
    assert.equal(view.support, platform === 'win32' ? 'not-verified' : 'supported');
  }
  const win = computeMachineReadiness(status('win32', codex(), claude()));
  assert.deepEqual([win.platformSupport, win.knownPlatform, win.agents.codex.support], ['not-verified', true, 'not-verified']);
  assert.deepEqual([win.agents.claude.installed, win.agents.claude.authenticated, win.agents.claude.next], [false, null, 'install-manually']);
  assert.equal(computeMachineReadiness(status('freebsd', codex(), claude())).knownPlatform, false);
  const apiKey = computeMachineReadiness(status('linux', codex(), claude({ installed: true, problems: ['x'], auth: { loggedIn: true, method: 'apiKey', plan: null } }))).agents.claude;
  assert.deepEqual([apiKey.authenticated, apiKey.authProblem, apiKey.ready, apiKey.next], [false, 'not-subscription', false, 'sign-in-manually']);
  const signedOut = computeMachineReadiness(status('linux', codex(), claude({ installed: true, problems: ['not logged in'], auth: { loggedIn: false, method: null, plan: null } }))).agents.claude;
  assert.deepEqual([signedOut.authenticated, signedOut.ready], [false, false]);
  const absent = computeMachineReadiness(status('linux', codex(), claude({ connectionIncluded: false, installed: true, auth: null }))).agents.claude;
  assert.deepEqual([absent.included, absent.connection, absent.ready, absent.next], [false, 'unavailable', false, null], 'a release without the connection never claims it');
});

test('a saved preferred agent is a wish: offered only when available, with the readiness computed now', () => {
  const signedIn = { loggedIn: true, method: 'chatgpt', checked: true, subscription: true };
  const view = (preferredAgent, c = codex(), k = claude()) => computeMachineReadiness(status('linux', c, k), { preferences: { preferredAgent } });
  assert.equal(view(null).preferredAgent, null);
  assert.deepEqual(view('codex').preferredAgent, { id: 'codex', ready: false, next: 'install' }, 'saved, but not ready now');
  assert.deepEqual(view('codex', codexIn({ login: signedIn })).preferredAgent, { id: 'codex', ready: true, next: 'verify' });
  assert.equal(view('claude', codex(), claude({ connectionIncluded: false })).preferredAgent, null, 'not offered where the connection is not included');
  assert.equal(view('gpt').preferredAgent, null);
  const doc = view('codex', codexIn({ login: signedIn }));
  assert.deepEqual([doc.schema, doc.level, doc.readyAgents], [MACHINE_READINESS_SCHEMA, 'ready', ['codex']]);
  assert.equal(view('codex').level, 'needs-setup');
});

test('console: /api/machine carries the readiness; nothing is written; never in a read-only console', async (t) => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'yf-mr-home-'));
  await initWorkspace(home, 'Home', 'greenfield', 'adaptive');
  const config = await mkdtemp(path.join(os.tmpdir(), 'yf-mr-cfg-'));
  const saved = process.env.YALLAFLOW_CONSOLE_CONFIG;
  process.env.YALLAFLOW_CONSOLE_CONFIG = path.join(config, 'console.json');
  await savePreferences({ preferredAgent: 'codex' });
  const empty = await mkdtemp(path.join(os.tmpdir(), 'yf-mr-bin-'));
  const server = await startConsoleServer({ roots: [home], port: 0, agentEnv: { PATH: empty, HOME: home } });
  const readOnly = await startConsoleServer({ roots: [home], port: 0, readOnly: true });
  t.after(async () => { await server.close(); await readOnly.close(); if (saved === undefined) delete process.env.YALLAFLOW_CONSOLE_CONFIG; else process.env.YALLAFLOW_CONSOLE_CONFIG = saved; });
  const before = (await readdir(config)).sort();
  const machine = await (await fetch(`${server.url}api/machine`, { headers: { Authorization: `Bearer ${server.token}` } })).json();
  assert.equal(machine.readiness.schema, MACHINE_READINESS_SCHEMA);
  assert.equal(machine.readiness.platform, process.platform);
  assert.deepEqual([machine.readiness.agents.codex.installed, machine.readiness.agents.codex.connection, machine.readiness.agents.claude.installed], [false, 'unavailable', false]);
  assert.deepEqual(machine.readiness.preferredAgent, { id: 'codex', ready: false, next: machine.readiness.agents.codex.next }, 'the saved preference is revalidated, not trusted');
  assert.equal(machine.readiness.level, 'needs-setup');
  assert.deepEqual((await readdir(config)).sort(), before, 'readiness is derived: no new file');
  assert.equal((await fetch(`${readOnly.url}api/machine`, { headers: { Authorization: `Bearer ${readOnly.token}` } })).status, 405);
});

// ---- the page (evaluated from the shipped app.js with minimal stand-ins) ----
const app = await readFile(new URL('../resources/console/app.js', import.meta.url), 'utf8');
const cut = (from, to) => { const start = app.indexOf(from); assert.ok(start >= 0, from); const end = app.indexOf(to, start); assert.ok(end > start, to); return app.slice(start, end); };
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const row = (ok, label, detail) => `<li data-ok="${ok}">${label}: ${detail}</li>`;

test('the page: Claude Code on simulated Windows is shown, marked Experimental and not verified, with three separate states', () => {
  for (const [lang, A] of [['en', (_ar, en) => en], ['ar', (ar) => ar]]) {
    const context = vm.createContext({ A, esc, claudeWarnings: () => '<warn>' });
    vm.runInContext(`${cut('  const osName = (platform) =>', '  // First open: one quiet')}; globalThis.card = claudeMachineCard;`, context);
    const st = status('win32', codex(), claude({ installed: true, version: '2.1.240', problems: [], auth: { loggedIn: true, method: 'claude.ai', plan: 'pro' } }));
    const win = context.card({ ...st, readiness: computeMachineReadiness(st) }, row);
    assert.match(win, /data-claude-card/);
    assert.match(win, lang === 'en' ? /Experimental · not verified on Windows/ : /تجريبي · لم يتم التحقق منه على Windows/);
    assert.equal((win.match(/<li /g) ?? []).length, 3, 'program, sign-in and connection rows');
    assert.match(win, /data-ok="true">[^<]*: <span class="ltr">claude 2\.1\.240/);
    assert.match(win, /data-ok="null">[^<]*: [^<]*(cannot be tested ahead|لا يمكن اختباره مسبقاً)/);
    assert.ok(!/verified ✓|Ready · tested/.test(win), 'never claims a tested connection');
    const linux = status('linux', codex(), claude());
    const plain = context.card({ ...linux, readiness: computeMachineReadiness(linux) }, row);
    assert.ok(!/not verified|لم يتم التحقق/.test(plain));
    assert.match(plain, /claude\.com\/claude-code/, 'missing: the official page, never an install by YallaFlow');
    const noConn = status('win32', codex(), claude({ connectionIncluded: false }));
    assert.match(context.card({ ...noConn, readiness: computeMachineReadiness(noConn) }, row), lang === 'en' ? /not available in this release/ : /غير متاح في هذه النسخة/);
  }
});

test('the page: the usual agent is listed first and marked, and still needs the click that enables it', () => {
  const chooser = (preferredAgent, claudeAvailable = true) => {
    const context = vm.createContext({ A: (_ar, en) => en, esc, readOnly: false, agentsClaudeAvailable: claudeAvailable, prefs: { preferredAgent } });
    vm.runInContext(`${cut('  const preferredAgentId = () =>', '  async function chooseAgent(')}; globalThis.html = agentChooser(); globalThis.id = preferredAgentId();`, context);
    return context;
  };
  const none = chooser(null);
  assert.ok(!/data-usual-agent/.test(none.html));
  assert.ok(none.html.indexOf('data-agent-choose="codex"') < none.html.indexOf('data-agent-choose="claude"'));
  const usualClaude = chooser('claude');
  assert.match(usualClaude.html, /data-usual-agent="claude"/);
  assert.ok(usualClaude.html.indexOf('data-agent-choose="claude"') < usualClaude.html.indexOf('data-agent-choose="codex"'));
  assert.match(usualClaude.html, /enabled for this project only when you click it/);
  assert.match(usualClaude.html, /experimental/, 'the experimental label stays');
  assert.equal((usualClaude.html.match(/<button type="button" class="agentpick-opt" data-agent-choose=/g) ?? []).length, 2, 'both stay buttons: nothing is pre-enabled');
  assert.equal(chooser('claude', false).id, null, 'a preferred agent this console cannot offer is not preselected');
  assert.match(chooser('codex').html, /data-usual-agent="codex"/);
  // the wizard starts from the usual agent, and choosing an agent saves the preference
  assert.match(app, /allowNested: false, agent: preferredAgentId\(\) \?\? 'codex', noAgent: false \}\)/);
  assert.match(cut('  async function chooseAgent(', '  function readinessAction('), /savePrefs\(\{ preferredAgent: provider \}\)/);
});
