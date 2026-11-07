// EXPERIMENTAL (1.4.0, off by default): the Claude Code connection (see
// docs/agents-claude-experimental.md). The Claude side is SIMULATED: an MCP-client fixture
// speaks to the real channel server and hook forwarder. Skipped when the experimental files
// are absent (a release tree).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { claudeIncluded } from '../src/agents/experimental.js';
import { activeWork, consoleWith, fakeTools, project, run, sleep, stateLines } from '../test-support/agent-fixtures.js';

const CHANNEL = fileURLToPath(new URL('../resources/agents/claude-channel.mjs', import.meta.url));
const HOOK = fileURLToPath(new URL('../resources/agents/claude-hook.mjs', import.meta.url));
const skip = !claudeIncluded() && 'the experimental Claude connection is not in this tree';

// ---------------------------------------------------------------- Claude (simulated MCP client)
function mcpClient(cwd) {
  const child = spawn(process.execPath, [CHANNEL], { cwd, stdio: ['pipe', 'pipe', 'inherit'] });
  const received = [];
  let buffer = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let cut;
    while ((cut = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, cut).trim(); buffer = buffer.slice(cut + 1); if (line) received.push(JSON.parse(line)); }
  });
  const send = (message) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
  const waitFor = async (predicate, ms = 5000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { const hit = received.find(predicate); if (hit) return hit; await sleep(20); }
    throw new Error(`MCP message not seen: ${JSON.stringify(received).slice(0, 400)}`);
  };
  return { child, received, send, waitFor, close: () => child.kill() };
}
function hook(input) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [HOOK], { stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.on('exit', (code) => resolve({ code, output }));
    child.stdin.end(JSON.stringify(input));
  });
}

test('claude (simulated): channel server registers, relays chat, replies, permissions, hooks; bridge token protected', { skip }, async () => {
  const { root, workId } = await project();
  const tools = await fakeTools();
  const c = await consoleWith(root, { agents: true, experimentalClaude: true, agentEnv: tools.env });
  const mcp = mcpClient(root);
  try {
    const file = path.join(root, '.yallaflow', 'local', 'agent-bridge.json');
    assert.equal((await stat(file)).mode & 0o777, 0o600, 'bridge file is private');
    const bridgeToken = JSON.parse(await readFile(file, 'utf8')).token;
    const projects = JSON.stringify(c.projects) + JSON.stringify(await c.status());
    assert.equal(projects.includes(bridgeToken), false, 'the bridge token never reaches the browser');

    mcp.send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-code-fixture', version: '0' } } });
    const init = await mcp.waitFor((m) => m.id === 1);
    assert.deepEqual(init.result.capabilities.experimental, { 'claude/channel': {}, 'claude/channel/permission': {} });
    assert.equal(init.result.protocolVersion, '2025-06-18');
    mcp.send({ method: 'notifications/initialized' });
    mcp.send({ id: 2, method: 'tools/list' });
    assert.equal((await mcp.waitFor((m) => m.id === 2)).result.tools[0].name, 'reply');
    await c.waitFor((e) => e.type === 'session.connected');

    const connect = await c.post('connect', { provider: 'claude', workId });
    assert.equal(connect.status, 200);
    const linked = await connect.json();
    assert.match(linked.launch.command, /--dangerously-load-development-channels server:yallaflow/);
    assert.match(linked.launch.command, /--mcp-config \.yallaflow\/local\/agent\/claude-mcp\.json/);
    assert.equal(spawnSync('git', ['check-ignore', '-q', '.yallaflow/local/agent/claude-mcp.json'], { cwd: root }).status, 0);
    assert.equal(await activeWork(root), null, 'connecting never activates work');
    assert.equal((await c.post('start', { provider: 'codex', workId })).status, 409, 'one session per checkout across providers');

    // until Claude Code reports its permission mode, nothing is sent (fails closed)
    const early = await c.post('message', { text: 'too early' });
    assert.equal(early.status, 409);
    assert.equal((await early.json()).error.code, 'MODE_UNKNOWN');
    await hook({ hook_event_name: 'SessionStart', cwd: root, session_id: 'sess-0001-abcd', permission_mode: 'default' });
    await c.waitFor((e) => e.type === 'mode.changed' && e.mode === 'default');
    // hooks of another Claude Code session in the same folder are ignored
    await hook({ hook_event_name: 'UserPromptSubmit', cwd: root, session_id: 'sess-9999-other', permission_mode: 'bypassPermissions' });
    await sleep(150);
    assert.equal(c.events.some((e) => e.mode === 'bypassPermissions'), false, 'a foreign session cannot change the linked mode');
    await c.post('message', { text: 'Continue the work' });
    const pushed = await mcp.waitFor((m) => m.method === 'notifications/claude/channel');
    assert.equal(pushed.params.content, 'Continue the work');
    assert.equal(pushed.params.meta.work_id, workId);
    mcp.send({ id: 3, method: 'tools/call', params: { name: 'reply', arguments: { chat_id: pushed.params.meta.chat_id, text: 'On it.' } } });
    assert.equal((await mcp.waitFor((m) => m.id === 3)).result.content[0].text, 'sent');
    assert.equal((await c.waitFor((e) => e.type === 'message.done')).text, 'On it.');

    // permission relay: deny from the console (tied to the tool call whose PreToolUse preceded it)
    await hook({ hook_event_name: 'PreToolUse', cwd: root, tool_name: 'Bash', tool_use_id: 'tu-1', session_id: 'sess-0001-abcd', permission_mode: 'default' });
    await c.waitFor((e) => e.type === 'tool.started' && e.toolCallId === 'tu-1');
    mcp.send({ method: 'notifications/claude/channel/permission_request', params: { request_id: 'abcde', tool_name: 'Bash', description: 'Create a file', input_preview: '{"command":"touch x"}' } });
    const asked = await c.waitFor((e) => e.type === 'permission.requested');
    assert.deepEqual(asked.decisions, ['allow', 'deny'], 'no allow-for-session for Claude');
    await c.post('permission', { requestId: asked.requestId, decision: 'deny' });
    const verdict = await mcp.waitFor((m) => m.method === 'notifications/claude/channel/permission');
    assert.deepEqual(verdict.params, { request_id: 'abcde', behavior: 'deny' });
    // a different Bash call (allowed by a rule) running later is not reported as an override
    await hook({ hook_event_name: 'PostToolUse', cwd: root, tool_name: 'Bash', tool_use_id: 'tu-other', session_id: 'sess-0001-abcd', permission_mode: 'default' });
    await c.waitFor((e) => e.type === 'tool.updated' && e.toolCallId === 'tu-other');
    assert.equal(c.events.some((e) => e.type === 'permission.overridden'), false, 'no false override claim');
    // the denied call ran anyway (answered in the terminal): reported honestly, never as denied by YallaFlow
    assert.equal((await hook({ hook_event_name: 'PostToolUse', cwd: root, tool_name: 'Bash', tool_use_id: 'tu-1', session_id: 'sess-0001-abcd', permission_mode: 'default' })).code, 0);
    assert.equal((await c.waitFor((e) => e.type === 'permission.overridden')).requestId, asked.requestId);
    // a request answered in Claude Code while still open in the console: closed as answered there,
    // and no console verdict is sent afterwards
    await hook({ hook_event_name: 'PreToolUse', cwd: root, tool_name: 'Edit', tool_use_id: 'tu-2', session_id: 'sess-0001-abcd', permission_mode: 'default' });
    await c.waitFor((e) => e.type === 'tool.started' && e.toolCallId === 'tu-2');
    mcp.send({ method: 'notifications/claude/channel/permission_request', params: { request_id: 'kmnop', tool_name: 'Edit', description: 'Edit a file', input_preview: '{}' } });
    const open2 = await c.waitFor((e) => e.type === 'permission.requested' && e.title.startsWith('Edit'));
    await hook({ hook_event_name: 'PostToolUse', cwd: root, tool_name: 'Edit', tool_use_id: 'tu-2', session_id: 'sess-0001-abcd', permission_mode: 'default' });
    const settled = await c.waitFor((e) => e.type === 'permission.resolved' && e.requestId === open2.requestId);
    assert.equal(settled.decision, 'elsewhere');
    assert.equal((await c.post('permission', { requestId: open2.requestId, decision: 'deny' })).status, 409, 'no longer open');
    await sleep(150);
    assert.equal(mcp.received.some((m) => m.params?.request_id === 'kmnop'), false, 'no verdict for a request answered in Claude Code');
    // timeout: nobody answers
    mcp.send({ method: 'notifications/claude/channel/permission_request', params: { request_id: 'fghij', tool_name: 'Write', description: 'Write', input_preview: '{}' } });
    await mcp.waitFor((m) => m.method === 'notifications/claude/channel/permission' && m.params.request_id === 'fghij', 3000);
    assert.equal(mcp.received.find((m) => m.params?.request_id === 'fghij').params.behavior, 'deny');
    // bad request ids are ignored
    mcp.send({ method: 'notifications/claude/channel/permission_request', params: { request_id: 'NOPE!', tool_name: 'Bash', description: '', input_preview: '' } });

    // hooks: mode and the final assistant message
    const stop = await hook({ hook_event_name: 'Stop', cwd: root, session_id: 'sess-0001-abcd', permission_mode: 'auto', last_assistant_message: 'All done.' });
    assert.deepEqual(stop, { code: 0, output: '' }, 'the hook never prints a decision');
    assert.equal((await c.waitFor((e) => e.type === 'turn.ended' && e.finalMessage)).finalMessage, 'All done.');
    assert.equal((await c.waitFor((e) => e.type === 'mode.changed' && e.mode === 'auto')).mode, 'auto');
    assert.equal((await c.status()).session.mode, 'auto');

    // bridge endpoints: wrong token, browser Origin
    const wrong = await fetch(`${c.server.url}api/agent-bridge/claude/event`, { method: 'POST', headers: { Authorization: 'Bearer nope', 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(wrong.status, 401);
    const browser = await fetch(`${c.server.url}api/agent-bridge/claude/event`, { method: 'POST', headers: { Authorization: `Bearer ${bridgeToken}`, Origin: c.origin, 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(browser.status, 403);
    assert.equal((await c.post('cancel', {})).status, 409, 'Stop is not offered for Claude');
    assert.equal((await c.post('disconnect', {})).status, 200);
  } finally {
    mcp.close();
    await c.close();
  }
  assert.equal(existsSync(path.join(root, '.yallaflow', 'local', 'agent-bridge.json')), false, 'bridge file removed when the console stops');
});

test('claude (simulated): the channel waits for a console and reports undelivered replies honestly', { skip }, async () => {
  const { root } = await project();
  const mcp = mcpClient(root);
  try {
    mcp.send({ id: 1, method: 'initialize', params: { protocolVersion: '2026-07-28' } });
    assert.equal((await mcp.waitFor((m) => m.id === 1)).result.protocolVersion, '2025-06-18', 'never negotiates the unsupported 2026-07-28 revision');
    mcp.send({ method: 'notifications/initialized' });
    mcp.send({ id: 2, method: 'tools/call', params: { name: 'reply', arguments: { chat_id: '1', text: 'x' } } });
    const reply = await mcp.waitFor((m) => m.id === 2);
    assert.equal(reply.result.isError, true);
    mcp.send({ id: 3, method: 'tools/call', params: { name: 'other' } });
    assert.equal((await mcp.waitFor((m) => m.id === 3)).error.code, -32602);
  } finally {
    mcp.close();
  }
});

test('claude (simulated): bridge file, channel takeover, disconnect, bypass, nested workspaces', { skip }, async () => {
  const { root, workId } = await project();
  const tools = await fakeTools();
  const outside = await mkdtemp(path.join(os.tmpdir(), 'yf-outside-'));
  await mkdir(path.join(root, '.yallaflow', 'local'), { recursive: true });
  const bridgeLink = path.join(root, '.yallaflow', 'local', 'agent-bridge.json');
  const target = path.join(outside, 'stolen.json');
  await symlink(target, bridgeLink);
  await assert.rejects(consoleWith(root, { agents: true, experimentalClaude: true, agentEnv: tools.env }), /symbolic link/);
  assert.equal(existsSync(target), false, 'the bridge token never lands outside the checkout');
  await rm(bridgeLink, { force: true });

  // (8) channel takeover and disconnect; (5) bypass mode; (7) nested workspaces
  const c3 = await consoleWith(root, { agents: true, experimentalClaude: true, agentEnv: { ...tools.env, YALLAFLOW_AGENT_PERMISSION_TIMEOUT_MS: '60000' } });
  const mcp = mcpClient(root);
  try {
    mcp.send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fixture', version: '0' } } });
    mcp.send({ method: 'notifications/initialized' });
    await c3.waitFor((e) => e.type === 'session.connected');
    const token = JSON.parse(await readFile(path.join(root, '.yallaflow', 'local', 'agent-bridge.json'), 'utf8')).token;
    const second = await fetch(`${c3.server.url}api/agent-bridge/claude/stream?pid=1`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(second.status, 409, 'a second channel cannot take over a live one');
    await second.body?.cancel();

    assert.equal((await c3.post('connect', { provider: 'claude', workId })).status, 200);
    // parallel calls of the same tool: a request can't be tied to one, so nothing is claimed
    await hook({ hook_event_name: 'PreToolUse', cwd: root, tool_name: 'Read', tool_use_id: 'tu-p1', session_id: 'sess-0002-abcd', permission_mode: 'default' });
    await hook({ hook_event_name: 'PreToolUse', cwd: root, tool_name: 'Read', tool_use_id: 'tu-p2', session_id: 'sess-0002-abcd', permission_mode: 'default' });
    mcp.send({ method: 'notifications/claude/channel/permission_request', params: { request_id: 'vwxyz', tool_name: 'Read', description: 'r', input_preview: '{}' } });
    const ambiguous = await c3.waitFor((e) => e.type === 'permission.requested' && e.title.startsWith('Read'));
    await hook({ hook_event_name: 'PostToolUse', cwd: root, tool_name: 'Read', tool_use_id: 'tu-p1', session_id: 'sess-0002-abcd', permission_mode: 'default' });
    await sleep(150);
    assert.equal(c3.events.some((e) => e.type === 'permission.resolved' && e.requestId === ambiguous.requestId), false, 'not closed on a guess');
    assert.equal((await c3.post('permission', { requestId: ambiguous.requestId, decision: 'deny' })).status, 200);
    await hook({ hook_event_name: 'PostToolUse', cwd: root, tool_name: 'Read', tool_use_id: 'tu-p2', session_id: 'sess-0002-abcd', permission_mode: 'default' });
    await hook({ hook_event_name: 'UserPromptSubmit', cwd: root, session_id: 'sess-0002-abcd', permission_mode: 'bypassPermissions' });
    assert.equal((await c3.waitFor((e) => e.type === 'mode.changed' && e.mode === 'bypassPermissions')).forbidden, true);
    const blocked = await c3.post('message', { text: 'hello' });
    assert.equal(blocked.status, 409);
    assert.equal((await blocked.json()).error.code, 'MODE_FORBIDDEN');
    await hook({ hook_event_name: 'UserPromptSubmit', cwd: root, session_id: 'sess-0002-abcd', permission_mode: 'default' });
    await c3.waitFor((e) => e.type === 'mode.changed' && e.mode === 'default');

    // a nested project without its own console never reaches the parent console
    const nested = path.join(root, 'packages', 'inner');
    await mkdir(path.join(nested, '.yallaflow'), { recursive: true });
    const before = c3.events.length;
    await hook({ hook_event_name: 'PreToolUse', cwd: nested, tool_name: 'Bash', tool_use_id: 'tu-nested', session_id: 'sess-0002-abcd', permission_mode: 'default' });
    await sleep(200);
    assert.equal(c3.events.slice(before).some((e) => e.toolCallId === 'tu-nested'), false, 'hook stops at the nearest .yallaflow');
    const inner = spawn(process.execPath, [CHANNEL], { cwd: nested, stdio: ['pipe', 'pipe', 'pipe'] });
    await sleep(600);
    assert.equal(c3.events.slice(before).filter((e) => e.type === 'session.connected').length, 0, 'channel stops at the nearest .yallaflow');
    inner.kill();

    // a pending request is denied when the channel drops, and nothing queued survives
    mcp.send({ method: 'notifications/claude/channel/permission_request', params: { request_id: 'pqrst', tool_name: 'Bash', description: 'x', input_preview: '{}' } });
    const pending = await c3.waitFor((e) => e.type === 'permission.requested' && e.title.startsWith('Bash'));
    mcp.close();
    const dropped = await c3.waitFor((e) => e.type === 'permission.resolved' && e.requestId === pending.requestId);
    assert.deepEqual([dropped.decision, dropped.by], ['deny', 'channel disconnected']);
  } finally {
    mcp.close();
    await c3.close();
  }
});

test('claude (simulated): agents claude-files writes git-ignored launch files', { skip }, async () => {
  const { root } = await project();
  const files = run(root, ['agents', 'claude-files']);
  assert.equal(files.status, 0, files.stderr);
  assert.match(files.stdout, /claude --mcp-config/);
  const settings = JSON.parse(await readFile(path.join(root, '.yallaflow', 'local', 'agent', 'claude-settings.json'), 'utf8'));
  assert.ok(settings.hooks.Stop[0].hooks[0].command.includes('claude-hook.mjs'));
  assert.equal(JSON.stringify(settings).includes('PermissionRequest'), false, 'hooks never answer permissions');
  const status = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).stdout;
  assert.equal(status.includes('local/agent'), false);
});

// ------------------------------------------------ security review of PF-0060 (regressions)
test('review: a stale bridge file pointing at another listener receives no token and no data', { skip }, async () => {
  const { writeFile } = await import('node:fs/promises');
  const http = await import('node:http');
  const root = await mkdtemp(path.join(os.tmpdir(), 'yf-claude-stale-'));
  await mkdir(path.join(root, '.yallaflow', 'local'), { recursive: true });
  const seen = [];
  const impostor = http.createServer((request, response) => {
    seen.push({ url: request.url, auth: request.headers.authorization ?? null });
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => { seen.at(-1).body = body; response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ proof: '00'.repeat(32) })); });
  });
  await new Promise((resolve) => impostor.listen(0, '127.0.0.1', resolve));
  const token = 'ab'.repeat(24);
  await writeFile(path.join(root, '.yallaflow', 'local', 'agent-bridge.json'), JSON.stringify({ port: impostor.address().port, token, pid: process.pid }));
  try {
    const result = await hook({ cwd: root, hook_event_name: 'PreToolUse', session_id: 'sess-12345678', tool_name: 'Bash', tool_input: { command: 'cat secret.txt' } });
    assert.equal(result.code, 0);
    const client = mcpClient(root);
    await sleep(1200);
    client.close();
    assert.ok(seen.every((entry) => entry.auth === null), 'the token is never sent to a server that cannot prove it');
    assert.ok(seen.every((entry) => !String(entry.body ?? '').includes('secret')), 'no hook data reaches it');
    assert.ok(seen.every((entry) => entry.url.startsWith('/api/agent-bridge/claude/hello')), 'only the proof request');
  } finally {
    await new Promise((resolve) => impostor.close(resolve));
  }
  // A bridge file whose console pid is gone is not even contacted.
  seen.length = 0;
  await writeFile(path.join(root, '.yallaflow', 'local', 'agent-bridge.json'), JSON.stringify({ port: 9, token, pid: 2 ** 22 + 12345 }));
  assert.equal((await hook({ cwd: root, hook_event_name: 'Stop', session_id: 'sess-12345678' })).code, 0);
});

test('review: Claude detection runs only after opt-in; a failed Claude enable leaves no lock or bridge file', { skip }, async () => {
  const { writeFile, chmod, symlink: link } = await import('node:fs/promises');
  const { startConsoleServer } = await import('../src/console/server.js');
  const bin = await mkdtemp(path.join(os.tmpdir(), 'yf-fake-claude-'));
  const log = path.join(bin, 'calls.log');
  await writeFile(path.join(bin, 'claude'), `#!/bin/sh\necho "$@" >> '${log}'\necho "2.1.300 (Claude Code)"\n`);
  await chmod(path.join(bin, 'claude'), 0o755);
  const { root } = await project();
  const server = await startConsoleServer({ roots: [root], port: 0, agentEnv: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
  try {
    const res = await fetch(`${server.url}api/agents`, { headers: { Authorization: `Bearer ${server.token}` } });
    const body = await res.json();
    assert.equal(body.claudeCode, undefined, 'no Claude readiness before opt-in');
    assert.equal(existsSync(log), false, 'claude was not run');
  } finally {
    await server.close();
  }
  // Second project whose local folder is a symbolic link: enabling with Claude fails there.
  const { root: other } = await project();
  const elsewhere = await mkdtemp(path.join(os.tmpdir(), 'yf-elsewhere-'));
  await rm(path.join(other, '.yallaflow', 'local'), { recursive: true, force: true });
  await link(elsewhere, path.join(other, '.yallaflow', 'local'));
  const two = await startConsoleServer({ roots: [root, other], port: 0, agentEnv: process.env });
  try {
    const origin = two.url.replace(/\/$/, '');
    const res = await fetch(`${two.url}api/agents/enable`, { method: 'POST', headers: { Authorization: `Bearer ${two.token}`, Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: true, claude: true }) });
    assert.ok(res.status >= 400, `enable failed (${res.status})`);
    const local = await readdir(path.join(root, '.yallaflow', 'local')).catch(() => []);
    assert.equal(local.includes('agent-bridge.json'), false, 'no bridge file left behind');
    assert.equal(local.some((name) => name.includes('lock')), false, 'no checkout lock left behind');
  } finally {
    await two.close();
  }
});
