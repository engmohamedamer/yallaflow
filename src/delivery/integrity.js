import path from 'node:path';
import { exists, readText } from '../utils/fs.js';
import { workspacePath } from '../core/workspace.js';
import { loadWorkProgress } from '../core/progress.js';
import { listVerificationRuns } from '../core/evidence.js';
import { readYaml } from '../core/yaml.js';
import { loadWorkQuestions } from '../questions/store.js';
import { CONVERGENCE_SKILL } from './constants.js';
import { convergenceRequired, intentSkill } from './policy.js';
import { requirementsFilePath, resolveDeliveryCriteria, validateRequirementsLedger } from './requirements.js';
import { convergenceFilePath, evaluateConvergence, validateConvergenceLedger } from './convergence.js';
import { impactFilePath, validateImpactLedger } from './impact.js';

// Doctor checks for work-delivery state (v0.3.8). Errors are corruption or
// contradiction: malformed or dangling references, impossible statuses, unsupported
// completion states. Warnings are freshness: convergence that was current when it was
// recorded but whose evidence has changed since — a revalidation signal, not
// corruption, and never a reason to rewrite historical DONE.
export async function checkDeliveryIntegrity(root, meta) {
  const errors = [];
  const warnings = [];
  if (meta.routingStatus === 'pending') return { errors, warnings };
  const id = meta.id;
  const files = {
    requirements: requirementsFilePath(root, id),
    convergence: convergenceFilePath(root, id),
    impact: impactFilePath(root, id)
  };
  const present = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([name, file]) => [name, await exists(file)])));
  const required = convergenceRequired(meta);
  if (!required) {
    for (const [name, found] of Object.entries(present)) {
      if (found) errors.push(`${id}: ${name}.yaml exists but the work item's Behavior Contract has no ${CONVERGENCE_SKILL}; delivery state belongs only to delivery-convergence work.`);
    }
    return { errors, warnings };
  }

  // Structural validation, collected per file so one corrupt ledger does not hide others.
  const raw = {};
  for (const [name, validate] of [['requirements', validateRequirementsLedger], ['convergence', validateConvergenceLedger], ['impact', validateImpactLedger]]) {
    if (!present[name]) continue;
    try {
      raw[name] = await readYaml(files[name]);
    } catch (error) {
      errors.push(`${id}: ${name}.yaml cannot be parsed: ${error.message}`);
      continue;
    }
    const problems = validate(raw[name]);
    for (const problem of problems) errors.push(`${id}: ${name}.yaml: ${problem}`);
    if (problems.length) delete raw[name];
  }
  if (Object.keys(raw).length !== Object.values(present).filter(Boolean).length) return { errors, warnings };

  // Requirement provenance must point to data that exists.
  if (raw.requirements) {
    const sources = new Set((meta.sources ?? []).map((source) => source.id));
    const questions = new Set((await loadWorkQuestions(root, meta)).ledger.questions.map((question) => question.id));
    let workText = null;
    const workFile = path.join(workspacePath(root), 'work', id, 'work.md');
    if (await exists(workFile)) workText = (await readText(workFile)).toLowerCase();
    for (const entry of [...raw.requirements.requirements, ...raw.requirements.acceptanceCriteria]) {
      for (const item of entry.provenance) {
        if (item.type === 'source' && !sources.has(item.source)) errors.push(`${id}: ${entry.id} provenance names source ${item.source}, which is not linked to ${id}.`);
        if (item.type === 'question' && !questions.has(item.question)) errors.push(`${id}: ${entry.id} provenance names question ${item.question}, which does not exist.`);
        if (item.type === 'specification' && workText !== null && !workText.includes(item.section.trim().toLowerCase())) {
          warnings.push(`${id}: ${entry.id} provenance cites specification section "${item.section}", which work.md does not mention.`);
        }
      }
    }
  }

  const resolved = await resolveDeliveryCriteria(root, meta);
  if (resolved.source === 'inherited' && resolved.unresolved.length) {
    errors.push(`${id}: assigned acceptance criteria ${resolved.unresolved.join(', ')} do not exist in ${resolved.owner}'s requirements ledger.`);
  }
  if (resolved.source === 'inherited' && present.requirements) {
    errors.push(`${id}: has its own requirements.yaml while answering for criteria assigned from ${resolved.owner}; one owner per criterion.`);
  }

  const progress = await loadWorkProgress(root, meta);
  const intent = intentSkill(progress.contract);
  // A DONE child whose inherited criteria were later withdrawn on the parent keeps its
  // history; that is reported, never failed.
  const inheritedHistory = resolved.source === 'inherited' && meta.status === 'DONE';
  if (intent && progress.ledger.skills[intent]?.status === 'completed' && !resolved.criteria.some((entry) => entry.status === 'active')) {
    if (inheritedHistory) warnings.push(`${id}: every acceptance criterion it delivered has since been withdrawn or deferred on ${resolved.owner}.`);
    else errors.push(`${id}: ${intent} checkpoint is completed but no active acceptance criteria are recorded.`);
  }

  // Convergence references must resolve.
  if (raw.convergence) {
    const refs = new Set(resolved.criteria.map((entry) => entry.ref));
    const runs = new Set((await listVerificationRuns(root, id)).map((run) => run.id));
    for (const assessment of raw.convergence.assessments) {
      for (const finding of assessment.findings) {
        if (!refs.has(finding.criterion)) errors.push(`${id}: ${assessment.id} assesses ${finding.criterion}, which is not an acceptance criterion of ${id}.`);
        for (const entry of finding.evidence) {
          if (entry.verificationRunId && !runs.has(entry.verificationRunId)) errors.push(`${id}: ${assessment.id} ${finding.criterion} cites verification ${entry.verificationRunId}, which does not exist.`);
          if (entry.type === 'convergence') {
            const childFile = convergenceFilePath(root, entry.workId);
            const child = await exists(childFile) ? await readYaml(childFile) : null;
            const cited = child?.assessments?.find((candidate) => candidate.id === entry.assessmentId);
            const childMeta = await readYaml(path.join(workspacePath(root), 'work', entry.workId, 'meta.yaml')).catch(() => null);
            if (!cited) errors.push(`${id}: ${assessment.id} ${finding.criterion} cites ${entry.workId}/${entry.assessmentId}, which does not exist.`);
            else if (childMeta?.parent !== id) errors.push(`${id}: ${assessment.id} ${finding.criterion} cites ${entry.workId}, which is not a decomposition child of ${id}.`);
            else if (!cited.findings.some((candidate) => candidate.criterion === `${id}/${finding.criterion}` && candidate.status === 'satisfied')) errors.push(`${id}: ${assessment.id} ${finding.criterion} cites ${entry.workId}/${entry.assessmentId}, which did not record ${id}/${finding.criterion} as satisfied.`);
          }
        }
      }
    }
  }

  // Impact revisions must be the audited ones the progress history records.
  if (raw.impact) {
    const history = progress.ledger.history ?? [];
    for (const impact of raw.impact.impacts) {
      for (const trigger of impact.triggers) {
        if (trigger.type === 'source' && !(meta.sources ?? []).some((source) => source.id === trigger.source)) {
          warnings.push(`${id}: ${impact.id} was raised for source ${trigger.source}, which is not linked to ${id} (interrupted intake?).`);
        }
      }
      for (const skill of impact.assessment?.applied?.revised ?? []) {
        if (!history.some((entry) => entry.skill === skill && entry.reason.startsWith(`Impact ${impact.id}:`))) {
          errors.push(`${id}: ${impact.id} claims it revised ${skill}, but progress.yaml has no matching revision.`);
        }
      }
    }
    const pending = raw.impact.impacts.find((impact) => impact.status === 'pending');
    if (pending && meta.status === 'DONE') errors.push(`${id}: is DONE with impact ${pending.id} still pending assessment.`);
  }

  // Completion states must be supported by recorded convergence. What was proven then
  // but is no longer current (stale: evidence drift, a criterion revised later, e.g. by
  // a parent, an invalidation) is a warning — history is never rewritten and DONE
  // gating already refuses it; a completion the findings never supported is an error.
  const convergenceDone = progress.ledger.skills[CONVERGENCE_SKILL]?.status === 'completed';
  if (meta.status === 'DONE' || convergenceDone) {
    const convergence = await evaluateConvergence(root, meta);
    const label = meta.status === 'DONE' ? 'is DONE' : `${CONVERGENCE_SKILL} checkpoint is completed`;
    if (meta.status === 'DONE' && !convergenceDone) errors.push(`${id}: is DONE but the ${CONVERGENCE_SKILL} checkpoint is ${progress.ledger.skills[CONVERGENCE_SKILL]?.status ?? 'pending'}.`);
    const pending = raw.impact?.impacts.find((impact) => impact.status === 'pending');
    if (!convergence.criteria.length && !inheritedHistory) errors.push(`${id}: ${label} but no active acceptance criteria are recorded.`);
    for (const entry of convergence.criteria) {
      if (entry.status !== 'satisfied') {
        if (pending && meta.status !== 'DONE') warnings.push(`${id}: ${entry.ref} is ${entry.status} while impact ${pending.id} awaits assessment.`);
        else errors.push(`${id}: ${label} but ${entry.ref} is ${entry.status}.`);
      } else if (entry.stale) {
        warnings.push(`${id}: ${entry.ref} convergence may be stale — ${entry.staleReasons.join('; ')}${meta.status === 'DONE' ? ' (DONE history is unchanged; reopen to revalidate if needed)' : ' (re-assess before DONE)'}.`);
      }
    }
    for (const item of convergence.unrequested.filter((entry) => entry.disposition === 'open')) errors.push(`${id}: ${label} but unrequested behavior ${item.id} is still open.`);
  }
  return { errors, warnings };
}
