// v1.3.0 Agent Interaction. Every provider here is SIMULATED: the ACP agent is
// test-support/fake-acp-agent.mjs and the Claude side is an MCP-client fixture speaking to
// the real channel server and hook forwarder. Real-provider evidence lives in
// research/agent-interaction/evidence/.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmod, copyFile, mkdtemp, mkdir, readFile, readdir, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { initWorkspace } from '../src/core/workspace.js';
import { startConsoleServer } from '../src/console/server.js';
import { clearDetectionCache, detectCodex, parseVersion, versionAtLeast } from '../src/agents/detect.js';
import { adapterEnvironment } from '../src/agents/codex.js';
import { AgentBridge } from '../src/agents/bridge.js';
import { claudeIncluded } from '../src/agents/experimental.js';
import { fromAcpUpdate, isForbiddenMode } from '../src/agents/events.js';

import {
  activeWork, cli, consoleWith, fakeTools, project, run, sleep, stateLines
} from '../test-support/agent-fixtures.js';

// ---------------------------------------------------------------- units
test('versions, forbidden modes, ACP normalization, and API keys stripped from the adapter env', () => {
  assert.deepEqual(parseVersion('codex-acp 2.5.0'), [2, 5, 0]);
  assert.equal(versionAtLeast([2, 1, 319], [2, 1, 234]), true);
  assert.equal(versionAtLeast([2, 1, 200], [2, 1, 234]), false);
  for (const mode of ['agent-full-access', 'bypassPermissions', 'dangerously-skip']) assert.equal(isForbiddenMode(mode), true, mode);
  for (const mode of ['read-only', 'workspace-write', 'default']) assert.equal(isForbiddenMode(mode), false, mode);
  assert.deepEqual(fromAcpUpdate({ update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hi' } } }).text, 'hi');
  assert.equal(fromAcpUpdate({ update: { sessionUpdate: 'usage_update' } }), null);
  const env = adapterEnvironment({ PATH: '/bin', OPENAI_API_KEY: 'x', CODEX_API_KEY: 'y', OPENAI_BASE_URL: 'z' }, '/usr/bin/codex');
  assert.deepEqual(env, { PATH: '/bin', CODEX_PATH: '/usr/bin/codex' });
});

test('detection: adapter missing, unsupported version, and ready', async () => {
  const tools = await fakeTools();
  assert.equal((await detectCodex({ ...tools.env, YALLAFLOW_CODEX_ACP: '', PATH: '/nonexistent' })).ready, false);
  const old = await fakeTools({ adapterVersion: '3.0.0' });
  const tooNew = await detectCodex(old.env);
  assert.equal(tooNew.ready, false);
  assert.match(tooNew.problems.join(' '), /not supported/);
  const ok = await detectCodex(tools.env);
  assert.equal(ok.ready, true, ok.problems.join(' '));
  assert.equal(ok.adapter.version, '2.5.0');
  assert.equal(ok.codex.version, '0.164.0');
});

// ---------------------------------------------------------------- Codex (simulated ACP)
test('codex: start, stream, follow-up, permissions (allow, deny, timeout), one session per checkout, no activation', async () => {
  const { root, workId } = await project();
  const tools = await fakeTools();
  const c = await consoleWith(root, { agents: true, agentEnv: tools.env });
  try {
    const status = await c.status();
    assert.equal(status.enabled, true);
    assert.equal(status.providers[0].ready, true);
    assert.equal(status.providers.length, 1, 'Claude is not offered without --experimental-claude');

    assert.equal((await c.post('start', { provider: 'codex', workId, mode: 'agent-full-access' })).status, 400, 'full access is refused');
    const started = await c.post('start', { provider: 'codex', workId, mode: 'read-only' });
    assert.equal(started.status, 201, await started.clone().text());
    const session = await started.json();
    assert.equal(session.mode, 'read-only');
    assert.equal(session.auth, 'ChatGPT Plus');
    assert.deepEqual(session.modes, ['read-only', 'workspace-write', 'agent'], 'the full-access mode is never offered');
    assert.equal(await activeWork(root), null, 'starting a session never activates work');
    const spawned = (await stateLines(tools.state)).find((line) => line.spawn);
    assert.equal(spawned.hasOpenAiKey, false, 'OPENAI_API_KEY never reaches the adapter');
    assert.equal(spawned.hasCodexKey, false);
    assert.equal(spawned.cwd, root, 'the agent runs in the project checkout');

    assert.equal((await c.post('start', { provider: 'codex', workId })).status, 409, 'one session per checkout');

    assert.equal((await c.post('message', { text: 'Continue the work' })).status, 202);
    await c.waitFor((e) => e.type === 'turn.ended');
    assert.equal(c.events.filter((e) => e.type === 'message.delta').map((e) => e.text).join(''), 'Hello from the agent.');
    c.events.length = 0;
    await c.post('message', { text: 'Follow-up' });
    await c.waitFor((e) => e.type === 'turn.ended');
    // PF-0059: a failed turn (usage limit) still ends the turn; the session is idle again.
    c.events.length = 0;
    await c.post('message', { text: 'LIMIT reached' });
    const failed = await c.waitFor((e) => e.type === 'turn.ended');
    assert.equal(failed.stopReason, 'error');
    assert.ok(c.events.some((e) => e.type === 'error' && /Internal error/.test(e.message)));
    assert.equal((await c.status()).session.status, 'idle', 'the session is ready for another message');
    assert.equal((await c.post('message', { text: 'Follow-up after the limit' })).status, 202);
    await c.waitFor((e) => e.type === 'turn.ended' && e.stopReason !== 'error');

    // allow
    c.events.length = 0;
    await c.post('message', { text: 'PERMISSION please' });
    const asked = await c.waitFor((e) => e.type === 'permission.requested');
    assert.deepEqual(asked.decisions, ['allow', 'allow_session', 'deny']);
    assert.equal(asked.detail, null, 'the fixture tool title equals the permission title, so no duplicate detail');
    assert.equal((await c.post('permission', { requestId: asked.requestId, decision: 'bogus' })).status, 400);
    assert.equal((await c.post('permission', { requestId: asked.requestId, decision: 'allow' })).status, 200);
    await c.waitFor((e) => e.type === 'tool.updated' && e.status === 'completed');
    assert.equal((await c.post('permission', { requestId: asked.requestId, decision: 'allow' })).status, 409, 'a request is answered once');
    await c.waitFor((e) => e.type === 'turn.ended');
    // deny
    c.events.length = 0;
    await c.post('message', { text: 'PERMISSION again' });
    const asked2 = await c.waitFor((e) => e.type === 'permission.requested');
    await c.post('permission', { requestId: asked2.requestId, decision: 'deny' });
    await c.waitFor((e) => e.type === 'tool.updated' && e.status === 'failed');
    await c.waitFor((e) => e.type === 'turn.ended');
    // timeout (nobody answers; the browser could be closed)
    c.events.length = 0;
    await c.post('message', { text: 'PERMISSION once more' });
    await c.waitFor((e) => e.type === 'permission.requested');
    const resolved = await c.waitFor((e) => e.type === 'permission.resolved', 3000);
    assert.equal(resolved.decision, 'deny');
    assert.equal(resolved.by, 'timeout');
    const answers = (await stateLines(tools.state)).filter((line) => line.permission).map((line) => line.permission.optionId ?? line.permission.outcome);
    assert.deepEqual(answers, ['allow_once', 'decline', 'decline'], 'deny is the one-time decline, never the persistent host block');
    // the decision log is appended after the decision applies (best-effort): wait for it
    const logged = async () => (await readFile(path.join(root, '.yallaflow', 'local', 'agent-sessions', 'decisions.jsonl'), 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line).by);
    for (let tries = 0; tries < 100 && (await logged()).length < 3; tries++) await sleep(20);
    assert.deepEqual(await logged(), ['user', 'user', 'timeout']);
    const ignored = spawnSync('git', ['check-ignore', '-q', '.yallaflow/local/agent-sessions/decisions.jsonl'], { cwd: root });
    assert.equal(ignored.status, 0, 'session records are git-ignored');
  } finally {
    await c.close();
  }
});

test('codex: cancel, crash, resume after a console restart, explicit activation through Core', async () => {
  const { root, workId } = await project();
  const tools = await fakeTools();
  let c = await consoleWith(root, { agents: true, agentEnv: tools.env });
  let recordId;
  try {
    const session = await (await c.post('start', { provider: 'codex', workId })).json();
    recordId = session.recordId;
    await c.post('message', { text: 'SLOW count' });
    await c.waitFor((e) => e.type === 'message.delta');
    assert.equal((await c.post('message', { text: 'too early' })).status, 409, 'busy while working');
    assert.equal((await c.post('cancel', {})).status, 200);
    const ended = await c.waitFor((e) => e.type === 'turn.ended');
    assert.equal(ended.stopReason, 'cancelled');

    c.events.length = 0;
    await c.post('message', { text: 'CRASH now' });
    const crashed = await c.waitFor((e) => e.type === 'session.ended');
    assert.equal(crashed.reason, 'crashed');
    assert.equal(crashed.resumable, true);
    assert.equal((await c.status()).session, null);
  } finally {
    await c.close();
  }
  // A new console process: the session record survives and the session resumes by ID.
  c = await consoleWith(root, { agents: true, agentEnv: tools.env });
  try {
    const status = await c.status();
    assert.equal(status.resumable[0].id, recordId);
    assert.equal((await c.post('resume', { recordId: '../../etc' })).status, 400, 'record ids are validated');
    const resumed = await c.post('resume', { recordId });
    assert.equal(resumed.status, 201, await resumed.clone().text());
    await c.post('message', { text: 'after resume' });
    await c.waitFor((e) => e.type === 'turn.ended');

    assert.equal((await c.post('activate', { workId: 'PF-9999' })).status, 422, 'Core refuses an unknown item');
    assert.equal((await c.post('activate', { workId: '../x' })).status, 400);
    assert.equal(await activeWork(root), null);
    assert.equal((await c.post('activate', { workId })).status, 200);
    assert.equal(await activeWork(root), workId, 'activation happens only on the explicit request');
    assert.equal((await c.post('end', {})).status, 200);
  } finally {
    await c.close();
  }
});

test('codex: ending a session while a permission is pending denies it and never crashes the console', async () => {
  const { root, workId } = await project();
  const tools = await fakeTools();
  const c = await consoleWith(root, { agents: true, agentEnv: { ...tools.env, YALLAFLOW_AGENT_PERMISSION_TIMEOUT_MS: '60000' } });
  try {
    await c.post('start', { provider: 'codex', workId });
    await c.post('message', { text: 'PERMISSION then end' });
    await c.waitFor((e) => e.type === 'permission.requested');
    assert.equal((await c.post('end', {})).status, 200);
    const resolved = await c.waitFor((e) => e.type === 'permission.resolved');
    assert.equal(resolved.decision, 'deny');
    await sleep(300);
    assert.equal((await c.status()).enabled, true, 'the console is still serving');
  } finally {
    await c.close();
  }
});

test('codex: a non-subscription login is refused and no session starts', async () => {
  const { root, workId } = await project();
  const tools = await fakeTools({ auth: 'apiKey' });
  const c = await consoleWith(root, { agents: true, agentEnv: tools.env });
  try {
    const response = await c.post('start', { provider: 'codex', workId });
    assert.equal(response.status, 422);
    const body = await response.json();
    assert.equal(body.error.code, 'SUBSCRIPTION_REQUIRED');
    assert.equal((await c.status()).session, null);
  } finally {
    await c.close();
  }
});

test('security: opt-in, token, Origin, content type, read-only, unsupported controls', async () => {
  const { root, workId } = await project();
  const tools = await fakeTools();
  const off = await consoleWith(root, { agentEnv: tools.env });
  try {
    assert.equal((await off.status()).enabled, false);
    assert.equal((await off.post('start', { provider: 'codex', workId })).status, 405, 'agents are off without --agents');
  } finally { await off.close(); }
  const ro = await consoleWith(root, { agents: true, readOnly: true, agentEnv: tools.env });
  try {
    assert.equal(ro.projects.agents.enabled, false, '--read-only keeps the console read-only');
    assert.equal((await ro.post('start', { provider: 'codex', workId })).status, 405);
  } finally { await ro.close(); }
  const c = await consoleWith(root, { agents: true, agentEnv: tools.env });
  try {
    const raw = (headers) => fetch(`${c.server.url}api/p/${c.pid}/agent/start`, { method: 'POST', headers, body: JSON.stringify({ provider: 'codex', workId }) });
    assert.equal((await raw({ Origin: c.origin, 'Content-Type': 'application/json' })).status, 401);
    assert.equal((await raw({ Authorization: `Bearer ${c.server.token}`, 'Content-Type': 'application/json' })).status, 403, 'Origin required');
    assert.equal((await raw({ Authorization: `Bearer ${c.server.token}`, Origin: 'http://evil.example', 'Content-Type': 'application/json' })).status, 403);
    assert.equal((await raw({ Authorization: `Bearer ${c.server.token}`, Origin: c.origin, 'Content-Type': 'text/plain' })).status, 415);
    assert.equal((await c.post('start', { provider: 'codex', workId: '../../x' })).status, 400);
    assert.equal((await c.post('start', { provider: 'claude', workId })).status, 400, 'YallaFlow never starts Claude');
    assert.equal((await c.post('connect', { provider: 'claude', workId })).status, 400, 'Claude is experimental and off');
    assert.equal((await c.post('cancel', {})).status, 409);
    assert.equal((await c.post('message', { text: 'x' })).status, 409, 'no session');
    const bridge = await fetch(`${c.server.url}api/agent-bridge/claude/stream`);
    assert.equal(bridge.status, 404, 'no channel endpoint without --experimental-claude');
  } finally { await c.close(); }
});

test('security review regressions: start race, modes, symlinks', async () => {
  const { root, workId } = await project();
  const tools = await fakeTools();
  const c = await consoleWith(root, { agents: true, agentEnv: { ...tools.env, YALLAFLOW_AGENT_PERMISSION_TIMEOUT_MS: '60000' } });
  const spawns = async () => (await stateLines(tools.state).catch(() => [])).filter((line) => line.spawn).length;
  try {
    // (3) an empty, unknown, or full-access mode is refused before anything starts
    for (const mode of ['', null, 'agent', 'agent-full-access']) assert.equal((await c.post('start', { provider: 'codex', workId, mode })).status, 400, `mode ${mode}`);
    assert.equal(await spawns(), 0, 'no adapter was started for a refused mode');

    // (1) two concurrent starts: exactly one wins, one adapter process
    const [a, b] = await Promise.all([c.post('start', { provider: 'codex', workId, mode: 'read-only' }), c.post('start', { provider: 'codex', workId, mode: 'read-only' })]);
    assert.deepEqual([a.status, b.status].sort(), [201, 409]);
    assert.equal(await spawns(), 1, 'the losing request never spawned an adapter');

    // (3) the agent switching itself to full access ends the session
    await c.post('message', { text: 'ESCALATE please' });
    const refused = await c.waitFor((e) => e.type === 'error' && e.code === 'MODE_FORBIDDEN');
    assert.match(refused.message, /does not use/);
    await c.waitFor((e) => e.type === 'session.ended' && e.reason === 'forbidden mode');
    assert.equal((await c.status()).session, null);
    assert.equal(c.events.some((e) => e.type === 'mode.changed' && e.mode === 'agent-full-access'), false, 'the forbidden mode is never shown as the session mode');
  } finally {
    await c.close();
  }

  // (2) a symbolic link under .yallaflow/local is never written through
  const outside = await mkdtemp(path.join(os.tmpdir(), 'yf-outside-'));
  const sessions = path.join(root, '.yallaflow', 'local', 'agent-sessions');
  await rm(sessions, { recursive: true, force: true });
  await symlink(outside, sessions);
  const c2 = await consoleWith(root, { agents: true, agentEnv: tools.env });
  try {
    const start = await c2.post('start', { provider: 'codex', workId, mode: 'read-only' });
    assert.notEqual(start.status, 200, 'a session whose record would go through a link does not start');
    assert.deepEqual(await readdir(outside), [], 'nothing written outside the checkout');
  } finally {
    await c2.close();
  }
  await rm(sessions, { force: true });
});

test('codex: an adapter that cannot be spawned fails the start promptly and frees the checkout', async () => {
  const { root, workId } = await project();
  const tools = await fakeTools();
  const c = await consoleWith(root, { agents: true, agentEnv: tools.env });
  try {
    await c.status(); // detection is cached as ready
    await chmod(tools.env.YALLAFLOW_CODEX_ACP, 0o644); // the adapter loses its exec bit after detection
    const started = Date.now();
    const failed = await c.post('start', { provider: 'codex', workId, mode: 'read-only' });
    assert.notEqual(failed.status, 201);
    assert.ok(Date.now() - started < 20_000, 'no hang');
    assert.equal((await c.status()).session, null, 'the slot is free again');
  } finally {
    await c.close(); // and the console still shuts down
  }
});

test('stabilization: Allow for session is session-scoped only; nothing persists or carries to another session', async () => {
  const { root, workId } = await project();
  const tools = await fakeTools();
  const c = await consoleWith(root, { agents: true, agentEnv: tools.env });
  try {
    assert.equal((await c.post('start', { provider: 'codex', workId, mode: 'read-only' })).status, 201);
    // The fixture lists the persistent exec-policy rule before the session option.
    await c.post('message', { text: 'PERMISSION' });
    const asked = await c.waitFor((e) => e.type === 'permission.requested');
    assert.deepEqual(asked.decisions, ['allow', 'allow_session', 'deny']);
    await c.post('permission', { requestId: asked.requestId, decision: 'allow_session' });
    await c.waitFor((e) => e.type === 'turn.ended');
    // Only persistent "always" options: Allow for session is not offered, deny never blocks for the future.
    c.events.length = 0;
    await c.post('message', { text: 'PERMISSION PERSISTONLY' });
    const persistent = await c.waitFor((e) => e.type === 'permission.requested');
    assert.deepEqual(persistent.decisions, ['allow', 'deny'], 'no session-scoped option, so no Allow for session');
    assert.equal((await c.post('permission', { requestId: persistent.requestId, decision: 'allow_session' })).status, 400);
    await c.post('permission', { requestId: persistent.requestId, decision: 'deny' });
    await c.waitFor((e) => e.type === 'turn.ended');
    // A new session asks again: YallaFlow keeps no decision for reuse.
    assert.equal((await c.post('end')).status, 200);
    assert.equal((await c.post('start', { provider: 'codex', workId, mode: 'read-only' })).status, 201);
    c.events.length = 0;
    await c.post('message', { text: 'PERMISSION' });
    const again = await c.waitFor((e) => e.type === 'permission.requested');
    await c.post('permission', { requestId: again.requestId, decision: 'deny' });
    await c.waitFor((e) => e.type === 'turn.ended');
    const answers = (await stateLines(tools.state)).filter((line) => line.permission).map((line) => line.permission.optionId ?? line.permission.outcome);
    assert.deepEqual(answers, ['allow_for_session', 'cancelled', 'decline']);
    assert.ok(!answers.some((id) => ['accept_execpolicy_amendment', 'apply_network_policy_amendment:0'].includes(id)), 'a persistent provider rule is never selected');
    assert.equal(await activeWork(root), null, 'permissions never activate work or approve anything in YallaFlow');
  } finally {
    await c.close();
  }
});

test('stabilization: ending a Codex session ends what it started, and an incomplete cleanup is never reported as a clean stop', { skip: process.platform === 'win32' }, async () => {
  const { root, workId } = await project();
  const tools = await fakeTools();
  const c = await consoleWith(root, { agents: true, agentEnv: tools.env });
  const isAlive = (pid) => { try { process.kill(pid, 0); } catch { return false; } try { const st = readFileSync(`/proc/${pid}/stat`, 'utf8'); return st.slice(st.lastIndexOf(')') + 2)[0] !== 'Z'; } catch { return true; } };
  try {
    assert.equal((await c.post('start', { provider: 'codex', workId, mode: 'read-only' })).status, 201);
    await c.post('message', { text: 'SPAWN ESCAPE' });
    await c.waitFor((e) => e.type === 'turn.ended');
    const commands = (await stateLines(tools.state)).filter((line) => line.command);
    assert.equal(commands.length, 2);
    for (const { command } of commands) assert.ok(isAlive(command), 'the commands run while the session runs');
    const ended = await c.post('end');
    assert.equal(ended.status, 200);
    const body = await ended.json();
    assert.equal(body.cleanup.complete, true, JSON.stringify(body.cleanup));
    for (const { command, detached } of commands) {
      if (detached && process.platform !== 'linux') continue; // outside the group: tracked through /proc on Linux only
      assert.ok(!isAlive(command), `command ${command} (detached: ${detached}) was ended with the session`);
    }
    const endedEvent = await c.waitFor((e) => e.type === 'session.ended');
    assert.equal(endedEvent.cleanup.complete, true);

    await c.close();
    // A survivor YallaFlow cannot end: the event, the record and the shutdown result say so.
    clearDetectionCache();
    const seen = [];
    const bridge = new AgentBridge({ projects: [{ id: 'p1', name: 'Shop', root }], broadcast: (id, event) => seen.push(event), env: tools.env, port: 1 });
    await bridge.open();
    await bridge.startCodex('p1', { workId, mode: 'read-only' });
    [...bridge.projects.values()][0].session.impl.conn.survivors = () => [424242];
    const close = await bridge.close();
    assert.deepEqual(close.map((entry) => entry.cleanup.survivors), [['424242']]);
    const last = seen.filter((event) => event.type === 'session.ended').at(-1);
    assert.equal(last.cleanup.complete, false, 'the panel is told the stop is incomplete');
    const records = await readdir(path.join(root, '.yallaflow', 'local', 'agent-sessions'));
    const latest = (await Promise.all(records.filter((name) => name.endsWith('.json')).map(async (name) => JSON.parse(await readFile(path.join(root, '.yallaflow', 'local', 'agent-sessions', name), 'utf8'))))).find((record) => record.cleanup);
    assert.deepEqual(latest.cleanup, { complete: false, survivors: ['424242'] });
  } finally {
    await c.close().catch(() => {});
  }
});

test('stabilization: one agent console per checkout across separate console processes', async () => {
  const { root, workId } = await project();
  const tools = await fakeTools();
  // Console A: a separate OS process.
  const a = spawn(process.execPath, [cli, 'console', '--no-open', '--agents', '--port', '0'], { cwd: root, env: tools.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  a.stdout.on('data', (chunk) => { out += chunk; });
  try {
    for (let i = 0; i < 200 && !/Open: /.test(out); i++) await sleep(25);
    assert.match(out, /Open: /, out);
    assert.equal(existsSync(path.join(root, '.yallaflow', 'local')), false, 'opening an agent console writes nothing into the project');
    // A starts a session: from then on it owns the checkout.
    const url = /Open: (http:\/\/127\.0\.0\.1:\d+\/)#token=([0-9a-f]+)/.exec(out);
    const headers = { Authorization: `Bearer ${url[2]}`, Origin: url[1].replace(/\/$/, ''), 'Content-Type': 'application/json' };
    const listed = (await (await fetch(`${url[1]}api/projects`, { headers })).json()).projects;
    assert.deepEqual(listed.map((entry) => entry.root), [root], 'the console sees only the test project, never a saved list');
    const pid = listed[0].id;
    const startedA = await fetch(`${url[1]}api/p/${pid}/agent/start`, { method: 'POST', headers, body: JSON.stringify({ provider: 'codex', workId, mode: 'read-only' }) });
    assert.equal(startedA.status, 201, await startedA.clone().text());
    const lock = JSON.parse(await readFile(path.join(root, '.yallaflow', 'local', 'agent-console.lock'), 'utf8'));
    assert.equal(lock.pid, a.pid, 'console A holds the checkout lock');
    // Console B in this test process: it can show the project but cannot run agents there.
    const b = await consoleWith(root, { agents: true, agentEnv: tools.env });
    try {
      const status = await b.status();
      assert.match(status.lockedBy?.message ?? '', new RegExp(`pid ${a.pid}`));
      const refused = await b.post('start', { provider: 'codex', workId, mode: 'read-only' });
      assert.equal(refused.status, 409);
      assert.equal((await refused.json()).error.code, 'CHECKOUT_LOCKED');
      assert.equal((await stateLines(tools.state).catch(() => [])).filter((line) => line.spawn).length, 1, 'B started no adapter (the one is A\'s)');
      // A stops (or crashes): the checkout frees up for B on its next action.
      a.kill('SIGKILL');
      await new Promise((resolve) => a.once('exit', resolve));
      const started = await b.post('start', { provider: 'codex', workId, mode: 'read-only' });
      assert.equal(started.status, 201, await started.clone().text());
      const now = JSON.parse(await readFile(path.join(root, '.yallaflow', 'local', 'agent-console.lock'), 'utf8'));
      assert.equal(now.pid, process.pid, 'the stale lock of the killed console was reclaimed');
    } finally {
      await b.close();
    }
    assert.equal(existsSync(path.join(root, '.yallaflow', 'local', 'agent-console.lock')), false, 'released when the console stops');
  } finally {
    if (a.exitCode === null) a.kill('SIGKILL');
  }
});

test('stabilization: a directory swapped for a link after the check cannot redirect a local write', { skip: process.platform === 'win32' }, async () => {
  const { safeLocalDir, safeWriteFile, safeAppendFile, ANCHORED_WRITES } = await import('../src/agents/local-files.js');
  const root = await mkdtemp(path.join(os.tmpdir(), 'yf-anchor-'));
  const outside = await mkdtemp(path.join(os.tmpdir(), 'yf-outside-'));
  const dir = await safeLocalDir(root, '.yallaflow', 'local', 'agent-sessions');
  await safeWriteFile(dir, 'a.json', '{}');
  // The check passed; now the directory is swapped for a link to a place outside the checkout.
  await rename(dir, `${dir}.moved`);
  await symlink(outside, dir);
  await assert.rejects(safeWriteFile(dir, 'b.json', '{}'), { code: 'SYMLINK_REFUSED' });
  await assert.rejects(safeAppendFile(dir, 'decisions.jsonl', 'x\n'), { code: 'SYMLINK_REFUSED' });
  assert.deepEqual(await readdir(outside), [], 'nothing was written outside the checkout');
  if (process.platform === 'linux') assert.equal(ANCHORED_WRITES, true, 'Linux writes resolve directories through opened handles');
});

test('stabilization review: hard links, End while starting, overlapping lock claims, crash cleanup', { skip: process.platform === 'win32' }, async () => {
  const { safeLocalDir, safeAppendFile } = await import('../src/agents/local-files.js');
  const { link } = await import('node:fs/promises');
  // A hard link planted as the decision log is refused (O_NOFOLLOW does not stop it).
  const root0 = await mkdtemp(path.join(os.tmpdir(), 'yf-hardlink-'));
  const victim = path.join(await mkdtemp(path.join(os.tmpdir(), 'yf-victim-')), 'victim.txt');
  await writeFile(victim, 'original\n');
  const dir = await safeLocalDir(root0, '.yallaflow', 'local', 'agent-sessions');
  await link(victim, path.join(dir, 'decisions.jsonl'));
  await assert.rejects(safeAppendFile(dir, 'decisions.jsonl', 'x\n'), { code: 'HARDLINK_REFUSED' });
  assert.equal(await readFile(victim, 'utf8'), 'original\n');

  const { root, workId } = await project();
  const tools = await fakeTools();
  const isAlive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  // End while the adapter is still in its handshake: the adapter is ended now, with a cleanup result.
  const slow = { ...tools.env, FAKE_ACP_INIT_DELAY_MS: '3000' };
  const seen = [];
  clearDetectionCache();
  const bridge = new AgentBridge({ projects: [{ id: 'p1', name: 'Shop', root }], broadcast: (id, event) => seen.push(event), env: slow, port: 1 });
  await bridge.open();
  const starting = bridge.startCodex('p1', { workId, mode: 'read-only' }).catch((error) => error);
  for (let i = 0; i < 200 && !(await stateLines(tools.state).catch(() => [])).some((line) => line.spawn); i++) await sleep(10);
  const adapterPid = [...bridge.projects.values()][0].session.impl.conn.child.pid;
  const t0 = Date.now();
  const ended = await bridge.end('p1');
  assert.ok(Date.now() - t0 < 2500, 'the adapter is ended at once, not after the handshake');
  assert.equal(ended.cleanup.complete, true);
  assert.equal(isAlive(adapterPid), false, 'no adapter left running');
  assert.equal((await starting).code, 'CANCELLED');
  assert.equal(seen.filter((event) => event.type === 'session.ended').at(-1).cleanup.complete, true);
  await bridge.close();

  // Overlapping claims after another console released the checkout: no false "locked by me".
  clearDetectionCache();
  const a = new AgentBridge({ projects: [{ id: 'p1', name: 'Shop', root }], broadcast: () => {}, env: tools.env, port: 1 });
  const b = new AgentBridge({ projects: [{ id: 'p1', name: 'Shop', root }], broadcast: () => {}, env: tools.env, port: 2 });
  try {
  await a.open();
  await b.open();
  await a.startCodex('p1', { workId, mode: 'read-only' });
  assert.ok((await b.status('p1')).lockedBy, 'B sees the checkout as A\'s');
  await a.close();
  const [status, started] = await Promise.all([b.status('p1'), b.startCodex('p1', { workId, mode: 'read-only' })]);
  assert.equal(status.lockedBy, null);
  assert.equal(started.provider, 'codex');
  // The lock file removed under the owner (git clean): the owner notices and claims it again.
  await rm(path.join(root, '.yallaflow', 'local', 'agent-console.lock'));
  assert.equal((await b.status('p1')).lockedBy, null, 'status only reads');
  await b.ensureOwner([...b.projects.values()][0]);
  assert.ok(existsSync(path.join(root, '.yallaflow', 'local', 'agent-console.lock')), 'the next action claims it again');

  // A crash: what the adapter started in its group is ended, and the event carries the result.
  await b.message('p1', 'SPAWN then CRASH');
  const crashed = await (async () => { for (let i = 0; i < 300; i++) { const e = (await b.status('p1')).events.find((event) => event.type === 'session.ended'); if (e) return e; await sleep(20); } return null; })();
  assert.ok(crashed?.cleanup, 'the crash report carries a cleanup result');
  assert.equal(crashed.cleanup.coverage, process.platform === 'linux' ? 'tracked' : 'group');
  const command = (await stateLines(tools.state)).filter((line) => line.command).at(-1).command;
  assert.equal(isAlive(command), false, 'the command the crashed adapter started was ended');
  } finally {
    await a.close().catch(() => {});
    await b.close().catch(() => {});
  }
});

test('CLI: agents detect is read-only; console flag combinations are validated', async () => {
  const { root } = await project();
  const before = await readdir(path.join(root, '.yallaflow'));
  const detect = run(root, ['agents', 'detect']);
  assert.equal(detect.status, 0, detect.stderr);
  assert.match(detect.stdout, /Codex: /);
  assert.deepEqual(await readdir(path.join(root, '.yallaflow')), before);
  assert.match(run(root, ['console', '--agents', '--read-only', '--no-open']).stderr, /cannot be combined with --read-only/);
  assert.match(run(root, ['console', '--experimental-claude', '--no-open']).stderr, /needs --agents/);
  assert.equal(run(root, ['agents', 'bogus']).status, 1);
  // Releases do not include the experimental Claude connection: the flag refuses clearly.
  if (!claudeIncluded()) {
    assert.match(run(root, ['console', '--agents', '--experimental-claude', '--no-open']).stderr, /not included in this release/);
    assert.match(run(root, ['agents', 'claude-files']).stderr, /not included in this release/);
    assert.doesNotMatch(detect.stdout, /Claude/);
  }
  const status = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).stdout;
  assert.equal(status.includes('local/agent'), false);
});
