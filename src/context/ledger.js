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
  CONTEXT_SCHEMA_VERSION,
  FACT_ID_PATTERN,
  FACT_PROVENANCE_VALUES,
  FACT_STATES,
  HISTORY_ACTIONS
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
  'id', 'area', 'state', 'confidence', 'summary', 'provenance', 'origin', 'evidence',
  'verifiedAt', 'verifiedAtCommit', 'supersedes', 'supersededBy', 'dispute', 'note',
  'history', 'createdAt', 'updatedAt'
]);
const ORIGIN_FIELDS = new Set(['workId', 'candidateId', 'baselineFactId', 'adopted']);

export function contextLedgerPath(root) {
  return path.join(workspacePath(root), 'context', 'index.yaml');
}

export async function loadContextLedger(root) {
  const file = contextLedgerPath(root);
  if (!await exists(file)) return { exists: false, ledger: emptyLedger() };
  return { exists: true, ledger: await readYaml(file) };
}

export function emptyLedger() {
  return { schemaVersion: CONTEXT_SCHEMA_VERSION, facts: [], updatedAt: null };
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
export async function mutateContextLedger(root, mutator, now = new Date().toISOString()) {
  const { ledger } = await loadContextLedger(root);
  const before = validateContextLedger(ledger);
  if (before.length) {
    throw new Error(`The project context ledger is invalid; refusing to modify it:\n${before.map((entry) => `- ${entry}`).join('\n')}\nRun \`yallaflow doctor\` for details.`);
  }
  const head = gitHead(root);
  const touchedAreas = new Set();
  const ops = createOperations(ledger, { now, head, touchedAreas });
  const result = await mutator(ops);
  const after = validateContextLedger(ledger);
  if (after.length) throw new Error(`Project context transition rejected:\n${after.map((entry) => `- ${entry}`).join('\n')}`);
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

async function writeLedgerAtomically(root, ledger) {
  const file = contextLedgerPath(root);
  await ensureDir(path.dirname(file));
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');
  await rename(temporary, file);
}

// The fact a given candidate or baseline fact already produced or transitioned, if
// any — the idempotency key that makes retrying a partially completed promotion or
// approval safe. Matches an introducing origin, or a reconfirm/dispute history entry.
export function appliedTransition(ledger, origin) {
  const matches = (entry) => entry?.workId === origin.workId &&
    (origin.candidateId ? entry.candidateId === origin.candidateId : entry.baselineFactId === origin.baselineFactId);
  for (const fact of ledger.facts) {
    if (matches(fact.origin)) return fact;
    if ((fact.history ?? []).some((event) => ['reconfirmed', 'disputed'].includes(event.action) && matches(event))) return fact;
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
      origin: input.origin,
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

  const supersede = (targetId, input) => {
    const previous = requireFact(targetId, ['current', 'disputed'], 'supersede');
    const fact = introduce(input);
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

  const touch = (area) => touchedAreas.add(area);

  return { introduce, supersede, reconfirm, dispute, requireFact, touch, ledger };
}

function originRef(origin) {
  if (!origin) return {};
  return {
    ...(origin.workId ? { workId: origin.workId } : {}),
    ...(origin.candidateId ? { candidateId: origin.candidateId } : {}),
    ...(origin.baselineFactId ? { baselineFactId: origin.baselineFactId } : {})
  };
}

// Structural and lineage validation — pure, no filesystem. Doctor adds the checks
// that need workspace context (referenced work items, projection drift, freshness).
export function validateContextLedger(ledger) {
  const errors = [];
  if (!ledger || typeof ledger !== 'object' || Array.isArray(ledger)) return ['context ledger must be an object.'];
  const unknown = Object.keys(ledger).filter((field) => !LEDGER_FIELDS.has(field));
  if (unknown.length) errors.push(`context ledger has unknown field(s): ${unknown.join(', ')}.`);
  if (ledger.schemaVersion !== CONTEXT_SCHEMA_VERSION) errors.push(`context ledger schemaVersion must be ${CONTEXT_SCHEMA_VERSION}.`);
  if (!Array.isArray(ledger.facts)) return [...errors, 'context ledger must contain a facts array.'];

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
    errors.push(...validateFact(fact));
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
  return errors;
}

function validateFact(fact) {
  const errors = [];
  const label = fact.id;
  const unknown = Object.keys(fact).filter((field) => !FACT_FIELDS.has(field));
  if (unknown.length) errors.push(`${label} has unknown field(s): ${unknown.join(', ')}.`);
  if (!CONTEXT_AREAS.includes(fact.area)) errors.push(`${label} has unknown area ${JSON.stringify(fact.area)}.`);
  if (!FACT_STATES.includes(fact.state)) errors.push(`${label} has unknown state ${JSON.stringify(fact.state)}.`);
  if (!CONFIDENCE_LEVELS.includes(fact.confidence)) errors.push(`${label} has unknown confidence ${JSON.stringify(fact.confidence)}.`);
  if (!FACT_PROVENANCE_VALUES.includes(fact.provenance)) errors.push(`${label} has malformed provenance ${JSON.stringify(fact.provenance)}.`);
  if (!isNonEmptyString(fact.summary)) errors.push(`${label} requires a non-empty summary.`);

  if (!fact.origin || typeof fact.origin !== 'object' || Array.isArray(fact.origin) || !/^PF-\d+$/.test(fact.origin.workId ?? '')) {
    errors.push(`${label} requires an origin work item.`);
  } else {
    const unknownOrigin = Object.keys(fact.origin).filter((field) => !ORIGIN_FIELDS.has(field));
    if (unknownOrigin.length) errors.push(`${label} origin has unknown field(s): ${unknownOrigin.join(', ')}.`);
  }

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
  }
  if (!isNonEmptyString(fact.createdAt) || !isNonEmptyString(fact.updatedAt)) errors.push(`${label} requires createdAt and updatedAt.`);
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
