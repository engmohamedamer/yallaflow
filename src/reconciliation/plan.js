import { createHash } from 'node:crypto';
import { appliedTransition, findFact } from '../context/ledger.js';
import { CONFIDENCE_LEVELS, CONTEXT_AREAS, FACT_ID_PATTERN, LIMITATION_TYPES } from '../context/constants.js';
import {
  FACT_PRODUCING_ACTIONS,
  JOINING_ACTIONS,
  MARKDOWN_OUTCOMES,
  PLAN_STATUSES,
  RC_ID_PATTERN,
  REASON_REQUIRED_ACTIONS,
  RECONCILIATION_ACTIONS,
  RECONCILIATION_SCHEMA_VERSION,
  TARGETED_ACTIONS
} from './constants.js';

// Pure model of a reconciliation plan (work/<id>/reconciliation.yaml): structure,
// approval fingerprint, and the relationship graph the Agent declared. No filesystem.
// Nothing here compares meaning — the only automatic comparison is exact textual
// identity (exactDuplicateKey), reported and never acted on.

const PLAN_FIELDS = new Set(['schemaVersion', 'source', 'workId', 'status', 'candidates', 'approval', 'history', 'createdAt', 'updatedAt']);
const CANDIDATE_FIELDS = new Set([
  'id', 'origin', 'kind', 'workTitle', 'area', 'summary', 'confidence', 'provenance', 'evidence', 'recordedAt', 'note',
  'legacySection', 'exactDuplicateOf', 'sameStatementAs', 'decision', 'applied'
]);
const ORIGIN_FIELDS = new Set(['workId', 'baselineFactId', 'candidateId']);
const DECISION_FIELDS = new Set(['action', 'target', 'reason', 'summary', 'area', 'limitationType', 'decidedAt']);
const APPLIED_FIELDS = new Set(['at', 'factId', 'markdown', 'limitationId']);
const APPROVAL_FIELDS = new Set(['hash', 'approvedAt', 'note']);

export function validatePlanStructure(plan) {
  const errors = [];
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return ['reconciliation plan must be an object.'];
  const unknown = Object.keys(plan).filter((field) => !PLAN_FIELDS.has(field));
  if (unknown.length) errors.push(`reconciliation plan has unknown field(s): ${unknown.join(', ')}.`);
  if (plan.schemaVersion !== RECONCILIATION_SCHEMA_VERSION) errors.push(`reconciliation plan schemaVersion must be ${RECONCILIATION_SCHEMA_VERSION}.`);
  if (!PLAN_STATUSES.includes(plan.status)) errors.push(`reconciliation plan has unknown status ${JSON.stringify(plan.status)}.`);
  if (!Array.isArray(plan.candidates) || !plan.candidates.length) return [...errors, 'reconciliation plan must contain a non-empty candidates array.'];
  if (!Array.isArray(plan.history)) errors.push('reconciliation plan requires a history array.');

  const ids = new Set();
  const origins = new Set();
  for (const candidate of plan.candidates) {
    const label = candidate?.id ?? '<unknown candidate>';
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      errors.push('reconciliation candidate must be an object.');
      continue;
    }
    const extra = Object.keys(candidate).filter((field) => !CANDIDATE_FIELDS.has(field));
    if (extra.length) errors.push(`${label} has unknown field(s): ${extra.join(', ')}.`);
    if (!RC_ID_PATTERN.test(candidate.id ?? '')) errors.push(`reconciliation candidate has invalid ID ${JSON.stringify(candidate.id)}.`);
    if (ids.has(candidate.id)) errors.push(`duplicate reconciliation candidate ID ${candidate.id}.`);
    ids.add(candidate.id);

    const origin = candidate.origin;
    if (!origin || typeof origin !== 'object' || !/^PF-\d+$/.test(origin.workId ?? '') ||
      Boolean(origin.baselineFactId) === Boolean(origin.candidateId) ||
      Object.keys(origin).some((field) => !ORIGIN_FIELDS.has(field))) {
      errors.push(`${label} is missing its origin (work item plus exactly one baselineFactId or candidateId).`);
    } else {
      const key = candidateOriginKey(candidate);
      if (origins.has(key)) errors.push(`${label} repeats origin ${origin.workId} ${origin.baselineFactId ?? origin.candidateId}; each legacy item is one candidate.`);
      origins.add(key);
      if (!['baseline', 'knowledge'].includes(candidate.kind) || (candidate.kind === 'baseline') !== Boolean(origin.baselineFactId)) {
        errors.push(`${label} has a kind that does not match its origin.`);
      }
    }
    if (!CONTEXT_AREAS.includes(candidate.area)) errors.push(`${label} has unknown area ${JSON.stringify(candidate.area)}.`);
    if (!isNonEmptyString(candidate.summary)) errors.push(`${label} requires a summary.`);
    if (!CONFIDENCE_LEVELS.includes(candidate.confidence)) errors.push(`${label} has unknown confidence ${JSON.stringify(candidate.confidence)}.`);
    if (!Array.isArray(candidate.evidence) || !candidate.evidence.length || candidate.evidence.some((entry) => !isNonEmptyString(entry))) {
      errors.push(`${label} requires its recorded evidence references.`);
    }
    for (const field of ['exactDuplicateOf']) {
      if (candidate[field] !== undefined && !RC_ID_PATTERN.test(candidate[field])) errors.push(`${label} has a malformed ${field}.`);
    }
    if (candidate.sameStatementAs !== undefined && !FACT_ID_PATTERN.test(candidate.sameStatementAs)) errors.push(`${label} has a malformed sameStatementAs.`);
    if (candidate.decision !== undefined) errors.push(...validateDecisionShape(candidate.decision, label));
    if (candidate.applied !== undefined) {
      const applied = candidate.applied;
      if (!applied || typeof applied !== 'object' || Object.keys(applied).some((field) => !APPLIED_FIELDS.has(field)) || !isNonEmptyString(applied.at)) {
        errors.push(`${label} has a malformed applied record.`);
      } else {
        if (!candidate.decision) errors.push(`${label} is marked applied but has no decision.`);
        if (applied.factId !== undefined && !FACT_ID_PATTERN.test(applied.factId)) errors.push(`${label} applied record has a malformed factId.`);
        if (applied.markdown !== undefined && !MARKDOWN_OUTCOMES.includes(applied.markdown)) errors.push(`${label} applied record has an unknown markdown outcome.`);
        const producesFact = candidate.decision && !['skip', 'limitation'].includes(candidate.decision.action);
        if (producesFact && !applied.factId) errors.push(`${label} is applied as ${candidate.decision.action} but records no CTX fact.`);
      }
    }
  }
  if (plan.approval !== undefined) {
    const approval = plan.approval;
    if (!approval || typeof approval !== 'object' || Object.keys(approval).some((field) => !APPROVAL_FIELDS.has(field)) ||
      !/^sha256:[0-9a-f]{64}$/.test(approval.hash ?? '') || !isNonEmptyString(approval.approvedAt)) {
      errors.push('reconciliation plan has a malformed approval record.');
    }
  }
  if (plan.status === 'applied' && plan.candidates.some((candidate) => !candidate.applied)) {
    errors.push('reconciliation plan is marked applied but not every candidate is applied.');
  }
  return errors;
}

function validateDecisionShape(decision, label) {
  const errors = [];
  if (!decision || typeof decision !== 'object' || Array.isArray(decision)) return [`${label} has a malformed decision.`];
  const extra = Object.keys(decision).filter((field) => !DECISION_FIELDS.has(field));
  if (extra.length) errors.push(`${label} decision has unknown field(s): ${extra.join(', ')}.`);
  const { action } = decision;
  if (!RECONCILIATION_ACTIONS.includes(action)) {
    return [...errors, `${label} has invalid action ${JSON.stringify(action)}; must be one of: ${RECONCILIATION_ACTIONS.join(', ')}.`];
  }
  if (action === 'merge-with') {
    if (FACT_ID_PATTERN.test(decision.target ?? '')) {
      errors.push(`${label} (merge-with) targets ${decision.target}: merge-with collapses reconciliation candidates into one canonical fact. To relate a candidate to an existing fact use reconfirms (the same truth, one more historical observation), supersedes, or disputes.`);
    } else if (!RC_ID_PATTERN.test(decision.target ?? '')) {
      errors.push(`${label} (merge-with) requires a target RC-#### candidate.`);
    }
  } else if (TARGETED_ACTIONS.includes(action)) {
    if (!RC_ID_PATTERN.test(decision.target ?? '') && !FACT_ID_PATTERN.test(decision.target ?? '')) {
      errors.push(`${label} (${action}) requires a target RC-#### candidate or CTX-#### fact.`);
    }
  } else if (decision.target !== undefined) {
    errors.push(`${label} (${action}) must not name a target.`);
  }
  if (REASON_REQUIRED_ACTIONS.includes(action) && !isNonEmptyString(decision.reason)) errors.push(`${label} (${action}) requires a reason.`);
  if (decision.reason !== undefined && !isNonEmptyString(decision.reason)) errors.push(`${label} has an empty reason.`);
  if (decision.summary !== undefined || decision.area !== undefined) {
    if (!FACT_PRODUCING_ACTIONS.includes(action)) errors.push(`${label} (${action}) may not set summary/area; only a candidate that becomes a fact (new, supersedes) can.`);
    if (decision.summary !== undefined && !isNonEmptyString(decision.summary)) errors.push(`${label} has an empty summary.`);
    if (decision.area !== undefined && !CONTEXT_AREAS.includes(decision.area)) errors.push(`${label} has unknown area ${JSON.stringify(decision.area)}.`);
  }
  if (action === 'limitation') {
    if (!LIMITATION_TYPES.includes(decision.limitationType)) errors.push(`${label} (limitation) requires limitationType, one of: ${LIMITATION_TYPES.join(', ')}.`);
  } else if (decision.limitationType !== undefined) {
    errors.push(`${label} (${action}) must not set limitationType.`);
  }
  return errors;
}

// Normalizes one Agent-supplied decision ({candidate, action, ...}) into the stored
// shape. `action: "pending"` clears a decision.
export function normalizeDecisionInput(raw, now) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Each decision must be an object with at least candidate and action.');
  const allowed = new Set(['candidate', 'action', 'target', 'reason', 'summary', 'area', 'limitationType']);
  const extra = Object.keys(raw).filter((field) => !allowed.has(field));
  if (extra.length) throw new Error(`Decision for ${raw.candidate ?? '<unknown>'} has unknown field(s): ${extra.join(', ')}.`);
  if (!RC_ID_PATTERN.test(raw.candidate ?? '')) throw new Error(`Decision candidate ${JSON.stringify(raw.candidate)} is not an RC-#### reconciliation candidate ID.`);
  if (raw.action === 'pending') return { candidate: raw.candidate, clear: true };
  const decision = { action: raw.action };
  for (const field of ['target', 'reason', 'summary', 'area', 'limitationType']) {
    if (raw[field] === undefined) continue;
    const value = raw[field];
    decision[field] = typeof value !== 'string' ? value : ['reason', 'summary'].includes(field) ? value.trim().replace(/\s+/g, ' ') : value.trim();
  }
  decision.decidedAt = now;
  return { candidate: raw.candidate, decision };
}

// The approval fingerprint: exactly the content a reviewer approved — the candidates
// as recorded and every decision — excluding timestamps and apply bookkeeping, so
// applying an approved plan never invalidates its own approval, while any change to
// a candidate or decision does.
export function planHash(plan) {
  const material = plan.candidates.map((candidate) => ({
    id: candidate.id,
    origin: candidate.origin,
    area: candidate.area,
    summary: candidate.summary,
    confidence: candidate.confidence,
    evidence: candidate.evidence,
    decision: candidate.decision ? stripTimestamp(candidate.decision) : null
  }));
  return `sha256:${createHash('sha256').update(stableJson(material)).digest('hex')}`;
}

export function decisionsEqual(a, b) {
  if (!a || !b) return a === b;
  return stableJson(stripTimestamp(a)) === stableJson(stripTimestamp(b));
}

function stripTimestamp(decision) {
  const { decidedAt, ...rest } = decision;
  return rest;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function candidateOriginKey(candidate) {
  const origin = candidate.origin ?? {};
  return `${origin.workId}:${origin.candidateId ? `K:${origin.candidateId}` : `B:${origin.baselineFactId ?? ''}`}`;
}

// Deterministic, explicit exact-duplicate rule — and the only automatic comparison
// reconciliation makes: same area, same normalized summary (Unicode NFC, trimmed,
// whitespace collapsed, case-folded, trailing periods removed), and the same set of
// normalized evidence references. Differently worded statements never match.
export function normalizeStatement(value) {
  return String(value ?? '').normalize('NFC').trim().replace(/\s+/g, ' ').replace(/[.\s]+$/, '').toLowerCase();
}

export function exactDuplicateKey(candidate) {
  const evidence = [...new Set((candidate.evidence ?? []).map((entry) => String(entry).normalize('NFC').trim()))].sort();
  return stableJson([candidate.area, normalizeStatement(candidate.summary), evidence]);
}

// Resolves the Agent's declared relationships against the current canonical ledger.
// Every candidate reference resolves to a "node": a candidate that becomes its own
// fact this round ({ rc }), or an existing canonical fact ({ ctx }) — including the
// fact an already-applied candidate produced or joined. Returns:
//   errors       structural problems (unknown/self/cyclic/conflicting relations) — the
//                plan cannot be approved or applied
//   stateIssues  relations that were valid but no longer fit the ledger (e.g. the
//                target fact has since been superseded) — revise before applying
//   nodes        candidate ID → resolved node, for decided, unapplied candidates
export function resolvePlan(plan, ledger) {
  const errors = [];
  const stateIssues = [];
  const byId = new Map(plan.candidates.map((candidate) => [candidate.id, candidate]));
  const pending = plan.candidates.filter((candidate) => candidate.decision && !candidate.applied);

  // Node of any candidate: what a relation targeting it actually lands on.
  const memo = new Map();
  const nodeOf = (id, trail = []) => {
    if (memo.has(id)) return memo.get(id);
    if (trail.includes(id)) return { cycle: [...trail, id] };
    const candidate = byId.get(id);
    if (!candidate) return { unknown: id };
    const { decision } = candidate;
    let node;
    if (!decision) node = { undecided: id };
    else if (candidate.applied) {
      if (['skip', 'limitation', 'disputes'].includes(decision.action)) node = { none: decision.action, id };
      else {
        const fact = appliedTransition(ledger, candidate.origin);
        node = fact ? { ctx: fact.id, via: id } : { lost: id };
      }
    } else if (FACT_PRODUCING_ACTIONS.includes(decision.action)) node = { rc: id };
    else if (JOINING_ACTIONS.includes(decision.action)) node = targetNode(decision.target, [...trail, id]);
    else node = { none: decision.action, id };
    memo.set(id, node);
    return node;
  };
  const targetNode = (target, trail) => (FACT_ID_PATTERN.test(target) ? { ctx: target } : nodeOf(target, trail));

  const describeBad = (candidate, node) => {
    const { action, target } = candidate.decision;
    if (node.cycle) return `${candidate.id} (${action}) forms a relation cycle: ${node.cycle.join(' → ')}.`;
    if (node.unknown) return `${candidate.id} (${action}) targets unknown reconciliation candidate ${node.unknown}.`;
    if (node.undecided) return `${candidate.id} (${action}) targets ${node.undecided}, which has no decision yet — decide ${node.undecided} first (or in the same file).`;
    if (node.lost) return `${candidate.id} (${action}) targets ${node.lost}, which is marked applied but whose CTX fact is missing from the ledger.`;
    if (node.none) return `${candidate.id} (${action}) targets ${target}, which does not become a project fact (${node.id} is ${node.none}).`;
    return null;
  };

  const nodes = new Map();          // candidate → the fact node it becomes or joins
  const supersedes = new Map();     // superseding candidate → target node
  const disputes = new Map();       // disputing candidate → target node
  const nodeKey = (node) => (node.rc ? `rc:${node.rc}` : `ctx:${node.ctx}`);
  const nodeLabel = (node) => node.rc ?? node.ctx;
  const supersededBy = new Map();
  const disputedBy = new Map();

  for (const candidate of pending) {
    const { action, target } = candidate.decision;
    if (target !== undefined && target === candidate.id) {
      errors.push(`${candidate.id} (${action}) cannot target itself.`);
      continue;
    }
    if (FACT_PRODUCING_ACTIONS.includes(action) || JOINING_ACTIONS.includes(action)) {
      const node = nodeOf(candidate.id);
      const bad = describeBad(candidate, node);
      if (bad) { errors.push(bad); continue; }
      nodes.set(candidate.id, node);
    }
    if (!TARGETED_ACTIONS.includes(action)) continue;

    const node = JOINING_ACTIONS.includes(action) ? nodes.get(candidate.id) : targetNode(target, [candidate.id]);
    if (!node) continue;
    const bad = describeBad(candidate, node);
    if (bad) { errors.push(bad); continue; }
    if (node.rc === candidate.id) { errors.push(`${candidate.id} (${action}) cannot target its own merge group.`); continue; }

    // A reconfirmation observes the same kind of knowledge as the fact it confirms (the
    // rule `knowledge propose --reconfirms` already applies). A misfiled duplicate in
    // another area is collapsed with merge-with instead.
    const targetArea = node.ctx ? findFact(ledger, node.ctx)?.area : effectiveArea(byId.get(node.rc));
    if (action === 'reconfirms' && targetArea && targetArea !== candidate.area) {
      errors.push(`${candidate.id} (reconfirms) is ${candidate.area} knowledge but ${nodeLabel(node)} is ${targetArea}; a reconfirmation must confirm the same kind of knowledge — use merge-with to collapse a misfiled duplicate candidate.`);
      continue;
    }
    if (node.ctx) {
      const fact = findFact(ledger, node.ctx);
      if (!fact) { errors.push(`${candidate.id} (${action}) targets unknown project context fact ${node.ctx}.`); continue; }
      const allowed = action === 'disputes' ? ['current'] : ['current', 'disputed'];
      if (!allowed.includes(fact.state)) {
        stateIssues.push(`${candidate.id} (${action}) targets ${fact.id}, which is ${fact.state}${fact.supersededBy ? ` (superseded by ${fact.supersededBy}; target the current fact instead)` : ''}.`);
        continue;
      }
    }
    if (action === 'supersedes' || action === 'disputes') {
      const key = nodeKey(node);
      const claimed = action === 'supersedes' ? supersededBy : disputedBy;
      if (claimed.has(key)) {
        errors.push(`${candidate.id} and ${claimed.get(key)} both ${action === 'supersedes' ? 'supersede' : 'dispute'} ${nodeLabel(node)}; a fact has one successor and one open dispute.`);
        continue;
      }
      claimed.set(key, candidate.id);
      (action === 'supersedes' ? supersedes : disputes).set(candidate.id, node);
    }
  }
  for (const [key, by] of disputedBy) {
    if (supersededBy.has(key)) errors.push(`${by} disputes ${key.slice(key.indexOf(':') + 1)}, which ${supersededBy.get(key)} supersedes in the same plan; choose one relationship.`);
  }
  // Supersession among candidates must be acyclic (A supersedes B supersedes A).
  for (const start of supersedes.keys()) {
    const seen = new Set();
    let cursor = start;
    while (cursor) {
      if (seen.has(cursor)) { errors.push(`supersession cycle among reconciliation candidates involving ${start}.`); break; }
      seen.add(cursor);
      cursor = supersedes.get(cursor)?.rc ?? null;
    }
  }
  return { errors: [...new Set(errors)], stateIssues, nodes, supersedes, disputes };
}

function effectiveArea(candidate) {
  return candidate?.decision?.area ?? candidate?.area;
}

// Counts for status / handoff / upgrade reporting.
export function summarizePlan(plan) {
  const counts = { total: plan.candidates.length, decided: 0, pending: 0, applied: 0, byAction: Object.fromEntries(RECONCILIATION_ACTIONS.map((action) => [action, 0])) };
  for (const candidate of plan.candidates) {
    if (candidate.decision) {
      counts.decided += 1;
      counts.byAction[candidate.decision.action] += 1;
    } else counts.pending += 1;
    if (candidate.applied) counts.applied += 1;
  }
  return counts;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}
