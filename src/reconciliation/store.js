import path from 'node:path';
import { appendFile } from 'node:fs/promises';
import { exists, readText, writeText } from '../utils/fs.js';
import { readYaml, writeYaml } from '../core/yaml.js';
import { getCurrentState, listWork, nextWorkId, workspacePath } from '../core/workspace.js';
import { loadWorkProgress } from '../core/progress.js';
import {
  appliedTransition,
  currentFacts,
  loadContextLedger,
  mutateContextLedger,
  originKey,
  simulateContextLedger,
  validateContextLedger
} from '../context/ledger.js';
import { generatedLegacySectionState, writeContextProjection } from '../context/projection.js';
import { deriveProvenance, normalizeEvidenceRefs } from '../context/evidence.js';
import { collectLegacyItems, pendingLegacyItems } from '../context/legacy.js';
import { AREA_LABELS, CONTEXT_AREAS, CONTEXT_SCHEMA_V2, PROVENANCE_VALUES } from '../context/constants.js';
import { KNOWLEDGE_POLICY_VERSION } from '../knowledge/constants.js';
import { loadWorkLimitations, limitationsFilePath, nextLimitationId, normalizeLimitation, sameStatement, validateLimitation } from '../limitations/store.js';
import { gateStatus, loadReviews, requestGateReview, setGateStatus } from '../reviews/store.js';
import { REGISTRY_VERSION } from '../skills/constants.js';
import {
  decisionsEqual,
  exactDuplicateKey,
  normalizeDecisionInput,
  normalizeStatement,
  planHash,
  resolvePlan,
  summarizePlan,
  validatePlanStructure
} from './plan.js';
import {
  FACT_PRODUCING_ACTIONS,
  JOINING_ACTIONS,
  RECONCILIATION_ARCHIVE_FILE,
  RECONCILIATION_FILE,
  RECONCILIATION_GATE,
  RECONCILIATION_SCHEMA_VERSION,
  RECONCILIATION_SKILL,
  RECONCILIATION_SOURCE
} from './constants.js';

// Legacy knowledge reconciliation (v0.3.7). Migration is not reconciliation: v0.3.5
// durable knowledge becomes canonical current truth only through explicit,
// reviewable relationships the Agent declares — never by blind import and never by
// semantic inference inside the CLI.
//
//   legacy work records ──start──▶ candidates (RC-####, frozen in the plan)
//     ──plan --file──▶ Agent decisions ──approve (hash-bound)──▶ apply ──▶ CTX ledger
//
// The plan lives with a dedicated read-only reconciliation work item
// (work/<id>/reconciliation.yaml), reusing the ordinary work lifecycle, the
// reviews.yaml gate ledger, questions.yaml for unresolved ambiguity, discovery.yaml
// for limitations, and handoff/resume — the same shape as Brownfield Baseline. Work
// history (baseline.yaml / knowledge.yaml / work.md of PF-0001…) is never rewritten;
// the plan is the durable record of how old knowledge became current memory.

export function reconciliationFilePath(root, workId) {
  return path.join(workspacePath(root), 'work', workId, RECONCILIATION_FILE);
}

export async function loadReconciliation(root, workId) {
  const file = reconciliationFilePath(root, workId);
  if (!await exists(file)) return { exists: false, plan: null };
  return { exists: true, plan: await readYaml(file) };
}

async function writePlan(root, workId, plan) {
  const errors = validatePlanStructure(plan);
  if (errors.length) throw new Error(`Reconciliation plan for ${workId} would be invalid:\n${errors.map((entry) => `- ${entry}`).join('\n')}`);
  await writeYaml(reconciliationFilePath(root, workId), plan);
}

// Every reconciliation work item with its plan (plan may be null when missing).
export async function listReconciliations(root) {
  const results = [];
  for (const meta of await listWork(root)) {
    const { exists: hasPlan, plan } = await loadReconciliation(root, meta.id);
    if (meta.reconciliation || hasPlan) results.push({ meta, plan: hasPlan ? plan : null });
  }
  return results;
}

export async function findActiveReconciliation(root) {
  return (await listReconciliations(root)).find((entry) => entry.meta.reconciliation && entry.meta.status !== 'DONE') ?? null;
}

// Origins whose reconciliation decision deliberately keeps them out of project memory
// (skip / limitation) and has been applied — settled, but never in the ledger.
export function settledOriginKeys(reconciliations) {
  const keys = new Set();
  for (const { plan } of reconciliations) {
    if (!Array.isArray(plan?.candidates)) continue;
    for (const candidate of plan.candidates) {
      if (candidate.applied && ['skip', 'limitation'].includes(candidate.decision?.action)) keys.add(originKey(candidate.origin));
    }
  }
  return keys;
}

// Read-only: the legacy items that still require reconciliation.
export async function pendingLegacyCandidates(root) {
  const { ledger } = await loadContextLedger(root);
  const reconciliations = await listReconciliations(root);
  return pendingLegacyItems(await collectLegacyItems(root), ledger, settledOriginKeys(reconciliations));
}

async function resolveReconciliationWork(root, requestedWorkId) {
  if (requestedWorkId) {
    const entry = (await listReconciliations(root)).find((item) => item.meta.id === requestedWorkId);
    if (!entry || !entry.meta.reconciliation) throw new Error(`${requestedWorkId} is not a legacy-context reconciliation work item.`);
    if (!entry.plan) throw new Error(`${requestedWorkId} has no reconciliation plan (${RECONCILIATION_FILE}). Run \`yallaflow doctor\`.`);
    return entry;
  }
  const all = (await listReconciliations(root)).filter((item) => item.meta.reconciliation && item.plan);
  const active = all.find((item) => item.meta.status !== 'DONE') ?? all.at(-1);
  if (!active) throw new Error('No legacy-context reconciliation found. Run `yallaflow context reconcile start` first.');
  return active;
}

function assertStructurallyValid(workId, plan) {
  const errors = validatePlanStructure(plan);
  if (errors.length) {
    throw new Error(`Reconciliation plan for ${workId} is invalid; refusing to continue:\n${errors.map((entry) => `- ${entry}`).join('\n')}\nRun \`yallaflow doctor\` for details. No files were changed.`);
  }
}

// ---------------------------------------------------------------------------
// start

// Idempotent: while a reconciliation is open, `start` resumes it rather than creating
// a competing one. Refused (no mutation) when nothing legacy remains to reconcile.
export async function startReconciliation(root, now = new Date().toISOString()) {
  const active = await findActiveReconciliation(root);
  if (active) return { meta: active.meta, plan: active.plan, created: false };

  const pending = await pendingLegacyCandidates(root);
  if (!pending.length) {
    throw new Error('Nothing to reconcile: no legacy v0.3.5 project context is pending. Project memory is already governed by .yallaflow/context/index.yaml. No files were changed.');
  }
  const { ledger } = await loadContextLedger(root);
  const live = currentFacts(ledger);
  const firstByKey = new Map();
  const candidates = pending.map((item, index) => {
    const id = `RC-${String(index + 1).padStart(4, '0')}`;
    const candidate = { id, ...item };
    if (candidate.provenance === null) delete candidate.provenance;
    if (candidate.recordedAt === null) delete candidate.recordedAt;
    if (candidate.workTitle === null) delete candidate.workTitle;
    const key = exactDuplicateKey(candidate);
    if (firstByKey.has(key)) candidate.exactDuplicateOf = firstByKey.get(key);
    else firstByKey.set(key, id);
    const same = live.find((fact) => fact.area === candidate.area && normalizeStatement(fact.summary) === normalizeStatement(candidate.summary));
    if (same) candidate.sameStatementAs = same.id;
    return candidate;
  });

  const id = await nextWorkId(root);
  const meta = {
    id,
    type: 'investigation',
    title: 'Legacy Context Reconciliation',
    scope: 'bounded',
    workflow: 'investigation',
    readOnly: true,
    reconciliation: true,
    routingStatus: 'routed',
    routingConfidence: 'high',
    routingReason: 'Explicit legacy project-context reconciliation (yallaflow context reconcile start).',
    routedAt: now,
    requiredCapabilities: ['reconcile'],
    behaviorContract: { registryVersion: REGISTRY_VERSION, skills: [RECONCILIATION_SKILL] },
    status: 'INTAKE',
    // Reviewed through its own hash-bound 'reconciliation' gate, not the ordinary
    // knowledge-candidate review.
    knowledgePolicy: { version: KNOWLEDGE_POLICY_VERSION, reviewRequired: false },
    createdAt: now,
    updatedAt: now
  };
  const plan = {
    schemaVersion: RECONCILIATION_SCHEMA_VERSION,
    source: RECONCILIATION_SOURCE,
    workId: id,
    status: 'open',
    candidates,
    history: [{ action: 'started', at: now, candidateCount: candidates.length, existingFacts: live.length }],
    createdAt: now,
    updatedAt: now
  };
  const dir = path.join(workspacePath(root), 'work', id);
  await writeYaml(path.join(dir, 'meta.yaml'), meta);
  await writePlan(root, id, plan);
  await writeText(path.join(dir, 'work.md'), reconciliationWorkTemplate(meta, candidates.length));
  await writeText(path.join(dir, 'progress.md'), `# Work Ledger — ${id}\n\nCreated: ${now}\nKind: legacy project-context reconciliation\n\n- ${now} Reconciliation started (${candidates.length} legacy candidate(s)).\n`);
  // Never steals focus from work already in progress.
  const stateFile = path.join(workspacePath(root), 'state', 'current.yaml');
  const state = await getCurrentState(root);
  const becameActive = !state.activeWork;
  if (becameActive) await writeYaml(stateFile, { schemaVersion: 1, activeWork: id, stage: 'INTAKE', updatedAt: now });
  return { meta, plan, created: true, becameActive, previousActive: state.activeWork ?? null };
}

function reconciliationWorkTemplate(meta, count) {
  return `# ${meta.id} — Legacy Context Reconciliation\n\n**Type:** investigation (read-only)\n**Status:** ${meta.status}\n\n` +
    `Reconcile ${count} legacy v0.3.5 project-context item(s) into canonical project memory. Historical work items are never rewritten; ` +
    'this work item records how their knowledge becomes current truth.\n\n' +
    `1. Inspect candidates: \`yallaflow context reconcile show ${meta.id}\`\n` +
    `2. Record explicit decisions: \`yallaflow context reconcile plan ${meta.id} --file <decisions.json>\` (see \`yallaflow skill ${RECONCILIATION_SKILL}\`)\n` +
    `3. Record genuine ambiguity as questions: \`yallaflow question add ${meta.id} --category architecture --text "..."\` — never guess\n` +
    `4. Preview the resulting project memory: \`yallaflow context reconcile preview ${meta.id}\`\n` +
    `5. Complete the checkpoint, then a human approves: \`yallaflow context reconcile approve ${meta.id}\`\n` +
    `6. Apply: \`yallaflow context reconcile apply ${meta.id}\`\n\n` +
    'The structured plan (`reconciliation.yaml`) is CLI-owned state; change it only through `yallaflow context reconcile plan`.\n\n## Reconciliation Notes\n\n';
}

// ---------------------------------------------------------------------------
// plan (record Agent decisions)

export async function recordDecisions(root, requestedWorkId, input, now = new Date().toISOString()) {
  const { meta, plan } = await resolveReconciliationWork(root, requestedWorkId);
  assertStructurallyValid(meta.id, plan);
  if (plan.status === 'applied') throw new Error(`${meta.id}'s reconciliation is fully applied; its decisions are history. No files were changed.`);
  if (!input || typeof input !== 'object' || !Array.isArray(input.decisions) || !input.decisions.length) {
    throw new Error('Decisions file must be a JSON object with a non-empty "decisions" array. No files were changed.');
  }
  const draft = structuredClone(plan);
  const byId = new Map(draft.candidates.map((candidate) => [candidate.id, candidate]));
  const seen = new Set();
  const errors = [];
  for (const raw of input.decisions) {
    let normalized;
    try {
      normalized = normalizeDecisionInput(raw, now);
    } catch (error) {
      errors.push(error.message);
      continue;
    }
    const candidate = byId.get(normalized.candidate);
    if (!candidate) { errors.push(`Unknown reconciliation candidate ${normalized.candidate}.`); continue; }
    if (seen.has(candidate.id)) { errors.push(`${candidate.id} is decided more than once in this file.`); continue; }
    seen.add(candidate.id);
    if (candidate.applied) { errors.push(`${candidate.id} is already applied (${candidate.decision.action}); applied decisions are history and cannot change.`); continue; }
    if (normalized.clear) delete candidate.decision;
    else {
      // An unchanged decision keeps its original decidedAt.
      if (!decisionsEqual(candidate.decision, normalized.decision)) candidate.decision = normalized.decision;
    }
  }
  errors.push(...validatePlanStructure(draft));
  const { ledger } = await loadContextLedger(root);
  if (!errors.length) {
    const resolved = resolvePlan(draft, ledger);
    errors.push(...resolved.errors, ...resolved.stateIssues);
  }
  if (errors.length) throw new Error(`Reconciliation decisions rejected:\n${errors.map((entry) => `- ${entry}`).join('\n')}\nNo files were changed.`);

  const changed = planHash(draft) !== planHash(plan);
  if (!changed) return { meta, plan, changed: false };
  const wasApproved = Boolean(draft.approval);
  delete draft.approval;
  draft.history.push({ action: 'planned', at: now, decisions: seen.size, ...(wasApproved ? { invalidatedApproval: true } : {}) });
  draft.updatedAt = now;
  await writePlan(root, meta.id, draft);
  await requestGateReview(root, meta.id, RECONCILIATION_GATE, wasApproved ? 'reconciliation plan revised after approval' : 'reconciliation plan recorded', now);
  return { meta, plan: draft, changed: true, invalidatedApproval: wasApproved };
}

// ---------------------------------------------------------------------------
// review

export function reviewState(plan, reviewLedger) {
  const gate = gateStatus(reviewLedger, RECONCILIATION_GATE);
  if (!plan.approval) return gate === 'changes_requested' ? 'changes-requested' : 'awaiting-review';
  if (plan.approval.hash !== planHash(plan)) return 'changed-since-approval';
  if (gate !== 'approved') return 'approval-inconsistent';
  return 'approved';
}

export async function approveReconciliation(root, requestedWorkId, note, now = new Date().toISOString()) {
  const { meta, plan } = await resolveReconciliationWork(root, requestedWorkId);
  assertStructurallyValid(meta.id, plan);
  const unapplied = plan.candidates.filter((candidate) => candidate.decision && !candidate.applied);
  if (!unapplied.length) throw new Error(`${meta.id} has no unapplied reconciliation decisions to approve. Record decisions with \`yallaflow context reconcile plan\` first. No files were changed.`);
  const progress = await loadWorkProgress(root, meta);
  if (progress.ledger.skills[RECONCILIATION_SKILL]?.status !== 'completed') {
    throw new Error(`Complete the ${RECONCILIATION_SKILL} checkpoint before review: yallaflow checkpoint ${meta.id} --skill ${RECONCILIATION_SKILL} --complete --summary "..." No files were changed.`);
  }
  const { ledger } = await loadContextLedger(root);
  const resolved = resolvePlan(plan, ledger);
  const problems = [...resolved.errors, ...resolved.stateIssues];
  if (problems.length) throw new Error(`Reconciliation plan for ${meta.id} cannot be approved:\n${problems.map((entry) => `- ${entry}`).join('\n')}\nNo files were changed.`);
  const { ledger: reviews } = await loadReviews(root, meta.id);
  const hash = planHash(plan);
  if (plan.approval?.hash === hash && gateStatus(reviews, RECONCILIATION_GATE) === 'approved') return { meta, plan, unchanged: true };
  plan.approval = { hash, approvedAt: now, ...(note ? { note: note.trim() } : {}) };
  plan.history.push({ action: 'approved', at: now, hash, ...(note ? { note: note.trim() } : {}) });
  plan.updatedAt = now;
  await writePlan(root, meta.id, plan);
  await setGateStatus(root, meta.id, RECONCILIATION_GATE, 'approved', note, now);
  return { meta, plan, unchanged: false };
}

export async function feedbackReconciliation(root, requestedWorkId, note, now = new Date().toISOString()) {
  const { meta, plan } = await resolveReconciliationWork(root, requestedWorkId);
  assertStructurallyValid(meta.id, plan);
  delete plan.approval;
  plan.history.push({ action: 'changes_requested', at: now, ...(note ? { note: note.trim() } : {}) });
  plan.updatedAt = now;
  await writePlan(root, meta.id, plan);
  await setGateStatus(root, meta.id, RECONCILIATION_GATE, 'changes_requested', note, now);
  return { meta, plan };
}

// ---------------------------------------------------------------------------
// application model (shared by preview and apply — one interpretation, never two)

// Builds the ledger mutation for every decided, not-yet-applied candidate. Each group
// (a fact-producing candidate plus everything merged into or reconfirming it) is
// created within one mutator call, so a merge group can never be half-applied.
async function buildApplication(root, reconWorkId, plan, ledger, now) {
  const resolved = resolvePlan(plan, ledger);
  const problems = [...resolved.errors, ...resolved.stateIssues];
  const byId = new Map(plan.candidates.map((candidate) => [candidate.id, candidate]));
  // Crash-window safety: a candidate the ledger already reflects is never applied
  // again, even if the plan's own bookkeeping did not record it.
  const inLedger = (candidate) => Boolean(appliedTransition(ledger, candidate.origin));
  const todo = plan.candidates.filter((candidate) => candidate.decision && !candidate.applied && !inLedger(candidate));

  const evidenceOf = new Map();
  for (const candidate of todo) {
    evidenceOf.set(candidate.id, await normalizeEvidenceRefs(root, candidate.evidence, { workId: candidate.origin.workId, adopted: true }));
  }
  const originOf = (candidate) => ({
    workId: candidate.origin.workId,
    ...(candidate.origin.baselineFactId ? { baselineFactId: candidate.origin.baselineFactId } : { candidateId: candidate.origin.candidateId }),
    adopted: true,
    reconciliation: { workId: reconWorkId, candidate: candidate.id }
  });

  const roots = todo.filter((candidate) => FACT_PRODUCING_ACTIONS.includes(candidate.decision.action));
  const members = todo.filter((candidate) => JOINING_ACTIONS.includes(candidate.decision.action));
  const membersOf = (rootId) => members.filter((candidate) => resolved.nodes.get(candidate.id)?.rc === rootId);
  const disputes = todo.filter((candidate) => candidate.decision.action === 'disputes');
  const skips = todo.filter((candidate) => candidate.decision.action === 'skip');
  const limitations = todo.filter((candidate) => candidate.decision.action === 'limitation');

  // Supersession targets first: a candidate superseding another candidate is created
  // after the fact it replaces.
  const ordered = [];
  const visit = (candidate, trail = new Set()) => {
    if (ordered.includes(candidate) || trail.has(candidate.id)) return;
    trail.add(candidate.id);
    const target = resolved.supersedes.get(candidate.id);
    if (target?.rc && byId.get(target.rc)) visit(byId.get(target.rc), trail);
    ordered.push(candidate);
  };
  roots.forEach((candidate) => visit(candidate));

  const groups = ordered.map((candidate) => {
    const group = [candidate, ...membersOf(candidate.id)];
    const evidence = [];
    const seen = new Set();
    for (const member of group) {
      for (const entry of evidenceOf.get(member.id)) {
        const key = JSON.stringify(entry);
        if (!seen.has(key)) { seen.add(key); evidence.push(entry); }
      }
    }
    const times = group.map((member) => member.recordedAt).filter(Boolean).sort();
    const { decision } = candidate;
    return {
      root: candidate,
      members: group.slice(1),
      target: resolved.supersedes.get(candidate.id) ?? null,
      input: {
        area: decision.area ?? candidate.area,
        summary: decision.summary ?? candidate.summary,
        confidence: candidate.confidence,
        provenance: PROVENANCE_VALUES.includes(candidate.provenance) ? candidate.provenance : deriveProvenance(evidence),
        evidence,
        origin: originOf(candidate),
        verifiedAt: times.at(-1) ?? now,
        verifiedAtCommit: null,
        ...(candidate.note ? { note: candidate.note } : {})
      }
    };
  });
  const attachments = members.filter((candidate) => resolved.nodes.get(candidate.id)?.ctx);

  const mutator = (ops) => {
    const factOf = new Map(); // RC id → CTX id created this round
    const factFor = (node) => node.ctx ?? factOf.get(node.rc);
    for (const group of groups) {
      const fact = group.target
        ? ops.supersede(factFor(group.target), group.input, 'adopted').fact
        : ops.introduce(group.input, 'adopted');
      factOf.set(group.root.id, fact.id);
      for (const member of group.members) {
        ops.attachOrigin(fact.id, originOf(member), member.decision.action === 'merge-with' ? 'merged' : 'reconfirmed');
      }
    }
    for (const candidate of attachments) {
      ops.attachOrigin(resolved.nodes.get(candidate.id).ctx, originOf(candidate), candidate.decision.action === 'merge-with' ? 'merged' : 'reconfirmed');
    }
    for (const candidate of disputes) {
      ops.dispute(factFor(resolved.disputes.get(candidate.id)), { summary: candidate.summary, evidence: evidenceOf.get(candidate.id), origin: originOf(candidate) });
    }
    return factOf;
  };
  return { resolved, problems, todo, groups, attachments, disputes, skips, limitations, mutator, ledgerWork: groups.length + attachments.length + disputes.length };
}

// ---------------------------------------------------------------------------
// preview (read-only)

export async function previewReconciliation(root, requestedWorkId, now = new Date().toISOString()) {
  const { meta, plan } = await resolveReconciliationWork(root, requestedWorkId);
  assertStructurallyValid(meta.id, plan);
  const { ledger } = await loadContextLedger(root);
  const { ledger: reviews } = await loadReviews(root, meta.id);
  const application = await buildApplication(root, meta.id, plan, ledger, now);
  const counts = summarizePlan(plan);
  const base = { meta, plan, counts, review: reviewState(plan, reviews), problems: application.problems };
  if (application.problems.length) return { ...base, simulated: null };

  const before = currentFacts(ledger).length;
  const { ledger: after, result: factOf } = await simulateContextLedger(ledger, application.mutator, { now, minSchema: CONTEXT_SCHEMA_V2 });
  const areas = CONTEXT_AREAS
    .map((area) => ({ area, label: AREA_LABELS[area], current: after.facts.filter((fact) => fact.area === area && fact.state !== 'superseded').length }))
    .filter((entry) => entry.current);
  const markdown = await markdownImpact(root, application.todo);
  return {
    ...base,
    simulated: {
      before,
      after: currentFacts(after).length,
      disputedAfter: after.facts.filter((fact) => fact.state === 'disputed').length,
      areas,
      groups: application.groups.map((group) => ({ ...group, factId: factOf.get(group.root.id) })),
      attachments: application.attachments.map((candidate) => ({ candidate, factId: application.resolved.nodes.get(candidate.id).ctx })),
      disputes: application.disputes,
      skips: application.skips,
      limitations: application.limitations,
      markdown
    }
  };
}

async function markdownImpact(root, candidates) {
  const retire = [];
  const keep = [];
  const cache = new Map();
  for (const candidate of candidates) {
    const { file, marker } = candidate.legacySection ?? {};
    if (!file) continue;
    if (!cache.has(file)) {
      const absolute = path.join(workspacePath(root), file);
      cache.set(file, await exists(absolute) ? await readText(absolute) : null);
    }
    const { state } = generatedLegacySectionState(cache.get(file), candidate, marker);
    if (state === 'absent') continue;
    (state === 'edited' ? keep : retire).push({ candidate: candidate.id, file, marker });
  }
  return { retire, keep };
}

// ---------------------------------------------------------------------------
// apply

export async function applyReconciliation(root, requestedWorkId, now = new Date().toISOString()) {
  const { meta, plan } = await resolveReconciliationWork(root, requestedWorkId);
  assertStructurallyValid(meta.id, plan);
  const { ledger: reviews } = await loadReviews(root, meta.id);
  const review = reviewState(plan, reviews);
  if (review !== 'approved') {
    const why = {
      'awaiting-review': 'it has not been approved',
      'changes-requested': 'changes were requested',
      'changed-since-approval': 'it changed after it was approved (re-review required)',
      'approval-inconsistent': 'its approval record does not match the reconciliation review gate'
    }[review];
    throw new Error(`Cannot apply ${meta.id}'s reconciliation plan: ${why}. Review it with \`yallaflow context reconcile preview ${meta.id}\`, then \`yallaflow context reconcile approve ${meta.id}\`. No files were changed.`);
  }

  const { ledger } = await loadContextLedger(root);
  const ledgerErrors = validateContextLedger(ledger);
  if (ledgerErrors.length) throw new Error(`The project context ledger is invalid; refusing to apply:\n${ledgerErrors.map((entry) => `- ${entry}`).join('\n')}\nNo files were changed.`);
  // Whole-plan validation before any mutation: one invalid relation → zero changes.
  const application = await buildApplication(root, meta.id, plan, ledger, now);
  if (application.problems.length) {
    throw new Error(`Reconciliation plan for ${meta.id} cannot be applied:\n${application.problems.map((entry) => `- ${entry}`).join('\n')}\nRevise it with \`yallaflow context reconcile plan\` (then re-review). No files were changed.`);
  }

  // 1. Canonical project memory — one atomic ledger write through the single writer.
  let current = ledger;
  if (application.ledgerWork) {
    current = (await mutateContextLedger(root, application.mutator, now, { minSchema: CONTEXT_SCHEMA_V2 })).ledger;
  } else if ((await loadContextLedger(root)).exists) {
    // Retry after a projection failure: the ledger already holds everything; only
    // the derived Markdown needs regenerating.
    await writeContextProjection(root, current);
  }

  // Repeated apply of an already-applied plan: the projection above was the only
  // (repair) work; nothing else is written — no duplicate facts, origins, or history.
  const newlyApplied = plan.candidates.filter((candidate) => candidate.decision && !candidate.applied);
  if (!newlyApplied.length) return { meta, plan, newlyApplied, leftInPlace: [], archived: 0, completed: plan.status === 'applied', ledger: current };

  // 2. Work-scoped limitations (idempotent by statement).
  const limitationIds = await recordLimitations(root, meta.id, application.limitations, now);

  // 3. Bookkeeping for every newly settled candidate, then retire its legacy section.
  const archive = [];
  const leftInPlace = [];
  for (const candidate of newlyApplied) {
    const record = { at: now };
    if (!['skip', 'limitation'].includes(candidate.decision.action)) {
      const fact = appliedTransition(current, candidate.origin);
      if (!fact) throw new Error(`Internal error: ${candidate.id} was applied but its CTX fact is missing. Run \`yallaflow doctor\`.`);
      record.factId = fact.id;
    }
    if (limitationIds.has(candidate.id)) record.limitationId = limitationIds.get(candidate.id);
    record.markdown = await retireLegacySection(root, meta.id, candidate, archive);
    if (record.markdown === 'left-in-place') leftInPlace.push({ candidate: candidate.id, ...candidate.legacySection });
    candidate.applied = record;
  }
  const settled = plan.candidates.every((candidate) => candidate.applied);
  plan.status = settled ? 'applied' : 'open';
  plan.history.push({ action: 'applied', at: now, applied: newlyApplied.length, remaining: plan.candidates.filter((candidate) => !candidate.applied).length });
  plan.updatedAt = now;
  await writePlan(root, meta.id, plan);

  const progressFile = path.join(workspacePath(root), 'work', meta.id, 'progress.md');
  await appendFile(progressFile, `- ${now} Reconciliation applied: ${newlyApplied.length} candidate(s)${settled ? '; all candidates reconciled' : `; ${plan.candidates.filter((candidate) => !candidate.applied).length} pending`}.\n`, 'utf8');
  if (settled) await completeReconciliationWork(root, meta, now);
  return { meta, plan, newlyApplied, leftInPlace, archived: archive.length, completed: settled, ledger: current };
}

async function recordLimitations(root, workId, candidates, now) {
  const ids = new Map();
  if (!candidates.length) return ids;
  const { ledger } = await loadWorkLimitations(root, workId);
  for (const candidate of candidates) {
    const existing = ledger.limitations.find((entry) => sameStatement(entry.summary, candidate.summary));
    if (existing) { ids.set(candidate.id, existing.id); continue; }
    const entry = normalizeLimitation({
      type: candidate.decision.limitationType,
      area: candidate.area,
      summary: candidate.summary,
      reason: `${candidate.decision.reason} (reconciled from ${candidate.origin.workId} ${candidate.origin.baselineFactId ?? candidate.origin.candidateId} as ${candidate.id})`
    }, nextLimitationId(ledger.limitations), now);
    const errors = validateLimitation(entry, candidate.id);
    if (errors.length) throw new Error(errors.join('\n'));
    ledger.limitations.push(entry);
    ids.set(candidate.id, entry.id);
  }
  ledger.updatedAt = now;
  await writeYaml(limitationsFilePath(root, workId), ledger);
  return ids;
}

// A reconciled legacy section stops being presented as parallel current truth: a
// section that is byte-for-byte what v0.3.5 generated from the candidate's own record
// is copied verbatim into this work item's archive, then removed from the durable
// document. A section with any hand edit is never removed.
async function retireLegacySection(root, workId, candidate, archive) {
  const { file, marker } = candidate.legacySection ?? {};
  if (!file) return 'absent';
  const absolute = path.join(workspacePath(root), file);
  if (!await exists(absolute)) return 'absent';
  const content = await readText(absolute);
  const { state, text: section } = generatedLegacySectionState(content, candidate, marker);
  if (state === 'absent') return 'absent';
  if (state === 'edited') return 'left-in-place';
  const archiveFile = path.join(workspacePath(root), 'work', workId, RECONCILIATION_ARCHIVE_FILE);
  const archived = await exists(archiveFile) ? await readText(archiveFile) : `# Retired legacy context sections — ${workId}\n\nVerbatim copies of v0.3.5 append-only sections retired from durable project documents by reconciliation. Historical record only; current project memory is .yallaflow/context/index.yaml.\n`;
  if (!archived.includes(`${marker}\n`)) {
    await writeText(archiveFile, `${archived}\n## ${candidate.id} — from ${file}\n${section.startsWith('\n') ? section : `\n${section}`}`);
  }
  await writeText(absolute, content.replace(section, ''));
  archive.push(candidate.id);
  return 'removed';
}

async function completeReconciliationWork(root, meta, now) {
  const metaFile = path.join(workspacePath(root), 'work', meta.id, 'meta.yaml');
  const current = await readYaml(metaFile);
  current.status = 'DONE';
  current.updatedAt = now;
  await writeYaml(metaFile, current);
  const stateFile = path.join(workspacePath(root), 'state', 'current.yaml');
  const state = await readYaml(stateFile);
  if (state.activeWork === meta.id) await writeYaml(stateFile, { schemaVersion: 1, activeWork: null, stage: null, updatedAt: now });
}

// ---------------------------------------------------------------------------
// reporting helpers

export async function reconciliationStatus(root, requestedWorkId) {
  const { meta, plan } = await resolveReconciliationWork(root, requestedWorkId);
  const { ledger: reviews } = await loadReviews(root, meta.id);
  const counts = summarizePlan(plan);
  const questions = await openQuestions(root, meta.id);
  const blockers = [];
  const { ledger } = await loadContextLedger(root);
  const structural = validatePlanStructure(plan);
  const resolved = structural.length ? { errors: structural, stateIssues: [] } : resolvePlan(plan, ledger);
  const review = reviewState(plan, reviews);
  if (resolved.errors.length) blockers.push(`${resolved.errors.length} invalid relation(s) — revise the plan`);
  if (resolved.stateIssues.length) blockers.push(`${resolved.stateIssues.length} relation(s) no longer fit the ledger — revise the plan`);
  if (counts.pending) blockers.push(`${counts.pending} candidate(s) without a decision`);
  if (questions.length) blockers.push(`${questions.length} open reconciliation question(s)`);
  if (plan.status !== 'applied' && counts.decided > counts.applied && review !== 'approved') blockers.push(`review ${review}`);
  return { meta, plan, counts, review, questions, problems: [...resolved.errors, ...resolved.stateIssues], blockers, nextAction: nextAction(meta, plan, counts, review, resolved) };
}

async function openQuestions(root, workId) {
  const file = path.join(workspacePath(root), 'work', workId, 'questions.yaml');
  if (!await exists(file)) return [];
  const ledger = await readYaml(file);
  return (ledger.questions ?? []).filter((entry) => entry.status !== 'resolved');
}

function nextAction(meta, plan, counts, review, resolved) {
  if (plan.status === 'applied') return 'Reconciliation complete. Run `yallaflow doctor`.';
  if (resolved.errors.length || resolved.stateIssues.length) return `Revise decisions: yallaflow context reconcile plan ${meta.id} --file <decisions.json>`;
  const unapplied = counts.decided - counts.applied;
  if (!unapplied) return `Record decisions for the ${counts.pending} pending candidate(s): yallaflow context reconcile show ${meta.id}, then yallaflow context reconcile plan ${meta.id} --file <decisions.json>`;
  if (review === 'approved') return `Apply the approved plan: yallaflow context reconcile apply ${meta.id}`;
  return `Human review: yallaflow context reconcile preview ${meta.id}, then yallaflow context reconcile approve ${meta.id} (or feedback --changes-requested)`;
}

// Compact lines for handoff/resume/brief — progress and blockers, never all candidates.
export async function reconciliationSummaryLines(root, meta, limit = 3) {
  const status = await reconciliationStatus(root, meta.id);
  const { counts } = status;
  const resolved = counts.decided;
  const lines = [
    `Progress: ${resolved}/${counts.total} decided, ${counts.applied} applied · ${counts.byAction.new} new · ${counts.byAction['merge-with']} merged · ${counts.byAction.reconfirms} reconfirming · ${counts.byAction.supersedes} superseding · ${counts.byAction.disputes} disputing · ${counts.byAction.skip} skipped · ${counts.byAction.limitation} limitation(s) · ${counts.pending} pending`,
    `Review: ${status.review}`
  ];
  const undecided = status.plan.candidates.filter((candidate) => !candidate.decision);
  for (const candidate of undecided.slice(0, limit)) lines.push(`- ${candidate.id} [${candidate.area}] requires a decision${status.questions.length ? ' (see open questions)' : ''}`);
  if (undecided.length > limit) lines.push(`- … ${undecided.length - limit} more (yallaflow context reconcile status ${meta.id})`);
  for (const question of status.questions.slice(0, limit)) lines.push(`- ${question.id} open: ${question.question}`);
  return { lines, status };
}
