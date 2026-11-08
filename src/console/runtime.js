// Console runtime actions (1.4.0): Trust, Start, Stop, Restart of a profile service.
// Fixed argv only — the request names a service id and an action from a fixed set; the
// command that runs always comes from the reviewed profile, never from the request.
import { HttpError } from './create.js';
import { loadRuntimeProfiles } from '../runtime/profile.js';

export const RUNTIME_ACTIONS = Object.freeze(['trust', 'start', 'stop', 'restart']);
const SERVICE_ID = /^[a-z][a-z0-9-]{0,31}$/;

export function isServiceId(value) {
  return SERVICE_ID.test(String(value));
}

// One runtime write at a time per project (PF-0072 D2): Analyze, Save, Trust, Start and Stop
// cannot interleave, so a review cannot be overtaken by a concurrent change from the console.
const projectRuns = new Map(); // root -> the runtime action in progress
async function exclusive(root, label, fn) {
  if (projectRuns.has(root)) throw new HttpError(409, 'RUNTIME_BUSY', `Another runtime action is in progress for this project (${projectRuns.get(root)}); wait for it to finish.`);
  projectRuns.set(root, label);
  try { return await fn(); } finally { projectRuns.delete(root); }
}

function parseLast(result) {
  let parsed = null;
  try {
    parsed = JSON.parse(result.stdout.trim().split('\n').at(-1));
  } catch {
    throw new HttpError(500, 'CLI_FAILED', (result.stderr || result.stdout).trim().split('\n')[0] || 'The runtime command failed.');
  }
  if (parsed.error) throw Object.assign(new HttpError(422, parsed.error.code ?? 'RUNTIME_REFUSED', parsed.error.message), parsed.error.review || parsed.error.shared ? { extra: { ...(parsed.error.review ? { review: parsed.error.review } : {}), ...(parsed.error.shared ? { shared: parsed.error.shared } : {}) } } : {});
  return parsed;
}

export async function runRuntimeAction(root, serviceId, action, body, runner) {
  if (!isServiceId(serviceId) || !RUNTIME_ACTIONS.includes(action)) throw new HttpError(404, 'NOT_FOUND', 'Unknown runtime action.');
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'BAD_REQUEST', 'Send a JSON object.');
  const keys = Object.keys(body);
  let confirmShared = false;
  if (action === 'trust') {
    // Trusting authorizes future execution: the user types the service id after reviewing it.
    if (keys.length !== 2 || !keys.includes('confirm') || !keys.includes('definitionHash') || body.confirm !== serviceId) throw new HttpError(400, 'CONFIRMATION_REQUIRED', `Type the service id (${serviceId}) to confirm that you reviewed its command, folder, environment names and ports.`);
    if (!/^sha256:[0-9a-f]{64}$/.test(String(body.definitionHash))) throw new HttpError(400, 'BAD_REQUEST', 'The reviewed definition is missing; reload the page.');
  } else if (['stop', 'restart'].includes(action) && keys.length === 1 && keys[0] === 'confirmShared') {
    // Stopping or restarting shared infrastructure: the developer typed the service id after
    // seeing who else may be affected (PF-0072).
    if (body.confirmShared !== serviceId) throw new HttpError(400, 'CONFIRMATION_REQUIRED', `Type the service id (${serviceId}) to confirm that other projects may lose this shared service.`);
    confirmShared = true;
  } else if (keys.length) {
    throw new HttpError(400, 'BAD_REQUEST', 'Send an empty JSON object; the service is named in the URL.');
  }
  if (action === 'trust') {
    // Trusted here, in the console's own process, after the typed confirmation and bound to the
    // reviewed hash — never by asking the CLI to skip its terminal check (review finding 2).
    return exclusive(root, `trust ${serviceId}`, async () => {
      const { trustService } = await import('../runtime/trust.js');
      const service = (await loadRuntimeProfiles(root)).services.find((entry) => entry.id === serviceId);
      if (!service) throw new HttpError(404, 'RUNTIME_UNKNOWN_SERVICE', `No service ${serviceId} in the runtime profile.`);
      try {
        const record = await trustService(root, service, { expect: body.definitionHash });
        runner.invalidate?.(root);
        return { ok: true, id: serviceId, trustedAt: record.trustedAt };
      } catch (error) {
        throw Object.assign(new HttpError(422, error.code ?? 'RUNTIME_REFUSED', error.message), error.review || error.blocking ? { extra: { ...(error.review ? { review: error.review } : {}), ...(error.blocking ? { blocking: error.blocking } : {}) } } : {});
      }
    });
  }
  const args = ['runtime', action, serviceId, ...(confirmShared ? ['--confirm-shared'] : []), '--json'];
  return exclusive(root, `${action} ${serviceId}`, async () => parseLast(await runner.runAside(root, args, { env: { YALLAFLOW_RUNTIME_VIA: 'console' }, timeoutMs: await sequenceTimeoutMs(root) })));
}

// PF-0072: Analyze (read-only scan, stored as the scan plan) and Save selected (untrusted
// definitions). Fixed argv; the request carries only plan service ids.
export async function runRuntimePlanAction(root, action, body, runner) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'BAD_REQUEST', 'Send a JSON object.');
  if (action === 'analyze') {
    if (Object.keys(body).length) throw new HttpError(400, 'BAD_REQUEST', 'Send an empty JSON object.');
    return exclusive(root, 'analyze', async () => parseLast(await runner.runAside(root, ['runtime', 'analyze', '--json'], { env: { YALLAFLOW_RUNTIME_VIA: 'console' }, timeoutMs: 90_000 })));
  }
  if (action === 'save') {
    const keys = Object.keys(body);
    if (keys.some((key) => !['ids', 'replace', 'sharedProfile', 'from'].includes(key)) || !Array.isArray(body.ids) || !body.ids.length || body.ids.length > 16 || body.ids.some((id) => !isServiceId(id))) throw new HttpError(400, 'BAD_REQUEST', 'Send { "ids": [plan service ids], "replace"?: true, "sharedProfile"?: true, "from"?: "agent"|"scan" }.');
    if (body.from !== undefined && !['agent', 'scan'].includes(body.from)) throw new HttpError(400, 'BAD_REQUEST', 'from must be agent or scan.');
    // Saved in the console's own process (review finding 2); untrusted, nothing runs.
    return exclusive(root, 'save', async () => {
      const { savePlanServices } = await import('../runtime/plan.js');
      try {
        const result = await savePlanServices(root, body.ids, { from: body.from ?? 'agent', sharedProfile: body.sharedProfile === true, replace: body.replace === true });
        runner.invalidate?.(root);
        return { ok: true, ...result };
      } catch (error) {
        throw Object.assign(new HttpError(error.code === 'USAGE' ? 400 : 422, error.code ?? 'RUNTIME_REFUSED', error.message), error.ids ? { extra: { ids: error.ids } } : {});
      }
    });
  }
  throw new HttpError(404, 'NOT_FOUND', 'Unknown runtime plan action.');
}

// Start project / Stop project (PF-0069): every trusted service in dependency order, or every
// service YallaFlow started, in reverse. Fixed argv; the request carries no command.

// The whole sequence may wait for every service to be ready, so its time limit comes from
// the profile, never the 120 s write limit (security review, PF-0069): killing start --all
// halfway could leave a started service without its run record.
async function sequenceTimeoutMs(root) {
  try {
    const { services } = await loadRuntimeProfiles(root);
    const total = services.reduce((sum, service) => sum + (service.readyTimeoutSeconds + service.stopTimeoutSeconds + 15) * 1000, 0);
    return Math.min(Math.max(total + 60_000, 120_000), 3 * 60 * 60 * 1000);
  } catch {
    return 120_000;
  }
}

export async function runRuntimeProjectAction(root, action, body, runner) {
  if (!['start', 'stop'].includes(action)) throw new HttpError(404, 'NOT_FOUND', 'Unknown runtime action.');
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) throw new HttpError(400, 'BAD_REQUEST', 'Send an empty JSON object.');
  // One Start/Stop project (or any other runtime write) at a time per project.
  return exclusive(root, action === 'start' ? 'start project' : 'stop project', async () => parseLast(await runner.runAside(root, ['runtime', action, '--all', '--json'], { env: { YALLAFLOW_RUNTIME_VIA: 'console' }, timeoutMs: await sequenceTimeoutMs(root) })));
}
