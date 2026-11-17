// PF-0165 (owner review 2026-11-17): the saved chat can be deleted (one project only, never
// another project's or anything else in the checkout), saving can be turned off (what is
// already saved is kept until deleted), a message is saved whole or not at all, rotation never
// splits a message across the retention limit, and streaming stays cheap per chunk.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AgentBridge } from '../src/agents/bridge.js';
import { agentEvent } from '../src/agents/events.js';
import { Transcript, TRANSCRIPT_FILE, TRANSCRIPT_OLDER_FILE } from '../src/agents/transcript.js';
import { initWorkspace } from '../src/core/workspace.js';
import { addProject } from '../src/console/registry.js';
import { startConsoleServer } from '../src/console/server.js';
import { loadPreferences, savePreferences, validatePreferencesPatch } from '../src/console/preferences.js';

const POSIX = process.platform !== 'win32';
const tmp = (prefix) => mkdtemp(path.join(os.tmpdir(), prefix));
async function checkout(name = 'T') {
  const root = path.join(await tmp('yf-chat-history-'), name);
  await initWorkspace(root, name, 'greenfield', 'adaptive');
  return root;
}
const chatDir = (root) => path.join(root, '.yallaflow', 'local', 'agent-chat');
const say = (bridge, id, text) => bridge.emit(bridge.projects.get(id), agentEvent('message.sent', { text }));
const reply = (bridge, id, parts) => { for (const part of parts) bridge.emit(bridge.projects.get(id), agentEvent('message.delta', { role: 'agent', text: part })); };

test('clearing deletes only this project\'s saved chat; another project, a lane and the rest of the checkout keep theirs', async () => {
  const a = await checkout('a');
  const b = await checkout('b');
  const lane = await checkout('a-lane');
  const sent = [];
  let bridge = new AgentBridge({ projects: [{ id: 'a', root: a, name: 'a' }, { id: 'b', root: b, name: 'b' }, { id: 'l', root: lane, name: 'lane', kind: 'lane', parent: 'a' }], broadcast: (id, event) => sent.push([id, event.type]), env: { PATH: '/nonexistent' } });
  for (const id of ['a', 'b', 'l']) { say(bridge, id, `question in ${id}`); reply(bridge, id, ['answer ', `in ${id}`]); }
  await bridge.close();
  const otherLocal = path.join(a, '.yallaflow', 'local', 'keep-me.txt');
  await writeFile(otherLocal, 'not chat');
  await writeFile(path.join(chatDir(a), 'notes.txt'), 'not a transcript file');
  const bBefore = await readFile(path.join(chatDir(b), TRANSCRIPT_FILE), 'utf8');

  bridge = new AgentBridge({ projects: [{ id: 'a', root: a, name: 'a' }, { id: 'b', root: b, name: 'b' }, { id: 'l', root: lane, name: 'lane', kind: 'lane', parent: 'a' }], broadcast: (id, event) => sent.push([id, event.type]), env: { PATH: '/nonexistent' } });
  assert.equal((await bridge.status('a')).events.length, 2, 'restored before clearing');
  sent.length = 0;
  assert.deepEqual(await bridge.clearTranscript('a'), { cleared: true });
  assert.deepEqual(sent, [['a', 'chat.cleared']], 'only this project\'s pages are told');
  assert.equal(existsSync(path.join(chatDir(a), TRANSCRIPT_FILE)), false);
  assert.equal(existsSync(path.join(chatDir(a), TRANSCRIPT_OLDER_FILE)), false);
  assert.equal(await readFile(path.join(chatDir(a), 'notes.txt'), 'utf8'), 'not a transcript file', 'only the two transcript files are removed');
  assert.equal(await readFile(otherLocal, 'utf8'), 'not chat');
  assert.deepEqual((await bridge.status('a')).events, [], 'memory is emptied too');
  assert.equal(await readFile(path.join(chatDir(b), TRANSCRIPT_FILE), 'utf8'), bBefore, 'another project is untouched');
  assert.deepEqual((await bridge.status('b')).events.map((e) => e.text), ['question in b', 'answer in b']);
  assert.deepEqual((await bridge.status('l')).events.map((e) => e.text), ['question in l', 'answer in l'], 'a lane keeps its own chat');
  await assert.rejects(bridge.clearTranscript('nope'), { code: 'NOT_FOUND' });

  // after clearing, the conversation continues and is saved again; nothing old comes back
  const lastBefore = (await bridge.status('b')).events.at(-1).n;
  say(bridge, 'a', 'fresh start');
  await bridge.close();
  bridge = new AgentBridge({ projects: [{ id: 'a', root: a, name: 'a' }], broadcast: () => {}, env: { PATH: '/nonexistent' } });
  const after = (await bridge.status('a')).events;
  assert.deepEqual(after.map((e) => e.text), ['fresh start']);
  assert.ok(after[0].n > lastBefore, 'event numbers keep growing after a clear');
  await bridge.close();
});

test('clearing removes a planted link itself and never the file it points to', { skip: !POSIX }, async () => {
  const root = await checkout();
  const outside = path.join(await tmp('yf-chat-outside-'), 'precious.txt');
  await writeFile(outside, 'do not delete');
  await mkdir(chatDir(root), { recursive: true });
  await symlink(outside, path.join(chatDir(root), TRANSCRIPT_FILE));
  const bridge = new AgentBridge({ projects: [{ id: 'p', root, name: 'T' }], broadcast: () => {}, env: { PATH: '/nonexistent' } });
  await bridge.clearTranscript('p');
  assert.equal(await readFile(outside, 'utf8'), 'do not delete');
  assert.equal(existsSync(path.join(chatDir(root), TRANSCRIPT_FILE)), false);
  await bridge.close();
});

test('with saving off nothing new is written, what was saved stays and is still shown, and it can still be deleted', async () => {
  const root = await checkout();
  let on = true;
  const make = () => new AgentBridge({ projects: [{ id: 'p', root, name: 'T' }], broadcast: () => {}, env: { PATH: '/nonexistent' }, saveChat: () => on });
  // a fresh checkout with saving off: no folder, no file
  on = false;
  let bridge = make();
  say(bridge, 'p', 'not saved');
  await bridge.close();
  assert.equal(existsSync(chatDir(root)), false, 'nothing is created');
  // saved earlier with saving on
  on = true;
  bridge = make();
  say(bridge, 'p', 'saved earlier');
  reply(bridge, 'p', ['kept ', 'answer']);
  await bridge.close();
  const file = path.join(chatDir(root), TRANSCRIPT_FILE);
  const before = await readFile(file, 'utf8');
  on = false;
  bridge = make();
  const status = await bridge.status('p');
  assert.deepEqual(status.events.map((e) => e.text), ['saved earlier', 'kept answer'], 'existing history is kept and shown');
  assert.equal(status.transcript.saved, false, 'the page is told saving is off');
  say(bridge, 'p', 'secret plans');
  reply(bridge, 'p', ['only ', 'in memory']);
  await bridge.close();
  assert.equal(await readFile(file, 'utf8'), before, 'not one byte was added while saving was off');
  bridge = make();
  assert.ok(!(await bridge.status('p')).events.some((e) => /secret plans|in memory/.test(e.text ?? '')));
  await bridge.clearTranscript('p');
  assert.equal(existsSync(file), false, 'deleting works whatever the setting');
  await bridge.close();
});

test('a reply is saved whole or not at all when saving is switched in the middle of it', async () => {
  const dir = await tmp('yf-chat-switch-');
  let on = true;
  let t = new Transcript({ dirFor: async () => dir, readDir: async () => dir, saving: () => on, flushMs: 1 });
  t.add({ type: 'message.sent', text: 'q1' });
  t.add({ type: 'message.delta', text: 'A1-start ' });
  await t.flush();
  on = false; // turned off mid-reply: this reply is finished on disk
  t.add({ type: 'message.delta', text: 'A1-end' });
  t.add({ type: 'message.sent', text: 'q2 (not saved)' });
  t.add({ type: 'message.delta', text: 'A2-start ' });
  on = true; // turned on mid-reply: this reply is not saved half
  t.add({ type: 'message.delta', text: 'A2-end' });
  t.add({ type: 'message.sent', text: 'q3' });
  await t.flush();
  t = new Transcript({ dirFor: async () => dir, readDir: async () => dir });
  assert.deepEqual((await t.older(Number.MAX_SAFE_INTEGER)).events.map((e) => e.text), ['q1', 'A1-start A1-end', 'q3']);
});

test('rotation happens only where an entry starts: no saved message is ever cut at the retention limit', async () => {
  const dir = await tmp('yf-chat-rotate-');
  const t = new Transcript({ dirFor: async () => dir, readDir: async () => dir, maxBytes: 1500, flushMs: 1 });
  const replies = 12;
  for (let r = 0; r < replies; r++) {
    t.add({ type: 'message.sent', text: `question ${r}` });
    for (let w = 0; w < 30; w++) {
      t.add({ type: 'message.delta', text: `r${r}w${w} ` });
      if (w % 5 === 4) t.flushPending(); // a saved line every few chunks, as the timer does while streaming
    }
  }
  await t.flush();
  assert.ok(existsSync(path.join(dir, TRANSCRIPT_OLDER_FILE)), 'the limit was reached and the file rotated');
  const firstLine = async (name) => JSON.parse((await readFile(path.join(dir, name), 'utf8')).split('\n')[0]);
  for (const name of [TRANSCRIPT_FILE, TRANSCRIPT_OLDER_FILE]) {
    const first = await firstLine(name);
    assert.ok(first.type === 'message.sent' || /^r\d+w0 /.test(first.text), `${name} starts where an entry starts: ${first.type} ${String(first.text).slice(0, 12)}`);
  }
  const kept = (await new Transcript({ dirFor: async () => dir, readDir: async () => dir }).older(Number.MAX_SAFE_INTEGER, 200)).events;
  assert.ok(kept.length < replies * 2, 'older than the two files is not kept');
  for (const event of kept.filter((e) => e.type === 'message.delta')) {
    const r = /^r(\d+)w0 /.exec(event.text)?.[1];
    assert.ok(r !== undefined, `a kept reply starts at its first chunk: ${event.text.slice(0, 20)}`);
    assert.equal(event.text, Array.from({ length: 30 }, (_, w) => `r${r}w${w} `).join(''), 'and ends at its last');
  }
});

test('streaming stays cheap per chunk: 50,000 chunks are merged and broadcast without a write per chunk', async () => {
  const root = await checkout();
  let broadcasts = 0;
  const bridge = new AgentBridge({ projects: [{ id: 'p', root, name: 'T' }], broadcast: () => { broadcasts += 1; }, env: { PATH: '/nonexistent' } });
  const project = bridge.projects.get('p');
  say(bridge, 'p', 'go');
  const started = performance.now();
  for (let i = 0; i < 50_000; i++) bridge.emit(project, agentEvent('message.delta', { role: 'agent', text: 'tok ' }));
  const elapsed = performance.now() - started;
  assert.equal(broadcasts, 50_001, 'every chunk reaches the page as it arrives');
  assert.ok(elapsed < 5000, `50,000 chunks took ${Math.round(elapsed)} ms`);
  await bridge.close();
  const lines = (await readFile(path.join(chatDir(root), TRANSCRIPT_FILE), 'utf8')).trim().split('\n');
  assert.ok(lines.length <= 3, `the reply was written in a few lines, not per chunk (${lines.length})`);
  assert.equal(JSON.parse(lines[1]).text.length, 50_000 * 4, 'the whole reply is saved');
});

test('the preference is typed, off means false only, and the server applies it and guards Clear', async (t) => {
  assert.deepEqual(validatePreferencesPatch({ saveChatHistory: false }), { saveChatHistory: false });
  assert.throws(() => validatePreferencesPatch({ saveChatHistory: 'no' }), { code: 'BAD_PREFERENCES' });
  const config = await tmp('yf-chat-cfg-');
  const saved = process.env.YALLAFLOW_CONSOLE_CONFIG;
  process.env.YALLAFLOW_CONSOLE_CONFIG = path.join(config, 'console.json');
  t.after(() => { if (saved === undefined) delete process.env.YALLAFLOW_CONSOLE_CONFIG; else process.env.YALLAFLOW_CONSOLE_CONFIG = saved; });
  assert.equal((await loadPreferences()).saveChatHistory, null, 'absent: the default (saving on)');
  const a = await checkout('a');
  const b = await checkout('b');
  for (const root of [a, b]) {
    await mkdir(chatDir(root), { recursive: true });
    await writeFile(path.join(chatDir(root), TRANSCRIPT_FILE), `${JSON.stringify({ type: 'message.sent', n: 10, text: `old in ${path.basename(root)}` })}\n`);
    await addProject(root);
  }
  const server = await startConsoleServer({ roots: [a, b], port: 0, agents: true, agentEnv: { PATH: config, HOME: config } });
  t.after(() => server.close());
  const auth = { Authorization: `Bearer ${server.token}` };
  const headers = { ...auth, Origin: server.url.replace(/\/$/, ''), 'Content-Type': 'application/json' };
  const get = async (route) => (await fetch(`${server.url}api/${route}`, { headers: auth })).json();
  const post = async (route, body) => { const response = await fetch(`${server.url}api/${route}`, { method: 'POST', headers, body: JSON.stringify(body) }); return { status: response.status, body: await response.json().catch(() => null) }; };
  const ids = Object.fromEntries((await get('projects')).projects.map((p) => [path.basename(p.root), p.id]));
  assert.equal((await get(`p/${ids.a}/agent`)).transcript.saved, true);
  assert.equal((await post('preferences', { saveChatHistory: false })).body.saveChatHistory, false);
  assert.equal((await get(`p/${ids.a}/agent`)).transcript.saved, false, 'applies at once, without a restart');
  assert.deepEqual((await get(`p/${ids.a}/agent`)).events.map((e) => e.text), ['old in a'], 'turning saving off deletes nothing');
  for (const body of [{}, { confirm: 'yes' }, { confirm: true, project: ids.b }]) assert.equal((await post(`p/${ids.a}/agent/clear-history`, body)).status, 400, JSON.stringify(body));
  assert.equal((await fetch(`${server.url}api/p/${ids.a}/agent/clear-history`, { method: 'POST', headers: { ...headers, Origin: 'http://evil.example' }, body: JSON.stringify({ confirm: true }) })).status, 403);
  assert.ok(existsSync(path.join(chatDir(a), TRANSCRIPT_FILE)), 'refused requests deleted nothing');
  assert.deepEqual((await post(`p/${ids.a}/agent/clear-history`, { confirm: true })).body, { cleared: true });
  assert.equal(existsSync(path.join(chatDir(a), TRANSCRIPT_FILE)), false);
  assert.deepEqual((await get(`p/${ids.a}/agent`)).events, []);
  assert.deepEqual((await get(`p/${ids.b}/agent`)).events.map((e) => e.text), ['old in b'], 'the other project keeps its chat');
  assert.deepEqual(await readdir(chatDir(b)), [TRANSCRIPT_FILE]);
  await savePreferences({ saveChatHistory: null });
});
