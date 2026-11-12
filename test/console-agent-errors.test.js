import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// PF-0065: a refused agent action (for example MODE_UNKNOWN before Claude Code reports its
// permission mode) must stay visible, and the panel must not offer Send until the mode is known.
const app = await readFile(new URL('../resources/console/app.js', import.meta.url), 'utf8');
const cut = (from, to) => { const start = app.indexOf(from); assert.ok(start >= 0, from); return app.slice(start, app.indexOf(to, start)); };
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function actionHarness({ post }) {
  const code = cut('  async function loadAgent()', '  function onAgentEvent(') + cut('  async function agentAction(', '  // The one thing to do next');
  const context = vm.createContext({
    readiness: null, // PF-0133: agentPanel reads the readiness agent step
    agentsOn: true, pid: 'p', agent: null, agentBusy: false, agentError: null,
    route: () => ({ v: 'item' }), chatCtx: () => ({ id: 'PF-0001' }),
    renderAgent() {},
    api: async () => ({ session: { provider: 'claude', connected: true, mode: null }, events: [] }),
    agentPost: post
  });
  vm.runInContext(`${code}\nthis.act = async () => ({ ok: await agentAction('message', { text: 'hi' }), error: agentError });`, context);
  return context;
}

test('a refused send keeps its error after the agent state reloads', async () => {
  const context = actionHarness({ post: async () => { throw new Error('Claude Code has not reported its permission mode yet.'); } });
  const result = await context.act();
  assert.equal(result.ok, false);
  assert.equal(result.error, 'Claude Code has not reported its permission mode yet.');
});

test('a successful send reports success and leaves no error', async () => {
  const context = actionHarness({ post: async () => ({ ok: true }) });
  const result = await context.act();
  assert.deepEqual({ ...result }, { ok: true, error: null });
});

function panel(session, lang = 'en', events = []) {
  const code = [cut('  function richInline(', '  const overviewExpanded'), cut('  const PROVIDER =', '  const isForbidden ='), cut('  const isForbidden =', '  async function agentPost('), cut('  function agentEntries(', '  function toggleChat('), cut('  // ---------- continuing a stopped work item', '  function agentPanel('), cut('  function agentPanel(', '  // Returns false when the action failed.')].join('\n');
  const context = vm.createContext({
    readiness: null, // PF-0133: agentPanel reads the readiness agent step
    agentsOn: true, pid: 'p', snap: { project: { activeWork: 'PF-0001' } }, agentError: null, agentBusy: false, agentDraft: '', agentLaunch: null, agentProvider: null, agentMode: 'read-only', readOnly: false,
    agent: { pid: 'p', session, events, resumable: [], providers: [{ id: 'claude', ready: true, experimental: true, capabilities: { send: true, start: false } }] },
    A: (ar, en) => (lang === 'ar' ? ar : en), L: (value) => value?.[lang] ?? String(value ?? ''), esc, ago: () => '', route: () => ({ v: 'item' }),
    store: { get: (key, fallback) => fallback, set() {} },
    document: { querySelector: () => null }
  });
  vm.runInContext(`${code}\nthis.html = agentPanel({ id: 'PF-0001' });`, context);
  return context.html;
}

test('a connected Claude Code whose mode is unknown cannot be sent to and says why', () => {
  const html = panel({ provider: 'claude', connected: true, status: 'connected', mode: null });
  assert.match(html, /Waiting for the permission mode/);
  assert.match(html, /has not reported its permission mode yet/);
  assert.match(html, /<textarea[^>]*disabled/);
  assert.match(html, /<button class="btn go" type="submit" disabled>/);
});

test('once the mode is reported the panel offers Send', () => {
  const html = panel({ provider: 'claude', connected: true, status: 'connected', mode: 'default' });
  assert.doesNotMatch(html, /Waiting for the permission mode/);
  assert.doesNotMatch(html, /<textarea[^>]*disabled/);
  assert.match(html, /<button class="btn go" type="submit" >/);
});

test('the Arabic panel explains the wait too', () => {
  assert.match(panel({ provider: 'claude', connected: true, status: 'connected', mode: null }, 'ar'), /مستني وضع الأذونات/);
});

test('a failed send puts the typed message back', () => {
  assert.match(app, /agentAction\('message', \{ text \}\)\.then\(\(sent\) => \{ if \(!sent && !agentDraft\) \{ agentDraft = text; renderAgent\(\); \} \}\)/);
});


test('agent replies use formatted content while user messages stay literal', () => {
  const html = panel({ provider: 'claude', connected: true, status: 'connected', mode: 'default' }, 'en', [
    { type: 'message.sent', text: '**literal** <img src=x>' },
    { type: 'message.done', text: '## Summary\n\n- **Done**\n- `app.js`' }
  ]);
  assert.match(html, /class="amsg me"><p>\*\*literal\*\* &lt;img/);
  assert.match(html, /class="amsg richtext"><h4 dir="auto">Summary/);
  assert.match(html, /<strong>Done<\/strong>/);
});
