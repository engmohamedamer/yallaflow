// 1.4.0 Development Runtime Manager (PF-0047): profiles, trust, supervisor, console routes.
// Real child processes (node fixtures on free loopback ports); nothing leaves 127.0.0.1.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { initWorkspace } from '../src/core/workspace.js';
import { startConsoleServer } from '../src/console/server.js';
import { processStartTime } from '../src/runtime/process.js';
import { checkoutFingerprint, runtimeStateBase } from '../src/runtime/state.js';
import { link } from 'node:fs/promises';
import { loadSchema, validate } from '../test-support/schema.js';
import { consoleTrustSync } from '../test-support/runtime-trust.js';

const RUNTIME = loadSchema('runtime-1.schema.json');

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const SUPPORTED = process.platform === 'linux' || process.platform === 'darwin';
const GH_TOKEN = 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function run(root, args, env = {}) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, ...env } });
}
function runAsync(root, args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd: root, env: { ...process.env, ...env } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}
const json = (result) => JSON.parse(result.stdout.trim().split('\n').at(-1));

function freePort() {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); });
  });
}

const SERVER = `const http = require('http');
console.log('booting token=${GH_TOKEN} SECRET_TOKEN=' + (process.env.SECRET_TOKEN ?? 'absent') + ' NAMED=' + (process.env.NAMED ?? 'absent'));
process.on('SIGTERM', () => { console.log('graceful stop'); process.exit(0); });
http.createServer((q, r) => r.end('ok')).listen(Number(process.argv[2]), '127.0.0.1', () => console.log('listening'));
`;

async function project() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yf-runtime-'));
  await initWorkspace(root, 'Svc', 'greenfield', 'adaptive');
  await mkdir(path.join(root, 'web'));
  await writeFile(path.join(root, 'web', 'server.js'), SERVER);
  return root;
}

async function webService(root, extra = []) {
  const port = await freePort();
  const added = run(root, ['runtime', 'add', 'web', '--name', 'Web', '--cwd', 'web', '--port', String(port), '--ready-port', String(port), '--env', 'NAMED', ...extra, '--', process.execPath, 'server.js', String(port)]);
  assert.equal(added.status, 0, added.stderr);
  return port;
}

// Trust the way the console does: confirmed and bound to the reviewed definition.
function trust(root, id) {
  const hash = service(root, id).definitionHash;
  const result = consoleTrustSync(root, id, hash);
  assert.equal(result.status, 0, result.stderr);
  return result;
}
const status = (root) => { const doc = json(run(root, ['runtime', 'status', '--json'])); assert.deepEqual(validate(RUNTIME, doc), []); return doc; };
const service = (root, id = 'web') => status(root).services.find((entry) => entry.id === id);
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

test('profiles: argv only, repository-relative cwd, names not values; secrets and unknown fields refused without echo', { skip: !SUPPORTED }, async () => {
  const root = await project();
  const refuse = (args, pattern) => {
    const result = run(root, ['runtime', 'add', ...args]);
    assert.equal(result.status, 1, `${args.join(' ')} should be refused`);
    assert.match(result.stderr, pattern);
    return result;
  };
  refuse(['bad', '--cwd', '../outside', '--', 'node', 'x.js'], /repository-relative path without "\.\."/);
  refuse(['bad', '--cwd', '/etc', '--', 'node', 'x.js'], /repository-relative/);
  refuse(['Bad_Id', '--', 'node'], /id must match/);
  refuse(['bad', '--port', '70000', '--', 'node'], /ports\[0\] must be an integer from 1 to 65535/);
  refuse(['bad', '--env', 'DB_PASSWORD=hunter2', '--', 'node'], /variable names/);
  const secret = refuse(['bad', '--', 'node', 'x.js', `--token=${GH_TOKEN}`], /looks like it contains a secret value/);
  assert.equal(secret.stderr.includes(GH_TOKEN), false, 'the secret is never echoed');
  await writeFile(path.join(root, '.yallaflow', 'runtime.yaml'), JSON.stringify({ schemaVersion: 1, services: [{ id: 'x', name: 'x', kind: 'process', command: ['node'], cwd: '.', shell: true }] }));
  assert.match(run(root, ['runtime', 'status']).stdout, /unknown or non-overridable field\(s\): shell/);
  assert.match(run(root, ['doctor']).stdout, /FAIL runtime profile: .*shell/);
});

test('trust: required before start, personal, and renewed after any material change (shared or override)', { skip: !SUPPORTED }, async () => {
  const root = await project();
  const port = await webService(root);
  const refused = run(root, ['runtime', 'start', 'web', '--json']);
  assert.equal(refused.status, 1);
  assert.equal(json(refused).error.code, 'RUNTIME_UNTRUSTED');
  assert.deepEqual(json(refused).error.review.env, ['NAMED'], 'the refusal shows what to review');
  trust(root, 'web');
  assert.equal(service(root).trust.trusted, true);
  const trustFile = path.join(runtimeStateBase(), await checkoutFingerprint(root), 'trust.json');
  assert.ok((await readFile(trustFile, 'utf8')).includes('sha256:'), 'trust lives in the user config folder, outside the repository');
  assert.equal(await readFile(path.join(root, '.yallaflow', 'local', 'runtime-trust.yaml'), 'utf8').catch(() => null), null);

  // A personal override of the port is a material change.
  assert.equal(run(root, ['runtime', 'add', 'web', '--local', '--port', String(port + 1), '--', process.execPath, 'server.js', String(port + 1)]).status, 0);
  const overridden = service(root);
  assert.deepEqual([overridden.trust.trusted, overridden.trust.reason], [false, 'changed']);
  assert.deepEqual(overridden.overridden.sort(), ['command', 'ports']);
  assert.equal(run(root, ['runtime', 'remove', 'web', '--local']).status, 0);
  assert.equal(service(root).trust.trusted, true, 'back to the trusted definition');
  // Editing the shared profile (as a pulled change would) also ends trust.
  const file = path.join(root, '.yallaflow', 'runtime.yaml');
  const doc = JSON.parse(await readFile(file, 'utf8'));
  doc.services[0].env = ['NAMED', 'OTHER'];
  await writeFile(file, JSON.stringify(doc));
  assert.equal(service(root).trust.reason, 'changed');
});

test('start/stop/logs: readiness, minimal environment, redacted logs, graceful stop; nothing auto-starts', { skip: !SUPPORTED }, async () => {
  const root = await project();
  const port = await webService(root);
  trust(root, 'web');
  assert.equal(service(root).state, 'stopped', 'reading status never starts anything');
  const started = run(root, ['runtime', 'start', 'web', '--json'], { SECRET_TOKEN: 'from-parent-env', NAMED: 'visible' });
  assert.equal(started.status, 0, started.stdout + started.stderr);
  const { pid } = json(started);
  try {
    const now = service(root);
    assert.deepEqual([now.state, now.pid, now.ports[0].listening], ['running', pid, true]);
    const raw = await readFile(path.join(root, '.yallaflow', 'local', 'runtime', 'logs', 'web.log'), 'utf8');
    assert.match(raw, /SECRET_TOKEN=absent NAMED=visible/, 'only the base environment plus named variables reach the service');
    const logs = json(run(root, ['runtime', 'logs', 'web', '--json']));
    assert.equal(logs.lines.join('\n').includes(GH_TOKEN), false, 'logs are redacted on read');
    assert.ok(logs.lines.some((line) => line.includes('listening')));
    const again = json(run(root, ['runtime', 'start', 'web', '--json']));
    assert.deepEqual([again.already, again.pid], [true, pid], 'a second start is a no-op');
  } finally {
    const stopped = run(root, ['runtime', 'stop', 'web', '--json']);
    assert.equal(stopped.status, 0, stopped.stdout);
    assert.equal(json(stopped).forced, false, 'SIGTERM was enough');
  }
  assert.equal(alive(pid), false);
  assert.equal(service(root).state, 'stopped');
  assert.match((await readFile(path.join(root, '.yallaflow', 'local', 'runtime', 'logs', 'web.log'), 'utf8')), /graceful stop/);
  assert.equal(service(root).ports[0].listening, false);
  void port;
});

test('a port held by someone else refuses start and that process is never touched', { skip: !SUPPORTED }, async () => {
  const root = await project();
  const port = await webService(root);
  trust(root, 'web');
  const foreign = spawn(process.execPath, ['-e', `require('http').createServer((q,r)=>r.end('x')).listen(${port}, '127.0.0.1', () => console.log('up'))`]);
  await new Promise((resolve) => foreign.stdout.once('data', resolve));
  try {
    const refused = run(root, ['runtime', 'start', 'web', '--json']);
    assert.equal(json(refused).error.code, 'PORT_IN_USE');
    assert.deepEqual(service(root).unmanagedPorts, [port]);
    const stop = run(root, ['runtime', 'stop', 'web', '--json']);
    assert.equal(json(stop).already, true, 'stop of a service YallaFlow never started does nothing');
    assert.equal(alive(foreign.pid), true, 'the foreign process is untouched');
  } finally {
    foreign.kill('SIGKILL');
  }
});

test('crash recovery: a service killed outside YallaFlow reads failed; a reused PID is unmanaged and never signalled', { skip: !SUPPORTED }, async () => {
  const root = await project();
  await webService(root);
  trust(root, 'web');
  const { pid } = json(run(root, ['runtime', 'start', 'web', '--json']));
  process.kill(-pid, 'SIGKILL'); // killed by someone else
  await new Promise((resolve) => setTimeout(resolve, 300));
  const failed = service(root);
  assert.equal(failed.state, 'failed');
  assert.match(failed.reason, /ended without a stop/);
  assert.equal(json(run(root, ['runtime', 'stop', 'web', '--json'])).acknowledged, true);
  assert.equal(service(root).state, 'stopped');

  // PID reuse: the record names a live process whose start time differs.
  const stranger = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
  try {
    const runFile = path.join(runtimeStateBase(), await checkoutFingerprint(root), 'runs', 'web.json');
    const record = JSON.parse(await readFile(runFile, 'utf8'));
    Object.assign(record, { pid: stranger.pid, pgid: stranger.pid, startTime: 'not-its-start-time' });
    delete record.stoppedAt;
    await writeFile(runFile, JSON.stringify(record));
    const unknown = service(root);
    assert.equal(unknown.state, 'unknown');
    assert.match(unknown.reason, /unmanaged/);
    const stop = run(root, ['runtime', 'stop', 'web', '--json']);
    assert.equal(json(stop).error.code, 'RUNTIME_UNMANAGED');
    assert.equal(alive(stranger.pid), true, 'a process YallaFlow cannot positively identify is never signalled');
    assert.notEqual(processStartTime(stranger.pid), null);
    assert.equal(service(root).state, 'stopped', 'only the record was cleared');
  } finally {
    stranger.kill('SIGKILL');
  }
});

test('concurrency: five simultaneous starts start one process; restart replaces it; stop --all stops owned services only', { skip: !SUPPORTED }, async () => {
  const root = await project();
  await webService(root);
  trust(root, 'web');
  const results = await Promise.all([1, 2, 3, 4, 5].map(() => runAsync(root, ['runtime', 'start', 'web', '--json'])));
  for (const result of results) assert.equal(result.status, 0, result.stdout + result.stderr);
  const pids = new Set(results.map((result) => json(result).pid));
  assert.equal(pids.size, 1, 'one process for five requests');
  assert.equal(results.filter((result) => !json(result).already).length, 1);
  const [first] = pids;
  const restarted = json(run(root, ['runtime', 'restart', 'web', '--json']));
  assert.notEqual(restarted.pid, first);
  assert.equal(alive(first), false);
  const all = json(run(root, ['runtime', 'stop', '--all', '--json']));
  assert.equal(all.ok, true);
  assert.deepEqual(all.results.map((entry) => entry.id), ['web']);
  assert.equal(alive(restarted.pid), false);
});

test('start failures are reported with the log tail; a cwd escaping through a symlink is refused', { skip: !SUPPORTED }, async () => {
  const root = await project();
  assert.equal(run(root, ['runtime', 'add', 'boom', '--cwd', 'web', '--', process.execPath, '-e', 'console.error("config missing"); process.exit(3)']).status, 0);
  trust(root, 'boom');
  const boom = run(root, ['runtime', 'start', 'boom', '--json']);
  assert.equal(json(boom).error.code, 'RUNTIME_START_FAILED');
  assert.match(json(boom).error.message, /code 3[\s\S]*config missing/);
  assert.equal(service(root, 'boom').state, 'failed');

  const outside = await mkdtemp(path.join(os.tmpdir(), 'yf-outside-'));
  await symlink(outside, path.join(root, 'escape'));
  assert.equal(run(root, ['runtime', 'add', 'esc', '--cwd', 'escape', '--', process.execPath, '-e', '1']).status, 0);
  assert.equal(service(root, 'esc').trust.trusted, false);
  const unsafeTrust = consoleTrustSync(root, 'esc', 'unsafe');
  assert.equal(json(unsafeTrust).error.code, 'RUNTIME_TRUST_INPUT');
  const escaped = run(root, ['runtime', 'start', 'esc', '--json']);
  assert.equal(json(escaped).error.code, 'RUNTIME_TRUST_INPUT');

  assert.equal(run(root, ['runtime', 'add', 'ghost', '--', 'definitely-not-a-real-executable-yf']).status, 0);
  trust(root, 'ghost');
  assert.match(json(run(root, ['runtime', 'start', 'ghost', '--json'])).error.message, /was not found on PATH/);
});

test('suggestions come from repository evidence and never run', { skip: !SUPPORTED }, async () => {
  const root = await project();
  await writeFile(path.join(root, 'composer.json'), JSON.stringify({ require: { 'laravel/framework': '^11.0' } }));
  await writeFile(path.join(root, 'artisan'), '#!/usr/bin/env php\n');
  await mkdir(path.join(root, 'app'));
  await writeFile(path.join(root, 'app', 'User.php'), '<?php\n');
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ scripts: { dev: 'vite' } }));
  await writeFile(path.join(root, 'pnpm-lock.yaml'), '');
  await writeFile(path.join(root, 'docker-compose.yml'), 'services:\n  db:\n    image: mysql:8\n');
  const { suggestions } = json(run(root, ['runtime', 'suggest', '--json']));
  const byId = Object.fromEntries(suggestions.map((entry) => [entry.id, entry]));
  assert.deepEqual(byId.laravel.command, ['php', 'artisan', 'serve', '--host=127.0.0.1', '--port=8000']);
  assert.deepEqual(byId['node-dev'].command, ['pnpm', 'run', 'dev']);
  assert.deepEqual([byId.compose.kind, byId.compose.stopSignal], ['docker-compose', 'SIGINT']);
  assert.equal(service(root, 'laravel'), undefined, 'a suggestion is not a service until added');
  assert.equal(run(root, ['runtime', 'add', '--from-suggestion', 'laravel']).status, 0);
  const added = service(root, 'laravel');
  assert.deepEqual([added.state, added.trust.trusted], ['stopped', false], 'added, not trusted, not started');
});

test('console: runtime routes are token/Origin/JSON guarded, trust needs the typed id, read-only refuses', { skip: !SUPPORTED }, async () => {
  const root = await project();
  await webService(root);
  const server = await startConsoleServer({ roots: [root], port: 0 });
  const origin = server.url.replace(/\/$/, '');
  const headers = { Authorization: `Bearer ${server.token}`, Origin: origin, 'Content-Type': 'application/json' };
  try {
    const pid = (await (await fetch(`${server.url}api/projects`, { headers })).json()).projects[0].id;
    const post = (action, body, extra = {}) => fetch(`${server.url}api/p/${pid}/runtime/web/${action}`, { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify(body) });
    assert.equal((await fetch(`${server.url}api/p/${pid}/runtime`)).status, 401);
    const listed = await (await fetch(`${server.url}api/p/${pid}/runtime`, { headers })).json();
    assert.equal(listed.schema, 'yallaflow.runtime/1');
    assert.equal(listed.services[0].state, 'stopped');
    assert.equal((await fetch(`${server.url}api/p/${pid}/runtime/web/start`, { method: 'POST', headers: { Authorization: headers.Authorization, 'Content-Type': 'application/json' }, body: '{}' })).status, 403, 'Origin required');
    assert.equal((await post('start', {}, { 'Content-Type': 'text/plain' })).status, 415);
    assert.equal((await post('start', { command: ['rm', '-rf', '/'] })).status, 400, 'no command can be sent');
    assert.equal((await post('launch', {})).status, 405, 'unknown actions match no route');
    const untrusted = await post('start', {});
    assert.equal(untrusted.status, 422);
    assert.equal((await untrusted.json()).error.code, 'RUNTIME_UNTRUSTED');
    const hash = listed.services[0].definitionHash;
    assert.equal((await post('trust', { confirm: 'wrong', definitionHash: hash })).status, 400);
    assert.equal((await post('trust', { confirm: 'web' })).status, 400, 'the reviewed definition must be named');
    const stale = await post('trust', { confirm: 'web', definitionHash: `sha256:${'0'.repeat(64)}` });
    assert.equal(stale.status, 422);
    assert.equal((await stale.json()).error.code, 'RUNTIME_TRUST_STALE', 'a definition other than the one reviewed is never trusted');
    assert.equal((await post('trust', { confirm: 'web', definitionHash: hash })).status, 200);
    const started = await post('start', {});
    assert.equal(started.status, 200);
    const startedBody = await started.json();
    assert.equal(startedBody.state, 'running');
    const record = JSON.parse(await readFile(path.join(runtimeStateBase(), await checkoutFingerprint(root), 'runs', 'web.json'), 'utf8'));
    assert.equal(record.startedBy, 'console');
    const logs = await (await fetch(`${server.url}api/p/${pid}/runtime/web/logs?lines=5`, { headers })).json();
    assert.ok(logs.lines.length <= 5);
    assert.equal((await post('stop', {})).status, 200);
    assert.equal(alive(startedBody.pid), false);
  } finally {
    run(root, ['runtime', 'stop', '--all']);
    await server.close();
  }
  const ro = await startConsoleServer({ roots: [root], port: 0, readOnly: true });
  try {
    const pid = (await (await fetch(`${ro.url}api/projects`, { headers: { Authorization: `Bearer ${ro.token}` } })).json()).projects[0].id;
    const refused = await fetch(`${ro.url}api/p/${pid}/runtime/web/start`, { method: 'POST', headers: { Authorization: `Bearer ${ro.token}`, Origin: ro.url.replace(/\/$/, ''), 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(refused.status, 405);
  } finally {
    await ro.close();
  }
});

// ---------------------------------------------------------------- security review (PF-0047)
test('review: trust and run records planted inside the repository are ignored; trust needs the reviewed definition', { skip: !SUPPORTED }, async () => {
  const root = await project();
  await webService(root);
  const victim = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true });
  try {
    const local = path.join(root, '.yallaflow', 'local', 'runtime', 'runs');
    await mkdir(local, { recursive: true });
    await writeFile(path.join(root, '.yallaflow', 'local', 'runtime-trust.yaml'), JSON.stringify({ schemaVersion: 1, services: { web: { hash: service(root).definitionHash, trustedAt: 'x' } } }));
    await writeFile(path.join(local, 'web.json'), JSON.stringify({ id: 'web', pid: victim.pid, pgid: victim.pid, startTime: processStartTime(victim.pid) }));
    assert.equal(service(root).trust.trusted, false, 'a trust file in the checkout is not trust');
    assert.equal(service(root).state, 'stopped', 'a run record in the checkout is not a run');
    assert.equal(json(run(root, ['runtime', 'stop', 'web', '--json'])).already, true);
    assert.equal(alive(victim.pid), true, 'the planted process was never signalled');
    const wrong = consoleTrustSync(root, 'web', `sha256:${'1'.repeat(64)}`);
    assert.equal(json(wrong).error.code, 'RUNTIME_TRUST_STALE');
    assert.equal(service(root).trust.trusted, false);
  } finally {
    victim.kill('SIGKILL');
  }
});

test('review: a run record whose process no longer leads its own group is unmanaged and never signalled', { skip: process.platform !== 'linux' }, async () => {
  const root = await project();
  await webService(root);
  trust(root, 'web');
  const decoy = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true });
  const victim = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true });
  try {
    // Even a record in the user state folder: pgid ≠ pid, or pid not leading its group.
    const file = path.join(runtimeStateBase(), await checkoutFingerprint(root), 'runs', 'web.json');
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify({ id: 'web', pid: decoy.pid, pgid: victim.pid, startTime: processStartTime(decoy.pid), definitionHash: service(root).definitionHash }));
    assert.equal(service(root).state, 'unknown');
    assert.equal(json(run(root, ['runtime', 'stop', 'web', '--json'])).error.code, 'RUNTIME_UNMANAGED');
    assert.equal(alive(victim.pid), true);
    assert.equal(alive(decoy.pid), true);
  } finally {
    decoy.kill('SIGKILL');
    victim.kill('SIGKILL');
  }
});

test('review: log symlinks and hard links are refused; reading logs never writes, truncates or rotates', { skip: !SUPPORTED }, async () => {
  const root = await project();
  await webService(root);
  trust(root, 'web');
  const outside = await mkdtemp(path.join(os.tmpdir(), 'yf-victim-'));
  const victimFile = path.join(outside, 'victimrc');
  await writeFile(victimFile, 'original\n');
  const logs = path.join(root, '.yallaflow', 'local', 'runtime', 'logs');
  await mkdir(logs, { recursive: true });

  // Symlinked .log.1 next to an oversized log: viewing logs must not rotate into it.
  await writeFile(path.join(logs, 'web.log'), `echo PWNED\n${'x'.repeat(6 * 1024 * 1024)}\n`);
  await symlink(victimFile, path.join(logs, 'web.log.1'));
  json(run(root, ['runtime', 'logs', 'web', '--lines', '1', '--json']));
  assert.equal(await readFile(victimFile, 'utf8'), 'original\n', 'logs view wrote nothing');
  assert.ok((await readFile(path.join(logs, 'web.log'), 'utf8')).length > 5 * 1024 * 1024, 'logs view did not truncate');

  // Symlinked log: start refuses it and the target is untouched.
  await rm(path.join(logs, 'web.log'));
  await rm(path.join(logs, 'web.log.1'));
  await symlink(victimFile, path.join(logs, 'web.log'));
  assert.notEqual(run(root, ['runtime', 'start', 'web', '--json']).status, 0);
  assert.equal(await readFile(victimFile, 'utf8'), 'original\n');

  // Hard-linked log: refused, nothing appended.
  await rm(path.join(logs, 'web.log'));
  await link(victimFile, path.join(logs, 'web.log'));
  const hard = json(run(root, ['runtime', 'start', 'web', '--json']));
  assert.equal(hard.error.code, 'RUNTIME_LOG_UNSAFE');
  assert.equal(await readFile(victimFile, 'utf8'), 'original\n');
  assert.equal(service(root).state, 'stopped');
});

test('review: an untrusted dependency starts nothing; control and bidi characters are refused', { skip: !SUPPORTED }, async () => {
  const root = await project();
  const port = await webService(root);
  assert.equal(run(root, ['runtime', 'add', 'api', '--cwd', 'web', '--depends-on', 'web', '--', process.execPath, '-e', 'setInterval(() => {}, 1000)']).status, 0);
  trust(root, 'api'); // the dependency "web" is not trusted
  const refused = json(run(root, ['runtime', 'start', 'api', '--json']));
  assert.equal(refused.error.code, 'RUNTIME_UNTRUSTED');
  assert.match(refused.error.message, /web \(a dependency of api\)[\s\S]*Nothing was started/);
  assert.equal(service(root, 'web').state, 'stopped');
  assert.equal(service(root, 'api').state, 'stopped');
  const bidi = run(root, ['runtime', 'add', 'spoof', '--', 'node', 'safe.js‮']);
  assert.equal(bidi.status, 1);
  assert.match(bidi.stderr, /control or bidirectional-override characters/);
  void port;
});

test('review: CLI trust is a human decision — refused when not interactive', { skip: !SUPPORTED }, async () => {
  const root = await project();
  await webService(root);
  const scripted = run(root, ['runtime', 'trust', 'web', '--json']);
  assert.equal(json(scripted).error.code, 'RUNTIME_TRUST_INTERACTIVE');
  // PF-0072 review finding 2: no environment flag stands in for a person.
  const flagged = run(root, ['runtime', 'trust', 'web', '--expect', service(root).definitionHash, '--json'], { YALLAFLOW_RUNTIME_VIA: 'console' });
  assert.equal(json(flagged).error.code, 'RUNTIME_TRUST_INTERACTIVE', 'YALLAFLOW_RUNTIME_VIA=console is not a person');
  assert.equal(service(root).trust.trusted, false);
});

test('review: a FIFO planted as the log never hangs reads', { skip: !SUPPORTED }, async () => {
  const root = await project();
  await webService(root);
  const logs = path.join(root, '.yallaflow', 'local', 'runtime', 'logs');
  await mkdir(logs, { recursive: true });
  assert.equal(spawnSync('mkfifo', [path.join(logs, 'web.log')]).status, 0);
  const result = spawnSync(process.execPath, [cli, 'runtime', 'logs', 'web', '--json'], { cwd: root, encoding: 'utf8', timeout: 10_000 });
  assert.equal(result.signal, null, 'did not hang');
  assert.deepEqual(json(result).lines, []);
  assert.equal(service(root).state, 'stopped');
});


test('trust: script edits reject stale confirmation and start, while application edits retain trust', { skip: !SUPPORTED }, async () => {
  const root = await project();
  await writeFile(path.join(root, 'web/package.json'), '{"scripts":{"dev":"node server.js"}}');
  assert.equal(run(root, ['runtime', 'add', 'web', '--cwd', 'web', '--', 'npm', 'run', 'dev']).status, 0);
  trust(root, 'web');
  const reviewedHash = service(root).definitionHash;
  await writeFile(path.join(root, 'web/server.js'), '// application changed');
  assert.equal(service(root).trust.trusted, true);
  await writeFile(path.join(root, 'web/package.json'), '{"scripts":{"dev":"node changed.js"}}');
  assert.equal(service(root).trust.trusted, false);
  const stale = consoleTrustSync(root, 'web', reviewedHash);
  assert.equal(json(stale).error.code, 'RUNTIME_TRUST_STALE');
  assert.equal(json(run(root, ['runtime', 'start', 'web', '--json'])).error.code, 'RUNTIME_UNTRUSTED');
  trust(root, 'web');
  assert.equal(service(root).trust.trusted, true);
});


test('trust: a service changing its inputs during startup is stopped (only its own process) and the start fails (PF-0072 D2/R6)', { skip: !SUPPORTED }, async () => {
  const root = await project();
  await writeFile(path.join(root, 'web/package.json'), '{"scripts":{"dev":"node server.js"}}');
  await writeFile(path.join(root, 'web/server.js'), "require('fs').writeFileSync('package.json','{\"scripts\":{\"dev\":\"changed\"}}');setInterval(()=>{},1000);");
  assert.equal(run(root, ['runtime', 'add', 'web', '--cwd', 'web', '--', process.execPath, 'server.js']).status, 0);
  trust(root, 'web');
  // An unrelated process (not started by YallaFlow) must survive the rollback.
  const bystander = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore', detached: true });
  bystander.unref();
  try {
    const started = run(root, ['runtime', 'start', 'web', '--json']);
    assert.notEqual(started.status, 0);
    assert.equal(json(started).error.code, 'RUNTIME_CHANGED_DURING_START');
    assert.match(json(started).error.message, /process YallaFlow had just started was stopped; nothing else was touched/);
    const current = service(root);
    assert.equal(current.state, 'stopped');
    assert.equal(current.pid, null);
    assert.equal(current.trust.trusted, false);
    assert.equal(alive(bystander.pid), true, 'a process YallaFlow did not start is never terminated');
  } finally { try { process.kill(bystander.pid, 'SIGKILL'); } catch { /* gone */ } }
});
