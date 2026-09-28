import path from 'node:path';
import { exists } from '../utils/fs.js';
import { readYaml, writeYamlAtomic } from '../core/yaml.js';
import { loadWorkMetaOrThrow, workspacePath } from '../core/workspace.js';
import { listVerificationRuns } from '../core/evidence.js';
import { gitHead } from '../core/git.js';
import { formatEvidence, hasResolvableEvidence, normalizeEvidenceRefs, validateEvidenceEntry } from '../context/evidence.js';
import { evidenceStatus } from '../context/freshness.js';
import {
  ASSESSMENT_ID,
  CONVERGENCE_SCHEMA_VERSION,
  FINDING_STATUSES,
  QUALIFIED_REF,
  UNREQUESTED_DISPOSITIONS,
  UNREQUESTED_ID
} from './constants.js';
import { activeCriteria, bareRef, resolveDeliveryCriteria } from './requirements.js';
import { convergenceImpactBoundary, loadWorkImpacts, pendingImpact, pendingImpactMessage } from './impact.js';
import { convergenceRequired } from './policy.js';

// Delivery convergence (v0.3.8): does the delivered implementation match the approved
// intent? Distinct from verification (do the recorded technical checks pass?) and
// review (is the implementation technically acceptable?).
//
// The Agent inspects the implementation against each acceptance criterion and records
// a finding — satisfied, partial, missing, or contradicts — with a reason and evidence;
// implemented behavior nobody requested is recorded separately as UR-###. YallaFlow
// validates the references and records the assessment. It never infers a finding,
// never converts one, and never deletes one.
//
// work/<id>/convergence.yaml is append-only: CV-### assessments are never rewritten.
// The current view is derived: per active criterion, its latest finding; that finding
// is stale — history intact, current reliability gone — when it was recorded before an
// invalidation boundary, its criterion was revised since, or evidence it cites changed.

const LEDGER_FIELDS = new Set(['schemaVersion', 'assessments', 'updatedAt']);
const ASSESSMENT_FIELDS = new Set(['id', 'recordedAt', 'stage', 'basis', 'summary', 'findings', 'unrequested']);
const FINDING_FIELDS = new Set(['criterion', 'status', 'reason', 'evidence']);
const UNREQUESTED_FIELDS = new Set(['id', 'disposition', 'summary', 'reason', 'evidence']);
const INPUT_FIELDS = new Set(['summary', 'findings', 'unrequested']);
const CONVERGENCE_EVIDENCE = /^convergence:\s*(PF-\d+)\/(CV-\d{3,})$/i;

export function convergenceFilePath(root, workId) {
  return path.join(workspacePath(root), 'work', workId, 'convergence.yaml');
}

function emptyLedger() {
  return { schemaVersion: CONVERGENCE_SCHEMA_VERSION, assessments: [], updatedAt: null };
}

export async function loadWorkConvergence(root, meta) {
  const file = convergenceFilePath(root, meta.id);
  if (!await exists(file)) return { exists: false, ledger: emptyLedger() };
  const ledger = await readYaml(file);
  const errors = validateConvergenceLedger(ledger);
  if (errors.length) throw new Error(`Convergence ledger for ${meta.id} is invalid:\n- ${errors.join('\n- ')}`);
  return { exists: true, ledger: structuredClone(ledger) };
}

export function validateConvergenceLedger(ledger) {
  const errors = [];
  if (!ledger || typeof ledger !== 'object' || Array.isArray(ledger)) return ['convergence ledger must be an object'];
  unknown(ledger, LEDGER_FIELDS, 'convergence ledger', errors);
  if (ledger.schemaVersion !== CONVERGENCE_SCHEMA_VERSION) errors.push(`schemaVersion must be ${CONVERGENCE_SCHEMA_VERSION}`);
  if (!Array.isArray(ledger.assessments)) return [...errors, 'assessments must be an array'];
  const ids = new Set();
  const unrequestedSeen = new Set();
  let previous = '';
  for (const assessment of ledger.assessments) {
    const label = `assessment ${assessment?.id ?? '<unknown>'}`;
    if (!assessment || typeof assessment !== 'object') { errors.push(`${label} must be an object`); continue; }
    unknown(assessment, ASSESSMENT_FIELDS, label, errors);
    if (!ASSESSMENT_ID.test(assessment.id ?? '')) errors.push(`${label} has an invalid id (expected CV-###)`);
    if (ids.has(assessment.id)) errors.push(`duplicate assessment id ${assessment.id}`);
    ids.add(assessment.id);
    if (typeof assessment.recordedAt !== 'string') errors.push(`${label} requires recordedAt`);
    else if (assessment.recordedAt < previous) errors.push(`${label} is recorded out of order (assessments are append-only)`);
    else previous = assessment.recordedAt;
    if (!Array.isArray(assessment.findings) || !Array.isArray(assessment.unrequested)) { errors.push(`${label} requires findings and unrequested arrays`); continue; }
    if (!assessment.findings.length && !assessment.unrequested.length) errors.push(`${label} records nothing`);
    const criteria = new Set();
    for (const finding of assessment.findings) {
      const findingLabel = `${label} finding ${finding?.criterion ?? '<unknown>'}`;
      if (!finding || typeof finding !== 'object') { errors.push(`${findingLabel} must be an object`); continue; }
      unknown(finding, FINDING_FIELDS, findingLabel, errors);
      if (typeof finding.criterion !== 'string' || !finding.criterion) errors.push(`${findingLabel} requires a criterion`);
      if (criteria.has(finding.criterion)) errors.push(`${label} assesses ${finding.criterion} more than once`);
      criteria.add(finding.criterion);
      if (!FINDING_STATUSES.includes(finding.status)) errors.push(`${findingLabel} has an impossible status ${JSON.stringify(finding.status)}; expected one of: ${FINDING_STATUSES.join(', ')}`);
      if (!nonEmpty(finding.reason)) errors.push(`${findingLabel} requires a reason`);
      errors.push(...evidenceErrors(finding.evidence, findingLabel));
      if (finding.status === 'satisfied' && Array.isArray(finding.evidence) && !supportsSatisfied(finding.evidence)) {
        errors.push(`${findingLabel} is satisfied without evidence beyond free-text references`);
      }
    }
    for (const item of assessment.unrequested) {
      const itemLabel = `${label} unrequested ${item?.id ?? '<unknown>'}`;
      if (!item || typeof item !== 'object') { errors.push(`${itemLabel} must be an object`); continue; }
      unknown(item, UNREQUESTED_FIELDS, itemLabel, errors);
      if (!UNREQUESTED_ID.test(item.id ?? '')) errors.push(`${itemLabel} has an invalid id (expected UR-###)`);
      if (!UNREQUESTED_DISPOSITIONS.includes(item.disposition)) errors.push(`${itemLabel} has an invalid disposition ${JSON.stringify(item.disposition)}`);
      if (!unrequestedSeen.has(item.id)) {
        if (!nonEmpty(item.summary)) errors.push(`${itemLabel} is introduced without a summary`);
        if (!Array.isArray(item.evidence) || !item.evidence.length) errors.push(`${itemLabel} is introduced without evidence`);
        unrequestedSeen.add(item.id);
      }
      if (item.evidence !== undefined) errors.push(...evidenceErrors(item.evidence, itemLabel));
      if (item.disposition !== 'open' && !nonEmpty(item.reason)) errors.push(`${itemLabel} is ${item.disposition} without a reason`);
    }
  }
  return errors;
}

function evidenceErrors(evidence, label) {
  if (!Array.isArray(evidence) || !evidence.length) return [`${label} requires at least one evidence entry`];
  const errors = [];
  for (const entry of evidence) {
    if (entry?.type === 'convergence') {
      if (!/^PF-\d+$/.test(entry.workId ?? '') || !ASSESSMENT_ID.test(entry.assessmentId ?? '')) errors.push(`${label} has malformed convergence evidence`);
      continue;
    }
    const problem = validateEvidenceEntry(entry);
    if (problem) errors.push(`${label}: ${problem}`);
  }
  return errors;
}

function supportsSatisfied(evidence) {
  return evidence.some((entry) => entry.type === 'convergence') || hasResolvableEvidence(evidence);
}

// Convergence judges the verified implementation: it may be assessed once the
// verification checkpoint is completed (the delivery-convergence skill's prerequisite),
// and never on DONE work. Read directly from progress.yaml (read-only).
async function verificationCompleted(root, meta) {
  const file = path.join(workspacePath(root), 'work', meta.id, 'progress.yaml');
  if (!await exists(file)) return false;
  return (await readYaml(file)).skills?.verification?.status === 'completed';
}

export async function recordConvergence(root, workId, input, now = new Date().toISOString()) {
  const meta = await loadWorkMetaOrThrow(root, workId);
  if (!convergenceRequired(meta)) {
    throw new Error(`${workId} does not carry a delivery-convergence contract; convergence is not recorded for it. No files were changed.`);
  }
  if (meta.status === 'DONE') throw new Error(`${workId} is DONE; convergence history is closed. Reopen the work to re-assess it. No files were changed.`);
  if (!await verificationCompleted(root, meta)) {
    throw new Error(`${workId}: convergence judges the verified implementation; complete the verification checkpoint first (yallaflow verify ${workId} -- <command>, then checkpoint --skill verification --complete). No files were changed.`);
  }
  const impacts = await loadWorkImpacts(root, meta);
  const pending = pendingImpact(impacts.ledger);
  if (pending) throw new Error(`${pendingImpactMessage(workId, pending)}\n\nNo files were changed.`);

  const errors = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Convergence file must contain a JSON object: {"findings":[...],"unrequested":[...]}.');
  unknown(input, INPUT_FIELDS, 'convergence file', errors);
  const findingsIn = input.findings ?? [];
  const unrequestedIn = input.unrequested ?? [];
  if (!Array.isArray(findingsIn) || !Array.isArray(unrequestedIn)) errors.push('findings and unrequested must be arrays');
  else if (!findingsIn.length && !unrequestedIn.length) errors.push('the file records nothing: add at least one finding or unrequested item');
  if (input.summary !== undefined && !nonEmpty(input.summary)) errors.push('summary must be non-empty when present');
  if (errors.length) throw rejection(errors);

  const resolved = await resolveDeliveryCriteria(root, meta);
  const active = activeCriteria(resolved);
  if (!active.length) throw rejection(['no active acceptance criteria are recorded for this work item (yallaflow requirement record)']);
  const loaded = await loadWorkConvergence(root, meta);
  const ledger = loaded.ledger;
  const runs = await listVerificationRuns(root, workId);
  const findings = [];
  const seen = new Set();
  for (const [index, raw] of findingsIn.entries()) {
    const label = `finding ${raw?.criterion ?? `#${index + 1}`}`;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { errors.push(`${label} must be an object`); continue; }
    unknown(raw, FINDING_FIELDS, label, errors);
    const criterion = resolveCriterion(raw.criterion, resolved);
    if (!criterion) { errors.push(`${label}: ${JSON.stringify(raw.criterion)} is not an acceptance criterion of ${workId}${resolved.source === 'inherited' ? ` (assigned from ${resolved.owner})` : ''}`); continue; }
    if (criterion.status !== 'active') { errors.push(`${label}: ${criterion.ref} is ${criterion.status}; only active criteria are assessed`); continue; }
    if (seen.has(criterion.ref)) { errors.push(`${criterion.ref} is assessed more than once in the file`); continue; }
    seen.add(criterion.ref);
    if (!FINDING_STATUSES.includes(raw.status)) { errors.push(`${label}: status must be one of ${FINDING_STATUSES.join(', ')}; received ${JSON.stringify(raw.status)}`); continue; }
    if (!nonEmpty(raw.reason)) errors.push(`${label} requires a reason`);
    const evidence = await normalizeFindingEvidence(root, workId, raw.evidence, runs, label, errors, criterion);
    if (!evidence) continue;
    if (raw.status === 'satisfied') {
      if (!supportsSatisfied(evidence)) errors.push(`${label}: satisfied requires evidence beyond free-text references (a repository path, verification:V-###, runtime:/user: evidence, or convergence:PF-####/CV-###)`);
      for (const entry of evidence.filter((item) => item.verificationRunId)) {
        const run = runs.find((candidate) => candidate.id === entry.verificationRunId);
        if (!run?.success) errors.push(`${label}: satisfied cannot rest on failed verification run ${entry.verificationRunId}`);
      }
    }
    findings.push({ criterion: criterion.ref, status: raw.status, reason: nonEmpty(raw.reason) ? raw.reason.trim() : raw.reason, evidence });
  }

  const current = currentUnrequested(ledger);
  let nextUr = current.size ? Math.max(...[...current.keys()].map((id) => Number(id.slice(3)))) : 0;
  const unrequested = [];
  for (const [index, raw] of unrequestedIn.entries()) {
    const label = `unrequested ${raw?.id ?? `#${index + 1}`}`;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { errors.push(`${label} must be an object`); continue; }
    unknown(raw, UNREQUESTED_FIELDS, label, errors);
    const disposition = raw.disposition ?? 'open';
    if (!UNREQUESTED_DISPOSITIONS.includes(disposition)) { errors.push(`${label}: disposition must be one of ${UNREQUESTED_DISPOSITIONS.join(', ')}`); continue; }
    if (disposition !== 'open' && !nonEmpty(raw.reason)) errors.push(`${label}: ${disposition} requires an explicit reason`);
    let id = raw.id;
    if (id !== undefined) {
      if (!current.has(id)) { errors.push(`${label}: ${id} was never recorded (omit id to record new unrequested behavior)`); continue; }
    } else {
      if (!nonEmpty(raw.summary)) errors.push(`${label}: new unrequested behavior requires a summary`);
      if (!Array.isArray(raw.evidence) || !raw.evidence.length) errors.push(`${label}: new unrequested behavior requires evidence`);
      nextUr += 1;
      id = `UR-${String(nextUr).padStart(3, '0')}`;
    }
    if (unrequested.some((item) => item.id === id)) { errors.push(`${id} appears more than once in the file`); continue; }
    const evidence = raw.evidence === undefined ? undefined : await normalizeFindingEvidence(root, workId, raw.evidence, runs, label, errors);
    unrequested.push({
      id,
      disposition,
      ...(nonEmpty(raw.summary) ? { summary: raw.summary.trim() } : {}),
      ...(nonEmpty(raw.reason) ? { reason: raw.reason.trim() } : {}),
      ...(evidence ? { evidence } : {})
    });
  }
  if (errors.length) throw rejection(errors);

  const head = gitHead(root);
  const cited = [...new Set(findings.flatMap((finding) => finding.evidence).map((entry) => entry.verificationRunId).filter(Boolean))];
  const assessment = {
    id: nextAssessmentId(ledger.assessments),
    recordedAt: now,
    stage: meta.status,
    basis: {
      requirementsRevision: resolved.ledger.revision,
      ...(head ? { gitCommit: head } : {}),
      verificationRunIds: cited
    },
    ...(nonEmpty(input.summary) ? { summary: input.summary.trim() } : {}),
    findings,
    unrequested
  };
  ledger.assessments.push(assessment);
  ledger.updatedAt = now;
  await writeYamlAtomic(convergenceFilePath(root, workId), ledger);
  return { meta, assessment, ledger };
}

async function normalizeFindingEvidence(root, workId, refs, runs, label, errors, criterion = null) {
  if (!Array.isArray(refs) || !refs.length || refs.some((ref) => !nonEmpty(ref))) {
    errors.push(`${label} requires at least one evidence reference (repository path, verification:V-###, runtime:/user: text, convergence:PF-####/CV-###, or a reference)`);
    return null;
  }
  const out = [];
  for (const ref of refs) {
    const child = CONVERGENCE_EVIDENCE.exec(ref.trim());
    if (child) {
      const problem = criterion
        ? await childAssessmentProblem(root, workId, child[1].toUpperCase(), child[2].toUpperCase(), criterion)
        : 'convergence evidence can only support a criterion finding';
      if (problem) { errors.push(`${label}: ${problem}`); continue; }
      out.push({ type: 'convergence', workId: child[1].toUpperCase(), assessmentId: child[2].toUpperCase() });
      continue;
    }
    try {
      const normalized = await normalizeEvidenceRefs(root, [ref], { workId, verificationRuns: runs });
      if (normalized.some((entry) => entry.type === 'repository' && (entry.path === '.yallaflow' || entry.path.startsWith('.yallaflow/')))) {
        errors.push(`${label}: ${ref} is YallaFlow's own state, not evidence about the implementation`);
        continue;
      }
      out.push(...normalized);
    } catch (error) {
      errors.push(`${label}: ${error.message}`);
    }
  }
  return out;
}

// A child's assessment proves a parent criterion only when the child is a direct
// decomposition child of this work item and that assessment recorded the criterion
// (qualified as <parent>/AC-###) as satisfied.
async function childAssessmentProblem(root, workId, childId, assessmentId, criterion) {
  let meta;
  try {
    meta = await loadWorkMetaOrThrow(root, childId);
  } catch {
    return `convergence evidence names unknown work item ${childId}`;
  }
  if (meta.parent !== workId) return `convergence evidence must cite a direct decomposition child of ${workId}; ${childId} is not one`;
  const ledger = (await loadWorkConvergence(root, meta)).ledger;
  const assessment = ledger.assessments.find((entry) => entry.id === assessmentId);
  if (!assessment) return `convergence assessment ${childId}/${assessmentId} does not exist`;
  const qualified = `${workId}/${criterion.id}`;
  const finding = assessment.findings.find((entry) => entry.criterion === qualified);
  if (!finding) return `${childId}/${assessmentId} did not assess ${qualified}`;
  if (finding.status !== 'satisfied') return `${childId}/${assessmentId} recorded ${qualified} as ${finding.status}, not satisfied`;
  return null;
}

function resolveCriterion(ref, resolved) {
  if (typeof ref !== 'string') return null;
  const trimmed = ref.trim();
  const bare = bareRef(trimmed, resolved.owner);
  if (QUALIFIED_REF.test(bare)) return null;
  return resolved.criteria.find((entry) => entry.id === bare) ?? null;
}

function currentUnrequested(ledger) {
  const items = new Map();
  for (const assessment of ledger.assessments) {
    for (const item of assessment.unrequested) {
      items.set(item.id, { ...(items.get(item.id) ?? {}), ...item, assessment: assessment.id, recordedAt: assessment.recordedAt });
    }
  }
  return items;
}

function nextAssessmentId(assessments) {
  const highest = assessments.reduce((max, entry) => Math.max(max, Number(/^CV-(\d+)$/.exec(entry.id ?? '')?.[1]) || 0), 0);
  return `CV-${String(highest + 1).padStart(3, '0')}`;
}

// Read-only derived view. Never writes; staleness is computed, never stored.
export async function evaluateConvergence(root, meta) {
  const required = convergenceRequired(meta);
  const resolved = await resolveDeliveryCriteria(root, meta);
  const convergence = await loadWorkConvergence(root, meta);
  const impacts = await loadWorkImpacts(root, meta);
  const pending = pendingImpact(impacts.ledger);
  const impactBoundary = convergenceImpactBoundary(impacts.ledger);
  const runs = await listVerificationRuns(root, meta.id);
  const assessments = convergence.ledger.assessments;
  const latestByCriterion = new Map();
  for (const assessment of assessments) {
    for (const finding of assessment.findings) latestByCriterion.set(finding.criterion, { finding, assessment });
  }

  const criteria = [];
  for (const criterion of activeCriteria(resolved)) {
    const latest = latestByCriterion.get(criterion.ref);
    if (!latest) {
      criteria.push({ ref: criterion.ref, requirement: criterion.requirement, statement: criterion.statement, status: 'not-assessed', stale: false, staleReasons: [] });
      continue;
    }
    const staleReasons = await findingStaleness(root, meta, criterion, latest, { impactBoundary, runs });
    criteria.push({
      ref: criterion.ref,
      requirement: criterion.requirement,
      statement: criterion.statement,
      status: latest.finding.status,
      reason: latest.finding.reason,
      evidence: latest.finding.evidence,
      assessment: latest.assessment.id,
      recordedAt: latest.assessment.recordedAt,
      stale: staleReasons.length > 0,
      staleReasons
    });
  }
  const unrequested = [...currentUnrequested(convergence.ledger).values()];
  const counts = { satisfied: 0, partial: 0, missing: 0, contradicts: 0, 'not-assessed': 0, stale: 0 };
  for (const entry of criteria) {
    counts[entry.status] += 1;
    if (entry.stale) counts.stale += 1;
  }
  const gaps = criteria.filter((entry) => entry.status !== 'satisfied' || entry.stale);
  const openUnrequested = unrequested.filter((item) => item.disposition === 'open');
  const blockers = [
    ...(pending ? [{ text: `impact ${pending.id} is pending assessment` }] : []),
    ...(resolved.source === 'none' || !criteria.length ? [{ text: 'no active acceptance criteria are recorded' }] : []),
    ...gaps.map((entry) => ({ text: `${entry.ref} → ${entry.stale ? `stale (${entry.staleReasons[0]})` : entry.status}` })),
    ...openUnrequested.map((item) => ({ text: `${item.id} → unrequested behavior is open (accept with a reason, or remove it)` }))
  ];
  return {
    required,
    source: resolved.source,
    owner: resolved.owner,
    requirements: resolved.requirements,
    allCriteria: resolved.criteria,
    criteria,
    unrequested,
    counts,
    assessments: assessments.length,
    latestAssessment: assessments.at(-1) ?? null,
    pendingImpact: pending,
    converged: required && blockers.length === 0,
    blockers
  };
}

async function findingStaleness(root, meta, criterion, { finding, assessment }, { impactBoundary, runs }) {
  const reasons = [];
  if (meta.lastInvalidationAt && !(assessment.recordedAt > meta.lastInvalidationAt)) reasons.push(`recorded before the reopen/revision at ${meta.lastInvalidationAt}`);
  if (impactBoundary && !(assessment.recordedAt > impactBoundary)) reasons.push(`recorded before an impact assessment invalidated convergence at ${impactBoundary}`);
  if (criterion.updatedAt > assessment.recordedAt) reasons.push(`${criterion.ref} was revised after ${assessment.id}`);
  for (const entry of finding.evidence) {
    if (entry.type === 'repository') {
      const status = await evidenceStatus(root, entry);
      if (status === 'changed') reasons.push(`evidence ${entry.path} changed since ${assessment.id}`);
      if (status === 'missing') reasons.push(`evidence ${entry.path} no longer exists`);
    }
    if (entry.type === 'convergence') {
      const reason = await childEvidenceStaleness(root, meta, criterion, entry);
      if (reason) reasons.push(reason);
    }
    if (entry.verificationRunId && meta.lastInvalidationAt) {
      const run = runs.find((candidate) => candidate.id === entry.verificationRunId);
      if (run && !(run.verifiedAt > meta.lastInvalidationAt)) reasons.push(`cites verification ${run.id}, recorded before the latest reopen/revision`);
    }
  }
  return [...new Set(reasons)];
}

// Cited child convergence is only as current as the child's own view of the criterion.
async function childEvidenceStaleness(root, meta, criterion, entry) {
  let child;
  try {
    child = await loadWorkMetaOrThrow(root, entry.workId);
  } catch {
    return `cited ${entry.workId} no longer exists`;
  }
  const qualified = `${meta.id}/${criterion.id}`;
  const current = (await evaluateConvergence(root, child)).criteria.find((candidate) => candidate.ref === qualified);
  if (!current) return `${entry.workId} no longer answers for ${qualified}`;
  if (current.status !== 'satisfied' || current.stale) return `${entry.workId}'s current finding for ${qualified} is ${current.stale ? 'stale' : current.status}`;
  return null;
}

export function describeFindingEvidence(entry) {
  if (entry.type === 'convergence') return `${entry.workId}/${entry.assessmentId} (convergence)`;
  return formatEvidence(entry);
}

function rejection(errors) {
  return new Error(`Convergence assessment rejected:\n- ${errors.join('\n- ')}\n\nNo files were changed.`);
}

function unknown(value, allowed, label, errors) {
  const extra = Object.keys(value).filter((field) => !allowed.has(field));
  if (extra.length) errors.push(`${label} has unknown field(s): ${extra.join(', ')}`);
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}
