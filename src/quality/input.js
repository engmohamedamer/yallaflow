import { nextScopedId } from '../core/ids.js';
import { isSharedWorkspace } from '../core/workspace.js';
import { allocateCheckoutId } from '../shared/identity.js';

// Shared input validation for the quality ledgers (v1.1.0). Every helper pushes
// problems onto `errors` instead of throwing, so one rejection lists them all.
export function normalizeTarget(target, label, errors) {
  if (target === undefined || target === null) return null;
  if (typeof target !== 'object' || Array.isArray(target) || typeof target.baseUrl !== 'string') {
    errors.push(`${label} must be an object with a baseUrl`);
    return null;
  }
  const extra = Object.keys(target).filter((key) => key !== 'baseUrl');
  if (extra.length) errors.push(`${label} has unknown field(s): ${extra.join(', ')}`);
  let url;
  try {
    url = new URL(target.baseUrl);
  } catch {
    errors.push(`${label} baseUrl must be a URL`);
    return null;
  }
  if (url.username || url.password) {
    errors.push(`${label} baseUrl must not embed credentials`);
    return null;
  }
  return { baseUrl: `${url.origin}${url.pathname === '/' ? '' : url.pathname}` };
}

export function stringList(value, label, errors) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => !nonEmpty(item))) {
    errors.push(`${label} must be an array of non-empty strings`);
    return [];
  }
  return value.map((item) => item.trim());
}

// Record IDs for the quality ledgers. In a Shared Project they are branch-safe
// (QC-<clone tag>-0001, the same allocation as work and source IDs), so records made on
// two branches never share an ID; single-user projects keep the short QC-001 form.
export async function allocateRecordId(root, prefix, entries) {
  if (!await isSharedWorkspace(root)) return nextId(prefix, entries);
  return allocateCheckoutId(root, prefix, entries.map((entry) => entry.id), nextScopedId);
}

// IDs that occur more than once — possible only after a merge of two branches' ledgers.
export function duplicateIds(entries) {
  const seen = new Set();
  const duplicates = new Set();
  for (const entry of entries) (seen.has(entry.id) ? duplicates : seen).add(entry.id);
  return [...duplicates];
}

export function nextId(prefix, entries) {
  const max = entries.reduce((highest, entry) => Math.max(highest, Number(String(entry.id).slice(prefix.length + 1)) || 0), 0);
  return `${prefix}-${String(max + 1).padStart(3, '0')}`;
}

export function unknown(value, allowed, label, errors) {
  const extra = Object.keys(value).filter((key) => !allowed.has(key));
  if (extra.length) errors.push(`${label} has unknown field(s): ${extra.join(', ')}`);
}

export function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}
