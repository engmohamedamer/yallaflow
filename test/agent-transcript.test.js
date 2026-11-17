// PF-0165: the chat transcript. A long streamed reply no longer pushes the question out; the
// conversation is saved and comes back after a console restart; older messages load a page at
// a time with no gap and no repeat; the page merges instead of replacing, shows every loaded
// entry, and tells apart "not loaded yet", "folded", "could not load" and "not kept".
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, stat, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { AgentBridge } from '../src/agents/bridge.js';
import { agentEvent } from '../src/agents/events.js';
import { Transcript, mergeEvent, TRANSCRIPT_FILE, TRANSCRIPT_OLDER_FILE } from '../src/agents/transcript.js';
import { initWorkspace } from '../src/core/workspace.js';

const POSIX = process.platform !== 'win32';
async function checkout() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yf-transcript-'));
  await initWorkspace(root, 'T', 'greenfield', 'adaptive');
  return root;
}
const bridgeFor = (root, sent = []) => new AgentBridge({ projects: [{ id: 'p', root, name: 'T' }], broadcast: (_id, event) => sent.push(event), env: { PATH: '/nonexistent' } });
const chatDir = (root) => path.join(root, '.yallaflow', 'local', 'agent-chat');
const textOf = (events) => events.filter((e) => e.type === 'message.delta').map((e) => e.text).join('');

test('a long streamed reply is one entry: the question above it is never pushed out', async () => {
  const root = await checkout();
  const sent = [];
  const bridge = bridgeFor(root, sent);
  const project = bridge.projects.get('p');
  bridge.emit(project, agentEvent('message.sent', { text: 'My question' }));
  for (let i = 0; i < 1500; i++) bridge.emit(project, agentEvent('message.delta', { role: 'agent', text: `w${i} ` }));
  bridge.emit(project, agentEvent('turn.ended', { stopReason: 'end_turn' }));
  const status = await bridge.status('p');
  assert.deepEqual(status.events.map((e) => e.type), ['message.sent', 'message.delta', 'turn.ended']);
  assert.equal(status.events[0].text, 'My question');
  assert.ok(textOf(status.events).startsWith('w0 w1 ') && textOf(status.events).endsWith('w1499 '), 'the whole reply, from its first word');
  assert.equal(sent.length, 1502, 'the page still receives every chunk as it arrives');
  assert.ok(sent.every((e, i) => i === 0 || e.n > sent[i - 1].n), 'event numbers only grow');
  assert.deepEqual(status.transcript, { hasOlder: false, saved: true });
  await bridge.close();
});

test('the conversation is saved (private, secrets redacted) and comes back after a console restart', async () => {
  const root = await checkout();
  let bridge = bridgeFor(root);
  assert.equal((await bridge.status('p')).events.length, 0);
  assert.equal(existsSync(chatDir(root)), false, 'reading the chat creates nothing');
  let project = bridge.projects.get('p');
  bridge.emit(project, agentEvent('message.sent', { text: 'Deploy with TOKEN=abcd1234efgh5678ijkl please' }));
  bridge.emit(project, agentEvent('message.delta', { role: 'agent', text: 'Part one, ' }));
  bridge.emit(project, agentEvent('message.delta', { role: 'agent', text: 'part two.' }));
  bridge.emit(project, agentEvent('permission.requested', { requestId: 'r1', title: 'Run npm ci', decisions: ['allow', 'deny'], provider: 'codex' }));
  const lastBefore = (await bridge.status('p')).events.at(-1).n;
  await bridge.close();

  const file = path.join(chatDir(root), TRANSCRIPT_FILE);
  const saved = await readFile(file, 'utf8');
  assert.ok(!saved.includes('abcd1234efgh5678ijkl'), 'a secret-looking value is never written');
  assert.match(saved, /TOKEN=<redacted>/);
  assert.equal(saved.trim().split('\n').filter((line) => line.includes('"message.delta"')).length, 1, 'chunks of one reply are one saved line');
  if (POSIX) assert.equal((await stat(file)).mode & 0o077, 0, 'readable only by this user');
  assert.match(await readFile(path.join(root, '.yallaflow', 'local', '.gitignore'), 'utf8'), /\*/, 'the folder is git-ignored');

  bridge = bridgeFor(root); // a new console run
  const restored = (await bridge.status('p')).events;
  assert.ok(restored.length >= 3);
  assert.ok(restored.every((e) => e.restored === true), 'history is marked as history');
  assert.equal(textOf(restored), 'Part one, part two.');
  assert.equal(bridge.glance('p').lastStep, null, 'restored history says nothing about what the agent does now');
  project = bridge.projects.get('p');
  bridge.emit(project, agentEvent('message.sent', { text: 'And now?' }));
  const now = (await bridge.status('p')).events;
  assert.ok(now.at(-1).n > lastBefore, 'numbers keep growing across restarts');
  assert.equal(now.at(-1).restored, undefined);
  assert.equal(now.filter((e) => e.type === 'message.sent').length, 2, 'old and new together, nothing twice');
  await bridge.close();
});

test('older messages load a page at a time: no gap, no repeat, and an honest end', async () => {
  const root = await checkout();
  const bridge = bridgeFor(root);
  const project = bridge.projects.get('p');
  for (let i = 0; i < 650; i++) bridge.emit(project, agentEvent('message.sent', { text: `m${i}` }));
  const status = await bridge.status('p');
  assert.equal(status.events.length, 200);
  assert.equal(status.transcript.hasOlder, true, 'saved messages not loaded yet are announced');
  let all = [...status.events];
  let pages = 0;
  for (let more = true; more;) {
    const page = await bridge.transcript('p', { before: all[0].n, limit: 100 });
    assert.ok(page.events.length > 0 && page.events.length <= 100);
    all = [...page.events, ...all];
    more = page.hasOlder;
    pages += 1;
    assert.ok(pages < 20);
  }
  assert.deepEqual(all.map((e) => e.text), Array.from({ length: 650 }, (_x, i) => `m${i}`), 'every message once, in order (also those memory no longer holds)');
  assert.equal(new Set(all.map((e) => e.n)).size, 650);
  await assert.rejects(bridge.transcript('p', { before: 'x' }), { code: 'BAD_REQUEST' });
  await assert.rejects(bridge.transcript('nope', { before: 5 }), { code: 'NOT_FOUND' });
  assert.deepEqual(await bridge.transcript('p', { before: all[0].n }), { events: [], hasOlder: false });
  await bridge.close();
});

test('the saved history is bounded and the bound is real: one older file is kept; a damaged file loses only its bad lines', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yf-transcript-dir-'));
  const make = () => new Transcript({ dirFor: async () => dir, readDir: async () => dir, maxBytes: 2000, flushMs: 5 });
  const t = make();
  for (let i = 0; i < 60; i++) t.add({ type: 'message.sent', text: `message number ${i} ${'x'.repeat(40)}` });
  await t.flush();
  assert.ok(existsSync(path.join(dir, TRANSCRIPT_OLDER_FILE)), 'rotated once the limit is reached');
  assert.ok((await stat(path.join(dir, TRANSCRIPT_FILE))).size <= 2000);
  const kept = await make().older(Number.MAX_SAFE_INTEGER, 200);
  assert.ok(kept.events.length < 60 && kept.events.length > 5, 'older than the two files is not kept');
  assert.equal(kept.events.at(-1).text.startsWith('message number 59 '), true, 'the newest is always there');
  // a cut-off or foreign line is skipped, the rest is read
  await writeFile(path.join(dir, TRANSCRIPT_FILE), `{"type":"message.sent","n":5,"text":"ok"}\n{"type":"mess\nnot json\n{"n":"7"}\n{"type":"message.sent","n":9,"text":"also ok"}\n`);
  await writeFile(path.join(dir, TRANSCRIPT_OLDER_FILE), '');
  assert.deepEqual((await make().older(Number.MAX_SAFE_INTEGER)).events.map((e) => e.text), ['ok', 'also ok']);
  // a failed write is reported, and the conversation continues in memory
  const broken = new Transcript({ dirFor: async () => { throw new Error('disk full'); }, readDir: async () => null });
  broken.add({ type: 'message.sent', text: 'kept in memory' });
  await broken.flush();
  const latest = await broken.latest();
  assert.equal(latest.events[0].text, 'kept in memory');
  assert.match(latest.saveError, /disk full/);
});

test('merging: only consecutive chunks of the same kind join; anything between them starts a new entry', () => {
  const list = [];
  for (const event of [{ type: 'message.delta', n: 1, text: 'a' }, { type: 'message.delta', n: 2, text: 'b' }, { type: 'tool.started', n: 3, title: 't' }, { type: 'message.delta', n: 4, text: 'c' }, { type: 'thought.delta', n: 5, text: 'x' }, { type: 'message.sent', n: 6, text: 'u' }, { type: 'message.sent', n: 7, text: 'v' }]) mergeEvent(list, event);
  assert.deepEqual(list.map((e) => [e.type, e.text ?? e.title, e.n, e.endN ?? null]), [['message.delta', 'ab', 1, 2], ['tool.started', 't', 3, null], ['message.delta', 'c', 4, null], ['thought.delta', 'x', 5, null], ['message.sent', 'u', 6, null], ['message.sent', 'v', 7, null]]);
});

// ---- the page (evaluated from the shipped app.js with minimal stand-ins) ----
const app = await readFile(new URL('../resources/console/app.js', import.meta.url), 'utf8');
const cut = (from, to) => { const start = app.indexOf(from); assert.ok(start >= 0, from); const end = app.indexOf(to, start); assert.ok(end > start, to); return app.slice(start, end); };
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plain = (value) => JSON.parse(JSON.stringify(value));

function page({ agent = null, status = null, lang = 'en', failWith = null } = {}) {
  const calls = { api: [], renders: 0 };
  const context = vm.createContext({
    A: (ar, en) => (lang === 'ar' ? ar : en), esc, JSON, Object, Boolean, Number, String, Set, Infinity,
    pid: 'p', agentsOn: true, agent, agentError: null, chatCtx: () => ({ id: 'PF-0001' }), switchWanted: null, route: () => ({ v: 'item' }),
    api: async (url) => { calls.api.push(url); if (failWith) throw new Error(failWith); return typeof status === 'function' ? status(url) : status; },
    document: { querySelector: () => null }, renderAgent: () => { calls.renders += 1; }, render() {}, refreshAgentSetup() {}, byId: () => null, loadForView() {}
  });
  vm.runInContext(`${cut('  async function loadAgent() {', '  // The chat window body is what scrolls')}
    ${cut('  let chatHold = false;', '  function chatAtEnd() {').replace(/function syncChatJump\(\) \{[\s\S]*$/, '')}
    let chatOlder = { busy: false, error: null };
    globalThis.fx = { load: loadAgent, older: loadOlderChat, on: onAgentEvent, adopt: adoptAgentEvents, get: () => agent, err: () => agentError, olderState: () => chatOlder };`, context);
  return { fx: context.fx, calls };
}
const ev = (n, type = 'message.sent', extra = {}) => ({ n, type, text: `t${n}`, ...extra });

test('the page merges a state reload into what it shows: nothing disappears, nothing repeats, late events are kept', async () => {
  const merged = { n: 40, endN: 49, type: 'message.delta', text: 'whole reply' };
  // the page holds older loaded events (10-19), the reply as chunks (40-45 so far) and one event newer than the snapshot (60)
  const held = [...Array.from({ length: 10 }, (_x, i) => ev(10 + i)), ev(30), ...Array.from({ length: 6 }, (_x, i) => ({ n: 40 + i, type: 'message.delta', text: 'c' })), ev(60)];
  const snapshot = { session: null, pending: [], events: [ev(30), merged, ev(50)], transcript: { hasOlder: true, saved: true } };
  const { fx } = page({ agent: { pid: 'p', events: held, pending: [], transcript: { hasOlder: false } }, status: snapshot });
  await fx.load();
  const events = plain(fx.get().events);
  assert.deepEqual(events.map((e) => e.n), [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 30, 40, 50, 60]);
  assert.equal(events.find((e) => e.n === 40).text, 'whole reply', 'the chunks are replaced by the complete reply, once');
  assert.equal(fx.get().transcript.hasOlder, false, 'the page already reached the start; a reload does not offer it again');
  // a chunk the reload already covered is ignored; a new one is added
  fx.on('p', { n: 45, type: 'message.delta', text: 'c' });
  fx.on('p', { n: 61, type: 'message.delta', text: ' more' });
  fx.on('other', ev(99));
  assert.deepEqual(plain(fx.get().events).map((e) => e.n).slice(-2), [60, 61]);
  // a first load takes the server's word on older messages
  const first = page({ status: snapshot });
  await first.fx.load();
  assert.deepEqual([plain(first.fx.get().events).length, first.fx.get().transcript.hasOlder], [3, true]);
});

test('the page loads older messages before its earliest one; a failure is said and can be retried', async () => {
  const start = { pid: 'p', events: [ev(100), ev(101)], pending: [], transcript: { hasOlder: true } };
  const ok = page({ agent: plain(start), status: (url) => ({ events: [ev(98), ev(99), ev(100)], hasOlder: false }) });
  await ok.fx.older();
  assert.deepEqual(ok.calls.api, ['/api/p/p/agent/transcript?before=100&limit=100']);
  assert.deepEqual(plain(ok.fx.get().events).map((e) => e.n), [98, 99, 100, 101], 'an overlapping event is not added twice');
  assert.equal(ok.fx.get().transcript.hasOlder, false);
  const bad = page({ agent: plain(start), failWith: 'network down' });
  await bad.fx.older();
  assert.deepEqual([plain(bad.fx.olderState()), plain(bad.fx.get().events).length], [{ busy: false, error: 'network down' }, 2], 'what was shown stays; the error is kept for the retry control');
  const failed = page({ failWith: 'HTTP 500' });
  await failed.fx.load();
  assert.deepEqual([failed.fx.get(), failed.fx.err()], [null, 'HTTP 500']);
});

function panelKit({ lang = 'en' } = {}) {
  const context = vm.createContext({ A: (ar, en) => (lang === 'ar' ? ar : en), L: (v) => v.en, esc, JSON, Object, Boolean, Number, String, Set, Array, agent: null, richText: (t) => `<p>${esc(t)}</p>`, messageState: () => '', readOnly: false });
  vm.runInContext(`${cut('  function agentEntries(events) {', '  // The agent chat as a floating window')}
    ${cut('  function groupSteps(entries) {', '  // PF-0105: the message that starts or continues')}
    ${cut('  let chatOlder = { busy: false, error: null }; // loading older messages', '  function agentPanel(it) {')}
    globalThis.fx = { entries: agentEntries, html: () => chatEntriesHtml(), bar: chatOlderBar, save: chatSaveNote, set: (a, o) => { agent = a; if (o) chatOlder = o; }, open: (k) => chatStepsOpen.add(k), perm: permCard };`, context);
  return context.fx;
}

test('every loaded message is shown whole; only tool steps fold, and an opened group stays open', () => {
  const fx = panelKit();
  const long = 'x'.repeat(30000);
  const events = [];
  for (let i = 0; i < 150; i++) events.push({ n: i * 3 + 1, type: 'message.sent', text: `question ${i}` }, { n: i * 3 + 2, type: 'message.delta', text: i === 0 ? long : `answer ${i}` }, { n: i * 3 + 3, type: 'turn.ended' });
  const entries = fx.entries(events);
  assert.equal(entries.filter((e) => e.kind === 'user').length, 150, 'no 80-entry cut');
  assert.equal(entries.find((e) => e.kind === 'agent').text.length, 30000, 'a long answer is not clipped');
  fx.set({ events: [{ n: 1, type: 'message.sent', text: 'go' }, ...['a', 'b', 'c'].map((id, i) => ({ n: 2 + i, type: 'tool.started', toolCallId: id, title: `npm ${id}`, status: 'completed' })), { n: 9, type: 'message.done', text: 'Final answer.' }, { n: 10, type: 'notice', text: 'Your answer was not delivered.' }] });
  let html = fx.html();
  assert.match(html, /<div class="amsg me"><p>go<\/p>/);
  assert.match(html, /<details class="atools" data-steps="a" ><summary>[\s\S]*3 steps/, 'steps fold behind a summary that says how many');
  assert.match(html, /Final answer\./);
  assert.match(html, /<div class="anote warn">Your answer was not delivered\.<\/div>/, 'a notice from the bridge is shown (it used to be dropped)');
  assert.ok(!/<details[^>]*>(?:(?!<\/details>)[\s\S])*(amsg me|Final answer)/.test(html), 'a message is never inside a folded block');
  fx.open('a');
  assert.match(fx.html(), /<details class="atools" data-steps="a" open>/);
  // a permission request restored from history cannot be answered
  const card = fx.perm({ requestId: 'r', title: 'Run npm ci', decisions: ['allow', 'deny'], restored: true });
  assert.ok(!/data-agent-perm/.test(card));
  assert.match(card, /no longer open/);
  assert.match(fx.perm({ requestId: 'r', title: 'Run npm ci', decisions: ['allow', 'deny'] }), /data-agent-perm="r"/);
});

test('the reader is told which case applies: not loaded yet, loading, could not load, or the declared limit', () => {
  for (const lang of ['en', 'ar']) {
    const fx = panelKit({ lang });
    const events = [{ n: 5, type: 'message.sent', text: 'q' }];
    fx.set({ events, transcript: { hasOlder: true, saved: true } }, { busy: false, error: null });
    assert.match(fx.bar(), /data-chat-older="more"[\s\S]*data-chat-older-load/);
    assert.match(fx.bar(), lang === 'en' ? /older saved messages that are not loaded yet/ : /رسائل أقدم محفوظة لم تُحمَّل بعد/);
    fx.set({ events, transcript: { hasOlder: true } }, { busy: true, error: null });
    assert.match(fx.bar(), /data-chat-older="busy"/);
    fx.set({ events, transcript: { hasOlder: true } }, { busy: false, error: 'x' });
    assert.match(fx.bar(), /data-chat-older="error"[\s\S]*data-chat-older-load/);
    assert.match(fx.bar(), lang === 'en' ? /they are saved, not deleted/ : /محفوظة ولم تُحذف/);
    fx.set({ events, transcript: { hasOlder: false, saved: true } }, { busy: false, error: null });
    assert.match(fx.bar(), /data-chat-older="start"/);
    assert.match(fx.bar(), lang === 'en' ? /About the last 16 MB of conversation is kept; anything older is not saved/ : /الأقدم من ذلك لا يُحفظ/);
    fx.set({ events: [], transcript: {} }, { busy: false, error: null });
    assert.equal(fx.bar(), '');
    fx.set({ events, transcript: { saveError: 'disk full' } });
    assert.match(fx.save(), /data-chat-save-error[\s\S]*disk full/);
  }
});

test('the panel keeps the conversation readable without a session, offers a retry on a failed load, and never pulls a reader down', () => {
  assert.match(app, /const past = chatEntriesHtml\(\);\s*\n\s*const earlier = past \? `<div class="apast" data-chat-past>/);
  assert.match(app, /if \(\(!agent \|\| agent\.pid !== pid\) && agentError\) return `<section class="panel agent" id="agent"><div class="errbar data small" role="alert">[\s\S]{0,400}data-agent-retry/);
  assert.match(app, /const stick = !chatHold && \(chatForceEnd \|\| chatAtEnd\(\)\);/);
  assert.match(app, /if \(!stick && !chatHold\) chatUnseen = true;/);
  assert.match(app, /if \(after && before !== null\) after\.scrollTop = after\.scrollHeight - before;/, 'loading older messages keeps the reading position');
  assert.match(app, /btn\.textContent = chatUnseen \? A\('رسائل جديدة ↓', 'New messages ↓'\) : A\('انتقل لآخر المحادثة ↓', 'Jump to latest ↓'\);/);
  assert.doesNotMatch(app, /agent\.events\.length > 400/);
});

test('owner review: the panel says where the chat is kept, offers the save setting and a confirmed delete, and never claims perfect redaction', () => {
  for (const lang of ['en', 'ar']) {
    const fx = panelKit({ lang });
    fx.set({ events: [{ n: 1, type: 'message.sent', text: 'q' }], transcript: { saved: true } });
    let html = fx.save();
    assert.match(html, /data-chat-keep/);
    assert.match(html, /data-chat-save-toggle checked/);
    assert.match(html, /data-chat-clear/);
    assert.match(html, /\.yallaflow\/local\/agent-chat/);
    assert.match(html, lang === 'en' ? /does not guarantee every secret is caught/ : /لا يضمن إخفاء كل سر/);
    assert.ok(!/data-chat-save-off/.test(html));
    fx.set({ events: [{ n: 1, type: 'message.sent', text: 'q' }], transcript: { saved: false } });
    html = fx.save();
    assert.match(html, /data-chat-save-toggle >/, 'unchecked when saving is off');
    assert.match(html, /data-chat-save-off/);
    assert.match(html, lang === 'en' ? /What was saved before is kept as it is/ : /ما حُفظ من قبل باقٍ كما هو/);
    fx.set({ events: [], transcript: { readError: 'transcript.jsonl is larger than 64 MB and was not read.' } });
    assert.match(fx.save(), /data-chat-read-error[\s\S]*64 MB/, 'a file too large to read is said, never silently skipped');
  }
  // the delete goes through a confirm() and a confirmed request; a cleared event empties the view
  assert.match(app, /\[data-chat-clear\]'\)\) \{\n\s+if \(!confirm\(/);
  assert.match(app, /agentAction\('clear-history', \{ confirm: true \}/);
  assert.match(app, /event\.type === 'chat\.cleared'\) \{ agent\.events = \[\];/);
});
