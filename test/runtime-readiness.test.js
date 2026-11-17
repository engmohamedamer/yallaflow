// PF-0166 (owner review 2026-11-17): the dependency check has three states and is never an
// unconditional blocker. READY starts; NEEDS_SETUP shows the fix and can be tried anyway
// (that skips this one check, nothing else); UNKNOWN is said and never blocks. Custom setups,
// monorepos and unknown environments are covered. Port changes: no partial or uncertain
// rewrite, dependents reported, shared definitions kept, a local change can be undone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, symlink } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { checkPrerequisites } from '../src/runtime/prerequisites.js';
import { planPortChange, PortChangeError } from '../src/runtime/ports.js';
import { addService, loadRuntimeProfiles, resetLocalOverride, updateService } from '../src/runtime/profile.js';
import { runtimeStatus, startService, stopService } from '../src/runtime/supervisor.js';
import { SUPPORTED } from '../src/runtime/process.js';
import { initWorkspace } from '../src/core/workspace.js';
import { runRuntimeAction, resetRuntimeOverride } from '../src/console/runtime.js';
import { trustAsConsole } from '../test-support/runtime-trust.js';

process.env.XDG_CONFIG_HOME = await mkdtemp(path.join(os.tmpdir(), 'yf-ready-cfg-'));
const tmp = (prefix = 'yf-ready-') => mkdtemp(path.join(os.tmpdir(), prefix));
const json = (file, value) => writeFile(file, JSON.stringify(value));
const svc = (over = {}) => ({ id: 'web', name: 'Web', kind: 'process', command: ['npm', 'run', 'dev'], cwd: '.', env: [], ports: [4200], ready: { port: 4200 }, links: [], dependsOn: [], ...over });
const ANGULAR = { scripts: { dev: 'ng serve', start: 'ng serve' }, devDependencies: { '@angular/cli': '^19.0.0' } };
async function tree(files) {
  const root = await tmp();
  for (const [name, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    if (content !== null) await writeFile(path.join(root, name), typeof content === 'string' ? content : JSON.stringify(content));
  }
  return root;
}
const state = async (root, service, cwd = root) => checkPrerequisites(service, { cwd, top: root });
async function freePort() { return new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); }); }

test('three states: READY, NEEDS_SETUP with its fix, UNKNOWN with its reason', async () => {
  const ready = await tree({ 'package.json': ANGULAR, 'package-lock.json': '{}', 'node_modules/.bin/ng': '' });
  assert.deepEqual(await state(ready, svc()), { state: 'READY', ok: true, problems: [] });
  const missing = await tree({ 'package.json': ANGULAR, 'package-lock.json': '{}' });
  const needs = await state(missing, svc());
  assert.deepEqual([needs.state, needs.ok, needs.problems[0].code, needs.problems[0].fix.display], ['NEEDS_SETUP', false, 'DEPENDENCIES_MISSING', 'npm ci --include=dev']);
  const noTool = await tree({ 'package.json': ANGULAR, 'node_modules/.keep': '' });
  assert.deepEqual([(await state(noTool, svc())).state, (await state(noTool, svc())).problems[0].code], ['NEEDS_SETUP', 'LOCAL_TOOL_MISSING']);
  assert.equal((await state(await tree({ 'package.json': { scripts: { dev: 'node s.js' } } }), svc())).state, 'READY', 'nothing declared: nothing is missing');
});

test('unknown environments are UNKNOWN, never blocked: other commands, Compose, missing or outside folders, no package.json', async () => {
  const root = await tree({ 'package.json': ANGULAR });
  const reason = async (service, cwd) => { const r = await state(root, service, cwd); assert.equal(r.ok, true, JSON.stringify(service.command)); assert.equal(r.state, 'UNKNOWN'); return r.reason; };
  assert.equal(await reason(svc({ command: ['php', 'artisan', 'serve'] })), 'unsupported-command');
  assert.equal(await reason(svc({ command: ['./start.sh'] })), 'unsupported-command');
  assert.equal(await reason(svc({ command: ['make', 'dev'] })), 'unsupported-command');
  assert.equal(await reason(svc({ kind: 'docker-compose', command: ['docker', 'compose', 'up'] })), 'not-checked');
  assert.equal(await reason(svc({ command: ['npm', '--prefix', 'nowhere', 'run', 'dev'] })), 'folder-missing');
  assert.equal(await reason(svc({ command: ['npm', '--prefix', '..', 'run', 'dev'] })), 'outside-project');
  const bare = await tree({ 'README.md': 'no package here' });
  assert.equal((await state(bare, svc())).reason, 'no-package-json');
  const broken = await tree({ 'package.json': '{ not json' });
  assert.equal((await state(broken, svc())).reason, 'no-package-json', 'an unreadable package.json is not a verdict');
});

test('custom setups are not called missing: Yarn Plug\'n\'Play and a service that sets NODE_PATH', async () => {
  const pnp = await tree({ 'package.json': ANGULAR, 'yarn.lock': '', '.pnp.cjs': '' });
  assert.deepEqual([(await state(pnp, svc({ command: ['yarn', 'dev'] }))).state, (await state(pnp, svc({ command: ['yarn', 'dev'] }))).reason], ['UNKNOWN', 'yarn-pnp']);
  const custom = await tree({ 'package.json': ANGULAR, 'package-lock.json': '{}' });
  const r = await state(custom, svc({ env: ['NODE_PATH'] }));
  assert.deepEqual([r.state, r.ok, r.reason], ['UNKNOWN', true, 'custom-module-path']);
});

test('monorepos: a hoisted install counts; a tool in a sibling package does not; a nested package is checked in its own folder', async () => {
  const hoisted = await tree({ 'package.json': { private: true, workspaces: ['apps/*'] }, 'node_modules/.bin/ng': '', 'apps/web/package.json': ANGULAR });
  assert.equal((await state(hoisted, svc({ command: ['npm', '--prefix', 'apps/web', 'run', 'dev'] }))).state, 'READY', 'npm workspaces hoist to the root');
  const pnpm = await tree({ 'pnpm-workspace.yaml': 'packages: [apps/*]', 'pnpm-lock.yaml': '', 'node_modules/.pnpm/.keep': '', 'apps/web/package.json': ANGULAR, 'apps/web/node_modules/.bin/ng': '' });
  assert.equal((await state(pnpm, svc({ command: ['pnpm', '-C', 'apps/web', 'dev'] }))).state, 'READY', 'pnpm links the tool into the package');
  const sibling = await tree({ 'package.json': { private: true }, 'apps/web/package.json': ANGULAR, 'apps/web/node_modules/.keep': '', 'apps/admin/node_modules/.bin/ng': '' });
  const r = await state(sibling, svc({ command: ['npm', '--prefix', 'apps/web', 'run', 'dev'] }));
  assert.deepEqual([r.state, r.problems[0].code, r.problems[0].dir], ['NEEDS_SETUP', 'LOCAL_TOOL_MISSING', path.join('apps', 'web')], 'a sibling\'s tool is not reachable');
  const nested = await tree({ 'package.json': { private: true }, 'pnpm-lock.yaml': '', 'apps/web/package.json': ANGULAR });
  const n = await state(nested, svc({ command: ['pnpm', '--dir', 'apps/web', 'dev'] }));
  assert.equal(n.problems[0].fix.display, `cd ${path.join('apps', 'web')} && pnpm install`, 'the lockfile beside the package decides; none there means a plain install');
  const fromCwd = await tree({ 'package.json': { private: true }, 'apps/web/package.json': ANGULAR, 'apps/web/package-lock.json': '{}' });
  assert.equal((await state(fromCwd, svc(), path.join(fromCwd, 'apps', 'web'))).problems[0].fix.display, `cd ${path.join('apps', 'web')} && npm ci --include=dev`, 'a service whose folder is the package');
});

test('try anyway skips only the dependency check: trust, a dependency\'s own check and the port pre-flight still apply', { skip: !SUPPORTED }, async (t) => {
  const port = await freePort();
  const root = await tree({ 'package.json': { scripts: { start: 'node serve.js' }, dependencies: { leftpad: '1.0.0' } }, 'package-lock.json': '{}', 'serve.js': `require('node:http').createServer((q, s) => s.end('ok')).listen(${port}, '127.0.0.1');` });
  await initWorkspace(root, 'R', 'greenfield', 'adaptive');
  await addService(root, { id: 'web', name: 'Web', kind: 'process', command: ['npm', 'run', 'start'], cwd: '.', ports: [port], ready: { port } });
  await addService(root, { id: 'needs-dep', name: 'NeedsDep', kind: 'process', command: ['npm', 'run', 'start'], cwd: '.', ports: [], dependsOn: ['web'] });
  t.after(async () => { await stopService(root, 'web').catch(() => {}); });

  const status = (await runtimeStatus(root)).services.find((s) => s.id === 'web');
  assert.equal(status.prerequisites.state, 'NEEDS_SETUP');
  // untrusted: try anyway does not get past trust
  await assert.rejects(startService(root, 'web', { skipSetupCheck: true }), { code: 'RUNTIME_UNTRUSTED' });
  await trustAsConsole(root, 'web');
  await trustAsConsole(root, 'needs-dep');
  await assert.rejects(startService(root, 'web'), (error) => error.code === 'RUNTIME_PREREQUISITES' && error.state === 'NEEDS_SETUP' && /--skip-setup-check/.test(error.message));
  // the skip is for the service named, not for what it depends on
  await assert.rejects(startService(root, 'needs-dep', { skipSetupCheck: true }), (error) => error.code === 'RUNTIME_PREREQUISITES' && /web|this project/.test(error.message));
  // the port pre-flight still runs: a taken port is refused, and its holder is not stopped
  const holder = net.createServer().listen(port, '127.0.0.1');
  await new Promise((resolve) => holder.once('listening', resolve));
  await assert.rejects(startService(root, 'web', { skipSetupCheck: true }), { code: 'PORT_IN_USE' });
  assert.equal(holder.listening, true, 'the process holding the port was not touched');
  await new Promise((resolve) => holder.close(resolve));
  // and then it starts (its script needs no installed package)
  const started = await startService(root, 'web', { skipSetupCheck: true });
  assert.deepEqual([started.state, started.setupCheckSkipped], ['running', ['DEPENDENCIES_MISSING']]);
  const logs = await readFile(path.join(root, '.yallaflow', 'local', 'runtime', 'logs', 'web.log'), 'utf8');
  assert.match(logs, /dependency check skipped at the developer's request \(DEPENDENCIES_MISSING\)/);
});

test('UNKNOWN never blocks a start, and a path outside the repository is refused whatever the setup check', { skip: !SUPPORTED }, async (t) => {
  const port = await freePort();
  const root = await tree({ 'package.json': { scripts: { start: 'node serve.js' }, dependencies: { leftpad: '1.0.0' } }, 'serve.js': `require('node:http').createServer((q, s) => s.end('ok')).listen(${port}, '127.0.0.1');` });
  await initWorkspace(root, 'R', 'greenfield', 'adaptive');
  await addService(root, { id: 'custom', name: 'Custom', kind: 'process', command: ['npm', 'run', 'start'], cwd: '.', env: ['NODE_PATH'], ports: [port], ready: { port } });
  await trustAsConsole(root, 'custom');
  t.after(async () => { await stopService(root, 'custom').catch(() => {}); });
  assert.equal((await runtimeStatus(root)).services.find((s) => s.id === 'custom').prerequisites.state, 'UNKNOWN');
  assert.equal((await startService(root, 'custom')).state, 'running', 'no skip needed');
  await stopService(root, 'custom');
  // folder protection is not part of the setup check: a linked folder outside is still refused
  const outside = await tmp('yf-ready-outside-');
  await symlink(outside, path.join(root, 'linked'));
  await addService(root, { id: 'escape', name: 'Escape', kind: 'process', command: ['npm', 'run', 'start'], cwd: 'linked', ports: [] }).catch(() => {});
  const listed = (await loadRuntimeProfiles(root)).services.some((s) => s.id === 'escape');
  if (listed) {
    await trustAsConsole(root, 'escape').catch(() => {});
    // refused by the folder or trust protection, never reaching the setup check or a spawn
    await assert.rejects(startService(root, 'escape', { skipSetupCheck: true }), (error) => Boolean(error.code) && !['RUNTIME_PREREQUISITES', 'RUNTIME_START_FAILED'].includes(error.code));
    assert.notEqual((await runtimeStatus(root).catch(() => ({ services: [] }))).services.find((s) => s.id === 'escape')?.state, 'running');
  }
});

test('the console sends try anyway only as an explicit start or restart; anything else is refused', async () => {
  const calls = [];
  const runner = { runAside: async (_root, args) => { calls.push(args); return { stdout: `${JSON.stringify({ ok: true, id: 'web', state: 'running' })}\n`, stderr: '' }; }, write: async (_root, args) => { calls.push(args); return { stdout: `${JSON.stringify({ ok: true, id: 'web', reset: ['command'] })}\n`, stderr: '' }; } };
  const root = await tree({ '.yallaflow/runtime.yaml': JSON.stringify({ schemaVersion: 1, services: [] }) });
  await runRuntimeAction(root, 'web', 'start', { skipSetupCheck: true }, runner);
  await runRuntimeAction(root, 'web', 'restart', { skipSetupCheck: true }, runner);
  await runRuntimeAction(root, 'web', 'start', {}, runner);
  assert.deepEqual(calls.map((args) => args.join(' ')), ['runtime start web --skip-setup-check --json', 'runtime restart web --skip-setup-check --json', 'runtime start web --json']);
  for (const [action, body] of [['start', { skipSetupCheck: 'yes' }], ['start', { skipSetupCheck: false }], ['stop', { skipSetupCheck: true }], ['trust', { skipSetupCheck: true }], ['start', { skipSetupCheck: true, confirmShared: 'web' }], ['start', { skipTrust: true }]]) {
    await assert.rejects(runRuntimeAction(root, 'web', action, body, runner), (error) => error.status === 400, `${action} ${JSON.stringify(body)}`);
  }
  assert.equal(calls.length, 3, 'nothing ran for a refused request');
  for (const body of [{}, { confirm: 'yes' }, { confirm: true, scope: 'shared' }]) await assert.rejects(resetRuntimeOverride(root, 'web', body, runner), { code: 'CONFIRMATION_REQUIRED' });
  await resetRuntimeOverride(root, 'web', { confirm: true }, runner);
  assert.deepEqual(calls.at(-1), ['runtime', 'reset', 'web', '--json']);
});

test('port changes: no partial or uncertain rewrite, and other services that mention the old port are reported, not changed', async () => {
  const root = await tree({ 'package.json': ANGULAR });
  const plan = (service, opts = {}) => planPortChange(service, 4200, 4202, { cwd: root, ...opts });
  await assert.rejects(plan(svc({ command: ['vite', '--port', '4200', '--origin', 'http://localhost:4200'] })), (error) => error instanceof PortChangeError && /more than one place/.test(error.message), 'one mention changed, another left behind');
  for (const command of [['pnpm', 'dev'], ['yarn', 'dev'], ['bun', 'run', 'dev']]) await assert.rejects(plan(svc({ command })), (error) => error instanceof PortChangeError && /passes extra arguments/.test(error.message), command[0]);
  const chained = await tree({ 'package.json': { scripts: { dev: 'ng serve && echo done' }, devDependencies: { '@angular/cli': '1' } } });
  await assert.rejects(planPortChange(svc(), 4200, 4202, { cwd: chained }), /more than one command/);
  const pinned = await tree({ 'package.json': { scripts: { dev: 'ng serve --port 4200' }, devDependencies: { '@angular/cli': '1' } } });
  await assert.rejects(planPortChange(svc(), 4200, 4202, { cwd: pinned }), /already sets its port/);
  const env = await tree({ 'package.json': { scripts: { dev: 'vite --host' }, devDependencies: { vite: '1' } } });
  assert.deepEqual((await planPortChange(svc(), 4200, 4202, { cwd: env })).patch.command, ['npm', 'run', 'dev', '--', '--port', '4202'], 'npm with a known dev server is still changed');
  // dependents and proxy links are reported
  const others = [svc({ id: 'web' }), svc({ id: 'waits', command: ['node', 'w.js'], ports: [5000], ready: { port: 4200 } }), svc({ id: 'proxy', command: ['caddy', 'reverse-proxy', '--to', 'localhost:4200'], ports: [8080], ready: { port: 8080 }, links: [] }), svc({ id: 'admin', command: ['npm', 'run', 'admin'], ports: [4300], ready: { port: 4300 }, links: [{ label: 'App', url: 'http://localhost:4200/admin' }] }), svc({ id: 'api', command: ['node', 'api.js'], ports: [3000], ready: { port: 3000 }, links: [{ label: 'API', url: 'http://localhost:3000/' }] })];
  const done = await planPortChange(svc({ command: ['vite', '--port', '4200'] }), 4200, 4202, { cwd: root, others });
  assert.deepEqual(done.references, [{ id: 'waits', where: ['readiness check'] }, { id: 'proxy', where: ['command'] }, { id: 'admin', where: ['links'] }]);
  assert.deepEqual(others[2].command, ['caddy', 'reverse-proxy', '--to', 'localhost:4200'], 'never changed');
});

test('a local port change keeps the shared file byte for byte and every other field, and can be undone', async () => {
  const root = await tmp();
  await initWorkspace(root, 'R', 'greenfield', 'adaptive');
  await addService(root, { id: 'api', name: 'API', kind: 'process', command: ['node', 'api.js'], cwd: '.', ports: [3000] });
  await addService(root, { id: 'web', name: 'Web', kind: 'process', command: ['vite', '--port', '4200'], cwd: '.', ports: [4200], ready: { port: 4200 }, dependsOn: ['api'], links: [{ label: 'App', url: 'http://localhost:4200/' }] });
  await addService(root, { id: 'mine', name: 'Mine', kind: 'process', command: ['node', 'x.js'], cwd: '.', ports: [] }, { local: true });
  const sharedFile = path.join(root, '.yallaflow', 'runtime.yaml');
  const before = await readFile(sharedFile, 'utf8');
  const web = (await loadRuntimeProfiles(root)).services.find((s) => s.id === 'web');
  const plan = await planPortChange(web, 4200, 4202, { cwd: root });
  await updateService(root, 'web', plan.patch, { local: true });
  assert.equal(await readFile(sharedFile, 'utf8'), before, 'the shared definition is untouched');
  let now = (await loadRuntimeProfiles(root)).services.find((s) => s.id === 'web');
  assert.deepEqual([now.command, now.ports, now.ready, now.dependsOn, now.links[0].url, now.name], [['vite', '--port', '4202'], [4202], { port: 4202 }, ['api'], 'http://localhost:4202/', 'Web']);
  assert.deepEqual(now.overridden.sort(), ['command', 'links', 'ports', 'ready']);
  const undone = await resetLocalOverride(root, 'web');
  assert.deepEqual(undone.reset.sort(), ['command', 'links', 'ports', 'ready']);
  now = (await loadRuntimeProfiles(root)).services.find((s) => s.id === 'web');
  assert.deepEqual([now.command, now.ports, now.overridden], [['vite', '--port', '4200'], [4200], []], 'back to the shared definition');
  assert.equal(await readFile(sharedFile, 'utf8'), before);
  assert.ok((await loadRuntimeProfiles(root)).services.some((s) => s.id === 'mine'), 'another local service is kept');
  await assert.rejects(resetLocalOverride(root, 'web'), { code: 'RUNTIME_NOTHING_TO_RESET' });
  await assert.rejects(resetLocalOverride(root, 'mine'), /defined on this machine only/, 'a personal service is never deleted by an undo');
  await assert.rejects(resetLocalOverride(root, 'nope'), { code: 'RUNTIME_UNKNOWN_SERVICE' });
});
