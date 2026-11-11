// PF-0123 (1.5.2): agent setup on this machine — detection, approved installs (no sudo, no
// shell, no secrets), Codex's own device sign-in, and a connection test that leaves nothing
// running. Every program here is a fake; nothing is installed or signed in.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MachineSetup, parseLoginStatus, setupEnvironment } from '../src/agents/setup.js';
import { startConsoleServer } from '../src/console/server.js';
import { initWorkspace } from '../src/core/workspace.js';
import { fakeTools } from '../test-support/agent-fixtures.js';
import { clearDetectionCache } from '../src/agents/detect.js';

// A bin folder with a fake npm (records its argv and environment) and, optionally, a fake codex.
async function bin({ codex = null, login = 'chatgpt', prefixWritable = true } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yf-machine-'));
  const binDir = path.join(dir, 'bin');
  const prefix = path.join(dir, 'prefix');
  await mkdir(binDir, { recursive: true });
  await mkdir(path.join(prefix, 'lib', 'node_modules'), { recursive: true });
  await mkdir(path.join(prefix, 'bin'), { recursive: true });
  if (!prefixWritable) { await chmod(path.join(prefix, 'lib', 'node_modules'), 0o555); await chmod(path.join(prefix, 'bin'), 0o555); await chmod(prefix, 0o555); }
  const record = path.join(dir, 'npm-calls.jsonl');
  await writeFile(path.join(binDir, 'npm'), `#!/usr/bin/env node\nconst fs = require('fs');\nconst args = process.argv.slice(2);\nif (args[0] === 'prefix') { console.log(${JSON.stringify(prefix)}); process.exit(0); }\nfs.appendFileSync(${JSON.stringify(record)}, JSON.stringify({ args, env: Object.keys(process.env) }) + '\\n');\nconsole.log('added 2 packages in 1s');\n`);
  await chmod(path.join(binDir, 'npm'), 0o755);
  if (codex) {
    const loginLine = { chatgpt: 'Logged in using ChatGPT', apikey: 'Logged in using an API key - sk-***', none: 'Not logged in' }[login];
    await writeFile(path.join(binDir, 'codex'), `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "codex-cli 0.167.0"; exit 0; fi\nif [ "$1" = "login" ] && [ "$2" = "status" ]; then echo "${loginLine}"; [ "${login}" = "none" ] && exit 1; exit 0; fi\nif [ "$1" = "login" ] && [ "$2" = "--device-auth" ]; then echo "Follow these steps to sign in with ChatGPT using device code authorization:"; echo "1. Open this link in your browser: https://auth.openai.com/codex/device"; echo "2. Enter this one-time code: ABCD-12345"; sleep 1; echo "Successfully logged in"; exit 0; fi\nexit 2\n`);
    await chmod(path.join(binDir, 'codex'), 0o755);
  }
  // Only these fakes and the system folders: real agents installed next to Node stay invisible.
  await symlink(process.execPath, path.join(binDir, 'node'));
  const env = { PATH: `${binDir}:/usr/bin:/bin`, HOME: dir, OPENAI_API_KEY: 'sk-should-never-reach', NPM_TOKEN: 'npm-secret', npm_config__authToken: 'secret-token', npm_config_registry: 'https://registry.npmjs.org/' };
  return { dir, binDir, prefix, record, env };
}

const waitJob = async (machine, ms = 8000) => {
  const end = Date.now() + ms;
  while (machine.jobView()?.state === 'running' && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 50));
  return machine.jobView();
};

test('setup environment keeps npm settings but never a credential', () => {
  const env = setupEnvironment({ PATH: '/x', HOME: '/h', OPENAI_API_KEY: 'k', NPM_TOKEN: 't', npm_config__authToken: 'a', npm_config_registry: 'r', GITHUB_TOKEN: 'g', AWS_SECRET_ACCESS_KEY: 's' });
  assert.deepEqual(Object.keys(env).sort(), ['HOME', 'PATH', 'npm_config_registry']);
});

test('Codex login status: only a ChatGPT subscription sign-in counts', () => {
  assert.deepEqual(parseLoginStatus({ ok: true, stdout: 'Logged in using ChatGPT\n', stderr: '' }), { loggedIn: true, method: 'chatgpt' });
  assert.deepEqual(parseLoginStatus({ ok: true, stdout: 'Logged in using an API key - sk-proj-***\n', stderr: '' }), { loggedIn: true, method: 'api-key' });
  assert.deepEqual(parseLoginStatus({ ok: false, stdout: 'Not logged in\n', stderr: '' }), { loggedIn: false, method: null });
});

test('nothing installed: the exact install command, approved before it runs, without sudo or secrets', async () => {
  clearDetectionCache();
  const b = await bin();
  const machine = new MachineSetup({ env: b.env });
  const status = await machine.status();
  assert.equal(status.codex.cli, null);
  assert.equal(status.codex.ready, false);
  const plan = status.codex.install;
  assert.equal(plan.command, 'npm install -g @openai/codex@0.167.0 @agentclientprotocol/codex-acp@2.5.0', 'pinned to the tested versions');
  assert.equal(plan.writable, true);
  assert.doesNotMatch(plan.command, /sudo/);
  await assert.rejects(machine.install({ planHash: plan.planHash }), { code: 'CONFIRMATION_REQUIRED' });
  await assert.rejects(machine.install({ confirm: true, planHash: 'stale' }), { code: 'PLAN_CHANGED' });
  assert.equal(existsSync(b.record), false, 'nothing ran before the confirmation');
  const job = await machine.install({ confirm: true, planHash: plan.planHash });
  assert.equal(job.kind, 'install');
  const done = await waitJob(machine);
  assert.equal(done.state, 'done');
  assert.match(done.tail, /added 2 packages/);
  const [call] = (await readFile(b.record, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(call.args, ['install', '-g', '@openai/codex@0.167.0', '@agentclientprotocol/codex-acp@2.5.0']);
  for (const secret of ['OPENAI_API_KEY', 'NPM_TOKEN', 'npm_config__authToken']) assert.ok(!call.env.includes(secret), `${secret} is not passed to npm`);
  assert.ok(call.env.includes('npm_config_registry'));
});

test('an npm global folder this user cannot write is refused: no sudo, the command to run by hand instead', { skip: process.getuid?.() === 0 ? 'root can write anywhere' : false }, async () => {
  clearDetectionCache();
  const b = await bin({ prefixWritable: false });
  const machine = new MachineSetup({ env: b.env });
  const plan = (await machine.status()).codex.install;
  assert.equal(plan.writable, false);
  await assert.rejects(machine.install({ confirm: true, planHash: plan.planHash }), (error) => error.code === 'NPM_PREFIX_NOT_WRITABLE' && /never uses sudo/.test(error.message));
  assert.equal(existsSync(b.record), false);
  await chmod(b.prefix, 0o755);
});

test('sign-in: Codex\'s own device flow after confirmation; the link and code are shown, nothing else', async () => {
  clearDetectionCache();
  const b = await bin({ codex: true, login: 'none' });
  const machine = new MachineSetup({ env: b.env });
  const status = await machine.status();
  assert.deepEqual([status.codex.cli?.version, status.codex.login.loggedIn], ['0.167.0', false]);
  assert.equal(machine.loginProblem(), 'Codex is not signed in. Sign in with your ChatGPT subscription.');
  await assert.rejects(machine.signIn({}), { code: 'CONFIRMATION_REQUIRED' });
  await machine.signIn({ confirm: true });
  await assert.rejects(machine.signIn({ confirm: true }), { code: 'SETUP_BUSY' }, 'one setup step at a time');
  const done = await waitJob(machine);
  assert.equal(done.state, 'done');
  assert.equal(done.url, 'https://auth.openai.com/codex/device');
  assert.equal(done.code, 'ABCD-12345');
});

test('an API-key sign-in is reported as not usable', async () => {
  clearDetectionCache();
  const b = await bin({ codex: true, login: 'apikey' });
  const machine = new MachineSetup({ env: b.env });
  const status = await machine.status();
  assert.equal(status.codex.login.method, 'api-key');
  assert.equal(status.codex.ready, false);
  assert.match(machine.loginProblem(), /API key/);
});

test('connection test: handshake only, in an empty temporary folder, no session, process ended', async () => {
  clearDetectionCache();
  const tools = await fakeTools();
  const machine = new MachineSetup({ env: tools.env });
  const verified = await machine.verify();
  assert.equal(verified.ok, true);
  assert.deepEqual(verified.auth, { kind: 'account', label: 'ChatGPT Plus' });
  assert.equal(verified.cleanup.survivors, 0);
  const lines = (await readFile(tools.state, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(lines.filter((line) => line.spawn).length, 1);
  assert.match(lines[0].cwd, /yallaflow-codex-check-/, 'not run in any project');
  assert.equal(lines[0].hasOpenAiKey, false, 'API keys are stripped');
  assert.ok(!lines.some((line) => 'mode' in line), 'no session was created (no mode set)');
  assert.equal(existsSync(`${tools.state}.sessions`), false, 'no session/new');
  assert.equal(existsSync(lines[0].cwd), false, 'the temporary folder is removed');
  clearDetectionCache();
  const apiKey = await fakeTools({ auth: 'apikey' });
  const refused = await new MachineSetup({ env: apiKey.env }).verify();
  assert.deepEqual([refused.ok, refused.code], [false, 'SUBSCRIPTION_REQUIRED']);
});

test('HTTP: status and actions need the token and Origin; a read-only console runs none of them', async () => {
  clearDetectionCache();
  const root = await mkdtemp(path.join(os.tmpdir(), 'yf-machine-project-'));
  await initWorkspace(root, 'Shop', 'greenfield', 'adaptive');
  const b = await bin();
  for (const readOnly of [false, true]) {
    const server = await startConsoleServer({ roots: [root], port: 0, readOnly, agentEnv: b.env });
    const origin = server.url.replace(/\/$/, '');
    const auth = { Authorization: `Bearer ${server.token}` };
    try {
      assert.equal((await fetch(`${server.url}api/machine`)).status, 401);
      const status = await fetch(`${server.url}api/machine`, { headers: auth });
      assert.equal(status.status, readOnly ? 405 : 200);
      const post = (action, body) => fetch(`${server.url}api/machine/${action}`, { method: 'POST', headers: { ...auth, Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (readOnly) {
        for (const action of ['codex/install', 'codex/login', 'codex/verify', 'job/cancel']) assert.equal((await post(action, { confirm: true })).status, 405, action);
      } else {
        const plan = (await status.json()).codex.install;
        assert.equal((await fetch(`${server.url}api/machine/codex/install`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: true, planHash: plan.planHash }) })).status, 403, 'Origin required');
        assert.equal((await post('codex/install', { planHash: plan.planHash })).status, 400, 'confirmation required');
        assert.equal((await post('codex/install', { confirm: true, planHash: plan.planHash })).status, 202);
      }
    } finally {
      await server.close();
    }
  }
});

test('one setup step at a time from the moment it is accepted; cancel ends the whole process group', async () => {
  clearDetectionCache();
  const b = await bin();
  // npm that starts a child and waits: cancel must end both.
  await writeFile(path.join(b.binDir, 'npm'), `#!/usr/bin/env node\nconst { spawn } = require('child_process');\nconst args = process.argv.slice(2);\nif (args[0] === 'prefix') { console.log(${JSON.stringify(b.prefix)}); process.exit(0); }\nconst c = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });\nrequire('fs').writeFileSync(${JSON.stringify(path.join(b.dir, 'child.pid'))}, String(c.pid));\nconsole.log('installing…');\nsetInterval(() => {}, 1000);\n`);
  const machine = new MachineSetup({ env: b.env });
  const plan = (await machine.status()).codex.install;
  const [first, second] = await Promise.allSettled([machine.install({ confirm: true, planHash: plan.planHash }), machine.install({ confirm: true, planHash: plan.planHash })]);
  assert.equal(first.status, 'fulfilled');
  assert.equal(second.reason?.code, 'SETUP_BUSY', 'a double submit never starts a second global install');
  const childPid = Number(await (async () => { for (let i = 0; i < 100; i++) { try { return await readFile(path.join(b.dir, 'child.pid'), 'utf8'); } catch { await new Promise((r) => setTimeout(r, 50)); } } return '0'; })());
  assert.ok(childPid > 0);
  assert.equal(machine.cancel().state, 'cancelling');
  await assert.rejects(machine.signIn({ confirm: true }), { code: 'SETUP_BUSY' }, 'still busy until the process has ended');
  const done = await waitJob({ jobView: () => { const j = machine.jobView(); return j?.state === 'cancelling' ? { ...j, state: 'running' } : j; } }, 10000);
  assert.equal(done.state, 'cancelled');
  await new Promise((r) => setTimeout(r, 300));
  assert.throws(() => process.kill(childPid, 0), 'the child npm started was ended too');
});

test('setup keeps proxy and certificate settings; a status probe that cannot run is unknown, not signed out', () => {
  const env = setupEnvironment({ PATH: '/x', HTTPS_PROXY: 'http://proxy:8080', no_proxy: 'localhost', NODE_EXTRA_CA_CERTS: '/etc/ca.pem', OPENAI_API_KEY: 'k' });
  assert.deepEqual(Object.keys(env).sort(), ['HTTPS_PROXY', 'NODE_EXTRA_CA_CERTS', 'PATH', 'no_proxy']);
  assert.deepEqual(parseLoginStatus({ ok: false, probeFailed: true, stdout: '', stderr: '' }), { loggedIn: false, method: null, unknown: true });
});

test('tested Codex versions: exact pins, inside the supported adapter range, checked before an install is offered', async () => {
  const { TESTED_CODEX, REQUIREMENTS, parseVersion, versionAtLeast } = await import('../src/agents/detect.js');
  const { pinnedCompatible, CODEX_PACKAGE, ADAPTER_PACKAGE } = await import('../src/agents/setup.js');
  for (const pin of [TESTED_CODEX.cli.version, TESTED_CODEX.adapter.version]) assert.match(pin, /^\d+\.\d+\.\d+$/, 'an exact version, never a range');
  const acp = parseVersion(TESTED_CODEX.adapter.version);
  assert.ok(versionAtLeast(acp, REQUIREMENTS.codexAcp.min) && acp[0] <= REQUIREMENTS.codexAcp.maxMajor);
  assert.equal(CODEX_PACKAGE, `@openai/codex@${TESTED_CODEX.cli.version}`);
  assert.equal(ADAPTER_PACKAGE, `@agentclientprotocol/codex-acp@${TESTED_CODEX.adapter.version}`);
  assert.deepEqual(pinnedCompatible(), { ok: true, problems: [] });
  assert.equal(pinnedCompatible('14.21.3').ok, false, 'an unsupported Node.js gets no install offer');
});
