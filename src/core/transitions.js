import path from 'node:path';
import { appendFile } from 'node:fs/promises';
import { exists } from '../utils/fs.js';
import { readYaml, writeYaml } from './yaml.js';
import { latestVerification, listVerificationRuns } from './evidence.js';
import { nextStageForWork, requiredSkillForStage, stageForSkill, workflowStagesFor } from './workflows.js';
import { workspacePath } from './workspace.js';
import { incompleteImplementationSkills, loadWorkProgress, progressFilePath } from './progress.js';
import { loadWorkKnowledge, writeKnowledgeLedger } from '../knowledge/store.js';
import { loadWorkQuestions, summarizeQuestions } from '../questions/store.js';
import { resolveBehaviorContract } from '../skills/resolver.js';
import { WRITE_STAGES } from '../behavior/constants.js';

// Skills whose revision/reopening invalidates completed work later in the chain (see
// core/progress.js's CASCADE_ORDER and reopenWork below). Kept in one place so the
// stage-correction resolver and reopen both mark the same freshness boundary.
const CASCADE_CHAIN = Object.freeze(['implementation', 'verification', 'code-review']);
const REOPEN_TARGETS = Object.freeze(['implementation', 'verification', 'review']);

export async function advanceActiveWork(root) {
  const base = workspacePath(root);
  const stateFile = path.join(base, 'state', 'current.yaml');
  const state = await readYaml(stateFile);
  if (!state.activeWork) throw new Error('No active work item.');

  const workDir = path.join(base, 'work', state.activeWork);
  const metaFile = path.join(workDir, 'meta.yaml');
  const meta = await readYaml(metaFile);
  if (meta.routingStatus === 'pending') throw new Error(`${meta.id} is awaiting routing. Run \`yallaflow route\` first.`);
  const current = state.stage ?? meta.status;
  const workflow = meta.workflow ?? meta.type;
  const next = nextStageForWork(meta, current);
  if (!next) throw new Error(`${meta.id} is already at the final stage.`);

  const progress = await loadWorkProgress(root, meta);
  const questions = await loadWorkQuestions(root, meta);
  const blockers = stageExitBlockers(meta, current, progress.contract, progress.ledger, questions.ledger);
  if (blockers.length) {
    throw new Error(
      `Cannot advance from ${current} to ${next}.\n\nBlocking requirements:\n` +
      blockers.map((blocker) => `- ${blocker}`).join('\n')
    );
  }

  if (['IMPLEMENTATION', 'EXECUTION'].includes(next)) {
    if (progress.contract.skills.length) {
      const incomplete = incompleteImplementationSkills(progress.contract, progress.ledger);
      if (incomplete.length) {
        throw new Error(`Cannot transition to ${next}; complete required checkpoint(s) first: ${incomplete.join(', ')}.`);
      }
    }
  }

  let verification = null;
  if (next === 'DONE' && workflow !== 'investigation') {
    verification = await latestVerification(root, meta.id);
    if (!verification?.success) {
      throw new Error('Cannot transition to DONE without fresh successful verification evidence. Run `yallaflow verify -- <command>` first.');
    }
    if (meta.lastInvalidationAt && !(verification.verifiedAt > meta.lastInvalidationAt)) {
      throw new Error(
        'Cannot transition to DONE: verification evidence predates a later implementation reopen or revision. Run `yallaflow verify -- <command>` again.'
      );
    }
  }

  if (next === 'DONE' && progress.contract.skills.includes('code-review') && progress.ledger.skills['code-review']?.status !== 'completed') {
    throw new Error('Cannot transition to DONE until the code-review checkpoint is completed.');
  }

  if (next === 'DONE' && meta.knowledgePolicy?.reviewRequired === true) {
    const knowledge = await loadWorkKnowledge(root, meta);
    if (knowledge.ledger.reviewStatus !== 'reviewed') {
      throw new Error(
        'Cannot transition to DONE until project knowledge review is complete. ' +
        'Resolve all candidates or run `yallaflow knowledge review --none`.'
      );
    }
  }

  const now = new Date().toISOString();
  meta.status = next;
  meta.updatedAt = now;
  if (next === 'DONE' && workflow !== 'investigation') {
    const runs = await listVerificationRuns(root, meta.id);
    const relevant = runs.filter((run) => !meta.lastInvalidationAt || run.verifiedAt > meta.lastInvalidationAt);
    meta.completionHistory = [...(meta.completionHistory ?? []), {
      completedAt: now,
      verificationRunIds: relevant.map((run) => run.id)
    }];
  }
  state.stage = next;
  state.updatedAt = now;
  if (next === 'DONE') state.activeWork = null;

  await writeYaml(metaFile, meta);
  await writeYaml(stateFile, state);
  await appendFile(path.join(workDir, 'progress.md'), `- ${now} Stage: ${current} → ${next}\n`, 'utf8');
  return { id: meta.id, from: current, to: next, type: meta.type };
}

// Ordinary checkpoint revision walks the workflow stage backward when an earlier,
// architecturally-gated skill is revised, and separately marks a freshness boundary
// (lastInvalidationAt) when the revised skill is part of the post-implementation
// dependency chain — regardless of whether that also moves the stage, since e.g.
// revising 'code-review' invalidates DONE-eligibility without any stage to roll back to.
export async function reconcileStageAfterCheckpointRevision(root, meta, skillId, now = new Date().toISOString()) {
  const targetStage = stageForSkill(meta, skillId);
  const stages = workflowStagesFor(meta);
  const currentIndex = stages.indexOf(meta.status);
  const targetIndex = targetStage ? stages.indexOf(targetStage) : -1;
  const needsStageCorrection = Boolean(targetStage) && currentIndex >= 0 && currentIndex > targetIndex;
  const marksInvalidation = CASCADE_CHAIN.includes(skillId);
  if (!needsStageCorrection && !marksInvalidation) return null;

  const base = workspacePath(root);
  const from = meta.status;
  if (needsStageCorrection) meta.status = targetStage;
  if (marksInvalidation) meta.lastInvalidationAt = now;
  meta.updatedAt = now;
  await writeYaml(path.join(base, 'work', meta.id, 'meta.yaml'), meta);

  if (!needsStageCorrection) return null;
  const stateFile = path.join(base, 'state', 'current.yaml');
  const state = await readYaml(stateFile);
  if (state.activeWork === meta.id) {
    state.stage = targetStage;
    state.updatedAt = now;
    await writeYaml(stateFile, state);
  }
  await appendFile(path.join(base, 'work', meta.id, 'progress.md'), `- ${now} Stage corrected: ${from} → ${targetStage}\n`, 'utf8');
  return { from, to: targetStage };
}

// Reactivates DONE work at a supported execution stage, resetting the checkpoints that
// depended on the point being reopened (see CASCADE_CHAIN) while leaving everything
// upstream, and every durable evidence/knowledge record, untouched. No manual file
// editing is required or supported.
export async function reopenWork(root, workId, input, now = new Date().toISOString()) {
  if (!isNonEmptyString(input.reason)) throw new Error('Reopen requires a non-empty --reason.');
  if (!REOPEN_TARGETS.includes(input.toStage)) {
    throw new Error(`--to must be one of: ${REOPEN_TARGETS.join(', ')}; received ${JSON.stringify(input.toStage)}.`);
  }

  const base = workspacePath(root);
  const metaFile = path.join(base, 'work', workId, 'meta.yaml');
  if (!await exists(metaFile)) throw new Error(`Work item ${workId} was not found.`);
  const meta = await readYaml(metaFile);
  if (meta.status !== 'DONE') throw new Error(`${workId} is not DONE; only completed work can be reopened.`);

  const workflow = meta.workflow ?? meta.type;
  const writeStage = (WRITE_STAGES[workflow] ?? [])[0];
  const targetStage = { implementation: writeStage, verification: 'VERIFICATION', review: 'VERIFICATION' }[input.toStage];
  if (!targetStage || !workflowStagesFor(meta).includes(targetStage)) {
    throw new Error(`${workId}'s workflow (${workflow}) has no ${input.toStage} stage to reopen into.`);
  }

  const contract = resolveBehaviorContract(meta);
  const progress = await loadWorkProgress(root, meta);
  const ledger = progress.ledger;
  const reason = input.reason.trim();
  const targetIndex = { implementation: 0, verification: 1, review: 2 }[input.toStage];

  CASCADE_CHAIN.forEach((skillId, index) => {
    if (index < targetIndex || !contract.skills.includes(skillId)) return;
    const current = ledger.skills[skillId] ?? { status: 'pending' };
    if (index === targetIndex && skillId === 'implementation') {
      if (current.status === 'in_progress') return;
      ledger.skills[skillId] = { status: 'in_progress', startedAt: now };
      ledger.history.push({ skill: skillId, from: current.status, to: 'in_progress', reason, changedAt: now });
      return;
    }
    if (current.status === 'pending') return;
    ledger.skills[skillId] = { status: 'pending' };
    ledger.history.push({
      skill: skillId,
      from: current.status,
      to: 'pending',
      reason: index === targetIndex ? reason : `Reopened to ${input.toStage}: ${reason}`,
      changedAt: now
    });
  });
  ledger.updatedAt = now;
  await writeYaml(progressFilePath(root, workId), ledger);

  if (input.toStage === 'implementation') {
    const knowledge = await loadWorkKnowledge(root, meta);
    if (knowledge.exists && knowledge.ledger.reviewStatus === 'reviewed') {
      knowledge.ledger.reviewStatus = 'pending';
      delete knowledge.ledger.reviewedAt;
      knowledge.ledger.updatedAt = now;
      await writeKnowledgeLedger(root, workId, knowledge.ledger);
    }
  }

  const from = meta.status;
  meta.status = targetStage;
  meta.updatedAt = now;
  meta.lastInvalidationAt = now;
  meta.lifecycleHistory = [...(meta.lifecycleHistory ?? []), {
    action: 'reopen', fromStage: from, toStage: targetStage, reason, changedAt: now
  }];
  await writeYaml(metaFile, meta);

  await writeYaml(path.join(base, 'state', 'current.yaml'), {
    schemaVersion: 1, activeWork: workId, stage: targetStage, updatedAt: now
  });
  await appendFile(path.join(base, 'work', workId, 'progress.md'), `- ${now} Reopened: DONE → ${targetStage} (${reason})\n`, 'utf8');

  return { id: workId, from, to: targetStage, reason };
}

function stageExitBlockers(meta, stage, contract, ledger, questionsLedger) {
  const blockers = [];
  const requiredSkill = requiredSkillForStage(meta, stage, contract.skills);
  if (requiredSkill) {
    const status = ledger.skills[requiredSkill]?.status ?? 'pending';
    if (status !== 'completed') blockers.push(`${requiredSkill} checkpoint is ${status}`);
  }
  if (['SPECIFICATION', 'PLAN'].includes(stage)) {
    const unresolved = summarizeQuestions(questionsLedger).materialOpen;
    if (unresolved.length) blockers.push(`unresolved material decisions: ${unresolved.length} (${unresolved.map((entry) => entry.id).join(', ')})`);
  }
  return blockers;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}
