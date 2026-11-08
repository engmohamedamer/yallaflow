// Personal command trust (1.4.0, owner decision 3). Kept per user, outside the
// repository (src/runtime/state.js), bound to the effective definition hash of the
// service; the per-checkout state folder binds it to this checkout. Any material change
// ends the trust. Trust can require the exact definition the user reviewed (--expect).
import { definitionParts, loadRuntimeProfiles } from './profile.js';
import { readState, writeState } from './state.js';
export { checkoutFingerprint } from './state.js';

const FILE = 'trust.json';

async function readTrust(root) {
  const doc = await readState(root, FILE);
  return doc && typeof doc === 'object' && doc.services && typeof doc.services === 'object' ? doc : { schemaVersion: 1, services: {} };
}

// { trusted, reason } — reason is 'never', 'changed' (with what: inputs or fields) or
// 'blocked' (configuration that cannot be read with certainty, owner requirement S1).
export async function trustState(root, service) {
  const record = (await readTrust(root)).services[service.id];
  if (!record) return { trusted: false, reason: 'never' };
  let parts;
  try { parts = await definitionParts(root, service); }
  catch (error) {
    if (error.code === 'RUNTIME_TRUST_BLOCKED') return { trusted: false, reason: 'blocked', blocking: error.blocking, trustedAt: record.trustedAt };
    throw error;
  }
  if (record.hash !== parts.hash) return { trusted: false, reason: 'changed', trustedAt: record.trustedAt, changed: whatChanged(record, parts) };
  return { trusted: true, trustedAt: record.trustedAt, definitionHash: parts.hash };
}

function whatChanged(record, parts) {
  if (!record.inputs || !record.fieldsHash) return { fields: true, inputs: [] };
  const before = new Map(record.inputs);
  const after = new Map(parts.inputs);
  const inputs = [...new Set([...before.keys(), ...after.keys()])].filter((file) => before.get(file) !== after.get(file)).sort();
  return { fields: record.fieldsHash !== parts.fieldsHash, inputs };
}

export async function trustService(root, service, { expect = null, now = new Date().toISOString() } = {}) {
  const current = (await loadRuntimeProfiles(root)).services.find((entry) => entry.id === service.id);
  if (!current) throw Object.assign(new Error('The reviewed service no longer exists.'), { code: 'RUNTIME_TRUST_STALE' });
  const parts = await definitionParts(root, current); // refuses blocking configuration (S1)
  if (expect !== null && expect !== parts.hash) {
    throw Object.assign(new Error(`The definition of ${service.id} changed since you reviewed it; nothing was trusted. Review it again.`), { code: 'RUNTIME_TRUST_STALE', review: { definitionHash: parts.hash, command: service.command, cwd: service.cwd, env: service.env, ports: service.ports } });
  }
  const doc = await readTrust(root);
  doc.services[service.id] = { hash: parts.hash, fieldsHash: parts.fieldsHash, inputs: parts.inputs, trustedAt: now };
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
