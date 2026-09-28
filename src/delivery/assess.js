import path from 'node:path';
import { appendFile } from 'node:fs/promises';
import { loadWorkMetaOrThrow, workspacePath } from '../core/workspace.js';
import { loadWorkProgress, reviseCheckpoint } from '../core/progress.js';
import { reconcileStageAfterCheckpointRevision } from '../core/transitions.js';
import { CONVERGENCE_SKILL, IMPACT_ID, IMPACT_VERDICTS } from './constants.js';
import { convergenceRequired, intentFixed } from './policy.js';
import { loadWorkImpacts, pendingImpact, raiseImpact, writeImpactLedger } from './impact.js';
import { recordRequirements } from './requirements.js';
import { evaluateConvergence, loadWorkConvergence, recordConvergence } from './convergence.js';

// Applies the Agent's impact assessment (v0.3.8). The Agent decides, per completed
// stage, whether the changed intent affects it; YallaFlow validates the verdicts
// against deterministic rules and then invalidates the affected stages through the
// existing, audited checkpoint-revision path (progress history, stage correction,
// review-gate invalidation, the verification freshness boundary). There is no second
// lifecycle engine, and no evidence is deleted.

// Post-implementation chain, in order (the same chain checkpoint revision cascades).
const CHAIN = Object.freeze(['implementation', 'verification', CONVERGENCE_SKILL, 'code-review']);
const INPUT_FIELDS = new Set(['impact', 'summary', 'stages']);

// Stages with work that a change could invalidate: every contract checkpoint that is
// not pending, plus convergence whenever findings exist.
export async function assessableStages(root, meta) {
  const progress = await loadWorkProgress(root, meta);
  const convergence = await loadWorkConvergence(root, meta);
  return progress.contract.skills.filter((skill) =>
    (progress.ledger.skills[skill]?.status ?? 'pending') !== 'pending' ||
    (skill === CONVERGENCE_SKILL && convergence.ledger.assessments.length > 0));
}

export async function assessImpact(root, workId, input, now = new Date().toISOString()) {
  let meta = await loadWorkMetaOrThrow(root, workId);
  if (!convergenceRequired(meta)) throw new Error(`${workId} does not carry a delivery-convergence contract; it has no impact assessments. No files were changed.`);
  if (meta.status === 'DONE') throw new Error(`${workId} is DONE. No files were changed.`);
  const errors = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Impact file must contain a JSON object: {"impact":"IM-###","stages":{"<skill>":{"verdict":"affected|unaffected","reason":"..."}}}.');
  const extra = Object.keys(input).filter((field) => !INPUT_FIELDS.has(field));
  if (extra.length) errors.push(`impact file has unknown field(s): ${extra.join(', ')}`);

  const loaded = await loadWorkImpacts(root, meta);
  const ledger = loaded.ledger;
  const pending = pendingImpact(ledger);
  if (!pending) throw new Error(`${workId} has no pending impact to assess. No files were changed.`);
  if (input.impact !== undefined && (!IMPACT_ID.test(input.impact) || input.impact !== pending.id)) {
    const known = ledger.impacts.find((impact) => impact.id === input.impact);
    throw new Error(`${known ? `${input.impact} is already assessed` : `${JSON.stringify(input.impact)} is not an impact of ${workId}`}; the pending impact is ${pending.id}. No files were changed.`);
  }
  if (input.summary !== undefined && (typeof input.summary !== 'string' || !input.summary.trim())) errors.push('summary must be non-empty when present');

  const progress = await loadWorkProgress(root, meta);
  const assessable = await assessableStages(root, meta);
  const stages = input.stages;
  if (!stages || typeof stages !== 'object' || Array.isArray(stages)) {
    errors.push(`stages must be an object with a verdict for each completed stage: ${assessable.join(', ')}`);
    throw rejection(errors);
  }
  const verdicts = {};
  for (const [skill, value] of Object.entries(stages)) {
    if (!progress.contract.skills.includes(skill)) { errors.push(`${skill} is not a stage of ${workId}'s Behavior Contract`); continue; }
    if (!assessable.includes(skill)) { errors.push(`${skill} has no completed work to invalidate (its checkpoint is pending); leave it out`); continue; }
    if (!value || typeof value !== 'object' || Array.isArray(value)) { errors.push(`${skill} requires {"verdict","reason"}`); continue; }
    const unknownKeys = Object.keys(value).filter((key) => !['verdict', 'reason'].includes(key));
    if (unknownKeys.length) errors.push(`${skill} has unknown field(s): ${unknownKeys.join(', ')}`);
    if (!IMPACT_VERDICTS.includes(value.verdict)) { errors.push(`${skill} verdict must be affected or unaffected; received ${JSON.stringify(value.verdict)}`); continue; }
    if (typeof value.reason !== 'string' || !value.reason.trim()) { errors.push(`${skill} requires a reason for its verdict`); continue; }
    verdicts[skill] = { verdict: value.verdict, reason: value.reason.trim() };
  }
  for (const skill of assessable) if (!(skill in stages)) errors.push(`${skill} needs a verdict (it has completed work the change could affect)`);
  errors.push(...mechanicalRuleErrors(verdicts, assessable));
  // Changed acceptance criteria change what convergence must prove: mechanical, not semantic.
  const criteriaChanged = pending.triggers.some((trigger) => trigger.type === 'requirements' && trigger.changes.some((change) => /^AC-/.test(change.id)));
  if (criteriaChanged && assessable.includes(CONVERGENCE_SKILL) && verdicts[CONVERGENCE_SKILL]?.verdict === 'unaffected') {
    errors.push(`${CONVERGENCE_SKILL} cannot be unaffected: acceptance criteria changed (${pending.triggers.flatMap((trigger) => trigger.changes ?? []).map((change) => change.id).filter((id) => /^AC-/.test(id)).join(', ')})`);
  }
  if (errors.length) throw rejection(errors);

  // Apply in contract order so the earliest affected stage determines the final stage;
  // checkpoints the cascade already reset are not revised twice.
  const affected = progress.contract.skills.filter((skill) => verdicts[skill]?.verdict === 'affected');
  const revised = [];
  const stageBefore = meta.status;
  for (const skill of affected) {
    meta = await loadWorkMetaOrThrow(root, workId);
    const current = (await loadWorkProgress(root, meta)).ledger.skills[skill]?.status ?? 'pending';
    if (current === 'pending') continue;
    const reason = `Impact ${pending.id}: ${verdicts[skill].reason}`;
    const result = await reviseCheckpoint(root, workId, { skillId: skill, status: 'pending', reason }, now);
    await reconcileStageAfterCheckpointRevision(root, result.meta, skill, reason, now);
    revised.push(skill);
  }
  meta = await loadWorkMetaOrThrow(root, workId);
  const convergenceInvalidated = verdicts[CONVERGENCE_SKILL]?.verdict === 'affected';

  pending.status = 'assessed';
  pending.assessment = {
    assessedAt: now,
    ...(input.summary ? { summary: input.summary.trim() } : {}),
    stages: verdicts,
    applied: {
      revised,
      ...(stageBefore !== meta.status ? { stage: { from: stageBefore, to: meta.status } } : {}),
      convergenceInvalidated
    }
  };
  ledger.updatedAt = now;
  await writeImpactLedger(root, workId, ledger);
  const unaffected = Object.keys(verdicts).filter((skill) => verdicts[skill].verdict === 'unaffected');
  await appendFile(path.join(workspacePath(root), 'work', workId, 'progress.md'),
    `- ${now} Impact ${pending.id} assessed: affected ${affected.join(', ') || 'none'}; unaffected ${unaffected.join(', ') || 'none'}\n`, 'utf8');
  return { meta, impact: pending, revised, affected, unaffected, stage: pending.assessment.applied.stage ?? null };
}

// Deterministic consequences the Agent's verdicts must respect:
//   - an affected post-implementation stage makes every later one affected (they were
//     built on it — the same cascade checkpoint revision applies);
//   - any affected stage makes convergence affected (the intent it was judged against
//     changed).
function mechanicalRuleErrors(verdicts, assessable) {
  const errors = [];
  const affectedChain = CHAIN.findIndex((skill) => verdicts[skill]?.verdict === 'affected');
  if (affectedChain >= 0) {
    for (const later of CHAIN.slice(affectedChain + 1)) {
      if (assessable.includes(later) && verdicts[later]?.verdict === 'unaffected') {
        errors.push(`${later} cannot be unaffected while ${CHAIN[affectedChain]} is affected (it was built on it)`);
      }
    }
  }
  const anyAffected = Object.values(verdicts).some((value) => value.verdict === 'affected');
  if (anyAffected && assessable.includes(CONVERGENCE_SKILL) && verdicts[CONVERGENCE_SKILL]?.verdict === 'unaffected') {
    errors.push(`${CONVERGENCE_SKILL} cannot be unaffected when another stage is affected: the intent it was judged against changed`);
  }
  return errors;
}

function rejection(errors) {
  return new Error(`Impact assessment rejected:\n- ${[...new Set(errors)].join('\n- ')}\n\nNo files were changed.`);
}

// Recording requirements on work whose approved intent is already fixed is itself a
// change of intent: the change is recorded, and a pending impact (raised first) asks
// the Agent to assess what it affects. Before the intent is fixed, changes are free.
export async function recordRequirementsWithImpact(root, workId, input, now = new Date().toISOString()) {
  let raised = null;
  const result = await recordRequirements(root, workId, input, now, {
    beforeWrite: async ({ meta, changes }) => {
      const progress = await loadWorkProgress(root, meta);
      if (intentFixed(meta, progress.contract, progress.ledger)) {
        raised = await raiseImpact(root, meta, { type: 'requirements', changes }, now);
      }
    }
  });
  return { ...result, impact: raised };
}

// A convergence assessment that records a gap after the delivery-convergence checkpoint
// was completed returns the checkpoint to in_progress through the audited revision
// path — the same rule a failing verification applies to its checkpoint — so a
// completed checkpoint never silently contradicts the recorded findings.
export async function recordConvergenceAndReconcile(root, workId, input, now = new Date().toISOString()) {
  const result = await recordConvergence(root, workId, input, now);
  const progress = await loadWorkProgress(root, result.meta);
  if (progress.ledger.skills[CONVERGENCE_SKILL]?.status !== 'completed') return { ...result, reopened: null };
  const view = await evaluateConvergence(root, await loadWorkMetaOrThrow(root, workId));
  if (view.converged) return { ...result, reopened: null };
  const reason = `Convergence ${result.assessment.id} recorded gaps: ${view.blockers.slice(0, 3).map((entry) => entry.text).join('; ')}`;
  const revised = await reviseCheckpoint(root, workId, { skillId: CONVERGENCE_SKILL, status: 'in_progress', reason }, now);
  await reconcileStageAfterCheckpointRevision(root, revised.meta, CONVERGENCE_SKILL, reason, now);
  return { ...result, reopened: reason };
}
