// PF-0138: Claude Code connected through its channel but never linked to a session must not
// be a dead end: Unlink lets it go, and the project can be removed. The Claude side is
// SIMULATED (an MCP-client fixture speaks to the real channel server), as in
// agent-claude-experimental.test.js. Skipped when the experimental files are absent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { claudeIncluded } from '../src/agents/experimental.js';
import { consoleWith, fakeTools, project, sleep } from '../test-support/agent-fixtures.js';

const CHANNEL = fileURLToPath(new URL('../resources/agents/claude-channel.mjs', import.meta.url));
const skip = !claudeIncluded() && 'the experimental Claude connection is not in this tree';

function connectChannel(cwd) {
  const child = spawn(process.execPath, [CHANNEL], { cwd, stdio: ['pipe', 'ignore', 'inherit'] });
  const send = (message) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
  send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fixture', version: '0' } } });
  send({ method: 'notifications/initialized' });
  return { close: () => child.kill() };
}
const remove = (c) => fetch(`${c.server.url}api/projects/remove`, { method: 'POST', headers: { Authorization: `Bearer ${c.server.token}`, Origin: c.origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: c.pid }) });
const bridgeFile = (root) => path.join(root, '.yallaflow', 'local', 'agent-bridge.json');

test('claude (simulated): Unlink works when Claude Code is connected without a linked session, and it stays unlinked', { skip }, async () => {
  const { root } = await project();
  const tools = await fakeTools();
  const c = await consoleWith(root, { agents: true, experimentalClaude: true, agentEnv: tools.env });
  const channel = connectChannel(root);
  try {
    await c.waitFor((e) => e.type === 'session.connected');
    const before = (await c.status()).session;
    assert.equal(before.provider, 'claude');
    assert.equal(before.recordId, null, 'connected, but no session is linked');

    const unlink = await c.post('disconnect', {});
    assert.equal(unlink.status, 200, 'Unlink no longer fails with "No Claude Code session is linked"');
    assert.deepEqual(await unlink.json(), { ok: true, claude: false });
    assert.equal((await c.status()).session, null);
    assert.equal(existsSync(bridgeFile(root)), false, 'the channel has nothing to reconnect to');
    await sleep(2600); // longer than the channel's reconnect delay
    assert.equal((await c.status()).session, null, 'it does not come back by itself');

    assert.equal((await c.post('disconnect', {})).status, 409, 'with nothing connected, Unlink still says so');
    assert.equal((await remove(c)).status, 200, 'and the project can be removed');
  } finally {
    channel.close();
    await c.close();
  }
});

test('claude (simulated): a project with an idle, unlinked Claude Code connection can be removed directly', { skip }, async () => {
  const { root } = await project();
  const tools = await fakeTools();
  const c = await consoleWith(root, { agents: true, experimentalClaude: true, agentEnv: tools.env });
  const channel = connectChannel(root);
  try {
    await c.waitFor((e) => e.type === 'session.connected');
    const response = await remove(c);
    assert.equal(response.status, 200, 'no "an agent session is running" for a connection that is only attached');
    assert.equal(existsSync(bridgeFile(root)), false);
  } finally {
    channel.close();
    await c.close();
  }
});
