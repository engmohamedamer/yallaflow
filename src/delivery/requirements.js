import path from 'node:path';
import { exists } from '../utils/fs.js';
import { readYaml, writeYamlAtomic } from '../core/yaml.js';
import { loadWorkMetaOrThrow, workspacePath } from '../core/workspace.js';
import { loadWorkQuestions } from '../questions/store.js';
import {
  CRITERION_ID,
  PROVENANCE_TYPES,
  QUALIFIED_REF,
  REQUIREMENTS_SCHEMA_VERSION,
  REQUIREMENT_ID,
  REQUIREMENT_STATUSES
} from './constants.js';
import { convergenceRequired } from './policy.js';

// Stable requirement and acceptance-criterion identity (v0.3.8).
//
// The Agent extracts requirements and acceptance criteria from the approved intent
// (the specification, the clarified request, linked sources, answered questions) and
// proposes them with stable IDs; YallaFlow validates structure and references and
// records them. The approved specification stays authoritative: a statement here is a
// short structured extract plus provenance, not a second copy of the specification.
//
// work/<id>/requirements.yaml is the single canonical structured record. It holds no
// implementation or convergence status — that is derived from convergence.yaml. IDs
// are never reused or renumbered; withdrawn and deferred entries stay visible.

const LEDGER_FIELDS = new Set(['schemaVersion', 'revision', 'requirements', 'acceptanceCriteria', 'history', 'updatedAt']);
const REQUIREMENT_FIELDS = new Set(['id', 'statement', 'provenance', 'status', 'reason', 'recordedAt', 'updatedAt']);
const CRITERION_FIELDS = new Set(['id', 'requirement', 'statement', 'provenance', 'status', 'reason', 'recordedAt', 'updatedAt']);
const HISTORY_FIELDS = new Set(['action', 'id', 'at', 'revision', 'reason', 'previous']);
const INPUT_FIELDS = new Set(['requirements', 'acceptanceCriteria']);
const INPUT_REQUIREMENT_FIELDS = new Set(['id', 'statement', 'provenance', 'status', 'reason']);
const INPUT_CRITERION_FIELDS = new Set(['id', 'requirement', 'statement', 'provenance', 'status', 'reason']);
const PROVENANCE_FIELDS = {
  request: new Set(['type']),
  specification: new Set(['type', 'section']),
  source: new Set(['type', 'source', 'locator']),
  question: new Set(['type', 'question'])
};
const HISTORY_ACTIONS = new Set(['added', 'revised']);

export function requirementsFilePath(root, workId) {
  return path.join(workspacePath(root), 'work', workId, 'requirements.yaml');
}

function emptyLedger() {
  return { schemaVersion: REQUIREMENTS_SCHEMA_VERSION, revision: 0, requirements: [], acceptanceCriteria: [], history: [], updatedAt: null };
}

// Read-only; a missing ledger is an in-memory empty view and is never created by a read.
export async function loadWorkRequirements(root, meta) {
  const file = requirementsFilePath(root, meta.id);
  if (!await exists(file)) return { exists: false, ledger: emptyLedger() };
  const ledger = await readYaml(file);
  const errors = validateRequirementsLedger(ledger);
  if (errors.length) throw new Error(`Requirements ledger for ${meta.id} is invalid:\n- ${errors.join('\n- ')}`);
  return { exists: true, ledger: structuredClone(ledger) };
}

// Structural validation of a stored ledger. Returns every problem (doctor reports them
// all); reference checks against sources/questions live in the integrity module.
export function validateRequirementsLedger(ledger) {
  const errors = [];
  if (!ledger || typeof ledger !== 'object' || Array.isArray(ledger)) return ['requirements ledger must be an object'];
  unknownFields(ledger, LEDGER_FIELDS, 'requirements ledger', errors);
  if (ledger.schemaVersion !== REQUIREMENTS_SCHEMA_VERSION) errors.push(`schemaVersion must be ${REQUIREMENTS_SCHEMA_VERSION}`);
  if (!Number.isInteger(ledger.revision) || ledger.revision < 0) errors.push('revision must be a non-negative integer');
  if (!Array.isArray(ledger.requirements)) errors.push('requirements must be an array');
  if (!Array.isArray(ledger.acceptanceCriteria)) errors.push('acceptanceCriteria must be an array');
  if (!Array.isArray(ledger.history)) errors.push('history must be an array');
  if (errors.length) return errors;

  const requirementIds = new Set();
  for (const entry of ledger.requirements) {
    const label = `requirement ${entry?.id ?? '<unknown>'}`;
    if (!entry || typeof entry !== 'object') { errors.push(`${label} must be an object`); continue; }
    unknownFields(entry, REQUIREMENT_FIELDS, label, errors);
    if (!REQUIREMENT_ID.test(entry.id ?? '')) errors.push(`${label} has an invalid id (expected REQ-###)`);
    if (requirementIds.has(entry.id)) errors.push(`duplicate requirement id ${entry.id}`);
    requirementIds.add(entry.id);
    validateEntryBody(entry, label, errors);
  }
  const criterionIds = new Set();
  for (const entry of ledger.acceptanceCriteria) {
    const label = `acceptance criterion ${entry?.id ?? '<unknown>'}`;
    if (!entry || typeof entry !== 'object') { errors.push(`${label} must be an object`); continue; }
    unknownFields(entry, CRITERION_FIELDS, label, errors);
    if (!CRITERION_ID.test(entry.id ?? '')) errors.push(`${label} has an invalid id (expected AC-###)`);
    if (criterionIds.has(entry.id)) errors.push(`duplicate acceptance criterion id ${entry.id}`);
    criterionIds.add(entry.id);
    if (!requirementIds.has(entry.requirement)) errors.push(`${label} references unknown requirement ${JSON.stringify(entry.requirement)}`);
    validateEntryBody(entry, label, errors);
  }
  errors.push(...consistencyErrors(ledger));
  ledger.history.forEach((entry, index) => {
    const label = `history entry ${index + 1}`;
    if (!entry || typeof entry !== 'object') { errors.push(`${label} must be an object`); return; }
    unknownFields(entry, HISTORY_FIELDS, label, errors);
    if (!HISTORY_ACTIONS.has(entry.action)) errors.push(`${label} has an unknown action ${JSON.stringify(entry.action)}`);
    if (!requirementIds.has(entry.id) && !criterionIds.has(entry.id)) errors.push(`${label} references unknown id ${JSON.stringify(entry.id)}`);
    if (!nonEmpty(entry.at)) errors.push(`${label} requires an at timestamp`);
  });
  return errors;
}

function validateEntryBody(entry, label, errors) {
  if (!nonEmpty(entry.statement)) errors.push(`${label} requires a non-empty statement`);
  if (!REQUIREMENT_STATUSES.includes(entry.status)) errors.push(`${label} has an invalid status ${JSON.stringify(entry.status)}`);
  if (entry.status !== 'active' && !nonEmpty(entry.reason)) errors.push(`${label} is ${entry.status} and requires a reason`);
  if (!Array.isArray(entry.provenance) || !entry.provenance.length) errors.push(`${label} requires at least one provenance entry`);
  else entry.provenance.forEach((item, index) => errors.push(...provenanceErrors(item, `${label} provenance ${index + 1}`)));
  if (!nonEmpty(entry.recordedAt) || !nonEmpty(entry.updatedAt)) errors.push(`${label} requires recordedAt and updatedAt`);
}

function provenanceErrors(item, label) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return [`${label} must be an object`];
  if (!PROVENANCE_TYPES.includes(item.type)) return [`${label} has type ${JSON.stringify(item.type)}; expected one of: ${PROVENANCE_TYPES.join(', ')}`];
  const errors = [];
  unknownFields(item, PROVENANCE_FIELDS[item.type], label, errors);
  if (item.type === 'specification' && !nonEmpty(item.section)) errors.push(`${label} (specification) requires the section of the approved specification it comes from`);
  if (item.type === 'source' && !/^SRC-\d+$/.test(item.source ?? '')) errors.push(`${label} (source) requires a source SRC-####`);
  if (item.type === 'source' && item.locator !== undefined && !nonEmpty(item.locator)) errors.push(`${label} locator must be non-empty when present`);
  if (item.type === 'question' && !/^Q-\d+$/.test(item.question ?? '')) errors.push(`${label} (question) requires a question Q-###`);
  return errors;
}

// Rules on the resulting set: an active criterion belongs to an active requirement,
// and every active requirement has at least one active criterion (a requirement
// nothing can prove is not a delivery contract).
function consistencyErrors(ledger) {
  const errors = [];
  const byId = new Map(ledger.requirements.map((entry) => [entry.id, entry]));
  for (const criterion of ledger.acceptanceCriteria) {
    const parent = byId.get(criterion.requirement);
    if (criterion.status === 'active' && parent && parent.status !== 'active') {
      errors.push(`active acceptance criterion ${criterion.id} belongs to ${parent.status} requirement ${parent.id}; withdraw or defer the criterion too`);
    }
  }
  for (const requirement of ledger.requirements.filter((entry) => entry.status === 'active')) {
    if (!ledger.acceptanceCriteria.some((criterion) => criterion.requirement === requirement.id && criterion.status === 'active')) {
      errors.push(`active requirement ${requirement.id} has no active acceptance criterion`);
    }
  }
  return errors;
}

// The delivery criteria a work item answers for. `own`: its requirements.yaml.
// `inherited`: a decomposed child whose parent owns a requirements ledger — the child
// answers for the parent's criteria the decomposition assigned to it (read through,
// never copied). `none`: no structured intent.
export async function resolveDeliveryCriteria(root, meta) {
  const own = await loadWorkRequirements(root, meta);
  if (own.exists) {
    return {
      source: 'own',
      owner: meta.id,
      ledger: own.ledger,
      requirements: own.ledger.requirements,
      criteria: own.ledger.acceptanceCriteria.map((entry) => ({ ...entry, ref: entry.id }))
    };
  }
  const inherited = await inheritedCriteria(root, meta);
  if (inherited) return inherited;
  return { source: 'none', owner: meta.id, ledger: own.ledger, requirements: [], criteria: [] };
}

async function inheritedCriteria(root, meta) {
  if (!meta.parent || !Array.isArray(meta.acceptanceCriteria) || !meta.acceptanceCriteria.length) return null;
  let parent;
  try {
    parent = await loadWorkMetaOrThrow(root, meta.parent);
  } catch {
    return null;
  }
  const parentLedger = await loadWorkRequirements(root, parent);
  if (!parentLedger.exists) return null;
  const wanted = new Set(meta.acceptanceCriteria.map((ref) => bareRef(ref, parent.id)));
  const criteria = parentLedger.ledger.acceptanceCriteria
    .filter((entry) => wanted.has(entry.id))
    .map((entry) => ({ ...entry, ref: `${parent.id}/${entry.id}` }));
  const requirementIds = new Set(criteria.map((entry) => entry.requirement));
  return {
    source: 'inherited',
    owner: parent.id,
    ledger: parentLedger.ledger,
    requirements: parentLedger.ledger.requirements.filter((entry) => requirementIds.has(entry.id)),
    criteria,
    unresolved: [...wanted].filter((id) => !criteria.some((entry) => entry.id === id))
  };
}

// "AC-004" or "PF-0001/AC-004" → "AC-004" when the qualifier names the owner.
export function bareRef(ref, owner) {
  const qualified = QUALIFIED_REF.exec(ref);
  if (qualified && qualified[1] === owner) return qualified[2];
  return ref;
}

export function activeCriteria(resolved) {
  return resolved.criteria.filter((entry) => entry.status === 'active');
}

// Records Agent-extracted requirements/criteria from a JSON file. Upsert by ID: new
// IDs are added, existing IDs are revised (their previous content stays in history);
// entries not mentioned are left unchanged. The whole file is rejected on any error,
// with zero mutation. Returns the resulting ledger and the list of changes (used by
// the impact module when the intent was already fixed).
export async function recordRequirements(root, workId, input, now = new Date().toISOString(), { beforeWrite } = {}) {
  const meta = await loadWorkMetaOrThrow(root, workId);
  if (meta.routingStatus === 'pending') throw new Error(`${workId} is awaiting routing. Route the work before recording requirements.`);
  if (!convergenceRequired(meta)) {
    throw new Error(
      `${workId} does not carry a delivery-convergence contract, so requirement identity is not recorded for it. ` +
      'Requirements and acceptance criteria apply to newly routed feature work (bounded or architectural) and architectural changes (Skill Registry v5+). No files were changed.'
    );
  }
  if (meta.status === 'DONE') {
    throw new Error(`${workId} is DONE; its approved intent is history. Reopen the work (yallaflow reopen) before changing requirements. No files were changed.`);
  }
  const inherited = await inheritedCriteria(root, meta);
  if (inherited) {
    throw new Error(
      `${workId} answers for acceptance criteria owned by its parent ${inherited.owner} (assigned by decomposition). ` +
      `Change requirements on ${inherited.owner} instead. No files were changed.`
    );
  }

  const errors = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Requirements file must contain a JSON object: {"requirements":[...],"acceptanceCriteria":[...]}.');
  unknownFields(input, INPUT_FIELDS, 'requirements file', errors);
  const requirementsIn = input.requirements ?? [];
  const criteriaIn = input.acceptanceCriteria ?? [];
  if (!Array.isArray(requirementsIn) || !Array.isArray(criteriaIn)) errors.push('requirements and acceptanceCriteria must be arrays');
  else if (!requirementsIn.length && !criteriaIn.length) errors.push('the file records nothing: add at least one requirement or acceptance criterion');
  if (errors.length) throw rejection(errors);

  const loaded = await loadWorkRequirements(root, meta);
  const ledger = loaded.ledger;
  const questions = await loadWorkQuestions(root, meta);
  const context = {
    sources: new Set((meta.sources ?? []).map((source) => source.id)),
    questions: new Set(questions.ledger.questions.map((question) => question.id)),
    hasRequest: nonEmpty(meta.rawRequest)
  };
  const changes = [];
  const revision = ledger.revision + 1;
  const seen = new Set();
  applyEntries(ledger.requirements, requirementsIn, { kind: 'requirement', idPattern: REQUIREMENT_ID, fields: INPUT_REQUIREMENT_FIELDS, context, seen, errors, changes, ledger, now, revision });
  applyEntries(ledger.acceptanceCriteria, criteriaIn, { kind: 'acceptance criterion', idPattern: CRITERION_ID, fields: INPUT_CRITERION_FIELDS, context, seen, errors, changes, ledger, now, revision });
  const requirementIds = new Set(ledger.requirements.map((entry) => entry.id));
  for (const criterion of ledger.acceptanceCriteria) {
    if (!requirementIds.has(criterion.requirement)) errors.push(`acceptance criterion ${criterion.id} references unknown requirement ${JSON.stringify(criterion.requirement)}`);
  }
  errors.push(...consistencyErrors(ledger));
  errors.push(...await assignedCriterionErrors(root, workId, ledger, changes));
  if (errors.length) throw rejection(errors);
  if (!changes.length) return { meta, ledger, changes, unchanged: true };

  ledger.revision = revision;
  ledger.updatedAt = now;
  if (beforeWrite) await beforeWrite({ meta, changes });
  await writeYamlAtomic(requirementsFilePath(root, workId), ledger);
  return { meta, ledger, changes, unchanged: false };
}

function applyEntries(target, inputs, { kind, idPattern, fields, context, seen, errors, changes, ledger, now, revision }) {
  for (const [index, raw] of inputs.entries()) {
    const label = `${kind} ${raw?.id ?? `#${index + 1}`}`;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { errors.push(`${label} must be an object`); continue; }
    unknownFields(raw, fields, label, errors);
    const id = typeof raw.id === 'string' ? raw.id.trim() : raw.id;
    if (!idPattern.test(id ?? '')) { errors.push(`${label} has an invalid id (expected ${kind === 'requirement' ? 'REQ-###' : 'AC-###'})`); continue; }
    if (seen.has(id)) { errors.push(`${id} appears more than once in the file`); continue; }
    seen.add(id);
    const existing = target.find((entry) => entry.id === id);
    const sameNumber = target.find((entry) => entry.id !== id && idNumber(entry.id) === idNumber(id));
    if (sameNumber) { errors.push(`${id} would name the same number as existing ${sameNumber.id}; reuse ${sameNumber.id}`); continue; }
    const status = raw.status ?? existing?.status ?? 'active';
    if (!REQUIREMENT_STATUSES.includes(status)) { errors.push(`${label} has status ${JSON.stringify(status)}; expected one of: ${REQUIREMENT_STATUSES.join(', ')}`); continue; }
    const statement = raw.statement === undefined ? existing?.statement : raw.statement;
    if (!nonEmpty(statement)) errors.push(`${label} requires a non-empty statement`);
    const provenance = raw.provenance === undefined ? existing?.provenance : raw.provenance;
    if (!Array.isArray(provenance) || !provenance.length) errors.push(`${label} requires at least one provenance entry (where in the approved intent it comes from)`);
    else provenance.forEach((item, position) => errors.push(...provenanceErrors(item, `${label} provenance ${position + 1}`), ...provenanceReferenceErrors(item, `${label} provenance ${position + 1}`, context)));
    const reason = nonEmpty(raw.reason) ? raw.reason.trim() : undefined;
    if (status !== 'active' && status !== existing?.status && !reason) errors.push(`${label}: marking it ${status} requires a reason`);
    const next = {
      id,
      ...(kind === 'acceptance criterion' ? { requirement: raw.requirement === undefined ? existing?.requirement : raw.requirement } : {}),
      statement: nonEmpty(statement) ? statement.trim() : statement,
      provenance,
      status,
      ...(status !== 'active' ? { reason: reason ?? existing?.reason } : {}),
      recordedAt: existing?.recordedAt ?? now,
      updatedAt: existing?.updatedAt ?? now
    };
    if (existing) {
      const { recordedAt, updatedAt, ...before } = existing;
      const { recordedAt: _r, updatedAt: _u, ...after } = next;
      if (JSON.stringify(before) === JSON.stringify(after)) continue;
      next.updatedAt = now;
      target[target.indexOf(existing)] = next;
      ledger.history.push({ action: 'revised', id, at: now, revision, ...(reason ? { reason } : {}), previous: before });
      changes.push({ id, action: 'revised', from: before.status, to: status });
    } else {
      target.push(next);
      ledger.history.push({ action: 'added', id, at: now, revision });
      changes.push({ id, action: 'added', to: status });
    }
  }
}

// A criterion a decomposed child still answers for cannot be withdrawn or deferred on
// the parent: the child would be left with an obligation nobody owns. Re-plan the child
// (or finish it) first. Revising the statement is allowed — the child's findings then
// go stale and must be re-assessed before its DONE.
async function assignedCriterionErrors(root, workId, ledger, changes) {
  const file = path.join(workspacePath(root), 'work', workId, 'decomposition.yaml');
  if (!await exists(file)) return [];
  const decomposition = await readYaml(file);
  const errors = [];
  for (const change of changes.filter((entry) => CRITERION_ID.test(entry.id) && entry.to !== 'active')) {
    for (const child of decomposition.children ?? []) {
      if (!child.workId || !(child.acceptanceCriteria ?? []).map((ref) => bareRef(ref, workId)).includes(change.id)) continue;
      const childMeta = await loadWorkMetaOrThrow(root, child.workId).catch(() => null);
      if (childMeta && childMeta.status !== 'DONE') {
        errors.push(`${change.id} is assigned to ${child.workId} (${child.title}), which is not DONE; it cannot be marked ${change.to} while a child still answers for it`);
      }
    }
  }
  return errors;
}

function provenanceReferenceErrors(item, label, context) {
  if (!item || typeof item !== 'object') return [];
  if (item.type === 'source' && /^SRC-\d+$/.test(item.source ?? '') && !context.sources.has(item.source)) {
    return [`${label}: source ${item.source} is not linked to this work item (attach it with yallaflow intake add)`];
  }
  if (item.type === 'question' && /^Q-\d+$/.test(item.question ?? '') && !context.questions.has(item.question)) {
    return [`${label}: question ${item.question} does not exist in this work item's questions ledger`];
  }
  if (item.type === 'request' && !context.hasRequest) return [`${label}: this work item has no recorded raw request`];
  return [];
}

function idNumber(id) {
  return Number(/-(\d+)$/.exec(id)?.[1]);
}

function rejection(errors) {
  return new Error(`Requirements rejected:\n- ${errors.join('\n- ')}\n\nNo files were changed.`);
}

function unknownFields(value, allowed, label, errors) {
  const unknown = Object.keys(value).filter((field) => !allowed.has(field));
  if (unknown.length) errors.push(`${label} has unknown field(s): ${unknown.join(', ')}`);
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

// Completing the intent checkpoint (specification / requirement-clarification) of a
// delivery-convergence contract requires structured intent: at least one active
// acceptance criterion the work answers for.
export async function intentCheckpointBlocker(root, meta) {
  const resolved = await resolveDeliveryCriteria(root, meta);
  if (resolved.source === 'inherited' && resolved.unresolved.length) {
    return `assigned acceptance criteria ${resolved.unresolved.join(', ')} do not exist in ${resolved.owner}'s requirements ledger`;
  }
  if (!activeCriteria(resolved).length) {
    return 'no active acceptance criteria are recorded; record them first with `yallaflow requirement record ' + meta.id + ' --file requirements.json`';
  }
  return null;
}

