// Personal command trust (1.4.0, owner decision 3). Kept per user, outside the
// repository (src/runtime/state.js), bound to the effective definition hash of the
// service; the per-checkout state folder binds it to this checkout. Any material change
// ends the trust. Trust can require the exact definition the user reviewed (--expect).
import { definitionHash } from './profile.js';
import { readState, writeState } from './state.js';
export { checkoutFingerprint } from './state.js';

const FILE = 'trust.json';

async function readTrust(root) {
  const doc = await readState(root, FILE);
  return doc && typeof doc === 'object' && doc.services && typeof doc.services === 'object' ? doc : { schemaVersion: 1, services: {} };
}

// { trusted, reason } — reason is 'never' or 'changed' (definition).
export async function trustState(root, service) {
  const record = (await readTrust(root)).services[service.id];
  if (!record) return { trusted: false, reason: 'never' };
  if (record.hash !== definitionHash(service)) return { trusted: false, reason: 'changed', trustedAt: record.trustedAt };
  return { trusted: true, trustedAt: record.trustedAt };
}

export async function trustService(root, service, { expect = null, now = new Date().toISOString() } = {}) {
  const hash = definitionHash(service);
  if (expect !== null && expect !== hash) {
    throw Object.assign(new Error(`The definition of ${service.id} changed since you reviewed it; nothing was trusted. Review it again.`), { code: 'RUNTIME_TRUST_STALE', review: { definitionHash: hash, command: service.command, cwd: service.cwd, env: service.env, ports: service.ports } });
  }
  const doc = await readTrust(root);
  doc.services[service.id] = { hash, trustedAt: now };
  await writeState(root, FILE, doc);
  return doc.services[service.id];
}

export async function revokeTrust(root, id) {
  const doc = await readTrust(root);
  if (!doc.services[id]) return false;
  delete doc.services[id];
  await writeState(root, FILE, doc);
  return true;
}
