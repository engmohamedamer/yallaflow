// PF-0176: the Run Manager's lifecycle with REAL processes on whatever operating system runs this
// file (Linux locally; Linux, macOS and Windows in CI). A trusted service starts a child that
// starts a grandchild; YallaFlow must start it, see it running, find it again from its record
// (a console restart), stop all three, restart it, refuse a port that is taken, and never touch a
// process whose identity no longer matches its record.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { initWorkspace } from '../src/core/workspace.js';
import { restartService, runtimeStatus, startService, stopService } from '../src/runtime/supervisor.js';
import { clearProcessTable } from '../src/runtime/process.js';
import { checkoutFingerprint, runtimeStateBase } from '../src/runtime/state.js';
import { trustAsConsole } from '../test-support/runtime-trust.js';

const SERVICE = `const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const [role, port] = process.argv.slice(2);
fs.appendFileSync(path.join(__dirname, 'pids.txt'), process.pid + '\\n');
if (role === 'leader') {
  spawn(process.execPath, [__filename, 'child'], { stdio: 'ignore' });
  http.createServer((req, res) => res.end('ok')).listen(Number(port), '127.0.0.1');
} else if (role === 'child') {
  spawn(process.execPath, [__filename, 'grandchild'], { stdio: 'ignore' });
}
setInterval(() => {}, 1000);
`;

const freePort = () => new Promise((resolve) => { const server = net.createServer(); server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); }); });
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };
const until = async (check, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await check()) return true; await new Promise((resolve) => setTimeout(resolve, 100)); } return false; };
const pids = async (root) => (await readFile(path.join(root, 'pids.txt'), 'utf8').catch(() => '')).split('\n').map(Number).filter(Boolean);
const killAll = (list) => { for (const pid of list) { try { if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/T', '/F']); else process.kill(pid, 'SIGKILL'); } catch { /* gone */ } } };

async function project(port, extra = []) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yf-runtime-os-'));
  await initWorkspace(root, 'Run OS', 'greenfield', 'adaptive');
  await writeFile(path.join(root, 'service.cjs'), SERVICE);
  const services = [{ id: 'web', name: 'Web', kind: 'process', command: ['node', 'service.cjs', 'leader', String(port)], cwd: '.', ports: [port], ready: { port }, readyTimeoutSeconds: 30, stopTimeoutSeconds: 10 }, ...extra];
  await writeFile(path.join(root, '.yallaflow', 'runtime.yaml'), JSON.stringify({ schemaVersion: 1, services }));
  for (const service of services) await trustAsConsole(root, service.id);
  return root;
}

test(`real processes on ${process.platform}: start, find again, stop the whole tree, restart`, { timeout: 120_000 }, async () => {
  const port = await freePort();
  const root = await project(port);
  let seen = [];
  try {
    const started = await startService(root, 'web');
    assert.equal(started.state, 'running', JSON.stringify(started));
    assert.ok(await until(async () => (await pids(root)).length >= 3), 'leader, child and grandchild are up');
    seen = await pids(root);
    let status = await runtimeStatus(root);
    assert.equal(status.supported, true);
    assert.equal(status.services[0].state, 'running');
    // A console restart: nothing kept in memory, the record on disk is read again.
    clearProcessTable();
    status = await runtimeStatus(root);
    assert.equal(status.services[0].state, 'running', 'found again from its record');
    assert.equal(status.services[0].pid, seen[0]);

    const stopped = await stopService(root, 'web');
    assert.equal(stopped.state, 'stopped', JSON.stringify(stopped));
    assert.deepEqual(stopped.survivors, []);
    if (process.platform === 'win32') assert.equal(stopped.forced, true, 'Windows stops forcefully, and says so');
    assert.ok(await until(() => seen.every((pid) => !alive(pid))), `no process left behind: ${seen.filter(alive).join(', ')}`);
    assert.equal((await runtimeStatus(root)).services[0].state, 'stopped');

    await writeFile(path.join(root, 'pids.txt'), '');
    assert.equal((await startService(root, 'web')).state, 'running');
    const first = (await runtimeStatus(root)).services[0].pid;
    const restarted = await restartService(root, 'web');
    assert.equal(restarted.state, 'running');
    const second = (await runtimeStatus(root)).services[0].pid;
    assert.notEqual(second, first);
    assert.ok(await until(() => !alive(first)), 'the first run ended');
    seen = await pids(root);
    await stopService(root, 'web');
    assert.ok(await until(() => seen.every((pid) => !alive(pid))), `no process left behind after restart: ${seen.filter(alive).join(', ')}`);
  } finally {
    killAll(await pids(root));
  }
});

test(`real processes on ${process.platform}: a record whose identity no longer matches is never signalled; a taken port starts nothing`, { timeout: 120_000 }, async () => {
  const port = await freePort();
  const root = await project(port);
  try {
    assert.equal((await startService(root, 'web')).state, 'running');
    assert.ok(await until(async () => (await pids(root)).length >= 3));
    const leader = (await pids(root))[0];
    // The record now claims another start time: as if the pid had been reused by another program.
    const file = path.join(runtimeStateBase(), await checkoutFingerprint(root), 'runs', 'web.json');
    const record = JSON.parse(await readFile(file, 'utf8'));
    await writeFile(file, JSON.stringify({ ...record, startTime: process.platform === 'win32' ? '2000-01-01T00:00:00.0000000Z' : '1' }));
    clearProcessTable();
    assert.equal((await runtimeStatus(root)).services[0].state, 'unknown');
    await assert.rejects(stopService(root, 'web'), { code: 'RUNTIME_UNMANAGED' });
    assert.ok(alive(leader), 'the process was not touched');
  } finally {
    const list = await pids(root);
    killAll(list);
    await until(() => list.every((pid) => !alive(pid)));
  }
  const busy = net.createServer();
  await new Promise((resolve) => busy.listen(port, '127.0.0.1', resolve));
  try {
    await writeFile(path.join(root, 'pids.txt'), '');
    await assert.rejects(startService(root, 'web'), { code: 'PORT_IN_USE' });
    assert.deepEqual(await pids(root), [], 'nothing started');
  } finally {
    busy.close();
  }
});

test('Windows: a Docker Compose service is refused before anything runs; other services stay usable', { skip: process.platform !== 'win32' ? 'Windows only' : false, timeout: 60_000 }, async () => {
  const port = await freePort();
  const root = await project(port);
  await writeFile(path.join(root, 'docker-compose.yml'), 'services:\n  db:\n    image: postgres:16\n');
  const profile = JSON.parse(await readFile(path.join(root, '.yallaflow', 'runtime.yaml'), 'utf8'));
  profile.services.push({ id: 'db', name: 'DB', kind: 'docker-compose', command: ['docker', 'compose', 'up'], cwd: '.' });
  await writeFile(path.join(root, '.yallaflow', 'runtime.yaml'), JSON.stringify(profile));
  await assert.rejects(startService(root, 'db'), { code: 'RUNTIME_COMPOSE_WINDOWS' });
  await assert.rejects(stopService(root, 'db'), { code: 'RUNTIME_COMPOSE_WINDOWS' });
  const status = await runtimeStatus(root);
  assert.equal(status.services.find((entry) => entry.id === 'db').unsupported, 'compose-windows');
  assert.equal(status.capabilities.compose, false);
});
