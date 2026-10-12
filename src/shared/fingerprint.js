import { createHash } from 'node:crypto';

// Deterministic content fingerprints of canonical project memory (v0.3.10). A Shared
// Project identifies a memory state by what it contains, not by a mutable counter: two
// clones holding the same ledger content compute the same fingerprint, no server or
// global revision number is needed, and it works without Git.

// JSON with object keys sorted at every level; arrays keep their order (fact order and
// history order are meaningful).
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

// The whole ledger's identity: schema plus every fact. `updatedAt` is a write time,
// not content, and is excluded. An absent ledger and an empty one are the same state.
export function ledgerFingerprint(ledger) {
  return sha256(canonicalJson({ schemaVersion: ledger?.facts?.length ? ledger.schemaVersion : null, facts: ledger?.facts ?? [] }));
}

// One fact's identity: everything about it — state, summary, evidence, lineage,
// dispute, and history. Any change, including a reconfirmation elsewhere, changes it.
// Provenance shape is normalized (schema v1 `origin` ≡ schema v2 `origins: [origin]`)
// so a schema upgrade alone never looks like a semantic change.
export function factFingerprint(fact) {
  const { origin, origins, ...rest } = fact ?? {};
  return sha256(canonicalJson({ ...rest, origins: origins ?? (origin ? [origin] : []) })).slice(0, 16);
}

export function shortFingerprint(value) {
  return typeof value === 'string' ? value.slice(0, 12) : 'none';
}
