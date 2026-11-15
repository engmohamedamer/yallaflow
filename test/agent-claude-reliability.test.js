// PF-0145: Claude Code console reliability. An open channel stream proves nothing (Claude Code
// drops channel messages without an error when the organization has channels off), so:
// - each connection is checked once with a nonce; the console sends directly only after the
//   matching acknowledgment; a timeout means "unverified", never "dropped";
// - a message's state changes only on evidence that names its chat id;
// - Terminal Mode (copy, paste in Claude Code, hooks show the work) needs no channel at all.
// The Claude side is simulated. Skipped when the experimental files are absent (a release tree).
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { claudeIncluded } from '../src/agents/experimental.js';
import { consoleWith, fakeTools, project, sleep } from '../test-support/agent-fixtures.js';

const HOOK = fileURLToPath(new URL('../resources/agents/claude-hook.mjs', import.meta.url));
const skip = !claudeIncluded() && 'the experimental Claude connection is not in this tree';
const SESSION = 'sess-0001-abcd';
const OTHER = 'sess-9999-other';

function fakeStream() {
  const stream = new EventEmitter();
  stream.written = [];
  stream.destroyed = false;
  stream.writableEnded = false;
  stream.write = (data) => stream.written.push(JSON.parse(data.slice(6)));
  stream.end = () => { stream.writableEnded = true; stream.emit('close'); };
  return stream;
}
async function linkWith({ probeMs = 40, deliveryMs = 40 } = {}) {
  const { ClaudeLink } = await import('../src/agents/claude.js');
  const events = [];
  const link = new ClaudeLink({ emit: (event) => events.push(event) });
  link.probeTimeoutMs = probeMs;
  link.deliveryTimeoutMs = deliveryMs;
  const states = () => events.filter((e) => e.type === 'channel.state').map((e) => e.state);
  const chatStates = (chatId) => events.filter((e) => e.type === 'message.state' && e.chatId === chatId).map((e) => e.state);
  const hook = (name, extra = {}) => link.onHook({ session_id: SESSION, hook_event_name: name, permission_mode: 'default', ...extra });
  // Attach, report the mode, and answer the check as a working channel would.
  const verify = async (stream = fakeStream()) => {
    link.attachStream(stream, { pid: 1 });
    hook('UserPromptSubmit');
    await link.onChannelEvent({ type: 'reply', chat_id: stream.written[0].meta.chat_id, text: 'ok' });
    return stream;
  };
  return { link, events, states, chatStates, hook, verify };
}

test('a blocked channel: the check goes out once, is never answered, and the console offers Terminal Mode without claiming a drop', { skip }, async () => {
  const { link, events, states, hook } = await linkWith();
  const stream = fakeStream();
  link.attachStream(stream, { pid: 1 });
  assert.deepEqual(states(), ['checking']);
  assert.equal(stream.written.length, 0, 'nothing is sent before the permission mode is known');
  hook('UserPromptSubmit');
  hook('PreToolUse', { tool_name: 'Bash', tool_use_id: 'tu-1' });
  hook('Stop');
  assert.equal(stream.written.length, 1, 'one check per connection, whatever hooks follow');
  const check = stream.written[0];
  assert.equal(check.meta.kind, 'connection_check');
  assert.match(check.meta.chat_id, /^check-[0-9a-f]{16}$/);
  assert.match(check.content, /not a task: run no commands, read no files and change nothing/);
  assert.equal(link.channelState, 'checking', 'an open stream and hooks do not verify the channel');
  assert.throws(() => link.send('hello', null), (error) => error.code === 'CHANNEL_UNVERIFIED');
  await sleep(90);
  assert.deepEqual(states(), ['checking', 'unverified']);
  assert.throws(() => link.send('hello', null), (error) => error.code === 'CHANNEL_UNVERIFIED');
  assert.equal(stream.written.length, 1, 'no project message ever went through the unverified channel');
  assert.equal(events.some((e) => ['message.sent', 'message.state', 'delivery.unconfirmed', 'error'].includes(e.type)), false, 'no message is reported as sent or dropped');
  assert.equal(link.connected, true, 'the session stays connected for monitoring');
  link.detach();
});

test('a valid channel: only the matching acknowledgment enables direct messaging', { skip }, async () => {
  const { link, events, states, hook } = await linkWith();
  const stream = fakeStream();
  link.attachStream(stream, { pid: 1 });
  hook('SessionStart');
  await link.onChannelEvent({ type: 'reply', chat_id: 'check-0000000000000000', text: 'ok' });
  await link.onChannelEvent({ type: 'reply', chat_id: 'check-', text: 'ok' });
  assert.equal(link.channelState, 'checking', 'a wrong nonce verifies nothing');
  await link.onChannelEvent({ type: 'reply', chat_id: stream.written[0].meta.chat_id, text: 'ok' });
  assert.deepEqual(states(), ['checking', 'verified']);
  assert.equal(events.some((e) => e.type === 'message.done'), false, 'the acknowledgment is not shown as a reply');
  const chatId = link.send('hello', 'PF-0001');
  assert.match(chatId, /^[0-9a-f]{8}$/);
  assert.deepEqual(stream.written[1], { type: 'message', content: 'hello', meta: { chat_id: chatId, work_id: 'PF-0001' } });
  await sleep(90);
  assert.equal(link.channelState, 'verified', 'the check timer no longer applies');
  link.detach();
});

test('the check waits for a served permission mode and is sent once', { skip }, async () => {
  const { link, hook } = await linkWith();
  const stream = fakeStream();
  link.attachStream(stream, { pid: 1 });
  hook('UserPromptSubmit', { permission_mode: 'bypassPermissions' });
  assert.equal(stream.written.length, 0, 'a session that skips every permission is never sent to, not even the check');
  hook('UserPromptSubmit', { permission_mode: 'default' });
  hook('UserPromptSubmit', { permission_mode: 'acceptEdits' });
  assert.equal(stream.written.length, 1);
  link.detach();
});

test('a late acknowledgment still verifies the same connection', { skip }, async () => {
  const { link, states, hook } = await linkWith();
  const stream = fakeStream();
  link.attachStream(stream, { pid: 1 });
  hook('UserPromptSubmit');
  await sleep(90);
  assert.equal(link.channelState, 'unverified');
  await link.onChannelEvent({ type: 'reply', chat_id: stream.written[0].meta.chat_id, text: 'ok' });
  assert.deepEqual(states(), ['checking', 'unverified', 'verified']);
  assert.doesNotThrow(() => link.send('now it works', null));
  link.detach();
});

test('reconnection: a new connection is checked again, an old acknowledgment is ignored, and nothing is resent', { skip }, async () => {
  const { link, events, states, chatStates, hook, verify } = await linkWith({ deliveryMs: 5000 });
  const first = await verify();
  const oldCheck = first.written[0].meta.chat_id;
  const chatId = link.send('in flight', null);
  first.end(); // the session or the console connection dropped
  assert.equal(link.channelState, 'none');
  assert.equal(link.connected, false);
  assert.deepEqual(chatStates(chatId), ['unconfirmed'], 'what was on its way is unconfirmed at once');
  assert.throws(() => link.send('while away', null), (error) => error.code === 'NOT_CONNECTED');

  const second = fakeStream();
  link.attachStream(second, { pid: 2 });
  hook('UserPromptSubmit');
  assert.equal(second.written.length, 1, 'only the new check: the unconfirmed message is never sent again');
  assert.equal(second.written[0].meta.kind, 'connection_check');
  assert.notEqual(second.written[0].meta.chat_id, oldCheck, 'a nonce of its own');
  await link.onChannelEvent({ type: 'reply', chat_id: oldCheck, text: 'ok' });
  assert.equal(link.channelState, 'checking', 'the earlier connection\'s acknowledgment does not verify this one');
  assert.throws(() => link.send('too early', null), (error) => error.code === 'CHANNEL_UNVERIFIED');
  await link.onChannelEvent({ type: 'reply', chat_id: second.written[0].meta.chat_id, text: 'ok' });
  assert.deepEqual(states(), ['checking', 'verified', 'none', 'checking', 'verified']);
  assert.equal(events.filter((e) => e.type === 'session.connected').length, 2);
  // a late answer to the earlier message is still the truth about it
  await link.onChannelEvent({ type: 'reply', chat_id: chatId, text: 'done before the drop' });
  assert.deepEqual(chatStates(chatId), ['unconfirmed', 'answered']);
  link.detach();
});

test('multiple messages: each chat id has its own state, and only evidence naming it moves it', { skip }, async () => {
  const { link, events, chatStates, hook, verify } = await linkWith({ deliveryMs: 60 });
  await verify();
  hook('Stop');
  const [one, two, three] = [link.send('one', null), link.send('two', null), link.send('three', null)];
  assert.equal(new Set([one, two, three]).size, 3);
  assert.equal(link.status, 'connected', 'sending is not working');
  // hooks that name no message (the developer typing, a tool running) confirm nothing
  hook('UserPromptSubmit');
  hook('PreToolUse', { tool_name: 'Bash', tool_use_id: 'tu-1' });
  hook('PostToolUse', { tool_name: 'Bash', tool_use_id: 'tu-1' });
  assert.deepEqual([one, two, three].map((id) => chatStates(id).length), [0, 0, 0]);
  await link.onChannelEvent({ type: 'received', chat_id: two });
  assert.deepEqual(chatStates(two), ['received']);
  await sleep(120);
  assert.deepEqual(chatStates(one), ['unconfirmed']);
  assert.deepEqual(chatStates(three), ['unconfirmed']);
  assert.deepEqual(chatStates(two), ['received'], 'a received message is never called unconfirmed');
  await link.onChannelEvent({ type: 'reply', chat_id: two, text: 'Two is done.' });
  assert.deepEqual(chatStates(two), ['received', 'answered']);
  assert.equal(events.find((e) => e.type === 'message.done').chatId, two);
  // the channel's own tool call, seen by the hook, names the message too
  hook('PreToolUse', { tool_name: 'mcp__yallaflow__received', tool_use_id: 'tu-2', chat_id: three });
  assert.deepEqual(chatStates(three), ['unconfirmed', 'received']);
  assert.equal(events.some((e) => e.type === 'tool.started' && e.toolCallId === 'tu-2'), false, 'the channel\'s own calls are not shown as project work');
  // states never move backwards, and an unknown chat id changes nothing
  await link.onChannelEvent({ type: 'received', chat_id: two });
  await link.onChannelEvent({ type: 'received', chat_id: 'ffffffff' });
  assert.deepEqual(chatStates(two), ['received', 'answered']);
  assert.deepEqual(chatStates(one), ['unconfirmed'], 'the first message is still unconfirmed, and was not sent again');
  link.detach();
});

test('Terminal Mode: a copied message is never sent through the channel, even after the channel verifies later', { skip }, async () => {
  const { link, events, chatStates, hook } = await linkWith();
  const stream = fakeStream();
  link.attachStream(stream, { pid: 1 });
  hook('UserPromptSubmit');
  await sleep(90);
  assert.equal(link.channelState, 'unverified');
  link.noteTerminal('fix the title', 'abcd1234');
  assert.equal(events.find((e) => e.type === 'message.sent').state, 'copied');
  assert.throws(() => link.noteTerminal('again', 'abcd1234'), (error) => error.code === 'BAD_MESSAGE', 'one record per chat id');
  assert.throws(() => link.noteTerminal('bad id', '../etc'), (error) => error.code === 'BAD_MESSAGE');
  // the mode switches (a late acknowledgment): the copied message keeps its one route
  await link.onChannelEvent({ type: 'reply', chat_id: stream.written[0].meta.chat_id, text: 'ok' });
  assert.equal(link.channelState, 'verified');
  await sleep(90);
  assert.equal(stream.written.length, 1, 'only the check was ever written to the channel');
  assert.deepEqual(chatStates('abcd1234'), [], 'copied is not a delivery claim and never times out');
  // the developer pastes it: the prompt hook names it, and the turn's end answers it
  hook('UserPromptSubmit', { chat_id: 'abcd1234' });
  assert.deepEqual(chatStates('abcd1234'), ['received']);
  hook('Stop', { last_assistant_message: 'The title is fixed.' });
  assert.deepEqual(chatStates('abcd1234'), ['received', 'answered']);
  assert.equal(events.find((e) => e.type === 'turn.ended').finalMessage, 'The title is fixed.');
  // a later turn the developer typed themselves answers nothing
  link.noteTerminal('second', 'abcd5678');
  hook('UserPromptSubmit');
  hook('Stop');
  assert.deepEqual(chatStates('abcd5678'), []);
  link.detach();
});

test('session isolation: hooks of another session are ignored unless they prove they are this console\'s session', { skip }, async () => {
  const { link, events, chatStates, hook, verify } = await linkWith({ deliveryMs: 5000 });
  await verify();
  const foreign = (name, extra = {}) => link.onHook({ session_id: OTHER, hook_event_name: name, permission_mode: 'bypassPermissions', ...extra });
  foreign('UserPromptSubmit');
  foreign('PreToolUse', { tool_name: 'Bash', tool_use_id: 'tu-x' });
  foreign('UserPromptSubmit', { chat_id: 'ffffffff' }); // a chat id this console never issued
  foreign('SessionEnd');
  assert.equal(link.boundSession, SESSION);
  assert.equal(link.permissionMode, 'default', 'a foreign session cannot change the mode');
  assert.equal(events.some((e) => e.type === 'tool.started'), false);
  assert.equal(link.hookLive, true, 'a foreign SessionEnd does not end this session');

  // /clear: the bound session ends and the next one binds; the verified channel is the same process
  hook('SessionEnd');
  assert.equal(link.boundSession, null);
  assert.equal(link.connected, true, 'the channel stream is still open');
  assert.equal(link.channelState, 'verified');
  link.onHook({ session_id: 'sess-0002-next', hook_event_name: 'UserPromptSubmit', permission_mode: 'default' });
  assert.equal(link.boundSession, 'sess-0002-next');

  // a session that names one of this console's messages is the one it talks to
  const chatId = link.send('hello', null);
  link.onHook({ session_id: 'sess-0003-real', hook_event_name: 'PreToolUse', permission_mode: 'default', tool_name: 'mcp__yallaflow__received', tool_use_id: 'tu-r', chat_id: chatId });
  assert.equal(link.boundSession, 'sess-0003-real');
  assert.deepEqual(chatStates(chatId), ['received']);
  link.detach();
});

// ---------------------------------------------------------------- through the real hook forwarder
function runHook(input) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [HOOK], { stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.on('exit', (code) => resolve({ code, output }));
    child.stdin.end(JSON.stringify(input));
  });
}

test('Terminal Mode monitoring works with no channel at all: hooks reach the console, are tied to the session, and name the pasted message', { skip }, async () => {
  const { root, workId } = await project();
  const tools = await fakeTools();
  const c = await consoleWith(root, { agents: true, experimentalClaude: true, agentEnv: tools.env });
  try {
    assert.equal((await c.status()).session, null);
    assert.equal((await c.post('message', { text: 'nobody there', terminal: true, chatId: 'aaaa0000' })).status, 409, 'nothing to copy for before Claude Code is seen');
    const first = await runHook({ hook_event_name: 'UserPromptSubmit', cwd: root, session_id: SESSION, permission_mode: 'default', prompt: 'Run yallaflow brief' });
    assert.deepEqual(first, { code: 0, output: '' }, 'the hook never blocks or prints');
    await c.waitFor((e) => e.type === 'session.connected');
    let session = (await c.status()).session;
    assert.equal(session.provider, 'claude');
    assert.equal(session.channel, 'none');
    assert.equal(session.monitoring, true);
    assert.equal(session.mode, 'default');
    assert.equal(c.events.some((e) => e.type === 'error' || e.type === 'channel.state'), false, 'no channel error or state without a channel');

    // a direct send is refused; the same text goes the terminal way and is only recorded
    const direct = await c.post('message', { text: 'Fix the invoice title' });
    assert.ok(direct.status >= 400);
    const copied = await c.post('message', { text: 'Fix the invoice title', terminal: true, chatId: 'abcd1234' });
    assert.equal(copied.status, 202);
    assert.equal((await copied.json()).route, 'terminal');
    assert.equal((await c.waitFor((e) => e.type === 'message.sent')).state, 'copied');

    // another session in the folder types something: ignored
    await runHook({ hook_event_name: 'PreToolUse', cwd: root, session_id: OTHER, permission_mode: 'default', tool_name: 'Bash', tool_use_id: 'tu-foreign', tool_input: { command: 'rm -rf x' } });
    // the developer pastes the copied message in Claude Code
    await runHook({ hook_event_name: 'UserPromptSubmit', cwd: root, session_id: SESSION, permission_mode: 'default', prompt: 'Fix the invoice title\n\nSECRET-PROMPT-TEXT\n\n[yallaflow abcd1234]' });
    assert.equal((await c.waitFor((e) => e.type === 'message.state' && e.state === 'received')).chatId, 'abcd1234');
    await runHook({ hook_event_name: 'PreToolUse', cwd: root, session_id: SESSION, permission_mode: 'default', tool_name: 'Edit', tool_use_id: 'tu-1', tool_input: { file_path: 'src/invoice.js' } });
    assert.match((await c.waitFor((e) => e.type === 'tool.started' && e.toolCallId === 'tu-1')).title, /Edit: src\/invoice\.js/);
    await runHook({ hook_event_name: 'PostToolUse', cwd: root, session_id: SESSION, permission_mode: 'default', tool_name: 'Edit', tool_use_id: 'tu-1' });
    await runHook({ hook_event_name: 'Stop', cwd: root, session_id: SESSION, permission_mode: 'default', last_assistant_message: 'The title is fixed.' });
    assert.equal((await c.waitFor((e) => e.type === 'message.state' && e.state === 'answered')).chatId, 'abcd1234');
    assert.equal((await c.waitFor((e) => e.type === 'turn.ended')).finalMessage, 'The title is fixed.');
    assert.equal(c.events.some((e) => e.toolCallId === 'tu-foreign'), false, 'the other session\'s work is not shown');
    assert.equal(JSON.stringify(c.events).includes('SECRET-PROMPT-TEXT'), false, 'only the marker leaves the prompt, never its text');

    // linking the session to a work item keeps the same state
    assert.equal((await c.post('connect', { provider: 'claude', workId })).status, 200);
    session = (await c.status()).session;
    assert.deepEqual([session.workId, session.connected, session.channel, session.monitoring], [workId, true, 'none', true]);

    // Claude Code exits: the session ends cleanly, with no channel involved
    await runHook({ hook_event_name: 'SessionEnd', cwd: root, session_id: SESSION, reason: 'prompt_input_exit' });
    await c.waitFor((e) => e.type === 'session.disconnected');
    assert.equal((await c.status()).session.connected, false);
  } finally {
    await c.close();
  }
});

test('the launch files ask for SessionEnd hooks and let the channel\'s own two tools run without a prompt', { skip }, async () => {
  const { hookSettings } = await import('../src/agents/claude-files.js');
  const settings = hookSettings('/usr/bin/node');
  assert.deepEqual(settings.permissions, { allow: ['mcp__yallaflow__reply', 'mcp__yallaflow__received'] });
  assert.deepEqual(Object.keys(settings.hooks), ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Notification', 'Stop', 'SessionEnd']);
  assert.equal(JSON.stringify(settings).includes('channelsEnabled'), false, 'organization settings are never touched');
});
