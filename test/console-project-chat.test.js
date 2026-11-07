// PF-0067: the floating agent chat follows the page. A work item page is that item's chat;
// the other project pages share one project chat that is not tied to a work item.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const app = await readFile(new URL('../resources/console/app.js', import.meta.url), 'utf8');
const cut = (from, to) => { const start = app.indexOf(from); assert.ok(start >= 0, from); return app.slice(start, app.indexOf(to, start)); };
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function harness({ hash = '#/map', session = null, agentsOn = true, lang = 'en', items = [{ id: 'PF-0001', title: 'One', state: 'active', currentStation: 'change' }] } = {}) {
  const code = [
    cut('  const route = () =>', '  const curIndex ='),
    cut('  function richInline(', '  const overviewExpanded'),
    cut('  const PROVIDER =', '  const isForbidden ='), cut('  const isForbidden =', '  async function agentPost('),
    cut('  function agentEntries(', '  function toggleChat('),
    cut('  // ---------- continuing a stopped work item', '  function agentPanel('),
    cut('  function agentPanel(', '  // Returns false when the action failed.'),
    cut('  function agentOffPanel(', '\n  }\n') + '\n  }\n'
  ].join('\n');
  const context = vm.createContext({
    location: { hash }, snap: { items, project: { activeWork: null } }, pid: 'p', readOnly: false,
    agentsOn, agentsCanEnable: true, agentInfo: null, agentError: null, agentBusy: false, agentDraft: '', agentLaunch: null, agentProvider: null, agentMode: 'read-only', chatOpen: true,
    agent: { pid: 'p', session, events: [], resumable: [], history: [], pending: [], providers: [{ id: 'codex', ready: true, capabilities: { start: true, send: true, modes: ['read-only'] } }] },
    A: (ar, en) => (lang === 'ar' ? ar : en), L: (value) => value?.[lang] ?? String(value ?? ''), esc, ago: () => '',
    MODE_LABEL: { 'read-only': { ar: 'قراءة', en: 'Read only' } },
    stIndex: () => 0, ST: [],
    store: { get: (key, fallback) => fallback, set() {} },
    document: { querySelector: () => null }
  });
  vm.runInContext(`${code}\nthis.ctx = () => chatCtx(); this.dock = () => agentDock(chatCtx()); this.panel = () => agentPanel(chatCtx()); this.sugg = () => suggestions(chatCtx());`, context);
  return context;
}

test('every project page gets the project chat; a work item page gets its own; new-project pages get none', () => {
  for (const view of ['overview', 'map', 'lines', 'setup', 'team', 'insights']) assert.equal(harness({ hash: `#/${view}` }).ctx()?.project, true, view);
  assert.equal(harness({ hash: '#/item/PF-0001' }).ctx().id, 'PF-0001');
  assert.equal(harness({ hash: '#/new' }).ctx(), null);
  assert.equal(harness({ hash: '#/projects' }).ctx(), null);
  assert.equal(harness({ hash: '#/item/PF-9999' }).ctx(), null, 'an unknown item has no chat');
});

test('the project chat is labelled, starts no work item and suggests project questions', () => {
  const h = harness();
  assert.match(h.dock(), /Agent · Project<\/b>/);
  const html = h.panel();
  assert.match(html, /Project chat: not tied to a work item/);
  assert.doesNotMatch(html, /data-agent-activate/, 'no "Make it active" for the project');
  assert.match(html, /data-agent-start/);
  const s = h.sugg();
  assert.equal(s.length, 3);
  assert.ok(s.every((text) => !/PF-\d/.test(text)));
  assert.match(harness({ lang: 'ar' }).dock(), /الوكيل · المشروع/);
});

test('a running item session shows on project pages as a link to that item', () => {
  for (const provider of ['codex', 'claude']) {
    const html = harness({ session: { provider, workId: 'PF-0001', status: 'idle', connected: true } }).panel();
    assert.match(html, /session is active for <\/?a?[^>]*href="#\/item\/PF-0001"/, provider);
    assert.doesNotMatch(html, /data-agent-form/, `${provider}: no composer for another item's session`);
  }
});

test('a project session shows on an item page labelled as the project chat', () => {
  const html = harness({ hash: '#/item/PF-0001', session: { provider: 'codex', workId: null, status: 'idle', mode: 'read-only' } }).panel();
  assert.match(html, /This is the project chat session; it is not tied to this work item/);
  assert.match(html, /data-agent-form/);
});

test('with agents off the project chat explains how to turn them on without naming an item', () => {
  const html = harness({ agentsOn: false }).panel();
  assert.match(html, /Ask the agent about the project from here/);
  assert.doesNotMatch(html, /PF-0001/);
});

test('the item chat is unchanged', () => {
  const h = harness({ hash: '#/item/PF-0001' });
  assert.match(h.dock(), /Agent · <span class="ltr">PF-0001<\/span>/);
  assert.match(h.panel(), /data-agent-activate="PF-0001"/);
});
