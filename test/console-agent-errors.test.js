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
    planAwaitAgent: null, // PF-0143: the project chat says where a run setup request went
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
    planAwaitAgent: null, // PF-0143: the project chat says where a run setup request went
    agentsOn: true, pid: 'p', snap: { project: { activeWork: 'PF-0001' } }, agentError: null, agentBusy: false, agentDraft: '', agentLaunch: null, agentProvider: null, agentMode: 'read-only', readOnly: false,
    agent: { pid: 'p', session, events, resumable: [], providers: [{ id: 'claude', ready: true, experimental: true, capabilities: { send: true, start: false } }] },
    A: (ar, en) => (lang === 'ar' ? ar : en), L: (value) => value?.[lang] ?? String(value ?? ''), esc, ago: () => '', route: () => ({ v: 'item' }),
    store: { get: (key, fallback) => fallback, set() {} },
    document: { querySelector: () => null }
  });
  vm.runInContext(`${code}\nthis.html = agentPanel({ id: 'PF-0001' });`, context);
  return context.html;
}

// PF-0145: the panel offers Send only on a verified connection; until then (and when the check
// is never answered) it is Terminal mode, a normal way to work, never a warning.
test('a connected Claude Code that is still being checked offers Copy for terminal, not Send', () => {
  const html = panel({ provider: 'claude', connected: true, status: 'connected', mode: null, channel: 'checking' });
  assert.match(html, /Checking the connection…/);
  assert.doesNotMatch(html, /<textarea[^>]*disabled/);
  assert.match(html, /data-agent-form data-terminal>/);
  assert.match(html, /<button class="btn go" type="submit" >Copy for terminal<\/button>/);
  assert.doesNotMatch(html, /class="awarn"/);
});

test('an unverified connection is Terminal mode: one state, no error, no jargon', () => {
  const html = panel({ provider: 'claude', connected: true, status: 'connected', mode: 'default', channel: 'unverified', monitoring: true });
  assert.equal(html.match(/class="chip active"/g).length, 1, 'one connection state');
  assert.match(html, /<span class="chip active"><i><\/i>Terminal mode<\/span>/);
  assert.match(html, /Write your message here, copy it, then paste it in the Claude Code terminal\. The console shows the work as it happens\./);
  assert.match(html, />Copy for terminal<\/button>/);
  assert.doesNotMatch(html, /awarn|errbar|channelsEnabled|\bchannel\b|\bhook/i);
  // hooks alone (no channel at all) are the same Terminal mode
  const hookOnly = panel({ provider: 'claude', connected: true, status: 'working', mode: 'default', channel: 'none', monitoring: true });
  assert.match(hookOnly, /Terminal mode · working…/);
  assert.match(hookOnly, /data-agent-form data-terminal>/);
});

test('once the connection check is acknowledged the panel offers Send', () => {
  const html = panel({ provider: 'claude', connected: true, status: 'connected', mode: 'default', channel: 'verified' });
  assert.doesNotMatch(html, /Terminal mode|Checking the connection/);
  assert.doesNotMatch(html, /<textarea[^>]*disabled/);
  assert.match(html, /data-agent-form ><textarea/);
  assert.match(html, /<button class="btn go" type="submit" >Send<\/button>/);
});

test('the Arabic panel says the same states', () => {
  assert.match(panel({ provider: 'claude', connected: true, status: 'connected', mode: null, channel: 'checking' }, 'ar'), /جارٍ التحقق من الاتصال…/);
  const ar = panel({ provider: 'claude', connected: true, status: 'connected', mode: 'default', channel: 'unverified' }, 'ar');
  assert.match(ar, /وضع الترمينال/);
  assert.match(ar, />انسخ للترمينال<\/button>/);
  assert.match(panel({ provider: 'claude', connected: true, status: 'connected', mode: 'default', channel: 'verified' }, 'ar'), />ابعت<\/button>/);
});

test('each message shows its own state, by chat id, in both languages', () => {
  const session = { provider: 'claude', connected: true, status: 'connected', mode: 'default', channel: 'verified' };
  const events = [
    { type: 'message.sent', text: 'one', chatId: 'aaaaaaaa', route: 'direct', state: 'sending' },
    { type: 'message.sent', text: 'two', chatId: 'bbbbbbbb', route: 'direct', state: 'sending' },
    { type: 'message.sent', text: 'three', chatId: 'cccccccc', route: 'terminal', state: 'copied' },
    { type: 'message.sent', text: 'four', chatId: 'dddddddd', route: 'direct', state: 'sending' },
    { type: 'message.state', chatId: 'bbbbbbbb', state: 'received' },
    { type: 'message.state', chatId: 'aaaaaaaa', state: 'unconfirmed' },
    { type: 'message.state', chatId: 'dddddddd', state: 'answered' }
  ];
  const html = panel(session, 'en', events);
  const state = (text) => new RegExp(`<p>${text}</p><span class="amsg-state[^"]*" data-msg-state="([a-z]+)"`).exec(html)?.[1];
  assert.deepEqual([state('one'), state('two'), state('three'), state('four')], ['unconfirmed', 'received', 'copied', 'answered']);
  assert.match(html, /Delivery unconfirmed, and it was not sent again\./);
  assert.match(html, /data-copy="one\n\n\[yallaflow aaaaaaaa\]" data-copy-what="terminal">Copy for terminal</);
  assert.match(html, /Received ✓/);
  assert.match(html, /Answered ✓/);
  const ar = panel(session, 'ar', events);
  assert.match(ar, /تم الاستلام ✓/);
  assert.match(ar, /تم الرد ✓/);
  assert.match(ar, /لم يتأكد وصولها، ولم تُرسل مرة أخرى/);
  // a Codex message (no chat id) shows no state line
  assert.doesNotMatch(panel(session, 'en', [{ type: 'message.sent', text: 'plain' }]), /amsg-state/);
});

test('Copy for terminal copies inside the click and records the message without sending it', () => {
  assert.match(app, /const viaTerminal = e\.target\.hasAttribute\('data-terminal'\); const chatId = viaTerminal \? newChatId\(\) : null; if \(viaTerminal\) copy\(terminalText\(text, chatId\), 'terminal'\); agentAction\('message', viaTerminal \? \{ text, terminal: true, chatId \} : \{ text \}\)/);
});

test('a failed send puts the typed message back', () => {
  assert.match(app, /\{ text \}\)\.then\(\(sent\) => \{ if \(!sent && !agentDraft\) \{ agentDraft = text; renderAgent\(\); \} \}\)/);
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
