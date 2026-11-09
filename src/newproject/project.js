// New Project Wizard (1.4.0): plan → review → staged creation → Core init → first work.
//
// - A plan is an immutable record in the user's config folder (never in a repository),
//   identified by the SHA-256 of its canonical content. Creation needs that hash prefix
//   as confirmation, and re-derives the command from the catalog: a plan file edited by
//   anything else cannot run a different command.
// - The generator runs in a fresh staging folder next to the destination (argv, no shell,
//   scrubbed environment, own process group, time limit). Its output is renamed into the
//   destination only if the destination is still absent. Existing paths are never
//   overwritten, and a failure keeps staging with its log for diagnosis.
// - The project is initialized by Core (initProject) with wizard provenance, then a first
//   work item is created through Core for the developer to continue with their agent.
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { access, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { registryPath } from '../console/registry.js';
import { redactSecrets } from '../security/redact.js';
import { safeLocalDir, safeWriteFile } from '../agents/local-files.js';
import { CATALOG, CATALOG_VERSION, catalogEntry } from './catalog.js';

export const PLAN_SCHEMA = 'yallaflow.new-project-plan/1';
export const PROJECT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const STAGING_PREFIX = '.yallaflow-new-';
const GENERATOR_TIMEOUT_MS = 15 * 60 * 1000;
const PREREQ_TIMEOUT_MS = 5000;
const RATIONALE_MAX = 2000;
const DESCRIPTION_MAX = 4000;
// PF-0087: a stack the developer names that is not in the catalog. Only with the empty
// project: nothing runs for it; the first work item asks the agent to set it up.
const CUSTOM_STACK_MAX = 120;
const REQUIREMENTS_MAX = 16000;
const ATTACHMENTS_MAX = 10;
export const ENVIRONMENTS = Object.freeze(['docker', 'local', 'later']);
export const GIT_INIT_ARGV = Object.freeze(['git', 'init', '--quiet']);
const SAFE_ENV = Object.freeze(['PATH', 'HOME', 'LANG', 'LC_ALL', 'TERM', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'TZ', 'npm_config_cache', 'npm_config_registry', 'COMPOSER_HOME', 'COMPOSER_CACHE_DIR', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'https_proxy', 'http_proxy', 'no_proxy']);

export class NewProjectError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.code = code;
    Object.assign(this, details);
  }
}

export function plansDir(env = process.env) {
  return path.join(path.dirname(registryPath(env)), 'new-projects');
}

const exists = async (file) => { try { await lstat(file); return true; } catch { return false; } };

// Walks up from dir: is any ancestor (or dir) a YallaFlow workspace or a Git working tree?
async function enclosingRepository(dir) {
  let current = dir;
  for (;;) {
    if (await exists(path.join(current, '.yallaflow'))) return { kind: 'YallaFlow workspace', at: current };
    if (await exists(path.join(current, '.git'))) return { kind: 'Git repository', at: current };
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}
export function planHash(body) {
  return createHash('sha256').update(JSON.stringify(canonical(body))).digest('hex');
}

function probePrerequisite(prereq) {
  const result = spawnSync(prereq.argv[0], prereq.argv.slice(1), { encoding: 'utf8', timeout: PREREQ_TIMEOUT_MS, shell: false, env: scrubbedEnv() });
  if (result.error || result.status !== 0) return { name: prereq.name, found: false, note: prereq.note ?? null };
  const version = `${result.stdout}`.split('\n').map((line) => line.trim()).find((line) => /\d/.test(line)) ?? '';
  return { name: prereq.name, found: true, version: version.slice(0, 120), note: prereq.note ?? null };
}

function scrubbedEnv(source = process.env) {
  const env = {};
  for (const name of SAFE_ENV) if (typeof source[name] === 'string') env[name] = source[name];
  return env;
}

// Validates the request and writes an immutable plan. Nothing is created or executed
// except prerequisite `--version` probes.
export async function createPlan(input, { catalog = CATALOG, env = process.env, now = new Date().toISOString() } = {}) {
  const { name, parent, stack, install = false, allowNested = false, rationale = null, description = null, requirements = null, environment = null, git = false, attachments = [], customStack = null } = input ?? {};
  if (typeof name !== 'string' || !PROJECT_NAME.test(name) || name === '.' || name === '..') throw new NewProjectError('NEW_PROJECT_NAME', 'The project name must be 1-64 characters: letters, digits, dot, dash or underscore, starting with a letter or digit.');
  const entry = catalogEntry(stack, catalog);
  if (!entry) throw new NewProjectError('NEW_PROJECT_STACK', `Unknown stack ${JSON.stringify(stack)}. See \`yallaflow new catalog\`.`);
  if (typeof parent !== 'string' || !parent.trim() || !path.isAbsolute(parent)) throw new NewProjectError('NEW_PROJECT_PARENT', 'The parent folder must be an absolute path.');
  if (customStack !== null && (typeof customStack !== 'string' || !customStack.trim() || customStack.length > CUSTOM_STACK_MAX || /[\u0000-\u001f\u007f]/.test(customStack))) throw new NewProjectError('NEW_PROJECT_CUSTOM_STACK', `The stack you name must be one line of text up to ${CUSTOM_STACK_MAX} characters.`);
  if (customStack !== null && entry.generator) throw new NewProjectError('NEW_PROJECT_CUSTOM_STACK', 'A stack you name yourself goes with the empty project (--stack empty): nothing is generated for it.');
  const custom = customStack === null ? null : customStack.trim();
  if (install && !entry.install) throw new NewProjectError('NEW_PROJECT_INSTALL', `${entry.label} has no separate dependency install step${entry.installsDependencies ? ' (its generator installs dependencies itself)' : ''}.`);
  if (rationale !== null && (typeof rationale !== 'string' || rationale.length > RATIONALE_MAX)) throw new NewProjectError('NEW_PROJECT_RATIONALE', `The rationale must be text up to ${RATIONALE_MAX} characters.`);
  const intent = validateIntent(description, requirements);
  if (environment !== null && !ENVIRONMENTS.includes(environment)) throw new NewProjectError('NEW_PROJECT_ENVIRONMENT', `The environment must be one of: ${ENVIRONMENTS.join(', ')}.`);
  if (typeof git !== 'boolean') throw new NewProjectError('NEW_PROJECT_GIT', 'git must be true or false.');
  const planned = validateAttachments(attachments);
  let realParent;
  try {
    realParent = await realpath(parent);
  } catch {
    throw new NewProjectError('NEW_PROJECT_PARENT', `The parent folder ${parent} does not exist.`);
  }
  if (!(await stat(realParent)).isDirectory()) throw new NewProjectError('NEW_PROJECT_PARENT', `${parent} is not a folder.`);
  try {
    await access(realParent, constants.W_OK);
  } catch {
    throw new NewProjectError('NEW_PROJECT_PARENT', `You cannot write to ${parent}.`);
  }
  const destination = path.join(realParent, name);
  if (await exists(destination)) throw new NewProjectError('NEW_PROJECT_EXISTS', `${destination} already exists. The wizard only creates a new folder; it never overwrites or re-labels an existing project.`);
  const nested = await enclosingRepository(realParent);
  if (nested && !allowNested) throw new NewProjectError('NEW_PROJECT_NESTED', `${realParent} is inside a ${nested.kind} (${nested.at}). Choose another parent folder, or pass --allow-nested if a nested project is intended.`);
  if (git && nested) throw new NewProjectError('NEW_PROJECT_GIT_NESTED', `${realParent} is inside a ${nested.kind} (${nested.at}); a new Git repository is not created inside another one. Leave Git off, or choose another parent folder.`);

  const steps = [];
  if (entry.argv) steps.push({ id: 'generate', argv: entry.argv(name), cwd: '<staging>', network: entry.network, installsDependencies: entry.installsDependencies, runsPackageScripts: entry.runsPackageScripts });
  else steps.push({ id: 'generate', argv: null, cwd: '<staging>', network: false, installsDependencies: false, runsPackageScripts: false, note: 'create an empty project folder (no command runs)' });
  steps.push({ id: 'promote', argv: null, note: entry.argv ? `move the generated project into ${destination} only if it is still absent` : `create the project folder ${destination} only if it is still absent` });
  if (install && entry.install) steps.push({ id: 'install', argv: entry.install, cwd: destination, network: true, installsDependencies: true, runsPackageScripts: true });
  steps.push({ id: 'init', argv: null, note: `YallaFlow Core init (--type greenfield) with wizard provenance` });
  if (git) steps.push({ id: 'git-init', argv: [...GIT_INIT_ARGV], cwd: destination, network: false, installsDependencies: false, runsPackageScripts: false, note: 'a new local Git repository: no remote, no commit' });
  steps.push({ id: 'first-work', argv: null, note: 'YallaFlow Core start --keep-active: a first work item with your description (not activated)' });
  if (planned.length) steps.push({ id: 'link-files', argv: null, note: `link ${planned.length} attached file(s) to the first work item; each must match its SHA-256 below` });

  const body = {
    schema: PLAN_SCHEMA,
    catalogVersion: CATALOG_VERSION,
    createdAt: now,
    name,
    parent: realParent,
    destination,
    stack: entry.id,
    stackLabel: custom ? `${custom} (${entry.label})` : entry.label,
    technologies: custom ? [custom] : entry.stack,
    generator: entry.generator,
    install: Boolean(install && entry.install),
    allowNested: Boolean(allowNested && nested),
    nestedIn: nested ? nested.at : null,
    prerequisites: entry.prerequisites.map(probePrerequisite),
    expectedStructure: entry.structure,
    network: steps.some((step) => step.network),
    executesExternalCommands: steps.some((step) => Array.isArray(step.argv)),
    steps,
    rationale: rationale ? String(rationale).trim() : null,
    docs: entry.docs,
    // PF-0057 (all optional; older plans simply lack them).
    intent,
    environment,
    git,
    attachments: planned,
    ...(custom ? { customStack: custom } : {})
  };
  const hash = planHash(body);
  const id = `NP-${now.replace(/[-:TZ.]/g, '').slice(0, 14)}-${randomBytes(3).toString('hex')}`;
  const plan = { id, hash, body, progress: { steps: {}, staging: null, log: null } };
  await savePlan(plan, env);
  return plan;
}

async function privatePlansDir(env) {
  const dir = plansDir(env);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const info = await lstat(dir);
  if (info.isSymbolicLink() || !info.isDirectory() || (typeof process.getuid === 'function' && info.uid !== process.getuid())) throw new NewProjectError('NEW_PROJECT_STORE_UNSAFE', `The plan folder ${dir} is not a private folder of this user; refusing to use it.`);
  return dir;
}

async function savePlan(plan, env = process.env) {
  const dir = await privatePlansDir(env);
  const file = path.join(dir, `${plan.id}.json`);
  const temp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(temp, `${JSON.stringify(plan, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  await rename(temp, file);
}

export async function loadPlan(id, env = process.env) {
  if (!/^NP-\d{14}-[0-9a-f]{6}$/.test(String(id))) throw new NewProjectError('NEW_PROJECT_PLAN', `${id} is not a plan id.`);
  let plan;
  try {
    plan = JSON.parse(await readFile(path.join(plansDir(env), `${id}.json`), 'utf8'));
  } catch {
    throw new NewProjectError('NEW_PROJECT_PLAN', `No plan ${id}. Create one with \`yallaflow new plan\`.`);
  }
  if (planHash(plan.body) !== plan.hash) throw new NewProjectError('NEW_PROJECT_PLAN_TAMPERED', `Plan ${id} no longer matches its hash; it was changed after it was created. Create a new plan.`);
  return plan;
}

export async function listPlans(env = process.env) {
  let names = [];
  try { names = (await readdir(plansDir(env))).filter((name) => /^NP-\d{14}-[0-9a-f]{6}\.json$/.test(name)).sort().reverse(); } catch { return []; }
  const plans = [];
  for (const name of names.slice(0, 50)) {
    try { plans.push(await loadPlan(name.replace(/\.json$/, ''), env)); } catch { /* skip unreadable */ }
  }
  return plans;
}

// The command must still be exactly what the catalog derives for this plan.
function verifyAgainstCatalog(plan, catalog) {
  const entry = catalogEntry(plan.body.stack, catalog);
  if (!entry) throw new NewProjectError('NEW_PROJECT_PLAN_TAMPERED', `Plan ${plan.id} names a stack that is not in this version's catalog.`);
  const generate = plan.body.steps.find((step) => step.id === 'generate');
  const expected = entry.argv ? entry.argv(plan.body.name) : null;
  if (JSON.stringify(generate?.argv ?? null) !== JSON.stringify(expected)) throw new NewProjectError('NEW_PROJECT_PLAN_TAMPERED', `Plan ${plan.id}'s command does not match the catalog; create a new plan.`);
  const gitInit = plan.body.steps.find((step) => step.id === 'git-init');
  if (gitInit && (JSON.stringify(gitInit.argv) !== JSON.stringify(GIT_INIT_ARGV) || plan.body.git !== true)) throw new NewProjectError('NEW_PROJECT_PLAN_TAMPERED', `Plan ${plan.id}'s Git step does not match this version.`);
  const install = plan.body.steps.find((step) => step.id === 'install');
  if (install && JSON.stringify(install.argv) !== JSON.stringify(entry.install)) throw new NewProjectError('NEW_PROJECT_PLAN_TAMPERED', `Plan ${plan.id}'s install command does not match the catalog.`);
  if (!PROJECT_NAME.test(plan.body.name) || path.join(plan.body.parent, plan.body.name) !== plan.body.destination) throw new NewProjectError('NEW_PROJECT_PLAN_TAMPERED', `Plan ${plan.id}'s destination is inconsistent.`);
  return entry;
}

function runLogged(argv, cwd, logFile, timeoutMs) {
  return new Promise((resolve) => {
    open(logFile, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | (constants.O_NOFOLLOW ?? 0), 0o600).then(async (log) => {
      await log.write(`\n$ ${argv.join(' ')}\n`);
      let child;
      try {
        child = spawn(argv[0], argv.slice(1), { cwd, env: { ...scrubbedEnv(), CI: '1' }, shell: false, detached: process.platform !== 'win32', stdio: ['ignore', log.fd, log.fd] });
      } catch (error) {
        await log.close();
        return resolve({ code: null, error: error.message });
      }
      const timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }, timeoutMs);
      child.once('error', async (error) => { clearTimeout(timer); await log.close(); resolve({ code: null, error: error.code === 'ENOENT' ? `${argv[0]} was not found on PATH` : error.message }); });
      child.once('exit', async (code, signal) => { clearTimeout(timer); await log.write(`\n[exit ${code ?? signal}]\n`); await log.close(); resolve({ code, signal, timedOut: signal === 'SIGKILL' }); });
    }, (error) => resolve({ code: null, error: error.message }));
  });
}

async function logTail(file, lines = 40) {
  try {
    const text = await readFile(file, 'utf8');
    return text.split(/\r?\n/).slice(-lines).map((line) => redactSecrets(line)).join('\n');
  } catch {
    return '';
  }
}

// Executes a reviewed plan. `confirm` must be a prefix (>= 8 hex chars) of the plan hash.
// hooks.initProject / hooks.firstWork are Core entry points (injected so the CLI module
// graph stays acyclic).
export async function createFromPlan(id, confirm, { catalog = CATALOG, env = process.env, hooks, onStep = () => {} } = {}) {
  const plan = await loadPlan(id, env);
  if (typeof confirm !== 'string' || confirm.length < 8 || !plan.hash.startsWith(confirm.toLowerCase())) throw new NewProjectError('NEW_PROJECT_CONFIRM', `Confirm the reviewed plan with the first 8 or more characters of its hash (${plan.hash.slice(0, 8)}…).`);
  const entry = verifyAgainstCatalog(plan, catalog);
  const { body, progress } = plan;
  const done = (step) => progress.steps[step]?.status === 'done';
  const mark = async (step, status, extra = {}) => { progress.steps[step] = { status, at: new Date().toISOString(), ...extra }; await savePlan(plan, env); onStep(step, status); };

  if (!done('promote')) {
    if (await exists(body.destination)) throw new NewProjectError('NEW_PROJECT_EXISTS', `${body.destination} exists now. Nothing was created or changed; the wizard never overwrites an existing folder.`);
    const realParent = await realpath(body.parent).catch(() => null);
    if (realParent !== body.parent) throw new NewProjectError('NEW_PROJECT_PARENT', `The parent folder ${body.parent} changed or disappeared since the plan; create a new plan.`);
    const staging = await mkdtemp(path.join(body.parent, STAGING_PREFIX));
    const log = path.join(staging, 'yallaflow-new.log');
    progress.staging = staging; progress.log = log;
    await mark('generate', 'running');
    const output = path.join(staging, body.name);
    // npm resolves its project folder upwards: without its own package.json, staging would
    // inherit a parent folder's .npmrc and node_modules (which could shadow the pinned
    // generator). This marker makes staging npm's project root (security review, PF-0048).
    await writeFile(path.join(staging, 'package.json'), '{"private":true}\n', { flag: 'wx', mode: 0o600 });
    // A parent package.json whose "workspaces" match staging could still make the parent npm's
    // root. Verify npm's own answer before any npm-based generator runs (re-review, PF-0048).
    if (entry.argv && ['npx', 'npm'].includes(entry.argv(body.name)[0])) {
      const prefix = spawnSync('npm', ['prefix'], { cwd: staging, encoding: 'utf8', env: scrubbedEnv(), timeout: PREREQ_TIMEOUT_MS, shell: false });
      const resolved = prefix.status === 0 ? await realpath(prefix.stdout.trim()).catch(() => null) : null;
      if (resolved !== await realpath(staging)) {
        await mark('generate', 'failed', { error: 'npm project root is not the staging folder' });
        throw new NewProjectError('NEW_PROJECT_NPM_ROOT', `npm would treat ${resolved ?? 'an unknown folder'} as the project root instead of the staging folder (a parent package.json with "workspaces"?). The generator was not run; choose another parent folder. Staging is kept at ${staging}.`, { staging });
      }
    }
    if (entry.argv) {
      const result = await runLogged(entry.argv(body.name), staging, log, GENERATOR_TIMEOUT_MS);
      if (result.code !== 0) {
        await mark('generate', 'failed', { exitCode: result.code ?? null, error: result.error ?? (result.timedOut ? 'timed out' : null) });
        throw new NewProjectError('NEW_PROJECT_GENERATOR_FAILED', `The generator ${result.timedOut ? 'timed out' : result.error ? `could not run: ${result.error}` : `exited with code ${result.code}`}. Nothing was created at ${body.destination}. Staging with the full log is kept at ${staging} (discard it with \`yallaflow new discard ${id}\`).\n${await logTail(log)}`, { staging, log });
      }
    } else {
      await mkdir(output);
    }
    if (entry.marker && !(await exists(path.join(output, entry.marker)))) {
      await mark('generate', 'failed', { error: `expected ${entry.marker} not found` });
      throw new NewProjectError('NEW_PROJECT_GENERATOR_FAILED', `The generator finished but ${entry.marker} is missing, so its output is not trusted. Nothing was created at ${body.destination}. Staging is kept at ${staging}.`, { staging, log });
    }
    await mark('generate', 'done');
    // Promote only into a still-absent destination (same filesystem rename; a concurrent
    // creation of the destination makes rename fail or is detected just before).
    if (await exists(body.destination)) {
      await mark('promote', 'failed', { error: 'destination appeared' });
      throw new NewProjectError('NEW_PROJECT_EXISTS', `${body.destination} appeared while the project was being generated. Nothing was overwritten; the generated project stays in ${staging}.`, { staging });
    }
    try {
      // Claim the destination exclusively (mkdir fails if anything exists there, even an
      // empty folder created a moment ago), then move the generated entries into it.
      await mkdir(body.destination);
    } catch (error) {
      await mark('promote', 'failed', { error: error.code });
      throw new NewProjectError('NEW_PROJECT_EXISTS', `Could not create ${body.destination} (${error.code}). Nothing was overwritten; the generated project stays in ${staging}.`, { staging });
    }
    for (const name of await readdir(output)) await rename(path.join(output, name), path.join(body.destination, name));
    const created = await stat(body.destination);
    await mark('promote', 'done', { dev: created.dev, ino: created.ino });
  }
  const root = body.destination;
  // Later steps (install, init, first work) run only in the folder this plan created.
  const claimed = progress.steps.promote;
  const now = await lstat(root).catch(() => null);
  if (!now || now.isSymbolicLink() || !now.isDirectory() || now.dev !== claimed.dev || now.ino !== claimed.ino) {
    throw new NewProjectError('NEW_PROJECT_DESTINATION_CHANGED', `${root} is no longer the folder this plan created; nothing was installed, initialized or labelled there.`);
  }
  if (body.install && !done('install')) {
    await mark('install', 'running');
    const installLog = progress.staging && !progress.stagingRemoved ? path.join(progress.staging, 'yallaflow-new.log') : path.join(await mkdtemp(path.join(os.tmpdir(), 'yallaflow-new-')), 'install.log');
    const result = await runLogged(entry.install, root, installLog, GENERATOR_TIMEOUT_MS);
    if (result.code !== 0) {
      await mark('install', 'failed', { exitCode: result.code ?? null });
      throw new NewProjectError('NEW_PROJECT_INSTALL_FAILED', `Dependency install failed (${result.error ?? `exit ${result.code}`}). The project exists at ${root}; retry with \`yallaflow new create ${id} --confirm ${plan.hash.slice(0, 8)}\`, which skips the finished steps.\n${await logTail(installLog)}`);
    }
    await mark('install', 'done');
  }
  if (!done('init')) {
    if (await exists(path.join(root, '.yallaflow'))) throw new NewProjectError('NEW_PROJECT_DESTINATION_CHANGED', `${root} already has a YallaFlow workspace; the wizard never re-labels an existing project.`);
    await hooks.initProject(root, {
      name: body.name,
      origin: { createdBy: 'yallaflow new', generator: body.generator ? `${body.generator.package}@${body.generator.version}` : null, template: body.stack, stack: body.technologies, planHash: plan.hash, createdAt: new Date().toISOString(), ...(body.environment ? { environment: body.environment } : {}), ...(body.git ? { git: true } : {}) }
    });
    await mark('init', 'done');
  }
  if (body.git && !done('git-init')) {
    if (await exists(path.join(root, '.git'))) {
      await mark('git-init', 'done', { note: 'already a Git repository' });
    } else {
      await mark('git-init', 'running');
      const gitLog = await safeLocalDir(root, '.yallaflow', 'local').then((dir) => path.join(dir, 'git-init.log'));
      const result = await runLogged([...GIT_INIT_ARGV], root, gitLog, PREREQ_TIMEOUT_MS * 6);
      if (result.code !== 0) {
        await mark('git-init', 'failed', { exitCode: result.code ?? null });
        throw new NewProjectError('NEW_PROJECT_GIT_FAILED', `The project exists at ${root} with YallaFlow initialized, but \`git init\` failed (${result.error ?? `exit ${result.code}`}). Retry creation (it skips finished steps), or initialize Git later from the project's Overview.`);
      }
      await mark('git-init', 'done');
    }
  }
  let workId = progress.steps['first-work']?.workId ?? null;
  if (!done('first-work')) {
    workId = await hooks.firstWork(root, firstWorkRequest(body), firstWorkTitle(body));
    await mark('first-work', 'done', { workId });
  }
  if (progress.staging && !progress.stagingRemoved) {
    // Keep the generator log with the project's local (git-ignored) state, then remove staging.
    try {
      const localDir = await safeLocalDir(root, '.yallaflow', 'local');
      try { await writeFile(path.join(localDir, '.gitignore'), '*\n', { flag: 'wx' }); } catch { /* exists */ }
      const text = await readFile(path.join(progress.staging, 'yallaflow-new.log'), 'utf8').catch(() => '');
      if (text) await safeWriteFile(localDir, 'new-project.log', text, 0o600);
    } catch { /* diagnostics only */ }
    await removeStaging(plan);
    progress.stagingRemoved = true;
    await savePlan(plan, env);
  }
  return { id, destination: root, workId, stack: body.stack };
}

// The first work item: a short title, and the request in the developer's terms. Nothing is
// invented: no criteria, no architecture, only what the plan records.
export function firstWorkTitle(body) {
  const goal = body.intent?.description?.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  if (!goal) return `Set up ${body.name}`;
  const short = goal.length > 72 ? `${goal.slice(0, 71).replace(/\s+\S*$/, '')}…` : goal;
  return `${body.name}: ${short}`;
}

export function firstWorkRequest(body) {
  const stack = body.generator ? `${body.stackLabel} (generated with ${body.generator.package}@${body.generator.version}; the generated code is not reviewed yet)`
    : body.customStack ? `an empty project; the developer chose ${body.customStack} as the stack, and nothing is generated yet` : 'an empty project (no code yet)';
  const environment = { docker: 'Docker (planned; no Docker files were created yet)', local: 'local tools', later: 'to be decided' }[body.environment] ?? null;
  const lines = [];
  if (body.intent?.description) lines.push(body.intent.description.trim(), '');
  if (body.intent?.requirements) lines.push('Requirements from the developer:', body.intent.requirements.trim(), '');
  lines.push(`Project: ${body.name}, ${stack}.${environment ? ` Development environment: ${environment}.` : ''}`);
  if (body.customStack) lines.push(`Set up ${body.customStack} in this project with the developer: propose the official way to create it, and run nothing they have not approved.`);
  lines.push(body.intent?.requirements
    ? 'Next: review these requirements with the developer, then confirm the local setup and the runtime profile.'
    : 'Next: define the first product requirements with the developer, then confirm the local setup and the runtime profile.');
  // PF-0084: the choice is not project memory yet; this work item is where it becomes so.
  lines.push('When this work item finishes, propose the chosen stack, the development environment and the product goal as project knowledge, citing the generated files and the developer\'s choice in the New Project wizard (recorded in .yallaflow/config.yaml under project.origin).');
  return lines.join('\n');
}

function validateIntent(description, requirements) {
  const text = (value, max, label) => {
    if (value === null || value === undefined) return null;
    if (typeof value !== 'string' || value.length > max || value.includes('\0')) throw new NewProjectError('NEW_PROJECT_INTENT', `${label} must be text up to ${max} characters.`);
    return value.trim() || null;
  };
  const d = text(description, DESCRIPTION_MAX, 'The description');
  const r = text(requirements, REQUIREMENTS_MAX, 'The requirements');
  return d || r ? { description: d, requirements: r } : null;
}

// Attachments are described in the plan (name, size, SHA-256) and linked to the first work
// item after creation; a file whose bytes do not match its descriptor is refused then.
function validateAttachments(list) {
  if (!Array.isArray(list) || list.length > ATTACHMENTS_MAX) throw new NewProjectError('NEW_PROJECT_ATTACHMENTS', `Attach at most ${ATTACHMENTS_MAX} files.`);
  const seen = new Set();
  return list.map((entry) => {
    const { name, size, sha256 } = entry ?? {};
    if (typeof name !== 'string' || !name.trim() || name.length > 200 || /[\\/\u0000-\u001f\u007f]/.test(name) || name.startsWith('.')) throw new NewProjectError('NEW_PROJECT_ATTACHMENTS', 'Each attachment needs a plain file name.');
    if (!Number.isSafeInteger(size) || size <= 0) throw new NewProjectError('NEW_PROJECT_ATTACHMENTS', `${name}: the size must be a positive number of bytes.`);
    if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) throw new NewProjectError('NEW_PROJECT_ATTACHMENTS', `${name}: a SHA-256 hex digest is required.`);
    if (seen.has(sha256)) throw new NewProjectError('NEW_PROJECT_ATTACHMENTS', `${name} is attached twice.`);
    seen.add(sha256);
    return { name: name.trim(), size, sha256 };
  });
}

async function removeStaging(plan) {
  const staging = plan.progress.staging;
  if (!staging) return false;
  // Only a folder this plan created: directly under the plan's parent, with our prefix.
  if (path.dirname(staging) !== plan.body.parent || !path.basename(staging).startsWith(STAGING_PREFIX)) throw new NewProjectError('NEW_PROJECT_PLAN_TAMPERED', `Refusing to remove ${staging}: it is not a staging folder of this plan.`);
  const info = await lstat(staging).catch(() => null);
  if (!info) return false;
  if (info.isSymbolicLink() || !info.isDirectory()) throw new NewProjectError('NEW_PROJECT_PLAN_TAMPERED', `Refusing to remove ${staging}: it is not a real folder.`);
  await rm(staging, { recursive: true, force: true });
  return true;
}

export async function discardPlan(id, { env = process.env } = {}) {
  const plan = await loadPlan(id, env);
  if (plan.progress.steps.promote?.status === 'done') return { id, removed: false, note: 'The project was already created; only the plan is kept as a record.' };
  const removed = await removeStaging(plan);
  plan.progress.staging = null;
  plan.progress.discardedAt = new Date().toISOString();
  await savePlan(plan, env);
  return { id, removed };
}
