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
    agentsOn, agentsCanEnable: true, agentsClaudeAvailable: false, agentInfo: null, agentError: null, agentBusy: false, agentDraft: '', agentLaunch: null, agentProvider: null, agentMode: 'read-only', chatOpen: true,
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

// PF-0069: the picker points to Setup → Agents when Claude Code is off here or an agent is not ready.
test('the picker links to Setup → Agents when Claude Code is off for the project', () => {
  const h = harness({ hash: '#/item/PF-0001' });
  vm.runInContext('agentsClaudeAvailable = true;', h);
  assert.match(h.panel(), /Claude Code \(experimental\) is off for this project\. <a href="#\/setup" data-setup-agents>Open Setup → Agents<\/a>/);
  vm.runInContext("agentsClaudeAvailable = false; agent.providers = [{ id: 'codex', ready: false, problems: ['codex-acp missing'], capabilities: { start: true, send: true, modes: ['read-only'] } }];", h);
  assert.match(h.panel(), /An agent is not ready\. <a href="#\/setup"/);
  vm.runInContext("agent.providers = [{ id: 'codex', ready: true, capabilities: { start: true, send: true, modes: ['read-only'] } }];", h);
  assert.doesNotMatch(h.panel(), /data-setup-agents/);
});

// PF-0093: plain Arabic for YallaFlow's blockers, and a clear "your turn" with suggestions.
test('blocker texts read in Arabic; suggestions say they only fill the box; your turn after a reply', () => {
  const code = cut('  // PF-0093: YallaFlow\'s blocker texts', '\n  // ---------- item ----------');
  const ctx = vm.createContext({ lang: 'ar' });
  vm.runInContext(`${code}\nthis.b = blockerText;`, ctx);
  assert.equal(ctx.b('context-discovery checkpoint is pending'), 'الوكيل لسه ما سجّلش «اكتشاف المشروع». ابعتله في الشات يكمّل.');
  assert.match(ctx.b('specification review is awaiting_review in the current interaction mode — awaiting approval'), /مستني مراجعتك/);
  assert.match(ctx.b('Q-002: Which currency?'), /سؤال مفتوح.*Q-002.*Which currency/);
  assert.equal(ctx.b('something new from Core'), 'something new from Core', 'unknown text stays as it is');
  ctx.lang = 'en';
  assert.equal(ctx.b('context-discovery checkpoint is pending'), 'context-discovery checkpoint is pending', 'English stays as Core wrote it');

  const session = { provider: 'codex', workId: 'PF-0001', status: 'idle' };
  const h = harness({ hash: '#/item/PF-0001', session });
  h.agent.events = [{ type: 'message.sent', text: 'hi' }, { type: 'message.done', role: 'agent', text: 'Classified it.' }];
  const html = h.panel();
  // PF-0105: the Continue button replaces the generic "waiting for your reply" line.
  assert.match(html, /data-agent-continue/);
  assert.match(html, /Suggestions \(they fill the box; you send\)/);
  const before = harness({ hash: '#/item/PF-0001', session }).panel();
  assert.doesNotMatch(before, /data-agent-continue/, 'no Continue before the agent has replied');
});

// PF-0095: the chat says plainly whose turn it is.
test('the chat says when the agent is working, waiting for an approval, or waiting for a reply', () => {
  const working = harness({ hash: '#/item/PF-0001', session: { provider: 'codex', workId: 'PF-0001', status: 'working' } });
  const ago = (m) => new Date(Date.now() - m * 60000).toISOString();
  working.agent.events = [{ type: 'message.sent', text: 'go', at: ago(4) }, { type: 'tool.started', toolCallId: 't1', title: 'Run command', at: ago(1) }];
  const line = working.panel();
  assert.match(line, /The agent is working for 4 min · last step: Run command, 1 min ago\. Nothing is needed from you/);
  const approval = harness({ hash: '#/item/PF-0001', session: { provider: 'codex', workId: 'PF-0001', status: 'working' } });
  approval.agent.pending = [{ requestId: 'r1', title: 'Run command', decisions: ['allow', 'deny'] }];
  assert.match(approval.panel(), /waiting for your approval above/);
  const reply = harness({ hash: '#/item/PF-0001', session: { provider: 'codex', workId: 'PF-0001', status: 'idle' } });
  reply.agent.events = [{ type: 'message.sent', text: 'go' }, { type: 'message.done', role: 'agent', text: 'Local or hosted?' }];
  assert.match(reply.panel(), /data-agent-continue/);
  assert.doesNotMatch(reply.panel(), /The agent is working/);
});

// PF-0100: suggestions follow the real stage.
test('suggestions follow the stage: move on after an approval, plan and design wording', () => {
  const at = (extra) => harness({ hash: '#/item/PF-0001', items: [{ id: 'PF-0001', title: 'One', state: 'paused', currentStation: 'decide', routing: 'routed', ...extra }] }).sugg().at(-1);
  assert.match(at({ stage: 'SPECIFICATION', blocker: null, nextAction: 'yallaflow advance PF-0001' }), /move PF-0001 to the plan stage/);
  assert.match(at({ stage: 'SPECIFICATION', blocker: 'specification checkpoint is in_progress', nextAction: 'yallaflow checkpoint PF-0001 --skill specification --complete' }), /Prepare the specification/);
  assert.match(at({ stage: 'PLAN', blocker: 'implementation-planning checkpoint is pending' }), /Prepare the implementation plan/);
  assert.match(at({ stage: 'DESIGN', blocker: 'design-exploration checkpoint is in_progress' }), /Continue the design/);
  assert.match(at({ stage: 'PLAN', blocker: null, nextAction: 'yallaflow advance PF-0001' }), /start implementing PF-0001/);
});

// PF-0103: switching the project's single agent slot from a work item.
test('switch agent: end an idle Codex session elsewhere; hand over from Claude Code to Codex; wait while working', () => {
  const items = [{ id: 'PF-0001', title: 'One', state: 'active', currentStation: 'change' }, { id: 'PF-0002', title: 'Two', state: 'paused', currentStation: 'understand' }];
  const idle = harness({ hash: '#/item/PF-0002', items, session: { provider: 'codex', workId: 'PF-0001', status: 'idle' } }).panel();
  assert.match(idle, /data-agent-switch-end/);
  assert.match(idle, /End the PF-0001 session and work here/);
  const busy = harness({ hash: '#/item/PF-0002', items, session: { provider: 'codex', workId: 'PF-0001', status: 'working' } }).panel();
  assert.doesNotMatch(busy, /data-agent-switch-end/);
  assert.match(busy, /Codex is working on PF-0001\. Wait/);
  // PF-0109: a pending approval on the other item is named, with a button to open it.
  const waiting = harness({ hash: '#/item/PF-0002', items, session: { provider: 'codex', workId: 'PF-0001', status: 'working' } });
  waiting.agent.pending = [{ requestId: 'r1', title: 'Run command', decisions: ['allow', 'deny'] }];
  const w = waiting.panel();
  assert.match(w, /PF-0001: the agent needs your approval/);
  assert.match(w, /data-chat-item="PF-0001" data-chat-draft="">Open PF-0001/);
  const claude = harness({ hash: '#/item/PF-0002', items, session: { provider: 'claude', workId: null, status: 'connected', connected: true, mode: 'default' } });
  claude.agent.providers.push({ id: 'claude', ready: true, capabilities: { start: false, send: true, modes: [] } });
  assert.match(claude.panel(), /data-agent-switch-codex="PF-0002"/);
  const claudeBusy = harness({ hash: '#/item/PF-0002', items, session: { provider: 'claude', workId: null, status: 'working', connected: true, mode: 'default' } }).panel();
  assert.match(claudeBusy, /Claude Code is working\. Wait/);
  assert.doesNotMatch(claudeBusy, /data-agent-switch-codex/);
});

// PF-0105: the chat asks for the whole job and shows one action for what is needed.
test('chat: whole-job first message, one action (review, answer, continue), steps grouped', () => {
  const session = { provider: 'codex', workId: 'PF-0001', status: 'idle' };
  const fresh = harness({ hash: '#/item/PF-0001', session });
  const html = fresh.panel();
  assert.match(html, /Work on PF-0001 to the end: classify it/, 'the box holds the whole-job instruction before the first message');
  const review = harness({ hash: '#/item/PF-0001', session, items: [{ id: 'PF-0001', title: 'One', state: 'you', currentStation: 'decide', waitingFor: { kind: 'review', gate: 'specification' } }] });
  review.agent.events = [{ type: 'message.sent', text: 'go' }, { type: 'message.done', role: 'agent', text: 'Spec ready.' }];
  const r = review.panel();
  assert.match(r, /data-gate="specification" data-gate-item="PF-0001"/);
  assert.doesNotMatch(r, /data-agent-continue/, 'a review is the action, not Continue');
  const question = harness({ hash: '#/item/PF-0001', session, items: [{ id: 'PF-0001', title: 'One', state: 'you', currentStation: 'understand', waitingFor: { kind: 'question', questions: ['Q-001'] } }] });
  question.agent.events = [{ type: 'message.sent', text: 'go' }, { type: 'message.done', role: 'agent', text: 'Which currency?' }];
  assert.match(question.panel(), /data-act="answer" data-act-item="PF-0001"/);
  const steps = harness({ hash: '#/item/PF-0001', session });
  steps.agent.events = [{ type: 'message.sent', text: 'go' }, ...['a', 'b', 'c'].map((id) => ({ type: 'tool.started', toolCallId: id, title: `yallaflow ${id}`, status: 'completed' })), { type: 'message.done', role: 'agent', text: 'Done.' }];
  const stepsHtml = steps.panel();
  assert.match(stepsHtml, /<details class="atools">/);
  assert.match(stepsHtml, /3 steps/);
  assert.match(stepsHtml, /<details class="asugg-more">/, 'other suggestions are folded');
});

// PF-0106: a call from the agent is visible from project pages and leads to the item's chat.
test('attention: a pending permission or a finished turn on an item shows on project pages and opens that chat', () => {
  const pending = harness({ hash: '#/map', session: { provider: 'codex', workId: 'PF-0001', status: 'working' } });
  pending.agent.pending = [{ requestId: 'r1', title: 'Run command', decisions: ['allow', 'deny'] }];
  const dock = pending.dock();
  assert.match(dock, /class="chatcall" data-chat-item="PF-0001"/);
  assert.match(dock, /PF-0001: the agent needs your approval/);
  assert.match(dock, /class="chatfab[^"]*" data-chat-item="PF-0001"/, 'the corner button opens that item, not the project chat');
  const reply = harness({ hash: '#/map', session: { provider: 'codex', workId: 'PF-0001', status: 'idle' } });
  reply.agent.events = [{ type: 'message.sent', text: 'go' }, { type: 'message.done', role: 'agent', text: 'Done.' }];
  assert.match(reply.dock(), /PF-0001: the agent finished and waits for you/);
  const quiet = harness({ hash: '#/map', session: { provider: 'codex', workId: 'PF-0001', status: 'working' } });
  quiet.agent.events = [{ type: 'message.sent', text: 'go' }];
  assert.doesNotMatch(quiet.dock(), /chatcall/, 'nothing while it works');
  assert.match(quiet.dock(), /data-chat-toggle/);
});

// PF-0110: a finished item's open session is handed over in one click, and asks nothing.
test('a finished item holding the session: one Start button here, and no "waits for you" call-out', () => {
  const items = [{ id: 'PF-0007', title: 'Done one', state: 'done', currentStation: 'remember' }, { id: 'PF-0005', title: 'Next', state: 'new', routing: 'pending' }];
  const h = harness({ hash: '#/item/PF-0005', items, session: { provider: 'codex', workId: 'PF-0007', status: 'idle' } });
  h.agent.events = [{ type: 'message.sent', text: 'go' }, { type: 'message.done', role: 'agent', text: 'Finished.' }];
  const html = h.panel();
  assert.match(html, /data-agent-switch-start="PF-0005"/);
  assert.match(html, /Start PF-0005 with Codex/);
  assert.match(html, /Work on PF-0005 to the end/, 'the button shows the message it sends');
  assert.doesNotMatch(html, /data-agent-switch-end/);
  const board = harness({ hash: '#/map', items, session: { provider: 'codex', workId: 'PF-0007', status: 'idle' } });
  board.agent.events = h.agent.events;
  assert.doesNotMatch(board.dock(), /chatcall/, 'a done item never waits for the developer');
});
