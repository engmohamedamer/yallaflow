// Agent setup on this machine (PF-0123, 1.5.2; used by the console server): what the console's agents need, and guided,
// developer-approved repair. Machine level (installed tools, the provider's own sign-in) is
// kept apart from project level (.yallaflow/local/agents.json, set in Setup → Agents).
//
// Safety rules (owner conditions, 2026-11-11):
// - Nothing is installed or signed in without the developer's explicit confirmation; an
//   install is bound to the exact command the developer reviewed (planHash).
// - argv only, never a shell, never sudo; an install is refused when npm's global folder is
//   not writable by this user (the command is then shown to run by hand).
// - Subscription only: API-key variables are stripped from every child; an API-key login is
//   reported as not usable. Sign-in is Codex's own device flow (an official link and a
//   one-time code); YallaFlow never reads, stores or shows credentials.
// - The connection test starts the adapter in an empty temporary folder, completes only the
//   ACP handshake (no session, no prompt, no project), and always ends the process.
// - Claude Code stays experimental: in a published release it is only detected, never connected.
import { execFile, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REQUIREMENTS, TESTED_CODEX, clearDetectionCache, detectProviders, parseVersion, versionAtLeast, which } from './detect.js';
import { CodexSession } from './codex.js';
import { claudeIncluded } from './experimental.js';
import { redactSecrets } from '../security/redact.js';

// An error the console server answers with this HTTP status and code.
class SetupError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// Installs are pinned to the tested versions (PF-0124), never a range or "latest".
export const CODEX_PACKAGE = `${TESTED_CODEX.cli.package}@${TESTED_CODEX.cli.version}`;
export const ADAPTER_PACKAGE = `${TESTED_CODEX.adapter.package}@${TESTED_CODEX.adapter.version}`;

// Compatibility is checked before an install is offered: the pinned adapter must satisfy what
// the bridge requires, and this Node.js must be one the packages support.
export function pinnedCompatible(nodeVersion = process.versions.node) {
  const acp = parseVersion(TESTED_CODEX.adapter.version);
  const problems = [];
  if (!versionAtLeast(acp, REQUIREMENTS.codexAcp.min) || acp[0] > REQUIREMENTS.codexAcp.maxMajor) problems.push(`the pinned codex-acp ${TESTED_CODEX.adapter.version} is outside the supported range`);
  if (!versionAtLeast(parseVersion(nodeVersion), [16, 0, 0])) problems.push(`Node.js ${nodeVersion} is older than the Codex packages support (16+)`);
  return { ok: problems.length === 0, problems };
}
const SECRET_ENV = /(TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|AUTH|CREDENTIAL|COOKIE|SESSION)/i;
const INSTALL_TIMEOUT_MS = 10 * 60_000;
const LOGIN_TIMEOUT_MS = 15 * 60_000;
const TAIL_BYTES = 6000;

// The environment a setup child sees: the basics a CLI needs, npm's own non-secret settings,
// and nothing that looks like a credential.
export function setupEnvironment(env = process.env) {
  // Network settings (proxies, extra certificate authorities) are kept: without them installs and
  // sign-in fail behind a corporate proxy. They are not subscription credentials.
  const keep = ['PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'TMPDIR', 'SHELL', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'NVM_DIR', 'CODEX_HOME',
    'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'ALL_PROXY', 'https_proxy', 'http_proxy', 'no_proxy', 'all_proxy', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR'];
  const clean = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== 'string') continue;
    if (keep.includes(key) || (/^npm_config_/i.test(key) && !SECRET_ENV.test(key))) clean[key] = value;
  }
  return clean;
}

function run(file, args, { env, timeoutMs = 8000, cwd } = {}) {
  return new Promise((resolve) => {
    execFile(file, args, { env, timeout: timeoutMs, cwd, maxBuffer: 1024 * 1024, shell: false }, (error, stdout, stderr) => {
      // A probe that could not run (timeout, missing program) is not an answer.
      const probeFailed = Boolean(error && (error.killed || typeof error.code === 'string'));
      resolve({ ok: !error, code: error?.code ?? 0, probeFailed, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
    });
  });
}

// `codex login status`: Codex prints how it is signed in. Only the method is kept.
export function parseLoginStatus(result) {
  if (result.probeFailed) return { loggedIn: false, method: null, unknown: true };
  const text = `${result.stdout}\n${result.stderr}`;
  if (/logged in using (an )?api key/i.test(text)) return { loggedIn: true, method: 'api-key' };
  if (/logged in using chatgpt/i.test(text)) return { loggedIn: true, method: 'chatgpt' };
  if (/not logged in/i.test(text) || !result.ok) return { loggedIn: false, method: null };
  if (/logged in/i.test(text)) return { loggedIn: true, method: 'other' };
  return { loggedIn: false, method: null };
}

async function npmGlobal(env) {
  const npm = await which('npm', env);
  if (!npm) return { npm: null, prefix: null, writable: false };
  const result = await run(npm, ['prefix', '-g'], { env: setupEnvironment(env) });
  const prefix = result.ok ? result.stdout.trim().split('\n').pop() : null;
  if (!prefix) return { npm, prefix: null, writable: false };
  // npm writes packages under lib/node_modules and links under bin (Linux and macOS layout);
  // a folder that does not exist yet is created inside the prefix, so the prefix must be writable.
  const canWrite = async (target) => { try { await access(target, constants.W_OK); return true; } catch (error) { return error.code === 'ENOENT' ? canWrite(path.dirname(target)) : false; } };
  const writable = (await canWrite(path.join(prefix, 'lib', 'node_modules'))) && (await canWrite(path.join(prefix, 'bin')));
  return { npm, prefix, writable };
}

function installPlan(codex, npmInfo) {
  if (!pinnedCompatible().ok) return null;
  const packages = [];
  if (!codex.codex) packages.push(CODEX_PACKAGE);
  if (!codex.adapter || codex.problems.some((problem) => /codex-acp .* is not supported/.test(problem))) packages.push(ADAPTER_PACKAGE);
  if (!packages.length || !npmInfo.npm) return null;
  const argv = ['npm', 'install', '-g', ...packages];
  return { argv, command: argv.join(' '), packages, prefix: npmInfo.prefix, writable: npmInfo.writable, planHash: createHash('sha256').update(JSON.stringify({ argv, prefix: npmInfo.prefix })).digest('hex') };
}

export class MachineSetup {
  constructor({ env = process.env, readOnly = false } = {}) {
    this.env = env;
    this.readOnly = readOnly;
    this.job = null; // one setup job at a time: { id, kind, state, tail, url, code, startedAt, endedAt, exit, child }
    this.login = null; // last `codex login status` result, for readiness
    this.verified = null; // last connection test { ok, at, auth }
    this.pending = null; // a setup step accepted but whose process has not started yet
  }

  async status() {
    if (this.readOnly) throw new SetupError(405, 'READ_ONLY', 'This console was started with --read-only; it runs no agent probes.');
    clearDetectionCache();
    const found = await detectProviders({ env: this.env, claude: claudeIncluded(), maxAgeMs: 0 });
    const codex = found.codex;
    let login = { loggedIn: false, method: null, checked: false };
    if (codex.codex?.path) {
      const parsed = parseLoginStatus(await run(codex.codex.path, ['login', 'status'], { env: { ...setupEnvironment(this.env) } }));
      login = { ...parsed, checked: !parsed.unknown };
    }
    this.login = login;
    const npmInfo = await npmGlobal(this.env);
    const claudeBin = found.claude?.claude?.path ?? (await which('claude', this.env));
    let claudeVersion = found.claude?.claude?.version ?? null;
    if (claudeBin && !claudeVersion) claudeVersion = (parseVersion((await run(claudeBin, ['--version'], { env: setupEnvironment(this.env) })).stdout) ?? []).join('.') || null;
    return {
      platform: process.platform,
      supportedPlatform: ['linux', 'darwin'].includes(process.platform),
      node: process.versions.node,
      npm: { found: Boolean(npmInfo.npm), prefix: npmInfo.prefix, writable: npmInfo.writable },
      codex: {
        cli: codex.codex ? { version: codex.codex.version } : null,
        adapter: codex.adapter ? { version: codex.adapter.version } : null,
        problems: codex.problems,
        login: { loggedIn: login.loggedIn, method: login.method, checked: login.checked, subscription: login.method === 'chatgpt' },
        installed: Boolean(codex.codex && codex.adapter && !codex.problems.length),
        ready: Boolean(codex.ready && login.method === 'chatgpt'),
        install: installPlan(codex, npmInfo),
        // What this release was tested with, and whether the installed parts match it.
        tested: { cli: TESTED_CODEX.cli.version, adapter: TESTED_CODEX.adapter.version, testedAt: TESTED_CODEX.testedAt, compatible: pinnedCompatible() },
        matchesTested: Boolean(codex.codex?.version === TESTED_CODEX.cli.version && codex.adapter?.version === TESTED_CODEX.adapter.version),
        verified: this.verified
      },
      claude: {
        installed: Boolean(claudeBin),
        version: claudeVersion,
        // Published releases do not include the experimental connection (experimental.js).
        connectionIncluded: claudeIncluded(),
        ...(found.claude ? { ready: Boolean(found.claude.ready), problems: found.claude.problems, warnings: found.claude.warnings ?? [], auth: found.claude.auth ? { loggedIn: Boolean(found.claude.auth.loggedIn), method: found.claude.auth.method, plan: found.claude.auth.plan } : null } : {})
      },
      job: this.jobView()
    };
  }

  jobView() {
    if (!this.job) return null;
    const { id, kind, state, tail, url, code, startedAt, endedAt, exit, message } = this.job;
    return { id, kind, state, tail, url, code, startedAt, endedAt, exit, message: message ?? null };
  }

  // One setup step at a time, from the moment it is accepted (not only once its process runs),
  // and until a cancelled process has really ended.
  busy() {
    if (this.pending || ['running', 'cancelling'].includes(this.job?.state)) throw new SetupError(409, 'SETUP_BUSY', 'Another setup step is still running. Wait for it, or cancel it.');
  }

  async exclusive(kind, fn) {
    this.busy();
    this.pending = kind;
    try { return await fn(); } finally { this.pending = null; }
  }

  // Ends the child and everything it started (its own process group): SIGTERM, then SIGKILL.
  terminate(job) {
    const pid = job.child?.pid;
    if (!pid) return;
    const signal = (sig) => { try { process.kill(-pid, sig); } catch { try { job.child?.kill(sig); } catch { /* gone */ } } };
    signal('SIGTERM');
    const force = setTimeout(() => { if (job.child) signal('SIGKILL'); }, 5000);
    force.unref();
  }

  startJob(kind, file, args, { timeoutMs, onLine = null, env }) {
    const job = { id: randomBytes(6).toString('hex'), kind, state: 'running', tail: '', url: null, code: null, startedAt: new Date().toISOString(), endedAt: null, exit: null };
    // Its own process group, so a cancel or timeout also ends what npm or codex started.
    const child = spawn(file, args, { env, shell: false, detached: true, stdio: ['ignore', 'pipe', 'pipe'], cwd: os.homedir() });
    job.child = child;
    const timer = setTimeout(() => { job.message = 'timed out'; job.state = 'cancelling'; this.terminate(job); }, timeoutMs);
    timer.unref();
    const take = (chunk) => {
      // Terminal escapes (colours, OSC hyperlinks) and other control characters are removed.
      const text = redactSecrets(String(chunk)).replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, '').replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '');
      job.tail = (job.tail + text).slice(-TAIL_BYTES);
      if (onLine) onLine(job);
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    child.on('error', (error) => { job.message = String(error.message); });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      job.exit = code ?? signal ?? null;
      job.state = code === 0 && job.state === 'running' ? 'done' : job.state === 'cancelling' && !job.message ? 'cancelled' : 'failed';
      job.endedAt = new Date().toISOString();
      delete job.child;
      clearDetectionCache();
    });
    this.job = job;
    return this.jobView();
  }

  async install(body) {
    if (this.readOnly) throw new SetupError(405, 'READ_ONLY', 'This console was started with --read-only.');
    if (body?.confirm !== true || typeof body.planHash !== 'string') throw new SetupError(400, 'CONFIRMATION_REQUIRED', 'Review the command and confirm it first.');
    return this.exclusive('install', async () => {
    const current = await this.status();
    const plan = current.codex.install;
    if (!plan) throw new SetupError(409, 'NOTHING_TO_INSTALL', 'Codex and its adapter are already installed.');
    if (plan.planHash !== body.planHash) throw Object.assign(new SetupError(409, 'PLAN_CHANGED', 'What needs installing changed. Review the command again.'), { extra: { status: current } });
    if (!plan.writable) throw Object.assign(new SetupError(409, 'NPM_PREFIX_NOT_WRITABLE', `npm installs global packages into ${plan.prefix}, which this user cannot write. YallaFlow never uses sudo. Run the command yourself with a Node.js installed for your user (for example through nvm), or set an npm prefix in your home folder.`), { extra: { status: current } });
    const npm = await which('npm', this.env);
    return this.startJob('install', npm, plan.argv.slice(1), { timeoutMs: INSTALL_TIMEOUT_MS, env: setupEnvironment(this.env) });
    });
  }

  async signIn(body) {
    if (this.readOnly) throw new SetupError(405, 'READ_ONLY', 'This console was started with --read-only.');
    if (body?.confirm !== true) throw new SetupError(400, 'CONFIRMATION_REQUIRED', 'Confirm starting Codex\'s own sign-in.');
    return this.exclusive('login', async () => {
    const found = await detectProviders({ env: this.env, maxAgeMs: 0 });
    const codex = found.codex.codex?.path;
    if (!codex) throw new SetupError(409, 'CODEX_MISSING', 'Install Codex first.');
    // Codex's device sign-in prints an official link and a one-time code; the developer
    // completes it in the browser. Only those two are picked out of the output.
    return this.startJob('login', codex, ['login', '--device-auth'], {
      timeoutMs: LOGIN_TIMEOUT_MS,
      env: setupEnvironment(this.env),
      // Read from the whole output so far, so a link split across chunks is never kept half-way.
      onLine: (job) => {
        job.url = /https:\/\/[^\s"'<>]+(?=\s)/.exec(job.tail)?.[0]?.replace(/[).,]+$/, '') ?? null;
        job.code = /\b([A-Z0-9]{4,5}-[A-Z0-9]{4,5})\b/.exec(job.tail)?.[1] ?? null;
      }
    });
    });
  }

  cancel() {
    if (this.job?.state !== 'running') return this.jobView();
    this.job.state = 'cancelling'; // still busy until the process has ended
    this.terminate(this.job);
    return this.jobView();
  }

  // Proves the connection: the adapter starts, answers ACP initialize and reports a ChatGPT
  // account login. No session is created and nothing runs in a project.
  async verify() {
    if (this.readOnly) throw new SetupError(405, 'READ_ONLY', 'This console was started with --read-only.');
    return this.exclusive('verify', async () => {
    clearDetectionCache();
    const found = await detectProviders({ env: this.env, maxAgeMs: 0 });
    if (!found.codex.ready) throw new SetupError(409, 'CODEX_NOT_INSTALLED', found.codex.problems.join(' ') || 'Codex is not installed.');
    const scratch = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-codex-check-'));
    const session = new CodexSession({ root: scratch, detection: found.codex, emit: () => {}, askPermission: async () => 'deny', env: this.env });
    const at = new Date().toISOString();
    try {
      session.spawnAdapter();
      await session.handshake();
      this.verified = { ok: true, at, auth: { kind: session.auth?.kind ?? null, label: session.auth?.label ?? null } };
    } catch (error) {
      this.verified = { ok: false, at, code: error.code ?? 'CONNECTION_FAILED', message: String(error.message).slice(0, 300) };
    } finally {
      const cleanup = await session.end().catch(() => null);
      if (this.verified) this.verified.cleanup = cleanup ? { complete: Boolean(cleanup.complete), survivors: cleanup.survivors?.length ?? 0 } : null;
      await rm(scratch, { recursive: true, force: true });
    }
    return this.verified;
    });
  }

  // For readiness: a known non-subscription login makes the agent not ready.
  loginProblem() {
    if (!this.login?.checked) return null;
    if (!this.login.loggedIn) return 'Codex is not signed in. Sign in with your ChatGPT subscription.';
    if (this.login.method === 'api-key') return 'Codex is signed in with an API key. YallaFlow uses only a ChatGPT subscription sign-in.';
    return null;
  }

  close() {
    if (['running', 'cancelling'].includes(this.job?.state)) this.terminate(this.job);
  }
}
