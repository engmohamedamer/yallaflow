// Shared fixtures for the v1.3.0 Agent Workspace tests. Every provider here is SIMULATED:
// the ACP agent is test-support/fake-acp-agent.mjs.
import { spawnSync } from 'node:child_process';
import { chmod, copyFile, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { initWorkspace } from '../src/core/workspace.js';
import { startConsoleServer } from '../src/console/server.js';
import { clearDetectionCache } from '../src/agents/detect.js';
import { mkdtempSync } from 'node:fs';

// Never the developer's real saved-project list: a console started by these tests (in this
// process or as a child) must not open, read or write any project but the test's own.
process.env.XDG_CONFIG_HOME = mkdtempSync(path.join(os.tmpdir(), 'yf-agent-config-'));

export const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
export const FAKE = fileURLToPath(new URL('../test-support/fake-acp-agent.mjs', import.meta.url));
export const run = (cwd, args) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A fake installed toolchain: `codex` and a user-installed `codex-acp` package.
export async function fakeTools({ adapterVersion = '2.5.0', auth = 'account' } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yf-agent-tools-'));
  const pkg = path.join(dir, 'node_modules', '@agentclientprotocol', 'codex-acp');
  await mkdir(path.join(pkg, 'dist'), { recursive: true });
  await writeFile(path.join(pkg, 'package.json'), JSON.stringify({ name: '@agentclientprotocol/codex-acp', version: adapterVersion, type: 'module' }));
  const adapter = path.join(pkg, 'dist', 'index.js');
  await copyFile(FAKE, adapter);
  await chmod(adapter, 0o755);
  const codex = path.join(dir, 'codex');
  await writeFile(codex, '#!/bin/sh\necho "codex-cli 0.164.0"\n');
  await chmod(codex, 0o755);
  const state = path.join(dir, 'state.jsonl');
  return { dir, state, env: { ...process.env, YALLAFLOW_CODEX_BIN: codex, YALLAFLOW_CODEX_ACP: adapter, FAKE_ACP_STATE: state, FAKE_ACP_AUTH: auth, OPENAI_API_KEY: 'sk-test-should-be-stripped', CODEX_API_KEY: 'should-be-stripped', YALLAFLOW_AGENT_PERMISSION_TIMEOUT_MS: '400' } };
}

export async function project() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yf-agent-proj-'));
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
  await initWorkspace(root, 'Agent Shop', 'greenfield', 'adaptive');
  const created = run(root, ['start', '--keep-active', '--', 'Add CSV export']);
  const workId = /Created (PF-\d+)/.exec(created.stdout)[1];
  return { root, workId };
}

export async function consoleWith(root, options = {}) {
  clearDetectionCache();
  const server = await startConsoleServer({ roots: [root], port: 0, ...options });
  const origin = server.url.replace(/\/$/, '');
  const projects = await (await fetch(`${server.url}api/projects`, { headers: { Authorization: `Bearer ${server.token}` } })).json();
  const pid = projects.projects[0].id;
  const events = [];
  const controller = new AbortController();
  const stream = await fetch(`${server.url}api/events`, { headers: { Authorization: `Bearer ${server.token}` }, signal: controller.signal });
  (async () => {
    const reader = stream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let cut;
        while ((cut = buffer.indexOf('\n\n')) >= 0) {
          const line = buffer.slice(0, cut).split('\n').find((entry) => entry.startsWith('data: '));
          buffer = buffer.slice(cut + 2);
          if (line) { const item = JSON.parse(line.slice(6)); if (item.type === 'agent') events.push(item.event); }
        }
      }
    } catch { /* closed */ }
  })();
  const post = (action, body, headers = {}) => fetch(`${server.url}api/p/${pid}/agent/${action}`, { method: 'POST', headers: { Authorization: `Bearer ${server.token}`, Origin: origin, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body ?? {}) });
  const status = async () => (await fetch(`${server.url}api/p/${pid}/agent`, { headers: { Authorization: `Bearer ${server.token}` } })).json();
  const waitFor = async (predicate, ms = 20000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { const hit = events.find(predicate); if (hit) return hit; await sleep(20); }
    throw new Error(`event not seen; got ${events.map((e) => e.type).join(',')}`);
  };
  return { server, pid, origin, events, post, status, waitFor, projects, async close() { controller.abort(); await server.close(); } };
}
export const activeWork = async (root) => JSON.parse(await readFile(path.join(root, '.yallaflow', 'state', 'current.yaml'), 'utf8')).activeWork;
export const stateLines = async (file) => (await readFile(file, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
