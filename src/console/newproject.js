// Console New Project Wizard routes (1.4.0). Every action runs the canonical CLI
// (`yallaflow new …`) through the runner with argv only; the request supplies only the
// validated plan inputs, never a command. Creation needs the plan's hash prefix, typed or
// confirmed by the user after reviewing the plan, and runs in the background: the page
// follows the progress the plan records.
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

export async function wizardCatalog(root, runner) {
  return parseCli(await runner.runAside(root, ['new', 'catalog', '--json']));
}

export async function wizardPlan(root, body, runner) {
  exactObject(body, ['name', 'parent', 'stack', 'install', 'allowNested'], ['name', 'parent', 'stack']);
  for (const flag of ['install', 'allowNested']) if (flag in body && typeof body[flag] !== 'boolean') throw new HttpError(400, 'BAD_REQUEST', `${flag} must be true or false.`);
  const args = ['new', 'plan', '--name', body.name, '--parent', body.parent, '--stack', body.stack, ...(body.install ? ['--install'] : []), ...(body.allowNested ? ['--allow-nested'] : []), '--json'];
  const parsed = parseCli(await runner.runAside(root, args));
  if (parsed.error) throw new HttpError(422, parsed.error.code ?? 'NEW_PROJECT_REFUSED', parsed.error.message);
  return parsed;
}

// Starts creation in the background after checking the confirmation synchronously.
export async function wizardCreate(root, body, runner) {
  exactObject(body, ['planId', 'confirm'], ['planId', 'confirm']);
  let plan;
  try {
    plan = await loadPlan(body.planId);
  } catch (error) {
    throw new HttpError(422, error.code ?? 'NEW_PROJECT_PLAN', error.message);
  }
  if (body.confirm.length < 8 || !plan.hash.startsWith(body.confirm.toLowerCase())) throw new HttpError(422, 'NEW_PROJECT_CONFIRM', `Confirm with the plan's hash prefix (${plan.hash.slice(0, 8)}) after reviewing it.`);
  const existing = jobs.get(plan.id);
  if (!existing || existing.done) {
    // One creation per plan at a time; a finished or failed one can be retried (it skips done steps).
    const job = { done: null };
    jobs.set(plan.id, job);
    runner.runAside(root, ['new', 'create', plan.id, '--confirm', body.confirm, '--json'], { timeoutMs: CREATE_TIMEOUT_MS, env: { YALLAFLOW_NEW_VIA: 'console' } })
      .then((result) => parseCli(result))
      .catch((error) => ({ error: { code: error.code ?? 'CLI_FAILED', message: error.message } }))
      .then((result) => { job.done = result; });
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
