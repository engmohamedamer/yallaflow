// Console New Project Wizard routes (1.4.0). Every action runs the canonical CLI
// (`yallaflow new …`) through the runner with argv only; the request supplies only the
// validated plan inputs, never a command. Creation is confirmed by an explicit action that
// sends the full hash of the plan the user reviewed (PF-0057; a changed or different plan is
// refused); a plan that installs dependencies also needs the project name typed. It runs in
// the background, the page follows the progress the plan records, and the finished project
// is registered in the console by the server (so it happens even if the page was closed).
import { HttpError } from './create.js';
import { loadPlan } from '../newproject/project.js';
import { redactSecrets } from '../security/redact.js';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { inLocalDir, safeLocalDir } from '../agents/local-files.js';
import path from 'node:path';

const CREATE_TIMEOUT_MS = 20 * 60 * 1000;
const jobs = new Map(); // plan id -> { done: result | null }

function parseCli(result) {
  try {
    return JSON.parse(result.stdout.trim().split('\n').at(-1));
  } catch {
    throw new HttpError(500, 'CLI_FAILED', (result.stderr || result.stdout).trim().split('\n')[0] || 'The wizard command failed.');
  }
}

function exactObject(body, allowed, required) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'BAD_REQUEST', 'Send a JSON object.');
  const extra = Object.keys(body).filter((key) => !allowed.includes(key));
  if (extra.length) throw new HttpError(400, 'BAD_REQUEST', `Unexpected field(s): ${extra.join(', ')}.`);
  for (const key of required) if (typeof body[key] !== 'string' || !body[key].trim()) throw new HttpError(400, 'BAD_REQUEST', `${key} is required.`);
}

// Higher-risk plans: any step that installs dependencies or runs package scripts (a separate
// install, or a generator such as Laravel's that does it itself) needs the name typed.
export function needsTypedName(plan) {
  return Boolean(plan.body.install) || plan.body.steps.some((step) => step.installsDependencies || step.runsPackageScripts);
}

export async function wizardCatalog(root, runner) {
  return parseCli(await runner.runAside(root, ['new', 'catalog', '--json']));
}

export async function wizardPlan(root, body, runner) {
  exactObject(body, ['name', 'parent', 'stack', 'install', 'allowNested', 'description', 'requirements', 'environment', 'git', 'files'], ['name', 'parent', 'stack']);
  for (const flag of ['install', 'allowNested', 'git']) if (flag in body && typeof body[flag] !== 'boolean') throw new HttpError(400, 'BAD_REQUEST', `${flag} must be true or false.`);
  const LIMITS = { description: 4000, requirements: 16000, environment: 10 };
  for (const [text, max] of Object.entries(LIMITS)) if (text in body && body[text] !== null && (typeof body[text] !== 'string' || body[text].length > max || body[text].includes('\0'))) throw new HttpError(400, 'BAD_REQUEST', `${text} must be text up to ${max} characters.`);
  for (const key of ['name', 'parent', 'stack']) if (body[key].includes('\0')) throw new HttpError(400, 'BAD_REQUEST', `${key} is invalid.`);
  const attachments = body.files ?? [];
  if (!Array.isArray(attachments) || attachments.length > 10 || attachments.some((a) => !a || typeof a !== 'object' || typeof a.name !== 'string' || !Number.isSafeInteger(a.size) || typeof a.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(a.sha256))) throw new HttpError(400, 'BAD_REQUEST', 'files must list up to 10 files as { name, size, sha256 }.');
  const opt = (flag, value) => (value === undefined || value === null || value === '' ? [] : [`--${flag}=${value}`]);
  const args = ['new', 'plan', `--name=${body.name}`, `--parent=${body.parent}`, `--stack=${body.stack}`, ...(body.install ? ['--install'] : []), ...(body.allowNested ? ['--allow-nested'] : []),
    ...opt('description', body.description), ...opt('requirements', body.requirements), ...opt('environment', body.environment), ...(body.git ? ['--git'] : []),
    ...attachments.map((a) => `--attachment=${a.sha256}:${a.size}:${a.name}`), '--json'];
  const parsed = parseCli(await runner.runAside(root, args));
  if (parsed.error) throw new HttpError(422, parsed.error.code ?? 'NEW_PROJECT_REFUSED', parsed.error.message);
  return parsed;
}

// Starts creation in the background after checking the confirmation synchronously.
export async function wizardCreate(root, body, runner, { register = null } = {}) {
  exactObject(body, ['planId', 'confirm', 'confirmName'], ['planId', 'confirm']);
  let plan;
  try {
    plan = await loadPlan(body.planId);
  } catch (error) {
    throw new HttpError(422, error.code ?? 'NEW_PROJECT_PLAN', error.message);
  }
  // The page sends the full hash of the plan it showed: any other plan, or this plan changed
  // since, is refused (a typed 8+ character prefix is still accepted, as on the command line).
  if (body.confirm.length < 8 || !plan.hash.startsWith(body.confirm.toLowerCase())) throw new HttpError(422, 'NEW_PROJECT_CONFIRM', 'The plan changed or is not the one you reviewed. Review it again, then create.');
  // Higher risk: installing dependencies runs package scripts. Type the project name.
  if (needsTypedName(plan) && body.confirmName !== plan.body.name) throw new HttpError(422, 'NEW_PROJECT_CONFIRM_NAME', `This plan installs dependencies or runs package scripts. Type the project name (${plan.body.name}) to confirm.`);
  const existing = jobs.get(plan.id);
  if (!existing || existing.done) {
    // One creation per plan at a time; a finished or failed one can be retried (it skips done steps).
    const job = { done: null };
    jobs.set(plan.id, job);
    runner.runAside(root, ['new', 'create', plan.id, '--confirm', body.confirm, '--json'], { timeoutMs: CREATE_TIMEOUT_MS, env: { YALLAFLOW_NEW_VIA: 'console' } })
      .then((result) => parseCli(result))
      .catch((error) => ({ error: { code: error.code ?? 'CLI_FAILED', message: error.message } }))
      .then(async (result) => {
        // Created: add it to the console now; a failure here is reported, never retried by creating again.
        if (result?.ok && register) {
          try { result.registration = { ok: true, ...(await register(plan.id)) }; } catch (error) { result.registration = { ok: false, code: error.code ?? 'REGISTER_FAILED', message: error.message }; }
        }
        job.done = result;
      });
  }
  return { started: true, planId: plan.id };
}

// The plan with its recorded progress, the last log lines (redacted) and the outcome of a
// creation this console started.
export async function wizardProgress(planId) {
  let plan;
  try {
    plan = await loadPlan(planId);
  } catch (error) {
    throw new HttpError(404, error.code ?? 'NEW_PROJECT_PLAN', error.message);
  }
  // The log path is derived, never taken from the (unhashed) progress record, and is read
  // only as a regular, singly linked file (security review, PF-0048).
  let log = '';
  const staging = plan.progress.staging;
  const stagingOk = staging && path.dirname(staging) === plan.body.parent && path.basename(staging).startsWith('.yallaflow-new-');
  const logFile = plan.progress.stagingRemoved ? path.join(plan.body.destination, '.yallaflow', 'local', 'new-project.log') : stagingOk ? path.join(staging, 'yallaflow-new.log') : null;
  if (logFile) {
    const readSafely = async (file) => {
      let handle;
      try {
        handle = await open(file, constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0));
        const info = await handle.stat();
        return info.isFile() && info.nlink === 1 ? await handle.readFile('utf8') : '';
      } finally { await handle?.close(); }
    };
    try {
      // Inside the project, every folder on the way must be real (anchored, no links).
      const text = plan.progress.stagingRemoved
        ? await inLocalDir(await safeLocalDir(plan.body.destination, '.yallaflow', 'local'), (base) => readSafely(path.join(base, 'new-project.log')))
        : await readSafely(logFile);
      log = text.split(/\r?\n/).slice(-60).map(redactSecrets).join('\n');
    } catch { /* not written yet, or refused */ }
  }
  const job = jobs.get(plan.id);
  return { plan, log, running: Boolean(job && !job.done), outcome: job?.done ?? null };
}
