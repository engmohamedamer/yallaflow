// Console runtime actions (1.4.0): Trust, Start, Stop, Restart of a profile service.
// Fixed argv only — the request names a service id and an action from a fixed set; the
// command that runs always comes from the reviewed profile, never from the request.
import { HttpError } from './create.js';

export const RUNTIME_ACTIONS = Object.freeze(['trust', 'start', 'stop', 'restart']);
const SERVICE_ID = /^[a-z][a-z0-9-]{0,31}$/;

export function isServiceId(value) {
  return SERVICE_ID.test(String(value));
}

export async function runRuntimeAction(root, serviceId, action, body, runner) {
  if (!isServiceId(serviceId) || !RUNTIME_ACTIONS.includes(action)) throw new HttpError(404, 'NOT_FOUND', 'Unknown runtime action.');
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'BAD_REQUEST', 'Send a JSON object.');
  const keys = Object.keys(body);
  if (action === 'trust') {
    // Trusting authorizes future execution: the user types the service id after reviewing it.
    if (keys.length !== 2 || !keys.includes('confirm') || !keys.includes('definitionHash') || body.confirm !== serviceId) throw new HttpError(400, 'CONFIRMATION_REQUIRED', `Type the service id (${serviceId}) to confirm that you reviewed its command, folder, environment names and ports.`);
    if (!/^sha256:[0-9a-f]{64}$/.test(String(body.definitionHash))) throw new HttpError(400, 'BAD_REQUEST', 'The reviewed definition is missing; reload the page.');
  } else if (keys.length) {
    throw new HttpError(400, 'BAD_REQUEST', 'Send an empty JSON object; the service is named in the URL.');
  }
  const args = action === 'trust' ? ['runtime', 'trust', serviceId, '--expect', body.definitionHash, '--json'] : ['runtime', action, serviceId, '--json'];
  const result = await runner.runAside(root, args, { env: { YALLAFLOW_RUNTIME_VIA: 'console' } });
  let parsed = null;
  try {
    parsed = JSON.parse(result.stdout.trim().split('\n').at(-1));
  } catch {
    throw new HttpError(500, 'CLI_FAILED', (result.stderr || result.stdout).trim().split('\n')[0] || 'The runtime command failed.');
  }
  if (parsed.error) throw Object.assign(new HttpError(422, parsed.error.code ?? 'RUNTIME_REFUSED', parsed.error.message), parsed.error.review ? { extra: { review: parsed.error.review } } : {});
  return parsed;
}
