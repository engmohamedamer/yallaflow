import path from 'node:path';
import { rename, writeFile } from 'node:fs/promises';
import { ensureDir, exists } from '../utils/fs.js';
import { readYaml } from '../core/yaml.js';
import { workspacePath } from '../core/workspace.js';
import { gitHead } from '../core/git.js';
import { deriveProvenance, validateEvidenceEntry } from './evidence.js';
import { writeContextProjection } from './projection.js';
import {
  CONFIDENCE_LEVELS,
  CONTEXT_AREAS,
  CONTEXT_SCHEMA_V1,
  CONTEXT_SCHEMA_V2,
  CONTEXT_SCHEMA_VERSION,
  FACT_ID_PATTERN,
  FACT_PROVENANCE_VALUES,
  FACT_STATES,
  HISTORY_ACTIONS,
  SUPPORTED_CONTEXT_SCHEMAS,
  V1_HISTORY_ACTIONS
} from './constants.js';

// The one canonical, structured source of truth for durable project knowledge.
// Markdown under context/ and PROJECT.md is a projection of this ledger's current
// facts (projection.js); work items keep their own immutable history (knowledge.yaml,
// baseline.yaml) and are never rewritten when project understanding evolves.
//
// Exactly one writer: every mutation goes through mutateContextLedger below, which
// validates, persists, then re-renders the managed Markdown sections it affected.
// Reads never create the ledger — an absent file is an empty in-memory ledger.
//
// Failure model: the ledger write itself is atomic (validated in memory, written to a
// temporary file, then renamed over index.yaml). Rendering the Markdown projection is
// a separate, derived step — ledger + projection are NOT one filesystem transaction.
// If rendering fails after the ledger is written, canonical knowledge is intact,
// `doctor` reports the projection drift, `yallaflow context render` regenerates it
// deterministically, and retrying the originating command is idempotent (producers
// check appliedTransition before re-applying, so no fact, history entry, or lineage
// link is duplicated).

const LEDGER_FIELDS = new Set(['schemaVersion', 'facts', 'updatedAt']);
const FACT_FIELDS = new Set([
  'id', 'area', 'state', 'confidence', 'summary', 'provenance', 'origin', 'origins', 'evidence',
  'verifiedAt', 'verifiedAtCommit', 'supersedes', 'supersededBy', 'dispute', 'note',
  'history', 'createdAt', 'updatedAt'
]);
const V1_ORIGIN_FIELDS = new Set(['workId', 'candidateId', 'baselineFactId', 'adopted']);
const ORIGIN_FIELDS = new Set([...V1_ORIGIN_FIELDS, 'reconciliation']);
const RECONCILIATION_REF_FIELDS = new Set(['workId', 'candidate']);

export function contextLedgerPath(root) {
  return path.join(workspacePath(root), 'context', 'index.yaml');
}

// Reads the ledger exactly as stored — no migration on read. A ledger written by a
// newer YallaFlow (schema beyond SUPPORTED_CONTEXT_SCHEMAS) is refused up front with a
// clear message instead of being misread field by field.
export async function loadContextLedger(root) {
  const file = contextLedgerPath(root);
  if (!await exists(file)) return { exists: false, ledger: emptyLedger() };
  const ledger = await readYaml(file);
  const version = ledger?.schemaVersion;
  if (Number.isInteger(version) && version > CONTEXT_SCHEMA_VERSION) throw new Error(unsupportedSchemaMessage(version));
  return { exists: true, ledger };
}

// Read-only, never throws: which schema the workspace ledger uses and whether this CLI
// supports it (for `upgrade status` / `brief` / `doctor`).
export async function probeContextSchema(root) {
  const file = contextLedgerPath(root);
  if (!await exists(file)) return { exists: false, version: null, supported: true };
  try {
    const version = (await readYaml(file))?.schemaVersion ?? null;
    return { exists: true, version, supported: SUPPORTED_CONTEXT_SCHEMAS.includes(version), newer: Number.isInteger(version) && version > CONTEXT_SCHEMA_VERSION };
  } catch {
    return { exists: true, version: null, supported: false, unreadable: true };
  }
}

export function unsupportedSchemaMessage(version) {
  return `.yallaflow/context/index.yaml uses context schema v${version}, written by a newer YallaFlow; this CLI supports v${SUPPORTED_CONTEXT_SCHEMAS.join(' and v')}. Upgrade YallaFlow — nothing was read or changed.`;
}

// New ledgers start at schema v1 (readable by v0.3.6) and move to v2 only when their
// content requires it.
export function emptyLedger() {
  return { schemaVersion: CONTEXT_SCHEMA_V1, facts: [], updatedAt: null };
}

export function findFact(ledger, factId) {
  return ledger.facts.find((fact) => fact.id === factId) ?? null;
}

export function currentFacts(ledger) {
  return ledger.facts.filter((fact) => fact.state !== 'superseded');
}

// Applies one or more fact transitions to an in-memory draft; nothing is written
// unless the resulting ledger is structurally valid, and the ledger file is replaced
// atomically. `mutator(ops)` receives the operations below bound to the draft.
// `minSchema` lets a deliberate path (reconciliation apply) require schema v2; any
// mutation whose result needs v2 upgrades the ledger to v2 regardless.
export async function mutateContextLedger(root, mutator, now = new Date().toISOString(), { minSchema = CONTEXT_SCHEMA_V1 } = {}) {
  const { ledger } = await loadContextLedger(root);
  const { result, touchedAreas } = await applyToDraft(ledger, mutator, { now, head: gitHead(root), minSchema });
  ledger.updatedAt = now;
  await writeLedgerAtomically(root, ledger);
  try {
    await writeContextProjection(root, ledger, [...touchedAreas]);
  } catch (error) {
    throw new Error(
      `Project context ledger updated, but rendering the Markdown projection failed: ${error instanceof Error ? error.message : String(error)}\n` +
      'Canonical knowledge in .yallaflow/context/index.yaml is intact. Fix the cause, then run `yallaflow context render` ' +
      '(retrying the original command is also safe — it will not duplicate facts).'
    );
  }
  return { ledger, result };
}

// The same transitions against a deep copy of `ledger`, never written anywhere — the
// read-only preview of exactly what mutateContextLedger would produce (same
// operations, same validation, same CTX IDs, same schema). Throws on an invalid transition.
export async function simulateContextLedger(ledger, mutator, { now = new Date().toISOString(), head = null, minSchema = CONTEXT_SCHEMA_V1 } = {}) {
  const draft = structuredClone(ledger);
  const { result } = await applyToDraft(draft, mutator, { now, head, minSchema });
  return { ledger: draft, result };
}

// Validate the stored form → work on one canonical in-memory provenance shape
// (`origins` on every fact) → write at the lowest schema that can represent the
// result, never below the ledger's current schema → validate the stored form again.
async function applyToDraft(ledger, mutator, { now, head, minSchema }) {
  const before = validateContextLedger(ledger);
  if (before.length) {
    throw new Error(`The project context ledger is invalid; refusing to modify it:\n${before.map((entry) => `- ${entry}`).join('\n')}\nRun \`yallaflow doctor\` for details.`);
  }
  const stored = ledger.schemaVersion;
  for (const fact of ledger.facts) {
    if (!fact.origins) renameKey(fact, 'origin', 'origins', [fact.origin]);
  }
  const touchedAreas = new Set();
  const ops = createOperations(ledger, { now, head, touchedAreas });
  const result = await mutator(ops);
  const target = Math.max(stored, minSchema, requiresSchemaV2(ledger) ? CONTEXT_SCHEMA_V2 : CONTEXT_SCHEMA_V1);
  ledger.schemaVersion = target;
  if (target === CONTEXT_SCHEMA_V1) {
    for (const fact of ledger.facts) renameKey(fact, 'origins', 'origin', fact.origins[0]);
  }
  const after = validateContextLedger(ledger);
  if (after.length) throw new Error(`Project context transition rejected:\n${after.map((entry) => `- ${entry}`).join('\n')}`);
  return { result, touchedAreas };
}

// Content that schema v1 (v0.3.6) cannot represent: more than one origin, a
// reconciliation reference anywhere in a fact, or a v2-only history event.
export function requiresSchemaV2(ledger) {
  return ledger.facts.some((fact) => factOrigins(fact).length > 1 || containsKey(fact, 'reconciliation') ||
    (fact.history ?? []).some((entry) => !V1_HISTORY_ACTIONS.includes(entry?.action) || entry?.historical !== undefined));
}

function containsKey(value, key) {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((entry) => containsKey(entry, key));
  return Object.keys(value).some((name) => name === key || containsKey(value[name], key));
}

// Replaces one key in place, keeping its position — so a fact that did not change
// serializes byte-for-byte as before.
function renameKey(object, from, to, value) {
  if (!(from in object)) return;
  const entries = Object.entries(object).map(([name, current]) => (name === from ? [to, value] : [name, current]));
  for (const name of Object.keys(object)) delete object[name];
  for (const [name, current] of entries) object[name] = current;
}

async function writeLedgerAtomically(root, ledger) {
  const file = contextLedgerPath(root);
  await ensureDir(path.dirname(file));
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');
  await rename(temporary, file);
}

// Every historical origin a fact carries, introducing origin first: `origins` (schema
// v2) or the single `origin` (schema v1). The one accessor every reader uses, so no
// consumer depends on which schema a ledger is stored in.
export function factOrigins(fact) {
  if (Array.isArray(fact?.origins)) return fact.origins;
  return fact?.origin ? [fact.origin] : [];
}

// Identity of a historical origin: the work item plus the knowledge candidate or
// baseline fact inside it. Adoption/reconciliation annotations are not part of it.
export function originKey(origin = {}) {
  return `${origin.workId}:${origin.candidateId ? `K:${origin.candidateId}` : `B:${origin.baselineFactId ?? ''}`}`;
}

// The fact a given candidate or baseline fact already produced or transitioned, if
// any — the idempotency key that makes retrying a partially completed promotion,
// approval, or reconciliation safe. Matches an introducing origin, any contributing
// origin (multi-origin facts), or a reconfirm/dispute/merge history entry.
export function appliedTransition(ledger, origin) {
  const key = originKey(origin);
  const matches = (entry) => entry?.workId === origin.workId && originKey(entry) === key;
  for (const fact of ledger.facts) {
    if (factOrigins(fact).some(matches)) return fact;
    if ((fact.history ?? []).some((event) => ['reconfirmed', 'disputed', 'merged'].includes(event.action) && matches(event))) return fact;
  }
  return null;
}

function createOperations(ledger, { now, head, touchedAreas }) {
  const nextId = () => {
    const highest = ledger.facts.reduce((max, fact) => Math.max(max, Number(/^CTX-(\d+)$/.exec(fact.id)?.[1]) || 0), 0);
    return `CTX-${String(highest + 1).padStart(4, '0')}`;
  };

  const requireFact = (factId, allowedStates, verb) => {
    if (!FACT_ID_PATTERN.test(factId ?? '')) throw new Error(`${JSON.stringify(factId)} is not a valid project context fact ID (CTX-####).`);
    const fact = findFact(ledger, factId);
    if (!fact) throw new Error(`Project context fact ${factId} was not found.`);
    if (!allowedStates.includes(fact.state)) {
      throw new Error(`Cannot ${verb} ${factId}: it is ${fact.state}${fact.supersededBy ? ` (superseded by ${fact.supersededBy})` : ''}.`);
    }
    return fact;
  };

  const introduce = (input, action = 'introduced') => {
    const evidence = input.evidence;
    if (!Array.isArray(evidence) || !evidence.length) throw new Error('A project context fact requires at least one evidence entry.');
    const fact = {
      id: nextId(),
      area: input.area,
      state: 'current',
      confidence: input.confidence ?? 'confirmed',
      summary: input.summary,
      provenance: input.provenance ?? deriveProvenance(evidence),
      origins: [input.origin],
      evidence,
      verifiedAt: input.verifiedAt ?? now,
      verifiedAtCommit: input.verifiedAtCommit !== undefined ? input.verifiedAtCommit : head,
      supersedes: [],
      supersededBy: null,
      ...(input.note ? { note: input.note } : {}),
      history: [{ action, at: now, ...originRef(input.origin) }],
      createdAt: now,
      updatedAt: now
    };
    ledger.facts.push(fact);
    touchedAreas.add(fact.area);
    return fact;
  };

  const supersede = (targetId, input, action = 'introduced') => {
    const previous = requireFact(targetId, ['current', 'disputed'], 'supersede');
    const fact = introduce(input, action);
    fact.supersedes = [previous.id];
    fact.history[0].supersedes = previous.id;
    if (previous.dispute) {
      previous.history.push({ action: 'dispute-resolved', at: now, resolution: 'superseded', dispute: previous.dispute, ...originRef(input.origin) });
      delete previous.dispute;
    }
    previous.state = 'superseded';
    previous.supersededBy = fact.id;
    previous.updatedAt = now;
    previous.history.push({ action: 'superseded', at: now, supersededBy: fact.id, ...originRef(input.origin) });
    touchedAreas.add(previous.area);
    return { previous, fact };
  };

  // Same semantic fact, fresh verification: the fact keeps its ID and summary; its
  // supporting evidence and verification point are replaced, and the prior evidence
  // is preserved in history. Reconfirming a disputed fact resolves the dispute.
  const reconfirm = (factId, input) => {
    const fact = requireFact(factId, ['current', 'disputed'], 'reconfirm');
    if (!Array.isArray(input.evidence) || !input.evidence.length) throw new Error('Reconfirming a fact requires fresh evidence.');
    const entry = {
      action: 'reconfirmed',
      at: now,
      ...originRef(input.origin),
      previousEvidence: fact.evidence,
      previousVerifiedAt: fact.verifiedAt,
      previousVerifiedAtCommit: fact.verifiedAtCommit
    };
    if (fact.dispute) {
      fact.history.push({ action: 'dispute-resolved', at: now, resolution: 'reconfirmed', dispute: fact.dispute, ...originRef(input.origin) });
      delete fact.dispute;
      fact.state = 'current';
    }
    fact.history.push(entry);
    fact.evidence = input.evidence;
    if (input.confidence) fact.confidence = input.confidence;
    if (fact.provenance === 'unspecified') fact.provenance = deriveProvenance(input.evidence);
    fact.verifiedAt = now;
    fact.verifiedAtCommit = head;
    fact.updatedAt = now;
    touchedAreas.add(fact.area);
    return { fact };
  };

  const dispute = (factId, input) => {
    const fact = requireFact(factId, ['current'], 'dispute');
    if (!Array.isArray(input.evidence) || !input.evidence.length) throw new Error('Disputing a fact requires the conflicting evidence.');
    fact.state = 'disputed';
    fact.dispute = { summary: input.summary, evidence: input.evidence, raisedBy: input.origin, raisedAt: now };
    fact.history.push({ action: 'disputed', at: now, summary: input.summary, ...originRef(input.origin) });
    fact.updatedAt = now;
    touchedAreas.add(fact.area);
    return { fact };
  };

  // Historical provenance only (v0.3.7 reconciliation): another historical work item
  // established the same fact. The origin is appended to the fact's origins and a
  // history event records how it was related ('merged' — the same fact worded
  // differently; 'reconfirmed' — an independent confirmation). A historical record is
  // not fresh verification: evidence, verification point, and state are unchanged.
  const attachOrigin = (factId, origin, action) => {
    if (!['merged', 'reconfirmed'].includes(action)) throw new Error(`Unsupported origin relation ${JSON.stringify(action)}.`);
    const fact = requireFact(factId, ['current', 'disputed'], action === 'merged' ? 'merge into' : 'reconfirm');
    if (factOrigins(fact).some((entry) => originKey(entry) === originKey(origin))) {
      throw new Error(`${factId} already carries origin ${origin.workId} ${origin.candidateId ?? origin.baselineFactId}.`);
    }
    fact.origins.push(origin);
    fact.history.push({ action, at: now, historical: true, ...originRef(origin) });
    fact.updatedAt = now;
    touchedAreas.add(fact.area);
    return { fact };
  };

  const touch = (area) => touchedAreas.add(area);

  return { introduce, supersede, reconfirm, dispute, attachOrigin, requireFact, touch, ledger };
}

function originRef(origin) {
  if (!origin) return {};
  return {
    ...(origin.workId ? { workId: origin.workId } : {}),
    ...(origin.candidateId ? { candidateId: origin.candidateId } : {}),
    ...(origin.baselineFactId ? { baselineFactId: origin.baselineFactId } : {}),
    ...(origin.reconciliation ? { reconciliation: { ...origin.reconciliation } } : {})
  };
}

// Structural and lineage validation — pure, no filesystem. Doctor adds the checks
// that need workspace context (referenced work items, projection drift, freshness).
export function validateContextLedger(ledger) {
  const errors = [];
  if (!ledger || typeof ledger !== 'object' || Array.isArray(ledger)) return ['context ledger must be an object.'];
  const unknown = Object.keys(ledger).filter((field) => !LEDGER_FIELDS.has(field));
  if (unknown.length) errors.push(`context ledger has unknown field(s): ${unknown.join(', ')}.`);
  if (!SUPPORTED_CONTEXT_SCHEMAS.includes(ledger.schemaVersion)) {
    return [...errors, Number.isInteger(ledger.schemaVersion) && ledger.schemaVersion > CONTEXT_SCHEMA_VERSION
      ? unsupportedSchemaMessage(ledger.schemaVersion)
      : `context ledger schemaVersion must be one of ${SUPPORTED_CONTEXT_SCHEMAS.join(', ')}.`];
  }
  if (!Array.isArray(ledger.facts)) return [...errors, 'context ledger must contain a facts array.'];
  const version = ledger.schemaVersion;

  const byId = new Map();
  for (const fact of ledger.facts) {
    const id = fact?.id;
    if (!FACT_ID_PATTERN.test(id ?? '')) {
      errors.push(`context fact has invalid ID ${JSON.stringify(id)}.`);
      continue;
    }
    if (byId.has(id)) errors.push(`duplicate context fact ID ${id}.`);
    byId.set(id, fact);
  }

  for (const fact of ledger.facts) {
    if (!FACT_ID_PATTERN.test(fact?.id ?? '')) continue;
    errors.push(...validateFact(fact, version));
  }

  // Lineage: both directions must agree, and nothing may point at a missing fact.
  for (const fact of ledger.facts) {
    if (!FACT_ID_PATTERN.test(fact?.id ?? '')) continue;
    for (const targetId of Array.isArray(fact.supersedes) ? fact.supersedes : []) {
      const target = byId.get(targetId);
      if (!target) {
        errors.push(`${fact.id} supersedes unknown fact ${targetId}.`);
        continue;
      }
      if (target.supersededBy !== fact.id) errors.push(`${fact.id} supersedes ${targetId}, but ${targetId} is not marked superseded by ${fact.id}.`);
      if (target.state !== 'superseded') errors.push(`${targetId} is superseded by ${fact.id} but its state is ${target.state}.`);
    }
    if (fact.supersededBy) {
      const successor = byId.get(fact.supersededBy);
      if (!successor) errors.push(`${fact.id} is superseded by unknown fact ${fact.supersededBy}.`);
      else if (!(successor.supersedes ?? []).includes(fact.id)) errors.push(`${fact.id} is marked superseded by ${fact.supersededBy}, but ${fact.supersededBy} does not supersede it.`);
      if (fact.supersededBy === fact.id) errors.push(`${fact.id} cannot supersede itself.`);
    }
  }
  errors.push(...detectSupersessionCycles(ledger.facts, byId));
  errors.push(...detectDuplicateOrigins(ledger.facts));
  return errors;
}

function validateFact(fact, version) {
  const errors = [];
  const label = fact.id;
  const unknown = Object.keys(fact).filter((field) => !FACT_FIELDS.has(field));
  if (unknown.length) errors.push(`${label} has unknown field(s): ${unknown.join(', ')}.`);
  if (!CONTEXT_AREAS.includes(fact.area)) errors.push(`${label} has unknown area ${JSON.stringify(fact.area)}.`);
  if (!FACT_STATES.includes(fact.state)) errors.push(`${label} has unknown state ${JSON.stringify(fact.state)}.`);
  if (!CONFIDENCE_LEVELS.includes(fact.confidence)) errors.push(`${label} has unknown confidence ${JSON.stringify(fact.confidence)}.`);
  if (!FACT_PROVENANCE_VALUES.includes(fact.provenance)) errors.push(`${label} has malformed provenance ${JSON.stringify(fact.provenance)}.`);
  if (!isNonEmptyString(fact.summary)) errors.push(`${label} requires a non-empty summary.`);

  errors.push(...validateProvenance(fact, version));

  if (!Array.isArray(fact.evidence) || !fact.evidence.length) {
    errors.push(`${label} has no evidence.`);
  } else {
    for (const entry of fact.evidence) {
      const problem = validateEvidenceEntry(entry);
      if (problem) errors.push(`${label}: ${problem}.`);
    }
  }

  if (!isNonEmptyString(fact.verifiedAt)) errors.push(`${label} requires verifiedAt.`);
  if (fact.verifiedAtCommit !== null && fact.verifiedAtCommit !== undefined && !/^[0-9a-f]{7,64}$/.test(fact.verifiedAtCommit)) {
    errors.push(`${label} has a malformed verifiedAtCommit.`);
  }
  if (!Array.isArray(fact.supersedes)) errors.push(`${label} requires a supersedes array.`);
  if (fact.supersededBy !== null && fact.supersededBy !== undefined && !FACT_ID_PATTERN.test(fact.supersededBy)) {
    errors.push(`${label} has a malformed supersededBy.`);
  }

  // Impossible lifecycle states.
  if (fact.state === 'superseded' && !fact.supersededBy) errors.push(`${label} is superseded but names no successor (supersededBy).`);
  if (fact.state !== 'superseded' && fact.supersededBy) errors.push(`${label} is ${fact.state} but is marked superseded by ${fact.supersededBy}.`);
  if (fact.state === 'disputed' && (!fact.dispute || !isNonEmptyString(fact.dispute.summary) || !Array.isArray(fact.dispute.evidence) || !fact.dispute.evidence.length)) {
    errors.push(`${label} is disputed but has no dispute record with conflicting evidence.`);
  }
  if (fact.state !== 'disputed' && fact.dispute) errors.push(`${label} is ${fact.state} but still carries an open dispute record.`);
  if (fact.dispute?.evidence) {
    for (const entry of fact.dispute.evidence) {
      const problem = validateEvidenceEntry(entry);
      if (problem) errors.push(`${label} dispute: ${problem}.`);
    }
  }

  if (!Array.isArray(fact.history) || !fact.history.length) {
    errors.push(`${label} requires a history array.`);
  } else if (fact.history.some((entry) => !HISTORY_ACTIONS.includes(entry?.action) || !isNonEmptyString(entry?.at))) {
    errors.push(`${label} has a malformed history entry.`);
  } else if (version === CONTEXT_SCHEMA_V1 && fact.history.some((entry) => !V1_HISTORY_ACTIONS.includes(entry.action) || entry.historical !== undefined)) {
    errors.push(`${label} has schema-v2 history (merged / historical events) in a schema v1 ledger.`);
  }
  if (!isNonEmptyString(fact.createdAt) || !isNonEmptyString(fact.updatedAt)) errors.push(`${label} requires createdAt and updatedAt.`);
  return errors;
}

// One canonical provenance representation per schema, never both:
//   v1 — `origin` only (v0.3.6 shape; no reconciliation data anywhere in the fact)
//   v2 — `origins` only (non-empty, introducing origin first, no duplicates)
function validateProvenance(fact, version) {
  const label = fact.id;
  const errors = [];
  const hasOrigin = fact.origin !== undefined;
  const hasOrigins = fact.origins !== undefined;
  if (hasOrigin && hasOrigins) return [`${label} carries both origin and origins (divergent provenance); schema v${version} records provenance only in ${version === CONTEXT_SCHEMA_V1 ? 'origin' : 'origins'}.`];
  if (version === CONTEXT_SCHEMA_V1) {
    if (hasOrigins) return [`${label} uses origins, which requires context schema v2 (this ledger is v1).`];
    if (!isOriginObject(fact.origin)) return [`${label} requires an origin work item.`];
    errors.push(...validateOrigin(fact.origin, `${label} origin`, V1_ORIGIN_FIELDS));
    if (containsKey(fact, 'reconciliation')) errors.push(`${label} holds reconciliation data, which requires context schema v2 (this ledger is v1).`);
    return errors;
  }
  if (hasOrigin) return [`${label} uses origin; schema v2 records provenance only in origins.`];
  if (!Array.isArray(fact.origins) || !fact.origins.length) return [`${label} requires an origins array with at least its introducing origin.`];
  fact.origins.forEach((entry, index) => {
    if (!isOriginObject(entry)) errors.push(`${label} origins[${index}] requires an origin work item.`);
    else errors.push(...validateOrigin(entry, `${label} origins[${index}]`, ORIGIN_FIELDS));
  });
  const keys = fact.origins.map((entry) => originKey(entry ?? {}));
  const duplicate = keys.find((key, index) => keys.indexOf(key) !== index);
  if (duplicate) errors.push(`${label} lists origin ${duplicate.replace(/:[KB]:/, ' ')} more than once.`);
  return errors;
}

function isOriginObject(origin) {
  return Boolean(origin) && typeof origin === 'object' && !Array.isArray(origin) && /^PF-\d+$/.test(origin.workId ?? '');
}

function validateOrigin(origin, label, allowed) {
  const errors = [];
  const unknown = Object.keys(origin).filter((field) => !allowed.has(field));
  if (unknown.length) errors.push(`${label} has unknown field(s): ${unknown.join(', ')}.`);
  if (origin.reconciliation !== undefined) {
    const ref = origin.reconciliation;
    if (!ref || typeof ref !== 'object' || Array.isArray(ref) || Object.keys(ref).some((field) => !RECONCILIATION_REF_FIELDS.has(field)) ||
      !/^PF-\d+$/.test(ref.workId ?? '') || !/^RC-\d{4,}$/.test(ref.candidate ?? '')) {
      errors.push(`${label} has a malformed reconciliation reference.`);
    }
  }
  return errors;
}

// One historical origin establishes at most one fact: the same work-item candidate or
// baseline fact appearing as an origin of two facts means it was applied twice.
function detectDuplicateOrigins(facts) {
  const owners = new Map();
  const errors = [];
  for (const fact of facts) {
    if (!FACT_ID_PATTERN.test(fact?.id ?? '')) continue;
    for (const origin of factOrigins(fact)) {
      if (!origin?.workId) continue;
      const key = originKey(origin);
      const owner = owners.get(key);
      if (owner && owner !== fact.id) errors.push(`origin ${origin.workId} ${origin.candidateId ?? origin.baselineFactId} is claimed by both ${owner} and ${fact.id} (applied twice).`);
      else owners.set(key, fact.id);
    }
  }
  return errors;
}

function detectSupersessionCycles(facts, byId) {
  const errors = [];
  for (const fact of facts) {
    const seen = new Set();
    let cursor = fact;
    while (cursor?.supersededBy) {
      if (seen.has(cursor.id)) {
        errors.push(`supersession cycle detected involving ${fact.id}.`);
        break;
      }
      seen.add(cursor.id);
      cursor = byId.get(cursor.supersededBy);
    }
  }
  return [...new Set(errors)];
}

// Walks supersession lineage in both directions from a fact (oldest → newest).
export function lineageOf(ledger, factId) {
  const byId = new Map(ledger.facts.map((fact) => [fact.id, fact]));
  const start = byId.get(factId);
  if (!start) return [];
  const older = [];
  const seen = new Set([start.id]);
  let queue = [...(start.supersedes ?? [])];
  while (queue.length) {
    const id = queue.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    const fact = byId.get(id);
    if (!fact) continue;
    older.unshift(fact);
    queue.push(...(fact.supersedes ?? []));
  }
  const newer = [];
  let cursor = start;
  while (cursor?.supersededBy && !seen.has(cursor.supersededBy)) {
    seen.add(cursor.supersededBy);
    cursor = byId.get(cursor.supersededBy);
    if (cursor) newer.push(cursor);
  }
  return [...older, start, ...newer];
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}
