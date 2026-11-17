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
  if (parsed.error) {
    // What the page needs to offer the fix: the review, the shared notice, what is missing,
    // the port's owner and a free port, the line that explains a failure (PF-0166).
    const extra = Object.fromEntries(['review', 'shared', 'problems', 'state', 'port', 'owner', 'ownerService', 'declaredBy', 'suggestion', 'failure'].filter((key) => parsed.error[key] !== undefined && parsed.error[key] !== null).map((key) => [key, parsed.error[key]]));
    throw Object.assign(new HttpError(422, parsed.error.code ?? 'RUNTIME_REFUSED', parsed.error.message), Object.keys(extra).length ? { extra } : {});
  }
  return parsed;
}

// PF-0166: edit a service, move it to another port, or install its missing dependencies.
// Each runs the canonical CLI with argv built here from validated fields; the request never
// supplies a command line. An install needs the hash of the exact command the page showed.
const text = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
const port = (value) => Number.isInteger(value) && value >= 1 && value <= 65535;
function scopeFlag(body) {
  if (!['local', 'shared'].includes(body.scope)) throw new HttpError(400, 'BAD_REQUEST', 'Choose where to save: scope "local" (this machine) or "shared" (the repository file).');
  return `--${body.scope}`;
}
export async function editRuntimeService(root, serviceId, body, runner) {
  if (!isServiceId(serviceId)) throw new HttpError(404, 'NOT_FOUND', 'Unknown service.');
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'BAD_REQUEST', 'Send a JSON object.');
  const allowed = ['scope', 'name', 'cwd', 'open', 'ports', 'env', 'readyPort', 'readyLog', 'noReady', 'argv'];
  const extra = Object.keys(body).filter((key) => !allowed.includes(key));
  if (extra.length) throw new HttpError(400, 'BAD_REQUEST', `Unexpected field(s): ${extra.join(', ')}.`);
  const args = ['runtime', 'edit', serviceId, scopeFlag(body)];
  if ('name' in body) { if (!text(body.name, 80)) throw new HttpError(400, 'BAD_REQUEST', 'name must be 1-80 characters.'); args.push(`--name=${body.name}`); }
  if ('cwd' in body) { if (!text(body.cwd, 512)) throw new HttpError(400, 'BAD_REQUEST', 'cwd must be a folder path.'); args.push(`--cwd=${body.cwd}`); }
  if ('open' in body) { if (!text(body.open, 200)) throw new HttpError(400, 'BAD_REQUEST', 'open must be a path such as /admin.'); args.push(`--open=${body.open}`); }
  if ('ports' in body) { if (!Array.isArray(body.ports) || body.ports.length > 16 || !body.ports.every(port)) throw new HttpError(400, 'BAD_REQUEST', 'ports must list port numbers.'); args.push(...(body.ports.length ? body.ports.map((entry) => `--port=${entry}`) : ['--no-ports'])); }
  if ('env' in body) { if (!Array.isArray(body.env) || body.env.length > 64 || !body.env.every((name) => /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(String(name)))) throw new HttpError(400, 'BAD_REQUEST', 'env lists variable names, never values.'); args.push(...(body.env.length ? body.env.map((name) => `--env=${name}`) : ['--no-env'])); }
  if (['readyPort', 'readyLog', 'noReady'].filter((key) => key in body).length > 1) throw new HttpError(400, 'BAD_REQUEST', 'Send one of readyPort, readyLog, noReady.');
  if ('readyPort' in body) { if (!port(body.readyPort)) throw new HttpError(400, 'BAD_REQUEST', 'readyPort must be a port number.'); args.push(`--ready-port=${body.readyPort}`); }
  if ('readyLog' in body) { if (!text(body.readyLog, 200)) throw new HttpError(400, 'BAD_REQUEST', 'readyLog must be 1-200 characters.'); args.push(`--ready-log=${body.readyLog}`); }
  if (body.noReady === true) args.push('--no-ready');
  if ('argv' in body) {
    if (!Array.isArray(body.argv) || !body.argv.length || body.argv.length > 64 || !body.argv.every((part) => typeof part === 'string' && part.length > 0 && part.length <= 1024 && !part.includes('\0'))) throw new HttpError(400, 'BAD_REQUEST', 'argv must be the command as a list (executable first).');
    args.push('--json', '--', ...body.argv);
  } else args.push('--json');
  if (args.length <= 5 && !('argv' in body)) throw new HttpError(400, 'BAD_REQUEST', 'Nothing to change.');
  return exclusive(root, `edit ${serviceId}`, async () => parseLast(await runner.write(root, args)));
}
// Owner review (2026-11-17): undo this machine's change to a shared service. Confirmed, and
// only the local override file changes (the CLI refuses a service with no shared definition).
export async function resetRuntimeOverride(root, serviceId, body, runner) {
  if (!isServiceId(serviceId)) throw new HttpError(404, 'NOT_FOUND', 'Unknown service.');
  const keys = body && typeof body === 'object' && !Array.isArray(body) ? Object.keys(body).join(',') : '';
  if (keys !== 'confirm' || body.confirm !== true) throw new HttpError(400, 'CONFIRMATION_REQUIRED', 'Send { confirm: true } to drop this machine\'s change.');
  return exclusive(root, `reset ${serviceId}`, async () => parseLast(await runner.write(root, ['runtime', 'reset', serviceId, '--json'])));
}
export async function changeRuntimePort(root, serviceId, body, runner) {
  if (!isServiceId(serviceId)) throw new HttpError(404, 'NOT_FOUND', 'Unknown service.');
  const keys = body && typeof body === 'object' && !Array.isArray(body) ? Object.keys(body).sort().join(',') : '';
  if (keys !== 'from,scope,to' || !port(body.from) || !port(body.to)) throw new HttpError(400, 'BAD_REQUEST', 'Send { from, to, scope }.');
  return exclusive(root, `port ${serviceId}`, async () => parseLast(await runner.write(root, ['runtime', 'port', serviceId, `--from=${body.from}`, `--to=${body.to}`, scopeFlag(body), '--json'])));
}
export async function installRuntimePrerequisites(root, serviceId, body, runner) {
  if (!isServiceId(serviceId)) throw new HttpError(404, 'NOT_FOUND', 'Unknown service.');
  const keys = body && typeof body === 'object' && !Array.isArray(body) ? Object.keys(body).sort().join(',') : '';
  // The developer ticked "I reviewed this command"; the hash binds the run to that command.
  if (keys !== 'commandHash,confirmed' || body.confirmed !== true || !/^[0-9a-f]{64}$/.test(String(body.commandHash))) throw new HttpError(400, 'CONFIRMATION_REQUIRED', 'Review the install command and confirm it first.');
  return exclusive(root, `install ${serviceId}`, async () => parseLast(await runner.runAside(root, ['runtime', 'install', serviceId, `--confirm=${body.commandHash}`, '--json'], { timeoutMs: 16 * 60 * 1000, env: { YALLAFLOW_RUNTIME_VIA: 'console' } })));
}

export async function runRuntimeAction(root, serviceId, action, body, runner) {
  if (!isServiceId(serviceId) || !RUNTIME_ACTIONS.includes(action)) throw new HttpError(404, 'NOT_FOUND', 'Unknown runtime action.');
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'BAD_REQUEST', 'Send a JSON object.');
  const keys = Object.keys(body);
  let confirmShared = false;
  let skipSetupCheck = false;
  if (action === 'trust') {
    // Trusting authorizes future execution: the user types the service id after reviewing it.
    // PF-0101: the page sends a ticked checkbox (confirmed: true); a typed service id still works.
    const confirmedNow = keys.includes('confirmed') ? body.confirmed === true : body.confirm === serviceId;
    if (keys.length !== 2 || !(keys.includes('confirm') || keys.includes('confirmed')) || !keys.includes('definitionHash') || !confirmedNow) throw new HttpError(400, 'CONFIRMATION_REQUIRED', `Type the service id (${serviceId}) to confirm that you reviewed its command, folder, environment names and ports.`);
    if (!/^sha256:[0-9a-f]{64}$/.test(String(body.definitionHash))) throw new HttpError(400, 'BAD_REQUEST', 'The reviewed definition is missing; reload the page.');
  } else if (['stop', 'restart'].includes(action) && keys.length === 1 && ['confirmShared', 'confirmedShared'].includes(keys[0])) {
    // Stopping or restarting shared infrastructure: the developer typed the service id after
    // seeing who else may be affected (PF-0072).
    if (!(body.confirmedShared === true || body.confirmShared === serviceId)) throw new HttpError(400, 'CONFIRMATION_REQUIRED', `Type the service id (${serviceId}) to confirm that other projects may lose this shared service.`);
    confirmShared = true;
  } else if (['start', 'restart'].includes(action) && keys.length === 1 && keys[0] === 'skipSetupCheck') {
    // Owner review (2026-11-17): "Try anyway" skips only the dependency check. The same CLI
    // start runs with every other check (trust, folders, ports); the URL still names the service.
    if (body.skipSetupCheck !== true) throw new HttpError(400, 'BAD_REQUEST', 'skipSetupCheck must be true.');
    skipSetupCheck = true;
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
  const args = ['runtime', action, serviceId, ...(confirmShared ? ['--confirm-shared'] : []), ...(skipSetupCheck ? ['--skip-setup-check'] : []), '--json'];
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
