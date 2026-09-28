import path from 'node:path';
import { exists, readText } from '../utils/fs.js';
import { readYaml } from '../core/yaml.js';
import { workspacePath } from '../core/workspace.js';
import { appliedTransition, factOrigins, originKey } from '../context/ledger.js';
import { findLegacySections, generatedLegacySectionState, legacySectionState } from '../context/projection.js';
import { loadReviews } from '../reviews/store.js';
import { loadWorkKnowledge } from '../knowledge/store.js';
import { candidateOriginKey, planHash, resolvePlan, validatePlanStructure } from './plan.js';
import { listReconciliations, reviewState } from './store.js';
import { RECONCILIATION_FILE } from './constants.js';

// Reconciliation integrity for `doctor` — reported, never repaired.
// errors   — the plan or its lineage contradicts itself or the ledger: malformed plan,
//            missing origins, invalid/cyclic relations, unknown RC/CTX targets, an
//            approval that no longer matches the plan, applied candidates whose CTX
//            lineage is missing, a reconciled legacy section still presented as
//            current truth, orphaned plans.
// warnings — revise-before-apply signals: a relation the ledger has since moved past,
//            an interrupted apply, a reconciled legacy section kept because it was
//            hand-edited, legacy context not yet reconciled.
export async function checkReconciliationIntegrity(root, ledger, ledgerValid) {
  const errors = [];
  const warnings = [];
  const reconciliations = await listReconciliations(root);
  const byWork = new Map(reconciliations.map((entry) => [entry.meta.id, entry]));
  const active = reconciliations.filter((entry) => entry.meta.reconciliation && entry.meta.status !== 'DONE');
  if (active.length > 1) errors.push(`more than one open legacy-context reconciliation: ${active.map((entry) => entry.meta.id).join(', ')}.`);

  const reconciledKeys = new Map(); // origin key → candidate that settled it
  for (const { meta, plan } of reconciliations) {
    const label = `${meta.id} reconciliation`;
    if (!meta.reconciliation) { errors.push(`${label}: orphaned ${RECONCILIATION_FILE} in a work item that is not a reconciliation.`); continue; }
    if (!plan) { errors.push(`${label}: reconciliation work item has no ${RECONCILIATION_FILE}.`); continue; }
    const structural = validatePlanStructure(plan);
    if (structural.length) { errors.push(...structural.map((entry) => `${label}: ${entry}`)); continue; }
    if (plan.workId !== meta.id) errors.push(`${label}: plan belongs to ${plan.workId}.`);

    for (const candidate of plan.candidates) {
      const problem = await originProblem(root, candidate);
      if (problem) errors.push(`${label}: ${candidate.id} ${problem}.`);
      if (candidate.applied) reconciledKeys.set(candidateOriginKey(candidate), { label: `${meta.id} ${candidate.id}`, candidate });
    }

    const { ledger: reviews } = await loadReviews(root, meta.id);
    const review = reviewState(plan, reviews);
    if (review === 'changed-since-approval') errors.push(`${label}: plan is marked approved but was changed afterward (approved ${plan.approval.hash.slice(0, 15)}…, now ${planHash(plan).slice(0, 15)}…); re-review is required.`);
    if (review === 'approval-inconsistent') errors.push(`${label}: plan carries an approval but its reconciliation review gate is not approved.`);
    if (plan.status === 'applied' && meta.status !== 'DONE') errors.push(`${label}: plan is fully applied but ${meta.id} is ${meta.status}.`);
    if (meta.status === 'DONE' && plan.status !== 'applied') errors.push(`${label}: ${meta.id} is DONE but its plan still has unapplied candidates.`);

    if (!ledgerValid) continue;
    const resolved = resolvePlan(plan, ledger);
    errors.push(...resolved.errors.map((entry) => `${label}: ${entry}`));
    warnings.push(...resolved.stateIssues.map((entry) => `${label}: ${entry} Revise the plan before applying.`));
    for (const candidate of plan.candidates) {
      const fact = appliedTransition(ledger, candidate.origin);
      if (candidate.applied) {
        const keepsOut = ['skip', 'limitation'].includes(candidate.decision.action);
        if (keepsOut && fact) errors.push(`${label}: ${candidate.id} was applied as ${candidate.decision.action}, yet ${fact.id} also carries its origin (applied inconsistently).`);
        if (!keepsOut && !fact) errors.push(`${label}: ${candidate.id} is applied as ${candidate.decision.action} (${candidate.applied.factId}), but no CTX fact carries its origin lineage.`);
        if (!keepsOut && fact && candidate.applied.factId !== fact.id) {
          errors.push(`${label}: ${candidate.id} records ${candidate.applied.factId}, but its origin lineage is on ${fact.id}.`);
        }
      } else if (fact && factOrigins(fact).concat(fact.history ?? []).some((entry) => entry?.reconciliation?.workId === meta.id && entry.reconciliation.candidate === candidate.id)) {
        warnings.push(`${label}: ${candidate.id} is in the ledger (${fact.id}) but its apply did not finish; re-run \`yallaflow context reconcile apply ${meta.id}\` (safe — nothing is duplicated).`);
      }
    }
  }

  // Ledger lineage pointing at a reconciliation that does not exist.
  if (ledgerValid) {
    for (const fact of ledger.facts) {
      for (const origin of factOrigins(fact)) {
        const ref = origin.reconciliation;
        if (!ref) continue;
        const entry = byWork.get(ref.workId);
        if (!entry?.plan?.candidates?.some?.((candidate) => candidate.id === ref.candidate && candidateOriginKey(candidate) === originKey(origin))) {
          errors.push(`context ledger: ${fact.id} names reconciliation ${ref.workId} ${ref.candidate}, which does not record origin ${origin.workId} ${origin.baselineFactId ?? origin.candidateId}.`);
        }
      }
    }
  }

  const legacy = await classifyLegacySections(root, ledger, ledgerValid, reconciledKeys);
  errors.push(...legacy.errors);
  warnings.push(...legacy.warnings);
  return { errors, warnings, reconciliations, unreconciledSections: legacy.unreconciled };
}

async function originProblem(root, candidate) {
  const { workId, baselineFactId, candidateId } = candidate.origin;
  const dir = path.join(workspacePath(root), 'work', workId);
  if (!await exists(path.join(dir, 'meta.yaml'))) return `originates from work item ${workId}, which does not exist (missing candidate origin)`;
  if (baselineFactId) {
    const file = path.join(dir, 'baseline.yaml');
    const baseline = await exists(file) ? await readYaml(file) : null;
    if (!baseline?.facts?.some((fact) => fact.id === baselineFactId)) return `originates from ${workId} baseline fact ${baselineFactId}, which is not recorded (missing candidate origin)`;
    return null;
  }
  const meta = await readYaml(path.join(dir, 'meta.yaml'));
  const knowledge = await loadWorkKnowledge(root, meta);
  if (!knowledge.ledger.candidates.some((entry) => entry.id === candidateId)) return `originates from ${workId} knowledge candidate ${candidateId}, which is not recorded (missing candidate origin)`;
  return null;
}

// Each v0.3.5 append-only section still present in a durable document is one of:
//   unreconciled                 → counted in the "not yet governed" warning
//   reconciled, still templated  → ERROR: presented as parallel current truth
//   reconciled / adopted, edited → WARNING: kept verbatim; a human must review it
//   adopted (v0.3.6), templated  → WARNING: represented in the ledger; remove it
async function classifyLegacySections(root, ledger, ledgerValid, reconciledKeys) {
  const errors = [];
  const warnings = [];
  let unreconciled = 0;
  const cache = new Map();
  for (const section of await findLegacySections(root)) {
    const origin = section.kind === 'baseline'
      ? { workId: section.workId, baselineFactId: section.itemId }
      : { workId: section.workId, candidateId: section.itemId };
    const key = originKey(origin);
    if (!cache.has(section.relative)) cache.set(section.relative, await readText(path.join(workspacePath(root), section.relative)));
    const reconciled = reconciledKeys.get(key);
    const reconciledBy = reconciled?.label;
    const state = reconciled
      ? generatedLegacySectionState(cache.get(section.relative), reconciled.candidate, section.marker).state
      : legacySectionState(cache.get(section.relative), section.marker);
    const adoptedAs = !reconciledBy && ledgerValid ? appliedTransition(ledger, origin) : null;
    if (reconciledBy) {
      if (state === 'generated') errors.push(`${section.relative}: legacy section ${section.workId} ${section.itemId} is still presented as current project truth after reconciliation (${reconciledBy}); re-run \`yallaflow context reconcile apply\` to retire it.`);
      else warnings.push(`${section.relative}: legacy section ${section.workId} ${section.itemId} was reconciled (${reconciledBy}) but has been hand-edited, so it was kept verbatim outside the managed block; review it and remove it manually once its content is reflected in project memory.`);
    } else if (adoptedAs) {
      warnings.push(`${section.relative}: legacy section ${section.workId} ${section.itemId} is represented by ${adoptedAs.id} but remains outside the managed block${state === 'edited' ? ' (hand-edited)' : ''}; review it and remove it manually.`);
    } else {
      unreconciled += 1;
    }
  }
  return { errors, warnings, unreconciled };
}
