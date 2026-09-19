import { loadWorkProgress } from '../core/progress.js';
import { loadWorkQuestions, summarizeQuestions } from '../questions/store.js';

export async function loadWorkReadiness(root, meta) {
  const progress = await loadWorkProgress(root, meta);
  const questions = await loadWorkQuestions(root, meta);
  return evaluateReadiness(meta, progress, questions);
}

export function evaluateReadiness(meta, progress, questions) {
  const contract = progress.contract;
  const ledger = progress.ledger;
  const questionSummary = summarizeQuestions(questions.ledger);
  const materialQuestionBlockers = questionSummary.materialOpen.map((entry) => `${entry.id}: ${entry.question}`);
  const hasSpecification = contract.skills.includes('specification');
  const hasPlanning = contract.skills.includes('implementation-planning');
  const specificationCheckpoint = ledger.skills.specification?.status ?? 'pending';
  const planningCheckpoint = ledger.skills['implementation-planning']?.status ?? 'pending';

  const specification = hasSpecification
    ? readinessResult(
      specificationCheckpoint === 'completed' && !materialQuestionBlockers.length,
      checkpointBlockers('specification', specificationCheckpoint, materialQuestionBlockers)
    )
    : { status: 'NOT_APPLICABLE', blockers: [] };

  const planPrerequisitesReady = !hasSpecification || specification.status === 'READY';
  const plan = hasPlanning
    ? readinessResult(
      planningCheckpoint === 'completed' && planPrerequisitesReady && !materialQuestionBlockers.length,
      checkpointBlockers('implementation-planning', planningCheckpoint, [
        ...(planPrerequisitesReady ? [] : ['specification is not ready']),
        ...materialQuestionBlockers
      ])
    )
    : { status: 'NOT_APPLICABLE', blockers: [] };

  const stage = meta.status;
  const implementationStarted = ['IMPLEMENTATION', 'EXECUTION', 'VERIFICATION', 'DONE'].includes(stage);
  const implementation = meta.readOnly
    ? { status: 'NOT_AUTHORIZED' }
    : { status: implementationStarted ? (stage === 'DONE' ? 'COMPLETE' : 'STARTED') : 'NOT_STARTED' };
  const deliveryStatus = stage === 'DONE'
    ? 'DONE'
    : plan.status === 'READY'
      ? 'PLAN_READY'
      : specification.status === 'READY'
        ? 'SPEC_READY'
        : null;

  return { specification, plan, implementation, deliveryStatus, questions: questionSummary };
}

function readinessResult(ready, blockers) {
  return { status: ready ? 'READY' : 'BLOCKED', blockers: [...new Set(blockers)] };
}

function checkpointBlockers(skillId, status, other = []) {
  const blockers = [];
  if (status !== 'completed') blockers.push(`${skillId} checkpoint is ${status}`);
  blockers.push(...other);
  return blockers;
}
