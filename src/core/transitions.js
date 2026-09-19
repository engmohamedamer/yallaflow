import path from 'node:path';
import { appendFile } from 'node:fs/promises';
import { readYaml, writeYaml } from './yaml.js';
import { latestVerification } from './evidence.js';
import { nextStageForWork, requiredSkillForStage, stageForSkill, workflowStagesFor } from './workflows.js';
import { workspacePath } from './workspace.js';
import { incompleteImplementationSkills, loadWorkProgress } from './progress.js';
import { loadWorkKnowledge } from '../knowledge/store.js';
import { loadWorkQuestions, summarizeQuestions } from '../questions/store.js';

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
  const blockers = stageExitBlockers(meta, current, progress.ledger, questions.ledger);
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

  if (next === 'DONE' && workflow !== 'investigation') {
    const verification = await latestVerification(root, meta.id);
    if (!verification?.success) {
      throw new Error('Cannot transition to DONE without fresh successful verification evidence. Run `yallaflow verify -- <command>` first.');
    }
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
  state.stage = next;
  state.updatedAt = now;
  if (next === 'DONE') state.activeWork = null;

  await writeYaml(metaFile, meta);
  await writeYaml(stateFile, state);
  await appendFile(path.join(workDir, 'progress.md'), `- ${now} Stage: ${current} → ${next}\n`, 'utf8');
  return { id: meta.id, from: current, to: next, type: meta.type };
}

export async function reconcileStageAfterCheckpointRevision(root, meta, skillId, now = new Date().toISOString()) {
  const targetStage = stageForSkill(meta, skillId);
  if (!targetStage) return null;
  const stages = workflowStagesFor(meta);
  const currentIndex = stages.indexOf(meta.status);
  const targetIndex = stages.indexOf(targetStage);
  if (currentIndex <= targetIndex || currentIndex < 0) return null;

  const base = workspacePath(root);
  const stateFile = path.join(base, 'state', 'current.yaml');
  const state = await readYaml(stateFile);
  const from = meta.status;
  meta.status = targetStage;
  meta.updatedAt = now;
  await writeYaml(path.join(base, 'work', meta.id, 'meta.yaml'), meta);
  if (state.activeWork === meta.id) {
    state.stage = targetStage;
    state.updatedAt = now;
    await writeYaml(stateFile, state);
  }
  await appendFile(path.join(base, 'work', meta.id, 'progress.md'), `- ${now} Stage corrected: ${from} → ${targetStage}\n`, 'utf8');
  return { from, to: targetStage };
}

function stageExitBlockers(meta, stage, ledger, questionsLedger) {
  const blockers = [];
  const requiredSkill = requiredSkillForStage(meta, stage);
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
