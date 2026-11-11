// PF-0123 (1.5.2): project readiness — derived from Core state, enforced on the server, never
// blocking Greenfield work, onboarding or read-only use.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { initWorkspace } from '../src/core/workspace.js';
import { startConsoleServer } from '../src/console/server.js';
import { computeReadiness } from '../src/console/readiness.js';
import { approveTeamBaseline, writeTeamApp } from '../test-support/shared.js';
import { startBaseline } from '../src/baseline/store.js';
import { consoleWith, fakeTools } from '../test-support/agent-fixtures.js';

const workIds = async (root) => (await readdir(path.join(root, '.yallaflow', 'work')).catch(() => [])).sort();

async function project(kind, { app = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yf-ready-'));
  if (app) await writeTeamApp(root);
  else await writeFile(path.join(root, 'package.json'), '{"name":"legacy"}');
  await initWorkspace(root, 'Shop', kind, 'adaptive');
  return root;
}

async function serve(roots, options = {}) {
  const server = await startConsoleServer({ roots, port: 0, ...options });
  const origin = server.url.replace(/\/$/, '');
  const auth = { Authorization: `Bearer ${server.token}` };
  const pid = (await (await fetch(`${server.url}api/projects`, { headers: auth })).json()).projects[0].id;
  const get = async (pathname) => { const r = await fetch(`${server.url}${pathname.slice(1)}`, { headers: auth }); return { status: r.status, body: await r.json() }; };
  const post = (pathname, body) => fetch(`${server.url}${pathname.slice(1)}`, { method: 'POST', headers: { ...auth, Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { server, pid, get, post };
}

const step = (doc, id) => doc.steps.find((entry) => entry.id === id);

test('Greenfield is never gated: ready for work, and the first work item is created', async () => {
  const root = await project('greenfield');
  const { server, pid, get, post } = await serve([root]);
  try {
    const { status, body } = await get(`/api/p/${pid}/readiness`);
    assert.equal(status, 200);
    assert.equal(body.schema, 'yallaflow.console.readiness/1');
    assert.equal(step(body, 'initialized').status, 'done');
    assert.equal(step(body, 'understanding').status, 'done');
    assert.equal(body.allows.createWork, true);
    assert.equal(step(body, 'runtime').optional, true);
    assert.notEqual(body.level, 'attention');
    const created = await post(`/api/p/${pid}/work`, { requestId: 'green-0001', request: 'Our first requirement: a contact form' });
    assert.equal(created.status, 201);
  } finally {
    await server.close();
  }
});

test('Brownfield without approved understanding: readiness says so and work creation is refused before anything is written', async () => {
  const root = await project('brownfield');
  const { server, pid, get, post } = await serve([root]);
  try {
    const { body } = await get(`/api/p/${pid}/readiness`);
    assert.equal(body.level, 'incomplete');
    assert.deepEqual({ status: step(body, 'understanding').status, next: step(body, 'understanding').next.kind }, { status: 'required', next: 'agent' });
    assert.equal(body.allows.createWork, false);
    assert.equal(body.allows.runQueue, false);
    const refused = await post(`/api/p/${pid}/work`, { requestId: 'brown-0101', request: 'Fix invoice totals' });
    // Unchanged API contract: the same status and code Core's own refusal produces.
    assert.equal(refused.status, 422);
    const payload = await refused.json();
    assert.equal(payload.error.code, 'PROJECT_UNDERSTANDING_REQUIRED');
    assert.equal(payload.readiness.allows.createWork, false, 'the refusal carries the next step');
    assert.deepEqual(await workIds(root), []);
    // Onboarding is never blocked: the readiness read, setup and runtime reads still answer.
    assert.equal((await get(`/api/p/${pid}/setup`)).status, 200);
    assert.equal((await get(`/api/p/${pid}/runtime`)).status, 200);
  } finally {
    await server.close();
  }
});

test('Brownfield while the understanding is in progress or awaiting review points at the understanding work item', async () => {
  const root = await project('brownfield');
  const { meta } = await startBaseline(root);
  const doc = await computeReadiness(root, { agent: { checked: true, enabled: true, ready: true, problems: [] } });
  const understanding = step(doc, 'understanding');
  assert.equal(understanding.status, 'in-progress');
  assert.equal(understanding.baselineId, meta.id);
  assert.equal(doc.onboardingWorkId, meta.id, 'the understanding work item itself may run (no deadlock)');
  assert.equal(doc.allows.agentSessions, true, 'agent sessions stay available so the agent can establish understanding');
});

test('Brownfield with an approved baseline is ready with no migration', async () => {
  const root = await project('brownfield', { app: true });
  await approveTeamBaseline(root);
  const doc = await computeReadiness(root, { agent: { checked: true, enabled: true, ready: true, problems: [] } });
  assert.equal(step(doc, 'understanding').status, 'done');
  assert.equal(doc.allows.createWork, true);
  assert.equal(doc.level, 'ready');
});

test('agent readiness blocks only agent sessions and queues; runtime is optional', async () => {
  const root = await project('greenfield');
  const missing = await computeReadiness(root, { agent: { checked: true, enabled: true, ready: false, problems: ['Codex CLI (`codex`) is not installed or not on PATH.'] } });
  assert.equal(step(missing, 'agent').status, 'missing');
  assert.deepEqual([missing.allows.createWork, missing.allows.agentSessions, missing.allows.runQueue], [true, false, false]);
  assert.equal(missing.level, 'ready', 'a project without console agents is still ready for work (CLI users)');
  const off = await computeReadiness(root, { agent: { checked: true, enabled: false, ready: true, problems: [] } });
  assert.equal(step(off, 'agent').status, 'off');
  const runtime = await computeReadiness(root, { agent: { checked: false }, runtime: { supported: true, services: [{ state: 'running' }, { state: 'failed' }] } });
  assert.deepEqual({ status: step(runtime, 'runtime').status, running: step(runtime, 'runtime').running, failed: step(runtime, 'runtime').failed }, { status: 'failed', running: 1, failed: 1 });
  assert.equal(runtime.allows.createWork, true, 'a failed service never blocks work');
});

test('a read-only console reports readiness without probing agents', async () => {
  const root = await project('brownfield');
  const { server, pid, get } = await serve([root], { readOnly: true });
  try {
    const { status, body } = await get(`/api/p/${pid}/readiness`);
    assert.equal(status, 200);
    assert.equal(step(body, 'agent').status, 'unknown');
    assert.equal(step(body, 'understanding').status, 'required');
  } finally {
    await server.close();
  }
});

// ---------- queue runs (server guard) ----------

test('queue runs: refused before understanding except for the understanding item itself, and without a ready agent', async () => {
  const root = await project('brownfield');
  const { meta } = await startBaseline(root);
  const tools = await fakeTools();
  const c = await consoleWith(root, { agents: true, agentEnv: tools.env });
  const run = (body, env = c) => fetch(`${env.server.url}api/p/${env.pid}/execution/run`, { method: 'POST', headers: { Authorization: `Bearer ${env.server.token}`, Origin: env.server.url.replace(/\/$/, ''), 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmed: true, provider: 'codex', ...body }) });
  try {
    const refused = await run({ workIds: ['PF-9999'] });
    assert.equal(refused.status, 409);
    const payload = await refused.json();
    assert.equal(payload.error.code, 'PROJECT_UNDERSTANDING_REQUIRED');
    assert.equal(payload.readiness.onboardingWorkId, meta.id);
    const onboarding = await run({ workIds: [meta.id] });
    assert.notEqual((await onboarding.json()).error?.code, 'PROJECT_UNDERSTANDING_REQUIRED', 'the understanding item itself may run');
  } finally {
    await c.close();
  }
  const broken = await consoleWith(root, { agents: true, agentEnv: { ...tools.env, YALLAFLOW_CODEX_BIN: '', YALLAFLOW_CODEX_ACP: '', PATH: await mkdtemp(path.join(os.tmpdir(), 'yf-empty-path-')) } });
  try {
    const refused = await run({ workIds: [meta.id] }, broken);
    assert.equal(refused.status, 409);
    assert.equal((await refused.json()).error.code, 'AGENT_NOT_READY');
  } finally {
    await broken.close();
  }
});
