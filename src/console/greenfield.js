// Console Greenfield journey (1.4.0, PF-0057): tool checks, project registration after
// creation, Git init, guided runtime service setup and the wizard's attachments.
//
// Every write here is narrow and explicit:
// - registration only adds a folder that already holds a YallaFlow workspace to the
//   user-level console list (the same file `yallaflow console add` writes);
// - Git init runs `git init --quiet` (argv, no shell) in a registered project that is not
//   inside any Git working tree, and never adds a remote or a commit;
// - runtime setup runs Core's own `yallaflow runtime add` (nothing starts; trust stays a
//   separate, typed decision);
// - attachments run Core's `yallaflow intake add` on the plan's first work item, only for
//   files whose size and SHA-256 the reviewed plan lists.
import { execFile } from 'node:child_process';
import { lstat, realpath, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { HttpError, UPLOAD_EXTENSIONS, availabilityOf, linkedSourceWithHash, readMeta, receiveFile, safeFileName } from './create.js';
import { isServiceId } from './runtime.js';
import { loadRuntimeProfiles } from '../runtime/profile.js';
import { loadPlan } from '../newproject/project.js';
import { ENVIRONMENTS, GIT_INIT_ARGV } from '../newproject/project.js';

const TOOL_TIMEOUT_MS = 5000;
const SAFE_ENV = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'USER', 'LOGNAME', 'TMPDIR', 'TZ'];
const scrubbed = () => Object.fromEntries(SAFE_ENV.filter((name) => typeof process.env[name] === 'string').map((name) => [name, process.env[name]]));

function runQuiet(file, args, { cwd = os.homedir() } = {}) {
  return new Promise((resolve) => {
    execFile(file, args, { cwd, env: scrubbed(), timeout: TOOL_TIMEOUT_MS, maxBuffer: 256 * 1024, shell: false }, (error, stdout, stderr) => {
      resolve({ ok: !error, code: error?.code ?? 0, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
    });
  });
}

// Tools the environment step mentions; each is probed with its own version flag only.
// Nothing is installed or started.
const TOOLS = Object.freeze([
  { id: 'git', argv: ['git', '--version'] },
  { id: 'docker', argv: ['docker', '--version'] },
  { id: 'docker-compose', argv: ['docker', 'compose', 'version'] },
  { id: 'node', argv: ['node', '--version'] },
  { id: 'npm', argv: ['npm', '--version'] },
  { id: 'php', argv: ['php', '--version'] },
  { id: 'composer', argv: ['composer', '--no-plugins', '--version'] }
]);
let toolCache = null;

export async function probeTools({ maxAgeMs = 30_000 } = {}) {
  if (toolCache && Date.now() - toolCache.at < maxAgeMs) return toolCache.value;
  const tools = await Promise.all(TOOLS.map(async (tool) => {
    const result = await runQuiet(tool.argv[0], tool.argv.slice(1));
    const version = result.ok ? `${result.stdout}`.split('\n').map((line) => line.trim()).find((line) => /\d/.test(line)) ?? '' : '';
    return { id: tool.id, found: result.ok, version: version.slice(0, 120) };
  }));
  const value = { tools, checkedAt: new Date().toISOString(), environments: ENVIRONMENTS };
  toolCache = { at: Date.now(), value };
  return value;
}

// A folder qualifies for registration only when it is a real directory holding a real
// .yallaflow directory (no symbolic links at either level).
export async function workspaceRoot(candidate) {
  let real;
  try {
    real = await realpath(candidate);
  } catch {
    throw new HttpError(404, 'NOT_FOUND', 'That folder does not exist.');
  }
  const info = await lstat(real);
  const ws = await lstat(path.join(real, '.yallaflow')).catch(() => null);
  if (!info.isDirectory() || !ws || ws.isSymbolicLink() || !ws.isDirectory()) {
    throw new HttpError(422, 'NOT_A_YALLAFLOW_PROJECT', 'That folder has no YallaFlow workspace yet. An existing repository is set up through Brownfield onboarding (yallaflow init, then the project baseline), which is a separate step.');
  }
  return real;
}

// The project a finished plan created (identity-checked against the folder it claimed).
export async function createdProjectRoot(planId) {
  let plan;
  try {
    plan = await loadPlan(planId);
  } catch (error) {
    throw new HttpError(404, error.code ?? 'NEW_PROJECT_PLAN', error.message);
  }
  const promote = plan.progress.steps.promote;
  if (plan.progress.steps.init?.status !== 'done' || promote?.status !== 'done') throw new HttpError(409, 'NEW_PROJECT_NOT_CREATED', 'This plan has not created its project yet.');
  const now = await lstat(plan.body.destination).catch(() => null);
  if (!now || now.isSymbolicLink() || !now.isDirectory() || now.dev !== promote.dev || now.ino !== promote.ino) {
    throw new HttpError(409, 'NEW_PROJECT_DESTINATION_CHANGED', `${plan.body.destination} is no longer the folder this plan created.`);
  }
  return { plan, root: await workspaceRoot(plan.body.destination) };
}

export async function gitInit(root) {
  const inside = await runQuiet('git', ['rev-parse', '--is-inside-work-tree'], { cwd: root });
  if (inside.ok && inside.stdout.trim() === 'true') throw new HttpError(409, 'GIT_EXISTS', 'This project is already inside a Git repository; nothing was changed.');
  const present = await lstat(path.join(root, '.git')).catch(() => null);
  if (present) throw new HttpError(409, 'GIT_EXISTS', 'This project already has a .git entry; nothing was changed.');
  const result = await runQuiet(GIT_INIT_ARGV[0], GIT_INIT_ARGV.slice(1), { cwd: root });
  if (!result.ok) throw new HttpError(422, 'GIT_INIT_FAILED', `git init failed: ${(result.stderr || result.stdout).trim().split('\n')[0] || `exit ${result.code}`}`);
  return { initialized: true, remote: false, commit: false };
}

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const RUNTIME_FIELDS = ['fromSuggestion', 'id', 'name', 'kind', 'cwd', 'ports', 'env', 'readyPort', 'readyLog', 'local', 'argv'];

// Builds `yallaflow runtime add …` from a validated request. Values are passed as
// --option=value so none can be read as another option; the command follows `--`.
export function runtimeAddArgs(body, { override = false } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'BAD_REQUEST', 'Send a JSON object.');
  const extra = Object.keys(body).filter((key) => !RUNTIME_FIELDS.includes(key));
  if (extra.length) throw new HttpError(400, 'BAD_REQUEST', `Unexpected field(s): ${extra.join(', ')}.`);
  const local = body.local === true;
  if ('local' in body && typeof body.local !== 'boolean') throw new HttpError(400, 'BAD_REQUEST', 'local must be true or false.');
  if ('fromSuggestion' in body) {
    if (Object.keys(body).some((key) => !['fromSuggestion', 'local'].includes(key))) throw new HttpError(400, 'BAD_REQUEST', 'A suggestion is added as it is; edit the service afterwards if needed.');
    if (typeof body.fromSuggestion !== 'string' && !Number.isInteger(body.fromSuggestion)) throw new HttpError(400, 'BAD_REQUEST', 'Unknown suggestion.');
    const ref = String(body.fromSuggestion);
    if (!/^(?:\d{1,3}|[a-z][a-z0-9-]{0,31})$/.test(ref)) throw new HttpError(400, 'BAD_REQUEST', 'Unknown suggestion.');
    return ['runtime', 'add', `--from-suggestion=${ref}`, ...(local ? ['--local'] : [])];
  }
  if (!isServiceId(body.id)) throw new HttpError(400, 'BAD_REQUEST', 'The service id must start with a letter and use lowercase letters, digits and dashes (up to 32).');
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 60 || /[\u0000-\u001f\u007f]/.test(name)) throw new HttpError(400, 'BAD_REQUEST', 'Give the service a name (up to 60 characters).');
  if (!['process', 'docker-compose'].includes(body.kind)) throw new HttpError(400, 'BAD_REQUEST', 'The kind must be process or docker-compose.');
  const cwd = typeof body.cwd === 'string' && body.cwd.trim() ? body.cwd.trim() : '.';
  if (cwd.length > 300 || cwd.includes('\0')) throw new HttpError(400, 'BAD_REQUEST', 'The working folder is invalid.');
  const list = (value, label) => {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > 10) throw new HttpError(400, 'BAD_REQUEST', `${label} must be a list (up to 10).`);
    return value;
  };
  const ports = list(body.ports, 'ports').map((port) => {
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new HttpError(400, 'BAD_REQUEST', 'Each port must be a number from 1 to 65535.');
    return `--port=${port}`;
  });
  const env = list(body.env, 'env').map((entry) => {
    if (typeof entry !== 'string' || !ENV_NAME.test(entry)) throw new HttpError(400, 'BAD_REQUEST', 'Environment entries are variable names only (values stay in your environment or .env).');
    return `--env=${entry}`;
  });
  const ready = [];
  if (body.readyPort !== undefined && body.readyPort !== null) {
    if (!Number.isInteger(body.readyPort) || body.readyPort < 1 || body.readyPort > 65535) throw new HttpError(400, 'BAD_REQUEST', 'The ready port must be a number from 1 to 65535.');
    ready.push(`--ready-port=${body.readyPort}`);
  }
  if (body.readyLog !== undefined && body.readyLog !== null && body.readyLog !== '') {
    if (ready.length) throw new HttpError(400, 'BAD_REQUEST', 'Choose a ready port or a ready log line, not both.');
    if (typeof body.readyLog !== 'string' || body.readyLog.length > 200 || /[\u0000-\u001f\u007f]/.test(body.readyLog)) throw new HttpError(400, 'BAD_REQUEST', 'The ready log line must be plain text up to 200 characters.');
    ready.push(`--ready-log=${body.readyLog}`);
  }
  const argv = list(body.argv, 'argv');
  if (!argv.length || argv.some((part) => typeof part !== 'string' || !part || part.length > 1000 || part.includes('\0'))) throw new HttpError(400, 'BAD_REQUEST', 'Give the command as an executable and its arguments.');
  if (argv[0].startsWith('-')) throw new HttpError(400, 'BAD_REQUEST', 'The command must start with a program, not an option.');
  // A this-machine override of a shared service keeps the shared kind (Core refuses --kind).
  return ['runtime', 'add', body.id, `--name=${name}`, ...(override ? [] : [`--kind=${body.kind}`]), `--cwd=${cwd}`, ...ports, ...env, ...ready, ...(local ? ['--local'] : []), '--', ...argv];
}

export async function addRuntimeService(root, body, runner) {
  let override = false;
  if (body && body.local === true && isServiceId(body.id)) {
    const profiles = await loadRuntimeProfiles(root).catch(() => null);
    override = Boolean(profiles?.shared?.services?.some((entry) => entry.id === body.id));
  }
  const args = runtimeAddArgs(body, { override });
  const result = await runner.write(root, args);
  if (result.status !== 0) throw new HttpError(422, 'RUNTIME_REFUSED', (result.stderr || result.stdout).trim().split('\n').filter(Boolean).slice(0, 4).join('\n') || 'The service was not added.');
  return { added: true, output: result.stdout.trim().split('\n').filter(Boolean).slice(0, 6) };
}

// POST /api/new/plans/<id>/files: one file the reviewed plan lists, linked to the
// plan's first work item through Core intake. Refused before the project exists, for any
// file the plan does not list (by size and SHA-256), and for a second copy.
export async function attachPlannedFile(planId, request, runner) {
  const { plan, root } = await createdProjectRoot(planId);
  const workId = plan.progress.steps['first-work']?.status === 'done' ? plan.progress.steps['first-work'].workId : null;
  if (!workId) throw new HttpError(409, 'NEW_PROJECT_NOT_CREATED', 'The first work item does not exist yet.');
  const name = safeFileName(request.headers['x-file-name']);
  const ext = path.extname(name).toLowerCase();
  if (!name || !ext || name === ext || !UPLOAD_EXTENSIONS.includes(ext)) throw new HttpError(415, 'UNSUPPORTED_FILE', `${ext || 'This'} file cannot be attached. Supported: ${UPLOAD_EXTENSIONS.join(' ')}.`);
  const listed = plan.body.attachments ?? [];
  const declared = Number(request.headers['content-length']);
  if (!listed.length) throw new HttpError(409, 'NOT_PLANNED', 'This plan lists no attachments.');
  if (Number.isFinite(declared) && !listed.some((entry) => entry.size === declared)) throw new HttpError(409, 'NOT_PLANNED', `${name} is not one of the files reviewed in the plan.`);
  const received = await receiveFile(request, name);
  try {
    const match = listed.find((entry) => entry.sha256 === received.sha256 && entry.size === received.size);
    if (!match) throw new HttpError(409, 'NOT_PLANNED', `${name} does not match any file reviewed in the plan (its contents changed or it is a different file).`);
    const outcome = await runner.exclusive(root, async (exec) => {
      const existing = await linkedSourceWithHash(root, await readMeta(root, workId), received.sha256);
      if (existing) return { existing };
      return { result: await exec(['intake', 'add', workId, received.file, '--via', 'console']) };
    });
    if (outcome.existing) return { source: outcome.existing, name, workId, duplicate: true, ...(await availabilityOf(root, outcome.existing)) };
    if (outcome.result.status !== 0) throw new HttpError(422, 'ATTACH_REFUSED', (outcome.result.stderr || outcome.result.stdout).trim().split('\n')[0] || 'The file was not attached.');
    const source = /Sources? captured: (\S+)/.exec(outcome.result.stdout)?.[1] ?? null;
    return { source, name, workId, duplicate: false, ...(await availabilityOf(root, source)) };
  } finally {
    await rm(received.dir, { recursive: true, force: true });
  }
}

export async function isDirectory(file) {
  try { return (await stat(file)).isDirectory(); } catch { return false; }
}
