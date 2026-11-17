// PF-0166: fixing a service where it fails. What it needs before it can start (and the exact
// install command, run only on a confirmed action), who holds its port and a free one applied
// consistently, the line of the log that explains a failure, where a change is saved, and
// editing one field without losing the others.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, chmod, symlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { checkPrerequisites, installCommand, parsePackageCommand } from '../src/runtime/prerequisites.js';
import { diagnoseLog, sinceLastStart } from '../src/runtime/diagnose.js';
import { planPortChange, PortChangeError } from '../src/runtime/ports.js';
import { addService, definitionHash, loadRuntimeProfiles, updateService } from '../src/runtime/profile.js';
import { installPrerequisites, runtimeStatus, startService, stopService } from '../src/runtime/supervisor.js';
import { SUPPORTED } from '../src/runtime/process.js';
import { initWorkspace } from '../src/core/workspace.js';
import { trustAsConsole } from '../test-support/runtime-trust.js';

process.env.XDG_CONFIG_HOME = await mkdtemp(path.join(os.tmpdir(), 'yf-rtfix-cfg-'));
const tmp = (prefix = 'yf-rtfix-') => mkdtemp(path.join(os.tmpdir(), prefix));
const json = (file, value) => writeFile(file, JSON.stringify(value));
const svc = (over = {}) => ({ id: 'landing-start', name: 'Landing', kind: 'process', command: ['npm', '--prefix', 'landing', 'run', 'start'], cwd: '.', env: [], ports: [4200], ready: { port: 4200 }, links: [], dependsOn: [], ...over });
async function repo({ pkg = { scripts: { start: 'ng serve' }, devDependencies: { '@angular/cli': '^19.0.0' } }, lock = 'package-lock.json', dir = 'landing' } = {}) {
  const root = await tmp();
  await mkdir(path.join(root, dir), { recursive: true });
  await json(path.join(root, dir, 'package.json'), pkg);
  if (lock) await writeFile(path.join(root, dir, lock), '{}');
  return root;
}
const check = (root, service = svc()) => checkPrerequisites(service, { cwd: root, top: root });
async function freePort() { return new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); }); }

test('the real case: landing/node_modules is missing, and the fix is npm ci --include=dev in landing', async () => {
  const root = await repo();
  const result = await check(root);
  assert.equal(result.ok, false);
  const [problem] = result.problems;
  assert.deepEqual([problem.code, problem.dir, problem.fix.argv, problem.fix.cwd, problem.fix.display, problem.fix.lockfile, problem.fix.changesLockfile], ['DEPENDENCIES_MISSING', 'landing', ['npm', 'ci', '--include=dev'], 'landing', 'cd landing && npm ci --include=dev', 'package-lock.json', false]);
  assert.match(problem.fix.hash, /^[0-9a-f]{64}$/);
  // installed, but the script's own tool is not there
  await mkdir(path.join(root, 'landing', 'node_modules', '.bin'), { recursive: true });
  const tool = (await check(root)).problems[0];
  assert.deepEqual([tool.code, tool.tool, tool.package], ['LOCAL_TOOL_MISSING', 'ng', '@angular/cli']);
  await writeFile(path.join(root, 'landing', 'node_modules', '.bin', 'ng'), '');
  assert.deepEqual(await check(root), { state: 'READY', ok: true, problems: [] });
});

test('the install command follows the package manager and its lockfile; without a lockfile it says one is created', async () => {
  const cases = [['pnpm-lock.yaml', {}, ['pnpm', 'install', '--frozen-lockfile']], ['yarn.lock', {}, ['yarn', 'install', '--frozen-lockfile']], ['yarn.lock', { packageManager: 'yarn@4.5.0' }, ['yarn', 'install', '--immutable']],
    ['bun.lock', {}, ['bun', 'install', '--frozen-lockfile']], ['bun.lockb', {}, ['bun', 'install', '--frozen-lockfile']], ['npm-shrinkwrap.json', {}, ['npm', 'ci', '--include=dev']]];
  for (const [lock, extra, argv] of cases) {
    const dir = await tmp();
    await writeFile(path.join(dir, lock), '');
    assert.deepEqual((await installCommand(dir, extra)).argv, argv, lock);
  }
  const bare = await tmp();
  assert.deepEqual(await installCommand(bare, {}, 'pnpm'), { manager: 'pnpm', lockfile: null, argv: ['pnpm', 'install'] });
  assert.deepEqual((await installCommand(bare, { packageManager: 'yarn@1.22.0' })).argv, ['yarn', 'install']);
  const root = await repo({ lock: null });
  assert.equal((await check(root)).problems[0].fix.changesLockfile, true);
  // both pnpm and npm lockfiles: pnpm's wins, as in the service suggestions
  const both = await tmp(); await writeFile(path.join(both, 'pnpm-lock.yaml'), ''); await writeFile(path.join(both, 'package-lock.json'), '');
  assert.equal((await installCommand(both, {})).manager, 'pnpm');
});

test('only certain cases are reported: hoisted installs, Plug\'n\'Play, unknown commands and packages without dependencies are left alone', async () => {
  const hoisted = await repo();
  await mkdir(path.join(hoisted, 'node_modules', '.bin'), { recursive: true });
  await writeFile(path.join(hoisted, 'node_modules', '.bin', 'ng'), '');
  assert.equal((await check(hoisted)).ok, true, 'a workspace install above the package counts');
  const pnp = await repo(); await writeFile(path.join(pnp, '.pnp.cjs'), '');
  assert.equal((await check(pnp)).ok, true);
  const root = await repo();
  assert.equal((await check(root, svc({ command: ['php', 'artisan', 'serve'] }))).ok, true, 'not a Node package manager');
  assert.equal((await check(root, svc({ kind: 'docker-compose', command: ['docker', 'compose', 'up'] }))).ok, true);
  assert.equal((await check(root, svc({ command: ['npm', '--prefix', 'nowhere', 'start'] }))).ok, true, 'a folder that does not exist is the start\'s own error');
  assert.equal((await check(root, svc({ command: ['npm', '--prefix', '..', 'start'] }))).ok, true, 'never looks outside the repository');
  assert.equal((await check(await repo({ pkg: { scripts: { start: 'node server.js' } } }))).ok, true, 'no dependencies declared');
  // a global tool the package does not declare is not called missing
  const global = await repo({ pkg: { scripts: { start: 'serve .' }, dependencies: { leftpad: '1.0.0' } } });
  await mkdir(path.join(global, 'landing', 'node_modules'));
  assert.equal((await check(global)).ok, true);
  assert.deepEqual(parsePackageCommand(['pnpm', '-C', 'web', 'dev']), { manager: 'pnpm', dir: 'web', script: 'dev', npx: false });
  assert.deepEqual(parsePackageCommand(['yarn', '--cwd=app', 'start', '--', '--port', '1']), { manager: 'yarn', dir: 'app', script: 'start', npx: false });
  assert.equal(parsePackageCommand(['node', 'server.js']), null);
});

test('diagnosis: the line that states the cause, not the end of the stack trace; a missing project file is not "missing dependencies"', () => {
  const trace = ['--- yallaflow runtime: starting old at 2026 (cli) ---', 'old run noise Error: stale', '--- yallaflow runtime: starting landing-start at 2026 (cli) ---', '> landing@0.0.0 start', '> ng serve', 'node:internal/modules/cjs/loader:1228', '  throw err;', '  ^',
    "Error: Cannot find module '/work/landing/node_modules/@angular/cli/bin/ng.js'", '    at Module._resolveFilename (node:internal/modules/cjs/loader:1225:15)', '    at Module._load (node:internal/modules/cjs/loader:1051:27)', "  code: 'MODULE_NOT_FOUND',", '  requireStack: []', '}', '', 'Node.js v22.11.0'];
  const found = diagnoseLog(sinceLastStart(trace));
  assert.deepEqual(found, { line: "Error: Cannot find module '/work/landing/node_modules/@angular/cli/bin/ng.js'", kind: 'missing-module', detail: '/work/landing/node_modules/@angular/cli/bin/ng.js', module: 'dependency' });
  assert.equal(diagnoseLog(["Error: Cannot find module '/work/landing/dist/main.js'"]).module, 'project-file', 'a wrong path, said as such');
  assert.equal(diagnoseLog(["Error: Cannot find module './server'"]).module, 'project-file');
  assert.equal(diagnoseLog(["Error: Cannot find package 'express' imported from /work/a.mjs"]).module, 'dependency');
  assert.deepEqual([diagnoseLog(['Error: listen EADDRINUSE: address already in use 127.0.0.1:4200']).kind, diagnoseLog(['Error: listen EADDRINUSE: address already in use 127.0.0.1:4200']).detail], ['port-in-use', '4200']);
  assert.equal(diagnoseLog(['Port 4200 is already in use.']).kind, 'port-in-use');
  assert.deepEqual([diagnoseLog(['sh: 1: ng: not found']).kind, diagnoseLog(['sh: 1: ng: not found']).detail], ['command-not-found', 'ng']);
  assert.equal(diagnoseLog(['npm error Missing script: "start"']).kind, 'missing-script');
  assert.equal(diagnoseLog(['\u001b[31mTypeError: x is not a function\u001b[0m', '    at a.js:1']).line, 'TypeError: x is not a function', 'colour codes are removed');
  assert.equal(diagnoseLog(['starting…', 'listening on 3000', '']), null, 'nothing is invented');
});

test('moving a port changes the command, the port, the readiness check and the links together, or nothing', async () => {
  const root = await repo();
  const plan = async (service, from = 4200, to = 4202) => planPortChange(service, from, to, { cwd: root });
  const ng = await plan(svc({ links: [{ label: 'App', url: 'http://localhost:4200/' }, { label: 'Docs', url: 'http://localhost:9000/' }] }));
  assert.deepEqual(ng.patch, { command: ['npm', '--prefix', 'landing', 'run', 'start', '--', '--port', '4202'], ports: [4202], ready: { port: 4202 }, links: [{ label: 'App', url: 'http://localhost:4202/' }, { label: 'Docs', url: 'http://localhost:9000/' }] });
  assert.equal(ng.changed.length, 4);
  assert.deepEqual((await plan(svc({ command: ['npm', '--prefix', 'landing', 'run', 'start', '--', '--host', 'x', '--port', '4200'] }))).patch.command, ['npm', '--prefix', 'landing', 'run', 'start', '--', '--host', 'x', '--port', '4202']);
  assert.deepEqual((await plan(svc({ command: ['php', 'artisan', 'serve', '--port=4200'], ready: { log: 'started' } }))).patch, { command: ['php', 'artisan', 'serve', '--port=4202'], ports: [4202] }, 'a log readiness check is left alone');
  assert.deepEqual((await plan(svc({ command: ['vite', '-p', '4200'], ports: [4200, 9229] }))).patch.ports, [4202, 9229]);
  assert.deepEqual((await plan(svc({ command: ['php', '-S', '127.0.0.1:4200'] }))).patch.command, ['php', '-S', '127.0.0.1:4202']);
  // commands it does not understand are never edited by guesswork
  await assert.rejects(plan(svc({ command: ['node', 'server.js'] })), (error) => error instanceof PortChangeError && error.code === 'RUNTIME_PORT_COMMAND' && /Edit the command yourself/.test(error.message));
  await assert.rejects(plan(svc({ command: ['python', '-m', 'http.server', '4200'] })), PortChangeError, 'the port is there, in a form it does not recognize');
  const plainScript = await repo({ pkg: { scripts: { start: 'node server.js' }, dependencies: { x: '1' } } });
  await assert.rejects(planPortChange(svc(), 4200, 4202, { cwd: plainScript }), PortChangeError, 'a script that is not a known dev server');
  await assert.rejects(plan(svc({ kind: 'docker-compose', command: ['docker', 'compose', 'up'] })), /Compose file/);
  for (const [from, to] of [[4201, 4202], [4200, 4200], [4200, 0], [4200, 70000]]) await assert.rejects(plan(svc(), from, to), { code: 'RUNTIME_PROFILE_INVALID' });
});

test('an edit keeps every other field, says where it was saved, and never touches the shared file for a local change', async () => {
  const root = await tmp();
  await initWorkspace(root, 'R', 'greenfield', 'adaptive');
  await addService(root, { id: 'db', name: 'DB', kind: 'process', command: ['node', 'db.js'], cwd: '.' });
  await addService(root, { id: 'web', name: 'Web', kind: 'process', command: ['node', 'server.js', '--port', '4200'], cwd: '.', ports: [4200], ready: { port: 4200 }, dependsOn: ['db'], open: '/admin', env: ['NODE_ENV'], links: [{ label: 'App', url: 'http://localhost:4200/' }] });
  const sharedFile = path.join(root, '.yallaflow', 'runtime.yaml');
  const before = await readFile(sharedFile, 'utf8');
  const hashBefore = await definitionHash(root, (await loadRuntimeProfiles(root)).services.find((s) => s.id === 'web'));

  const local = await updateService(root, 'web', { ports: [4202], ready: { port: 4202 } }, { local: true });
  assert.deepEqual([local.savedTo, local.file, local.changed, local.masked], ['local', '.yallaflow/local/runtime.yaml', ['ports', 'ready'], []]);
  assert.equal(await readFile(sharedFile, 'utf8'), before, 'the shared file is byte-identical: teammates are not affected');
  const web = local.service;
  assert.deepEqual([web.ports, web.ready, web.dependsOn, web.open, web.env, web.links, web.command, web.name, web.overridden], [[4202], { port: 4202 }, ['db'], '/admin', ['NODE_ENV'], [{ label: 'App', url: 'http://localhost:4200/' }], ['node', 'server.js', '--port', '4200'], 'Web', ['ports', 'ready']]);
  assert.notEqual(await definitionHash(root, web), hashBefore, 'a changed port needs a new review');
  // a second local edit keeps the first
  assert.deepEqual((await updateService(root, 'web', { name: 'Web app' }, { local: true })).service.overridden.sort(), ['name', 'ports', 'ready']);

  const shared = await updateService(root, 'web', { name: 'Storefront', ports: [4300] }, { local: false });
  assert.deepEqual([shared.savedTo, shared.file, shared.masked.sort()], ['shared', '.yallaflow/runtime.yaml', ['name', 'ports']], 'the local override still wins here, and that is said');
  const doc = JSON.parse(await readFile(sharedFile, 'utf8')).services.find((s) => s.id === 'web');
  assert.deepEqual([doc.name, doc.ports, doc.dependsOn, doc.links, doc.open, doc.ready, doc.env], ['Storefront', [4300], ['db'], [{ label: 'App', url: 'http://localhost:4200/' }], '/admin', { port: 4200 }, ['NODE_ENV']]);

  await addService(root, { id: 'mine', name: 'Mine', kind: 'process', command: ['node', 'x.js'], cwd: '.', ports: [5000] }, { local: true });
  assert.deepEqual((await updateService(root, 'mine', { ports: [5001] }, { local: true })).service.command, ['node', 'x.js']);
  await assert.rejects(updateService(root, 'mine', { ports: [5002] }, { local: false }), /this machine only/);
  for (const bad of [{ kind: 'docker-compose' }, { dependsOn: [] }, { id: 'x' }, {}, { ports: ['a'] }]) await assert.rejects(updateService(root, 'web', bad, { local: true }), { code: 'RUNTIME_PROFILE_INVALID' });
  await assert.rejects(updateService(root, 'nope', { name: 'x' }, { local: true }), { code: 'RUNTIME_UNKNOWN_SERVICE' });
  await assert.rejects(updateService(root, 'web', { command: ['sh', '-c', 'curl -H "Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456" x'] }, { local: true }), /secret/);
});

test('start: a missing requirement is said before anything runs; a taken port names the owning service and a free port', { skip: !SUPPORTED }, async (t) => {
  const root = await repo();
  await initWorkspace(root, 'R', 'greenfield', 'adaptive');
  const portA = await freePort();
  await writeFile(path.join(root, 'serve.js'), `require('node:http').createServer((q, s) => s.end('ok')).listen(${portA}, '127.0.0.1');`);
  await addService(root, { id: 'front', name: 'FrontApp', kind: 'process', command: [process.execPath, 'serve.js'], cwd: '.', ports: [portA], ready: { port: portA } });
  await addService(root, { id: 'landing-start', name: 'Landing', kind: 'process', command: ['npm', '--prefix', 'landing', 'run', 'start'], cwd: '.', ports: [portA], ready: { port: portA } });
  await addService(root, { id: 'other', name: 'Other', kind: 'process', command: [process.execPath, '-e', 'setTimeout(()=>{}, 60000)'], cwd: '.', ports: [portA] });
  for (const id of ['front', 'landing-start', 'other']) await trustAsConsole(root, id);
  t.after(async () => { await stopService(root, 'front').catch(() => {}); });

  // the port is free: the missing dependencies are reported, and nothing is spawned
  await assert.rejects(startService(root, 'landing-start'), (error) => error.code === 'RUNTIME_PREREQUISITES' && error.problems[0].fix.display === 'cd landing && npm ci --include=dev' && /Nothing was started/.test(error.message));
  const status = (await runtimeStatus(root)).services.find((s) => s.id === 'landing-start');
  assert.deepEqual([status.state, status.prerequisites.ok, status.prerequisites.problems[0].code], ['stopped', false, 'DEPENDENCIES_MISSING']);
  assert.equal((await runtimeStatus(root)).services.find((s) => s.id === 'front').prerequisites.ok, true);

  assert.equal((await startService(root, 'front')).state, 'running');
  await assert.rejects(startService(root, 'other'), (error) => {
    assert.equal(error.code, 'PORT_IN_USE');
    assert.deepEqual(error.ownerService, { id: 'front', name: 'FrontApp' }, 'the owner is named as the service of this project');
    assert.ok(Number.isInteger(error.suggestion) && error.suggestion > portA, 'a free port is offered');
    assert.match(error.message, /the service front of this project; other was not started and nothing was stopped\. Port \d+ is free\./);
    return true;
  });
  assert.equal((await runtimeStatus(root)).services.find((s) => s.id === 'front').state, 'running', 'the other service was not stopped');
});

test('install: only for a trusted service, only the confirmed command, and the lockfile is not rewritten by a frozen install', { skip: !SUPPORTED }, async (t) => {
  const root = await repo();
  await initWorkspace(root, 'R', 'greenfield', 'adaptive');
  await addService(root, svc({ ports: [], ready: null }));
  // a stand-in npm on PATH: `npm ci` creates node_modules/.bin/ng and records how it was called
  const bin = await tmp('yf-rtfix-bin-');
  await writeFile(path.join(bin, 'npm'), `#!/bin/sh\necho "npm $* in $(pwd) CI=$CI TOKEN=\${SECRET_TOKEN:-none}" > "${bin}/called"\nif [ "$1" = "ci" ]; then mkdir -p node_modules/.bin && : > node_modules/.bin/ng; else echo "npm error code EUSAGE" >&2; exit 1; fi\n`);
  await chmod(path.join(bin, 'npm'), 0o755);
  const saved = { PATH: process.env.PATH, SECRET_TOKEN: process.env.SECRET_TOKEN };
  process.env.PATH = `${bin}${path.delimiter}${process.env.PATH}`; process.env.SECRET_TOKEN = 'do-not-leak';
  t.after(() => { process.env.PATH = saved.PATH; if (saved.SECRET_TOKEN === undefined) delete process.env.SECRET_TOKEN; else process.env.SECRET_TOKEN = saved.SECRET_TOKEN; });
  const fix = (await runtimeStatus(root)).services[0].prerequisites.problems[0].fix;
  const pkgBefore = await readFile(path.join(root, 'landing', 'package.json'), 'utf8');
  const lockBefore = await readFile(path.join(root, 'landing', 'package-lock.json'), 'utf8');

  await assert.rejects(installPrerequisites(root, 'landing-start', { confirm: fix.hash }), { code: 'RUNTIME_UNTRUSTED' });
  await trustAsConsole(root, 'landing-start');
  await assert.rejects(installPrerequisites(root, 'landing-start', {}), { code: 'RUNTIME_INSTALL_CONFIRM' });
  await assert.rejects(installPrerequisites(root, 'landing-start', { confirm: 'f'.repeat(64) }), { code: 'RUNTIME_INSTALL_CONFIRM' });
  assert.equal(existsSync(path.join(bin, 'called')), false, 'nothing ran without the confirmation of that exact command');

  const done = await installPrerequisites(root, 'landing-start', { confirm: fix.hash, startedBy: 'console' });
  assert.deepEqual([done.installed, done.command, done.ready, done.changesLockfile], [true, 'cd landing && npm ci --include=dev', true, false]);
  const called = await readFile(path.join(bin, 'called'), 'utf8');
  assert.match(called, /^npm ci --include=dev in .*\/landing CI=1 TOKEN=none/, 'argv only, in the package folder, without the developer\'s other variables');
  assert.equal(await readFile(path.join(root, 'landing', 'package.json'), 'utf8'), pkgBefore);
  assert.equal(await readFile(path.join(root, 'landing', 'package-lock.json'), 'utf8'), lockBefore);
  assert.equal((await runtimeStatus(root)).services[0].prerequisites.ok, true);
  await assert.rejects(installPrerequisites(root, 'landing-start', { confirm: fix.hash }), { code: 'RUNTIME_NOTHING_TO_INSTALL' });
});

test('a failed start reports the cause line, redacted, in the error and in the status', { skip: !SUPPORTED }, async () => {
  const root = await tmp();
  await initWorkspace(root, 'R', 'greenfield', 'adaptive');
  await writeFile(path.join(root, 'boot.js'), "console.log('API_KEY=abcd1234efgh5678ijkl9012'); require('./dist/main.js');");
  await addService(root, { id: 'api', name: 'API', kind: 'process', command: [process.execPath, 'boot.js'], cwd: '.' });
  await trustAsConsole(root, 'api');
  await assert.rejects(startService(root, 'api'), (error) => {
    assert.equal(error.code, 'RUNTIME_START_FAILED');
    assert.match(error.message, /Cause: Error: Cannot find module '\.\/dist\/main\.js'/);
    assert.deepEqual([error.failure.kind, error.failure.module], ['missing-module', 'project-file']);
    assert.ok(!error.message.includes('abcd1234efgh5678ijkl9012'), 'the log lines in the message are redacted');
    return true;
  });
  const status = (await runtimeStatus(root)).services[0];
  assert.deepEqual([status.state, status.failure.kind, status.failure.module, status.prerequisites.ok], ['failed', 'missing-module', 'project-file', true], 'a wrong path is not reported as missing dependencies');
  await stopService(root, 'api').catch(() => {});
});
