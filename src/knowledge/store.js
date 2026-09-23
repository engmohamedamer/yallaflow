import path from 'node:path';
import { exists } from '../utils/fs.js';
import { latestVerification } from '../core/evidence.js';
import { loadWorkProgress } from '../core/progress.js';
import { readYaml, writeYaml } from '../core/yaml.js';
import { workspacePath } from '../core/workspace.js';
import { loadWorkReadiness } from '../behavior/readiness.js';
import { usesArchitecturalReadiness } from '../core/workflows.js';
import { loadContextLedger, findFact } from '../context/ledger.js';
import { CONFIDENCE_LEVELS, PROVENANCE_VALUES, RELATION_TYPES } from '../context/constants.js';
import { loadWorkLimitations, sameStatement } from '../limitations/store.js';
import {
  CANDIDATE_STATUSES,
  KNOWLEDGE_KINDS,
  KNOWLEDGE_POLICY_VERSION,
  KNOWLEDGE_SCHEMA_VERSION,
  KNOWLEDGE_SOURCES,
  REVIEW_STATUSES
} from './constants.js';

const LEDGER_FIELDS = new Set(['version', 'reviewStatus', 'reviewedAt', 'candidates', 'updatedAt']);
const CANDIDATE_FIELDS = new Set([
  'id', 'kind', 'source', 'summary', 'evidence', 'status', 'createdAt', 'decisionDetails',
  'promotedAt', 'target', 'rejectedAt', 'rejectionReason',
  // v0.3.6 living project memory (all optional; absent on earlier candidates):
  'confidence', 'provenance', 'relation', 'factId'
]);
const RELATION_FIELDS = new Set(['type', 'factId']);
const DECISION_FIELDS = new Set(['context', 'decision', 'reason', 'costIfWrong', 'sourceRuling']);
const POLICY_FIELDS = new Set(['version', 'reviewRequired']);

export function knowledgeFilePath(root, workId) {
  return path.join(workspacePath(root), 'work', workId, 'knowledge.yaml');
}

export function resolveKnowledgePolicy(meta) {
  if (meta?.knowledgePolicy === undefined) {
    return { version: null, reviewRequired: false, label: 'legacy (not required)' };
  }
  const policy = meta.knowledgePolicy;
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
    throw new Error(`Work item ${meta.id ?? '<unknown>'} has an invalid knowledge policy.`);
  }
  rejectUnknownFields(policy, POLICY_FIELDS, `knowledge policy for ${meta.id ?? '<unknown>'}`);
  if (policy.version !== KNOWLEDGE_POLICY_VERSION || typeof policy.reviewRequired !== 'boolean') {
    throw new Error(`Work item ${meta.id ?? '<unknown>'} has an invalid knowledge policy.`);
  }
  return {
    version: policy.version,
    reviewRequired: policy.reviewRequired,
    label: `policy v${policy.version}${policy.reviewRequired ? ' (required)' : ''}`
  };
}

export async function loadWorkKnowledge(root, meta) {
  const policy = resolveKnowledgePolicy(meta);
  const file = knowledgeFilePath(root, meta.id);
  if (!await exists(file)) {
    return { exists: false, policy, ledger: emptyKnowledgeLedger() };
  }
  const ledger = await readYaml(file);
  validateKnowledgeLedger(ledger, meta.id);
  return { exists: true, policy, ledger: cloneLedger(ledger) };
}

export async function proposeKnowledge(root, workId, input, now = new Date().toISOString()) {
  const meta = await loadWorkMeta(root, workId);
  if (meta.routingStatus === 'pending') throw new Error(`${workId} is awaiting routing. Route the work before proposing project knowledge.`);
  if (!KNOWLEDGE_KINDS.includes(input.kind)) {
    throw new Error(`kind must be one of: ${KNOWLEDGE_KINDS.join(', ')}; received ${JSON.stringify(input.kind)}.`);
  }
  const summary = normalizeSummary(input.summary);
  const evidence = normalizeEvidence(input.evidence);
  if (!evidence.length) throw new Error('Knowledge candidates require at least one non-empty --evidence reference.');
  const requiresSource = meta.behaviorContract?.registryVersion >= 2;
  if (requiresSource && !KNOWLEDGE_SOURCES.includes(input.source)) {
    throw new Error(`New work requires --source to be one of: ${KNOWLEDGE_SOURCES.join(', ')}.`);
  }
  if (input.source !== undefined && !KNOWLEDGE_SOURCES.includes(input.source)) {
    throw new Error(`source must be one of: ${KNOWLEDGE_SOURCES.join(', ')}; received ${JSON.stringify(input.source)}.`);
  }

  if (input.confidence !== undefined && !CONFIDENCE_LEVELS.includes(input.confidence)) {
    throw new Error(`confidence must be one of: ${CONFIDENCE_LEVELS.join(', ')}; received ${JSON.stringify(input.confidence)}.`);
  }
  if (input.provenance !== undefined && !PROVENANCE_VALUES.includes(input.provenance)) {
    throw new Error(`provenance must be one of: ${PROVENANCE_VALUES.join(', ')}; received ${JSON.stringify(input.provenance)}.`);
  }
  await assertNotDiscoveryLimitation(root, meta.id, summary);
  const hasRelationInput = RELATION_TYPES.some((type) => input[type] !== undefined);
  if ((hasRelationInput || input.confidence || input.provenance) && input.kind === 'decision') {
    throw new Error('--supersedes/--reconfirms/--disputes, --confidence, and --provenance apply to project context facts, not decision (ADR) candidates.');
  }
  const relation = await resolveRelation(root, input);

  const loaded = await loadWorkKnowledge(root, meta);
  const candidate = {
    id: nextCandidateId(loaded.ledger.candidates),
    kind: input.kind,
    ...(input.source ? { source: input.source } : {}),
    summary,
    evidence,
    ...(input.confidence ? { confidence: input.confidence } : {}),
    ...(input.provenance ? { provenance: input.provenance } : {}),
    ...(relation ? { relation } : {}),
    status: 'proposed',
    createdAt: now
  };
  if (relation && relation.type !== 'supersedes' && relation.area !== input.kind) {
    throw new Error(`${relation.factId} is ${relation.area} knowledge; a candidate that ${relation.type === 'reconfirms' ? 'reconfirms' : 'disputes'} it must use --kind ${relation.area}.`);
  }
  if (relation) delete relation.area;
  if (input.kind === 'decision') {
    candidate.decisionDetails = await resolveDecisionDetails(root, meta, input);
  } else if (hasDecisionInput(input)) {
    throw new Error('Decision details and --from-ruling are only valid for kind decision.');
  }

  loaded.ledger.candidates.push(candidate);
  loaded.ledger.reviewStatus = 'pending';
  delete loaded.ledger.reviewedAt;
  loaded.ledger.updatedAt = now;
  await writeKnowledgeLedger(root, workId, loaded.ledger);
  return { meta, policy: loaded.policy, candidate, ledger: loaded.ledger };
}

export async function rejectKnowledge(root, workId, candidateId, reason, now = new Date().toISOString()) {
  const meta = await loadWorkMeta(root, workId);
  if (!isNonEmptyString(reason)) throw new Error('Rejecting a knowledge candidate requires a non-empty --reason.');
  const loaded = await loadWorkKnowledge(root, meta);
  const candidate = requireCandidate(loaded.ledger, candidateId);
  await assertKnowledgeReviewAllowed(root, meta, candidate);
  if (candidate.status === 'promoted') throw new Error(`Candidate ${candidateId} is already promoted and cannot be rejected.`);
  if (candidate.status === 'rejected') throw new Error(`Candidate ${candidateId} is already rejected.`);
  candidate.status = 'rejected';
  candidate.rejectedAt = now;
  candidate.rejectionReason = reason.trim();
  updateReviewStatus(loaded.ledger, now);
  await writeKnowledgeLedger(root, workId, loaded.ledger);
  return { meta, candidate, ledger: loaded.ledger };
}

export async function reviewKnowledgeNone(root, workId, now = new Date().toISOString()) {
  const meta = await loadWorkMeta(root, workId);
  await assertKnowledgeReviewAllowed(root, meta);
  const loaded = await loadWorkKnowledge(root, meta);
  if (loaded.ledger.candidates.length) {
    throw new Error('Cannot declare no durable knowledge after candidates exist. Promote or reject every candidate instead.');
  }
  loaded.ledger.reviewStatus = 'reviewed';
  loaded.ledger.reviewedAt = loaded.ledger.reviewedAt ?? now;
  loaded.ledger.updatedAt = now;
  await writeKnowledgeLedger(root, workId, loaded.ledger);
  return { meta, ledger: loaded.ledger, unchanged: loaded.exists && loaded.ledger.reviewedAt !== now };
}

export function summarizeKnowledge(ledger) {
  const proposed = ledger.candidates.filter((candidate) => candidate.status === 'proposed');
  const promoted = ledger.candidates.filter((candidate) => candidate.status === 'promoted');
  const rejected = ledger.candidates.filter((candidate) => candidate.status === 'rejected');
  return {
    reviewStatus: ledger.reviewStatus,
    proposed,
    promoted,
    rejected,
    totalCount: ledger.candidates.length
  };
}

export function isKnowledgeReviewRelevant(meta, stage, loaded, readiness = null) {
  const stableDesignEndpoint = ['SPEC_READY', 'PLAN_READY'].includes(readiness?.deliveryStatus);
  return (isKnowledgeReviewStage(meta, stage) || stableDesignEndpoint) && (loaded.policy.reviewRequired || loaded.exists);
}

export function isKnowledgeReviewStage(meta, stage = meta.status) {
  const workflow = meta.workflow ?? meta.type;
  return workflow === 'investigation'
    ? ['CONCLUSION', 'DONE'].includes(stage)
    : ['VERIFICATION', 'DONE'].includes(stage);
}

export async function assertKnowledgeReviewAllowed(root, meta, candidate = null) {
  if (usesArchitecturalReadiness(meta)) {
    const readiness = await loadWorkReadiness(root, meta);
    const stableDesignEndpoint = ['SPEC_READY', 'PLAN_READY'].includes(readiness.deliveryStatus);
    if (candidate?.source === 'design-spec' || candidate === null) {
      if (stableDesignEndpoint || meta.status === 'DONE') return;
      throw new Error(
        `Design/spec knowledge review for ${meta.id} requires SPEC_READY or PLAN_READY; current delivery status is ${readiness.deliveryStatus ?? 'NOT_READY'}.`
      );
    }
  }
  if (!isKnowledgeReviewStage(meta)) {
    throw new Error(`Knowledge review for ${meta.id} is available near completion, not at workflow stage ${meta.status ?? 'none'}.`);
  }
  if ((meta.workflow ?? meta.type) !== 'investigation') {
    const verification = await latestVerification(root, meta.id);
    if (!verification?.success) {
      throw new Error('Knowledge disposition requires fresh successful verification evidence. Run `yallaflow verify -- <command>` first.');
    }
  }
}

export function requireCandidate(ledger, candidateId) {
  if (!isNonEmptyString(candidateId)) throw new Error('--candidate must be a non-empty knowledge candidate ID.');
  const candidate = ledger.candidates.find((entry) => entry.id === candidateId);
  if (!candidate) throw new Error(`Knowledge candidate ${candidateId} was not found.`);
  return candidate;
}

export function updateReviewStatus(ledger, now) {
  if (ledger.candidates.some((candidate) => candidate.status === 'proposed')) {
    ledger.reviewStatus = 'pending';
    delete ledger.reviewedAt;
  } else {
    ledger.reviewStatus = 'reviewed';
    ledger.reviewedAt = ledger.reviewedAt ?? now;
  }
  ledger.updatedAt = now;
}

export async function writeKnowledgeLedger(root, workId, ledger) {
  validateKnowledgeLedger(ledger, workId);
  await writeYaml(knowledgeFilePath(root, workId), ledger);
}

export async function loadWorkMeta(root, workId) {
  const file = path.join(workspacePath(root), 'work', workId, 'meta.yaml');
  if (!await exists(file)) throw new Error(`Work item ${workId} was not found.`);
  return readYaml(file);
}

export function validateKnowledgeLedger(ledger, workId = '<unknown>') {
  if (!ledger || typeof ledger !== 'object' || Array.isArray(ledger)) {
    throw new Error(`Knowledge ledger for ${workId} must be an object.`);
  }
  rejectUnknownFields(ledger, LEDGER_FIELDS, `knowledge ledger for ${workId}`);
  if (ledger.version !== KNOWLEDGE_SCHEMA_VERSION) {
    throw new Error(`Knowledge ledger for ${workId} must use version ${KNOWLEDGE_SCHEMA_VERSION}.`);
  }
  if (!REVIEW_STATUSES.includes(ledger.reviewStatus)) {
    throw new Error(`Knowledge ledger for ${workId} has unsupported reviewStatus ${JSON.stringify(ledger.reviewStatus)}.`);
  }
  if (!Array.isArray(ledger.candidates)) throw new Error(`Knowledge ledger for ${workId} must contain a candidates array.`);
  const ids = new Set();
  for (const candidate of ledger.candidates) {
    validateCandidate(candidate);
    if (ids.has(candidate.id)) throw new Error(`Knowledge ledger for ${workId} contains duplicate candidate ID ${candidate.id}.`);
    ids.add(candidate.id);
  }
  if (ledger.reviewStatus === 'reviewed' && ledger.candidates.some((candidate) => candidate.status === 'proposed')) {
    throw new Error(`Knowledge ledger for ${workId} cannot be reviewed while candidates remain proposed.`);
  }
  if (ledger.reviewStatus === 'reviewed' && !isNonEmptyString(ledger.reviewedAt)) {
    throw new Error(`Reviewed knowledge ledger for ${workId} requires reviewedAt.`);
  }
  if (ledger.reviewStatus === 'pending' && ledger.reviewedAt !== undefined) {
    throw new Error(`Pending knowledge ledger for ${workId} cannot contain reviewedAt.`);
  }
  if (ledger.reviewedAt !== undefined && !isNonEmptyString(ledger.reviewedAt)) {
    throw new Error(`Knowledge ledger for ${workId} has invalid reviewedAt.`);
  }
  if (!isNonEmptyString(ledger.updatedAt)) throw new Error(`Knowledge ledger for ${workId} has invalid updatedAt.`);
  return true;
}

function emptyKnowledgeLedger() {
  return {
    version: KNOWLEDGE_SCHEMA_VERSION,
    reviewStatus: 'pending',
    candidates: [],
    updatedAt: null
  };
}

function cloneLedger(ledger) {
  return {
    ...ledger,
    candidates: ledger.candidates.map((candidate) => ({
      ...candidate,
      evidence: [...candidate.evidence],
      ...(candidate.relation ? { relation: { ...candidate.relation } } : {}),
      ...(candidate.decisionDetails ? { decisionDetails: { ...candidate.decisionDetails } } : {})
    }))
  };
}

async function resolveDecisionDetails(root, meta, input) {
  let sourceRuling;
  let decision = input.decision;
  let reason = input.reason;
  let costIfWrong = input.costIfWrong;
  if (input.fromRuling !== undefined) {
    const index = Number(input.fromRuling);
    if (!Number.isInteger(index) || index < 1) throw new Error('--from-ruling must be a positive one-based ruling number.');
    const progress = await loadWorkProgress(root, meta);
    const ruling = progress.ledger.rulings[index - 1];
    if (!ruling) throw new Error(`Ruling ${index} was not found for ${meta.id}.`);
    sourceRuling = index;
    decision ??= ruling.decision;
    reason ??= ruling.reason;
    costIfWrong ??= ruling.costIfWrong;
  }
  const details = {
    context: input.context?.trim(),
    decision: decision?.trim(),
    reason: reason?.trim(),
    costIfWrong: costIfWrong?.trim(),
    ...(sourceRuling ? { sourceRuling } : {})
  };
  for (const field of ['context', 'decision', 'reason', 'costIfWrong']) {
    if (!isNonEmptyString(details[field])) {
      throw new Error(`Decision knowledge requires non-empty --${toCliName(field)}.`);
    }
  }
  return details;
}

// The Agent declares the relationship explicitly; YallaFlow only validates that the
// referenced fact exists and that the transition is legal for its current state. It
// never infers semantic equivalence between prose statements.
async function resolveRelation(root, input) {
  const declared = RELATION_TYPES.filter((type) => input[type] !== undefined);
  if (!declared.length) return null;
  if (declared.length > 1) throw new Error('Use only one of --supersedes, --reconfirms, or --disputes per candidate.');
  const type = declared[0];
  const factId = typeof input[type] === 'string' ? input[type].trim() : input[type];
  const { ledger } = await loadContextLedger(root);
  const fact = findFact(ledger, factId);
  if (!fact) throw new Error(`--${type} ${factId}: project context fact ${factId} was not found. Run \`yallaflow context status\` to list current facts.`);
  const allowed = type === 'disputes' ? ['current'] : ['current', 'disputed'];
  if (!allowed.includes(fact.state)) {
    throw new Error(`--${type} ${factId}: ${factId} is ${fact.state}${fact.supersededBy ? ` (superseded by ${fact.supersededBy})` : ''} and cannot be ${type === 'supersedes' ? 'superseded' : type === 'reconfirms' ? 'reconfirmed' : 'disputed'}.`);
  }
  return { type, factId, area: fact.area };
}

async function assertNotDiscoveryLimitation(root, workId, summary) {
  const { ledger } = await loadWorkLimitations(root, workId);
  const match = (ledger.limitations ?? []).find((entry) => sameStatement(entry.summary, summary));
  if (match) {
    throw new Error(`"${summary}" is recorded as discovery limitation ${match.id} for ${workId}. Discovery limitations are work-scoped and cannot become project knowledge.`);
  }
}

function validateCandidate(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new Error('Knowledge candidate must be an object.');
  rejectUnknownFields(candidate, CANDIDATE_FIELDS, `knowledge candidate ${candidate.id ?? '<unknown>'}`);
  if (!/^K-\d{3,}$/.test(candidate.id)) throw new Error(`Invalid knowledge candidate ID ${JSON.stringify(candidate.id)}.`);
  if (!KNOWLEDGE_KINDS.includes(candidate.kind)) throw new Error(`Knowledge candidate ${candidate.id} has unknown kind ${JSON.stringify(candidate.kind)}.`);
  if (!isNonEmptyString(candidate.summary)) throw new Error(`Knowledge candidate ${candidate.id} requires a non-empty summary.`);
  if (candidate.source !== undefined && !KNOWLEDGE_SOURCES.includes(candidate.source)) {
    throw new Error(`Knowledge candidate ${candidate.id} has unsupported source ${JSON.stringify(candidate.source)}.`);
  }
  if (!Array.isArray(candidate.evidence) || !candidate.evidence.length || candidate.evidence.some((entry) => !isNonEmptyString(entry))) {
    throw new Error(`Knowledge candidate ${candidate.id} requires non-empty evidence references.`);
  }
  if (!CANDIDATE_STATUSES.includes(candidate.status)) throw new Error(`Knowledge candidate ${candidate.id} has unsupported status ${JSON.stringify(candidate.status)}.`);
  if (!isNonEmptyString(candidate.createdAt)) throw new Error(`Knowledge candidate ${candidate.id} has invalid createdAt.`);
  if (candidate.kind === 'decision') validateDecisionDetails(candidate.decisionDetails, candidate.id);
  else if (candidate.decisionDetails !== undefined) throw new Error(`Non-decision candidate ${candidate.id} cannot contain decisionDetails.`);
  if (candidate.status === 'promoted' && (!isNonEmptyString(candidate.promotedAt) || !isNonEmptyString(candidate.target))) {
    throw new Error(`Promoted candidate ${candidate.id} requires promotedAt and target.`);
  }
  if (candidate.status === 'rejected' && (!isNonEmptyString(candidate.rejectedAt) || !isNonEmptyString(candidate.rejectionReason))) {
    throw new Error(`Rejected candidate ${candidate.id} requires rejectedAt and rejectionReason.`);
  }
  if (candidate.confidence !== undefined && !CONFIDENCE_LEVELS.includes(candidate.confidence)) {
    throw new Error(`Knowledge candidate ${candidate.id} has unsupported confidence ${JSON.stringify(candidate.confidence)}.`);
  }
  if (candidate.provenance !== undefined && !PROVENANCE_VALUES.includes(candidate.provenance)) {
    throw new Error(`Knowledge candidate ${candidate.id} has unsupported provenance ${JSON.stringify(candidate.provenance)}.`);
  }
  if (candidate.relation !== undefined) {
    const relation = candidate.relation;
    if (!relation || typeof relation !== 'object' || Array.isArray(relation)) throw new Error(`Knowledge candidate ${candidate.id} has an invalid relation.`);
    rejectUnknownFields(relation, RELATION_FIELDS, `relation of knowledge candidate ${candidate.id}`);
    if (!RELATION_TYPES.includes(relation.type) || !/^CTX-\d{4,}$/.test(relation.factId ?? '')) {
      throw new Error(`Knowledge candidate ${candidate.id} has an invalid relation.`);
    }
    if (candidate.kind === 'decision') throw new Error(`Decision candidate ${candidate.id} cannot relate to a project context fact.`);
  }
  if (candidate.factId !== undefined && (candidate.status !== 'promoted' || !/^CTX-\d{4,}$/.test(candidate.factId))) {
    throw new Error(`Knowledge candidate ${candidate.id} has an invalid factId.`);
  }
  if (candidate.status === 'proposed' && ['promotedAt', 'target', 'rejectedAt', 'rejectionReason'].some((field) => candidate[field] !== undefined)) {
    throw new Error(`Proposed candidate ${candidate.id} cannot contain disposition fields.`);
  }
  if (candidate.status === 'promoted' && ['rejectedAt', 'rejectionReason'].some((field) => candidate[field] !== undefined)) {
    throw new Error(`Promoted candidate ${candidate.id} cannot contain rejection fields.`);
  }
  if (candidate.status === 'rejected' && ['promotedAt', 'target'].some((field) => candidate[field] !== undefined)) {
    throw new Error(`Rejected candidate ${candidate.id} cannot contain promotion fields.`);
  }
}

function validateDecisionDetails(details, candidateId) {
  if (!details || typeof details !== 'object' || Array.isArray(details)) throw new Error(`Decision candidate ${candidateId} requires decisionDetails.`);
  rejectUnknownFields(details, DECISION_FIELDS, `decision details for ${candidateId}`);
  for (const field of ['context', 'decision', 'reason', 'costIfWrong']) {
    if (!isNonEmptyString(details[field])) throw new Error(`Decision candidate ${candidateId} requires non-empty ${field}.`);
  }
  if (details.sourceRuling !== undefined && (!Number.isInteger(details.sourceRuling) || details.sourceRuling < 1)) {
    throw new Error(`Decision candidate ${candidateId} has invalid sourceRuling.`);
  }
}

function nextCandidateId(candidates) {
  const highest = candidates.reduce((max, candidate) => Math.max(max, Number(candidate.id.slice(2)) || 0), 0);
  return `K-${String(highest + 1).padStart(3, '0')}`;
}

function normalizeSummary(value) {
  if (!isNonEmptyString(value)) throw new Error('Knowledge candidates require a non-empty --summary.');
  return value.trim().replace(/\s+/g, ' ');
}

function normalizeEvidence(values = []) {
  if (!Array.isArray(values) || values.some((entry) => !isNonEmptyString(entry))) {
    throw new Error('--evidence values must be non-empty strings.');
  }
  return [...new Set(values.map((entry) => entry.trim()))];
}

function hasDecisionInput(input) {
  return ['context', 'decision', 'reason', 'costIfWrong', 'fromRuling'].some((field) => input[field] !== undefined);
}

function toCliName(value) {
  return value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function rejectUnknownFields(value, allowed, label) {
  const unknown = Object.keys(value).filter((field) => !allowed.has(field));
  if (unknown.length) throw new Error(`Unknown field(s) in ${label}: ${unknown.join(', ')}.`);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}
