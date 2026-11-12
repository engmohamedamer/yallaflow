// PF-0066: when an agent session on a work item stops, the console says why, keeps the stop
// in the git-ignored session record, and offers to continue the item with another agent.
// The provider is SIMULATED (test-support/fake-acp-agent.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { stopFrom } from '../src/agents/bridge.js';
import { consoleWith, fakeTools, project } from '../test-support/agent-fixtures.js';

test('stopFrom: a usage limit is recognised with its retry time; other stops keep their reason', () => {
  const limit = stopFrom('error', "You've hit your usage limit. Try again at 10:35 PM.");
  assert.equal(limit.reason, 'usage_limit');
  assert.equal(limit.retryAt, '10:35 PM');
  assert.equal(stopFrom('error', 'Rate limit reached, try again in 5 minutes').retryAt, '5 minutes');
  assert.equal(stopFrom('error', 'Internal error').reason, 'error');
  assert.equal(stopFrom('crashed', 'crashed').reason, 'crashed');
  assert.ok(stopFrom('error', 'x'.repeat(1000)).detail.length <= 300);
});

test('codex: a usage-limit turn is a stop with its retry time, kept after End and across a console restart', async () => {
  const { root, workId } = await project();
  const tools = await fakeTools();
  let c = await consoleWith(root, { agents: true, agentEnv: tools.env });
  try {
    await c.post('start', { provider: 'codex', workId, mode: 'read-only' });
    await c.post('message', { text: 'LIMIT reached' });
    const stopped = await c.waitFor((e) => e.type === 'session.stopped');
    assert.equal(stopped.provider, 'codex');
    assert.equal(stopped.workId, workId);
    assert.equal(stopped.stop.reason, 'usage_limit');
    assert.equal(stopped.stop.retryAt, '10:35 PM');
    await c.waitFor((e) => e.type === 'turn.ended');
    let history = (await c.status()).history;
    assert.equal(history[0].workId, workId);
    assert.equal(history[0].lastStop.reason, 'usage_limit');
    assert.equal((await c.post('end', {})).status, 200);
    history = (await c.status()).history;
    assert.equal(history[0].status, 'ended');
    assert.equal(history[0].lastStop.reason, 'usage_limit', 'ending after a limit keeps the limit as the reason');
  } finally {
    await c.close();
  }
  c = await consoleWith(root, { agents: true, agentEnv: tools.env });
  try {
    const status = await c.status();
    assert.equal(status.session, null);
    assert.equal(status.history[0].lastStop.reason, 'usage_limit', 'the stop survives a console restart');
  } finally {
    await c.close();
  }
});

test('codex: a crash and a plain End are recorded as such', async () => {
  const { root, workId } = await project();
  const tools = await fakeTools();
  const c = await consoleWith(root, { agents: true, agentEnv: tools.env });
  try {
    await c.post('start', { provider: 'codex', workId });
    await c.post('message', { text: 'CRASH now' });
    const crashed = await c.waitFor((e) => e.type === 'session.stopped' && e.stop?.reason === 'crashed');
    assert.equal(crashed.workId, workId);
    assert.equal((await c.status()).history[0].lastStop.reason, 'crashed', 'saved before it is announced');
    await c.post('start', { provider: 'codex', workId });
    assert.equal((await c.post('end', {})).status, 200);
    const [latest] = (await c.status()).history;
    assert.equal(latest.lastStop.reason, 'ended');
  } finally {
    await c.close();
  }
});

// ---- the console UI, run over the shipped code ----
const app = await readFile(new URL('../resources/console/app.js', import.meta.url), 'utf8');
const cut = (from, to) => { const start = app.indexOf(from); assert.ok(start >= 0, from); return app.slice(start, app.indexOf(to, start)); };
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function ui({ session = null, events = [], history = [], providers, lang = 'en', post = async () => ({}) } = {}) {
  const code = [cut('  const PROVIDER =', '  const isForbidden ='), cut('  async function agentAction(', '  // The one thing to do next'), cut('  // ---------- continuing a stopped work item', '  function agentPanel(')].join('\n');
  const calls = [];
  const context = vm.createContext({
    readOnly: false, agentBusy: false, agentError: null, agentDraft: '', agentLaunch: null, agentProvider: null, agentMode: 'read-only',
    agent: { session, events, history, providers: providers ?? [{ id: 'codex', ready: true }, { id: 'claude', ready: true }] },
    A: (ar, en) => (lang === 'ar' ? ar : en), L: (value) => value?.[lang], esc, ago: () => 'just now',
    renderAgent() {}, loadAgent: async () => {}, calls,
    // PF-0134: Connect also asks the server to open a terminal.
    agentTerminal: null, pid: 'p', why: (e) => e.message, post: async (url) => { calls.push(['open-terminal', url]); return { opened: true, terminal: 'xterm' }; },
    agentPost: async (action, body) => { calls.push([action, body]); return post(action, body); }
  });
  vm.runInContext(`${code}\nthis.card = (it) => stopCard(it); this.hist = (it) => sessionHistory(it); this.switchTo = async (to, it) => { await switchAgent(to, it); return { draft: agentDraft, launch: agentLaunch }; };`, context);
  return context;
}
const item = { id: 'PF-0007' };
const limitStop = { reason: 'usage_limit', detail: "You've hit your usage limit. Try again at 10:35 PM.", retryAt: '10:35 PM' };

test('UI: a live Codex usage limit offers Claude Code and a terminal message, not Codex again', () => {
  const c = ui({ session: { provider: 'codex', workId: 'PF-0007', status: 'idle' }, events: [{ type: 'message.sent' }, { type: 'session.stopped', provider: 'codex', stop: limitStop }] });
  const html = c.card(item);
  assert.match(html, /Codex reached its subscription usage limit\./);
  assert.match(html, /after 10:35 PM/);
  assert.match(html, /data-agent-switch="claude"/);
  assert.doesNotMatch(html, /data-agent-switch="codex"/);
  assert.match(html, /data-copy="Continue PF-0007\. The previous agent \(Codex\)/);
  assert.match(html, /sent only when you press Send/);
});

test('UI: a session started after the stop (the switch itself) clears the card', () => {
  const c = ui({ session: { provider: 'claude', workId: 'PF-0007', connected: false }, events: [{ type: 'session.stopped', provider: 'codex', stop: { reason: 'ended' } }, { type: 'session.started', provider: 'claude' }] });
  assert.equal(c.card(item), '');
});

test('UI: a message sent after the stop clears the card; another item never shows it', () => {
  const sent = ui({ session: { provider: 'codex', workId: 'PF-0007', status: 'idle' }, events: [{ type: 'session.stopped', provider: 'codex', stop: limitStop }, { type: 'message.sent' }] });
  assert.equal(sent.card(item), '');
  const other = ui({ session: { provider: 'codex', workId: 'PF-0001', status: 'idle' }, events: [{ type: 'session.stopped', provider: 'codex', stop: limitStop }] });
  assert.equal(other.card(item), '');
});

test('UI: with no session, the last recorded stop of this item is offered, including the same agent; Arabic too', () => {
  const history = [{ id: 'a', provider: 'codex', workId: 'PF-0007', startedAt: 't', endedAt: 't', status: 'ended', lastStop: limitStop }];
  const html = ui({ history }).card(item);
  assert.match(html, /data-agent-switch="codex"/, 'after a restart the limit may have reset');
  assert.match(html, /data-agent-switch="claude"/);
  assert.match(ui({ history, lang: 'ar' }).card(item), /وصل لحد الاستخدام في الاشتراك/);
  assert.equal(ui({ history: [{ ...history[0], workId: 'PF-0001' }] }).card(item), '');
});

test('UI: only ready providers are offered', () => {
  const html = ui({ history: [{ id: 'a', provider: 'codex', workId: 'PF-0007', status: 'crashed', lastStop: { reason: 'crashed' } }], providers: [{ id: 'codex', ready: true }, { id: 'claude', ready: false }] }).card(item);
  assert.match(html, /data-agent-switch="codex"/);
  assert.doesNotMatch(html, /data-agent-switch="claude"/);
});

test('UI: switching ends Codex first, connects Claude, and prepares (never sends) the continue message', async () => {
  const c = ui({
    session: { provider: 'codex', workId: 'PF-0007', status: 'idle' },
    events: [{ type: 'session.stopped', provider: 'codex', stop: limitStop }],
    post: async (action) => (action === 'connect' ? { launch: { command: 'claude --mcp-config x' } } : {})
  });
  const result = await c.switchTo('claude', item);
  assert.deepEqual(c.calls.map(([action]) => action), ['end', 'connect', 'open-terminal']);
  assert.equal(c.calls[1][1].workId, 'PF-0007');
  assert.equal(result.launch, 'claude --mcp-config x');
  assert.match(result.draft, /^Continue PF-0007\. The previous agent \(Codex\) reached its subscription usage limit\. Start with yallaflow handoff PF-0007/);
  assert.ok(!c.calls.some(([action]) => action === 'message'), 'nothing is sent for the developer');
});

test('UI: a failed End stops the switch; nothing else starts', async () => {
  const c = ui({
    session: { provider: 'codex', workId: 'PF-0007', status: 'idle' },
    events: [{ type: 'session.stopped', provider: 'codex', stop: limitStop }],
    post: async (action) => { if (action === 'end') throw new Error('nope'); return {}; }
  });
  const result = await c.switchTo('claude', item);
  assert.deepEqual(c.calls.map(([action]) => action), ['end']);
  assert.equal(result.draft, '');
});

test('UI: the item lists which agent worked on it and how each session stopped', () => {
  const html = ui({ history: [
    { id: 'b', provider: 'claude', workId: 'PF-0007', startedAt: 't', endedAt: null, status: 'running', lastStop: null },
    { id: 'a', provider: 'codex', workId: 'PF-0007', startedAt: 't', endedAt: 't', status: 'ended', lastStop: limitStop },
    { id: 'c', provider: 'codex', workId: 'PF-0001', startedAt: 't', endedAt: 't', status: 'ended', lastStop: null }
  ] }).hist(item);
  assert.match(html, /Agent sessions on this item \(2\)<\/summary>/);
  assert.match(html, /\(2\)/);
  assert.match(html, /<b>Claude Code<\/b> · just now · running/);
  assert.match(html, /<b>Codex<\/b> · just now → just now · reached its subscription usage limit/);
});
