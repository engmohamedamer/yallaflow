import path from 'node:path';
import { appendFile } from 'node:fs/promises';
import { exists } from '../utils/fs.js';
import { readYaml, writeYaml } from './yaml.js';
import { latestVerification, listVerificationRuns } from './evidence.js';
import { nextStageForWork, requiredSkillForStage, stageForSkill, workflowStagesFor } from './workflows.js';
import { getConfig, workspacePath } from './workspace.js';
import { incompleteImplementationSkills, loadWorkProgress, progressFilePath } from './progress.js';
import { loadWorkKnowledge, writeKnowledgeLedger } from '../knowledge/store.js';
import { loadWorkQuestions, summarizeQuestions } from '../questions/store.js';
import { resolveBehaviorContract } from '../skills/resolver.js';
import { WRITE_STAGES } from '../behavior/constants.js';
import { SKILL_TO_GATE, resolveInteractionPolicy } from '../behavior/interaction.js';
import { ensureGateRequested, gateStatus, invalidateGateIfApproved, loadReviews } from '../reviews/store.js';
import { decompositionBlockers, loadDecomposition } from '../decomposition/store.js';
import { CONVERGENCE_SKILL } from '../delivery/constants.js';
import { convergenceRequired } from '../delivery/policy.js';
import { loadWorkImpacts, pendingImpact } from '../delivery/impact.js';
import { evaluateConvergence } from '../delivery/convergence.js';

// Skills whose revision/reopening invalidates completed work later in the chain (see
// core/progress.js's CASCADE_ORDER and reopenWork below). Kept in one place so the
// stage-correction resolver and reopen both mark the same freshness boundary.
const CASCADE_CHAIN = Object.freeze(['implementation', 'verification', 'delivery-convergence', 'code-review']);
const REOPEN_TARGETS = Object.freeze(['implementation', 'verification', 'review']);

export async function advanceActiveWork(root, requestedWorkId) {
  const base = workspacePath(root);
  const stateFile = path.join(base, 'state', 'current.yaml');
  const state = await readYaml(stateFile);
  const workId = requestedWorkId ?? state.activeWork;
  if (!workId) throw new Error('No active work item.');

  const workDir = path.join(base, 'work', workId);
  const metaFile = path.join(workDir, 'meta.yaml');
  if (!await exists(metaFile)) throw new Error(`Work item ${workId} was not found.`);
  const meta = await readYaml(metaFile);
  if (meta.routingStatus === 'pending') throw new Error(`${meta.id} is awaiting routing. Run \`yallaflow route\` first.`);
  const isActive = workId === state.activeWork;
  const current = isActive ? (state.stage ?? meta.status) : meta.status;
  const workflow = meta.workflow ?? meta.type;
  const verdict = await evaluateAdvance(root, meta, current, { mutate: true });
  if (!verdict.allowed) throw new Error(verdict.error);
  const next = verdict.next;

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

  await writeYaml(metaFile, meta);
  if (isActive) {
    state.stage = next;
    state.updatedAt = now;
    if (next === 'DONE') state.activeWork = null;
    await writeYaml(stateFile, state);
  }
  await appendFile(path.join(workDir, 'progress.md'), `- ${now} Stage: ${current} → ${next}\n`, 'utf8');
  return { id: meta.id, from: current, to: next, type: meta.type };
}

// The single interpretation of "may this work item leave its current stage?", shared
// by `advance` (mutate: true — it may record a newly requested review gate) and the
// read-only `guide`/`next action` resolver (mutate: false). Returns the first blocking
// requirement together with the exact next valid CLI action, so an agent does not need
// repeated advance/guide round-trips to discover what to do next. Error text is the
// exact text `advance` has always thrown.
export async function evaluateAdvance(root, meta, current, { mutate = false } = {}) {
  const id = meta.id;
  const workflow = meta.workflow ?? meta.type;
  const next = nextStageForWork(meta, current);
  if (!next) return { allowed: false, next: null, final: true, error: `${id} is already at the final stage.`, blocker: null, action: null };
  const blocked = (error, blocker, action) => ({ allowed: false, next, error, blocker, action });
  // A legacy-context reconciliation has no meaningful investigation stages: it becomes
  // DONE only when `context reconcile apply` settles its last candidate (v0.3.7).
  if (meta.reconciliation) {
    const text = `${id} is a legacy-context reconciliation; it completes only through \`yallaflow context reconcile apply\` once every candidate is reconciled.`;
    return blocked(text, text, `yallaflow context reconcile status ${id}`);
  }

  const progress = await loadWorkProgress(root, meta);
  // A change of approved intent (new source, changed requirements) must be assessed
  // before the work moves anywhere (v0.3.8).
  const deliveryRequired = convergenceRequired(progress.contract);
  if (deliveryRequired) {
    const pending = pendingImpact((await loadWorkImpacts(root, meta)).ledger);
    if (pending) {
      return blocked(
        `Cannot advance from ${current} to ${next}: impact ${pending.id} is pending. A change of approved intent must be assessed before the work continues.`,
        `impact ${pending.id} is pending assessment`,
        `yallaflow impact status ${id}   (then: yallaflow impact assess ${id} --file impact.json)`
      );
    }
  }
  const questions = await loadWorkQuestions(root, meta);
  const blockers = await stageExitBlockers(root, meta, current, progress.contract, progress.ledger, questions.ledger, { mutate });
  if (blockers.length) {
    return blocked(
      `Cannot advance from ${current} to ${next}.\n\nBlocking requirements:\n` + blockers.map((entry) => `- ${entry.text}`).join('\n'),
      blockers[0].text,
      blockers[0].action
    );
  }

  if (['IMPLEMENTATION', 'EXECUTION'].includes(next) && progress.contract.skills.length) {
    const incomplete = incompleteImplementationSkills(progress.contract, progress.ledger);
    if (incomplete.length) {
      return blocked(
        `Cannot transition to ${next}; complete required checkpoint(s) first: ${incomplete.join(', ')}.`,
        `required checkpoint(s) incomplete: ${incomplete.join(', ')}`,
        checkpointAction(id, incomplete[0])
      );
    }
  }

  // Workflows without a VERIFICATION stage (investigation) never hit the stage-exit
  // verification gate above, but doctor still requires a pinned verification
  // checkpoint to be completed before DONE — so DONE enforces it for every workflow.
  if (next === 'DONE' && progress.contract.skills.includes('verification') && progress.ledger.skills.verification?.status !== 'completed') {
    const needsEvidence = !await hasFreshSuccessfulVerification(root, meta);
    return blocked(
      'Cannot transition to DONE until the verification checkpoint is completed.',
      'verification checkpoint is incomplete',
      needsEvidence ? `yallaflow verify ${id} -- <command>` : checkpointAction(id, 'verification')
    );
  }

  if (next === 'DONE' && workflow !== 'investigation') {
    const verification = await latestVerification(root, id);
    if (!verification?.success) {
      return blocked(
        'Cannot transition to DONE without fresh successful verification evidence. Run `yallaflow verify -- <command>` first.',
        'no fresh successful verification evidence exists',
        `yallaflow verify ${id} -- <command>`
      );
    }
    if (meta.lastInvalidationAt && !(verification.verifiedAt > meta.lastInvalidationAt)) {
      return blocked(
        'Cannot transition to DONE: verification evidence predates a later implementation reopen or revision. Run `yallaflow verify -- <command>` again.',
        'verification evidence predates a later reopen/revision',
        `yallaflow verify ${id} -- <command>`
      );
    }
  }

  if (next === 'DONE' && deliveryRequired) {
    const convergence = await evaluateConvergence(root, meta);
    if (!convergence.converged) {
      return blocked(
        'Cannot transition to DONE: the delivered implementation has not converged on the approved intent.\n\nDONE blocked:\n' +
        convergence.blockers.map((entry) => `- ${entry.text}`).join('\n') +
        '\n\nNext valid action: resolve the convergence gaps and record a new convergence assessment.',
        `convergence: ${convergence.blockers[0].text}${convergence.blockers.length > 1 ? ` (+${convergence.blockers.length - 1} more)` : ''}`,
        `yallaflow convergence status ${id}   (then: yallaflow convergence record ${id} --file convergence.json)`
      );
    }
    if (progress.ledger.skills[CONVERGENCE_SKILL]?.status !== 'completed') {
      return blocked(`Cannot transition to DONE until the ${CONVERGENCE_SKILL} checkpoint is completed.`, `${CONVERGENCE_SKILL} checkpoint is incomplete`, checkpointAction(id, CONVERGENCE_SKILL));
    }
    // An impact assessment can reopen an earlier checkpoint without moving the stage
    // (bounded work has no stage per checkpoint): DONE requires the whole pinned
    // contract to be complete again. A decomposed parent's implementation is its children.
    const decomposition = await loadDecomposition(root, id);
    const decomposed = decomposition.exists && ['executing', 'complete'].includes(decomposition.ledger.status);
    const incomplete = progress.contract.skills.filter((skill) => progress.ledger.skills[skill]?.status !== 'completed' && !(decomposed && skill === 'implementation'));
    if (incomplete.length) {
      return blocked(`Cannot transition to DONE; checkpoint(s) reopened since they were completed: ${incomplete.join(', ')}.`, `checkpoint(s) incomplete: ${incomplete.join(', ')}`, checkpointAction(id, incomplete[0]));
    }
  }

  if (next === 'DONE' && progress.contract.skills.includes('code-review') && progress.ledger.skills['code-review']?.status !== 'completed') {
    return blocked('Cannot transition to DONE until the code-review checkpoint is completed.', 'code-review checkpoint is incomplete', checkpointAction(id, 'code-review'));
  }

  if (next === 'DONE' && meta.knowledgePolicy?.reviewRequired === true) {
    const knowledge = await loadWorkKnowledge(root, meta);
    if (knowledge.ledger.reviewStatus !== 'reviewed') {
      const proposed = knowledge.ledger.candidates.filter((candidate) => candidate.status === 'proposed');
      return blocked(
        'Cannot transition to DONE until project knowledge review is complete. ' +
        'Resolve all candidates or run `yallaflow knowledge review --none`.',
        proposed.length ? `${proposed.length} knowledge candidate(s) awaiting promote/reject` : 'project knowledge review is pending',
        proposed.length
          ? `yallaflow knowledge promote ${id} --candidate ${proposed[0].id}   (or: knowledge reject ${id} --candidate ${proposed[0].id} --reason "...")`
          : `yallaflow knowledge propose ${id} --kind KIND --source SOURCE --summary "..." --evidence REF   (or: knowledge review ${id} --none)`
      );
    }
  }

  return { allowed: true, next, error: null, blocker: null, action: `yallaflow advance ${id}` };
}

async function hasFreshSuccessfulVerification(root, meta) {
  const verification = await latestVerification(root, meta.id);
  return Boolean(verification?.success) && !(meta.lastInvalidationAt && !(verification.verifiedAt > meta.lastInvalidationAt));
}

function checkpointAction(workId, skillId) {
  return `yallaflow checkpoint ${workId} --skill ${skillId} --complete --summary "..."`;
}

// Ordinary checkpoint revision walks the workflow stage backward when an earlier,
// architecturally-gated skill is revised, and separately marks a freshness boundary
// (lastInvalidationAt) when the revised skill is part of the post-implementation
// dependency chain — regardless of whether that also moves the stage, since e.g.
// revising 'code-review' invalidates DONE-eligibility without any stage to roll back to.
// A revised skill's own review approval (if any) is invalidated, and so is every
// downstream cascade skill's, since their approval was granted on top of what just
// changed (see reviews/store.js's invalidateGateIfApproved — history is preserved).
export async function reconcileStageAfterCheckpointRevision(root, meta, skillId, reason, now = new Date().toISOString()) {
  const targetStage = stageForSkill(meta, skillId);
  const stages = workflowStagesFor(meta);
  const currentIndex = stages.indexOf(meta.status);
  const targetIndex = targetStage ? stages.indexOf(targetStage) : -1;
  const needsStageCorrection = Boolean(targetStage) && currentIndex >= 0 && currentIndex > targetIndex;
  // Revising delivery-convergence re-opens the intent assessment only: verification
  // evidence stays valid, so it does not move the verification freshness boundary.
  const marksInvalidation = CASCADE_CHAIN.includes(skillId) && skillId !== 'delivery-convergence';
  if (!needsStageCorrection && !marksInvalidation) {
    if (CASCADE_CHAIN.includes(skillId)) await invalidateAffectedGates(root, meta.id, skillId, reason ?? `${skillId} revised`, now);
    return null;
  }

  const base = workspacePath(root);
  const from = meta.status;
  if (needsStageCorrection) meta.status = targetStage;
  if (marksInvalidation) meta.lastInvalidationAt = now;
  meta.updatedAt = now;
  await writeYaml(path.join(base, 'work', meta.id, 'meta.yaml'), meta);
  await invalidateAffectedGates(root, meta.id, skillId, reason ?? `${skillId} revised`, now);

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

async function invalidateAffectedGates(root, workId, skillId, reason, now) {
  const gateName = SKILL_TO_GATE[skillId];
  if (gateName) await invalidateGateIfApproved(root, workId, gateName, reason, now);
  const cascadeIndex = CASCADE_CHAIN.indexOf(skillId);
  if (cascadeIndex < 0) return;
  for (const downstream of CASCADE_CHAIN.slice(cascadeIndex + 1)) {
    const downstreamGate = SKILL_TO_GATE[downstream];
    if (downstreamGate) await invalidateGateIfApproved(root, workId, downstreamGate, `downstream of ${skillId} revision`, now);
  }
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
  const targetIndex = CASCADE_CHAIN.indexOf({ implementation: 'implementation', verification: 'verification', review: 'code-review' }[input.toStage]);

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
  for (const skillId of CASCADE_CHAIN.slice(targetIndex)) {
    const gateName = SKILL_TO_GATE[skillId];
    if (gateName) await invalidateGateIfApproved(root, workId, gateName, `reopened to ${input.toStage}: ${reason}`, now);
  }

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
  // Reopening for review re-reviews what was already implemented and verified: it does
  // not move the verification freshness boundary (v0.3.8; earlier it did, which left
  // completed verification and convergence contradicting doctor).
  if (input.toStage !== 'review') meta.lastInvalidationAt = now;
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

async function stageExitBlockers(root, meta, stage, contract, ledger, questionsLedger, { mutate = true } = {}) {
  const blockers = [];
  const workflow = meta.workflow ?? meta.type;
  const isWriteStage = (WRITE_STAGES[workflow] ?? []).includes(stage);

  const decomposition = isWriteStage ? await decompositionBlockers(root, meta) : null;
  if (decomposition !== null) {
    blockers.push(...decomposition.map((text) => ({ text, action: `yallaflow next ${meta.id}` })));
  } else {
    const requiredSkill = requiredSkillForStage(meta, stage, contract.skills);
    if (requiredSkill) {
      const status = ledger.skills[requiredSkill]?.status ?? 'pending';
      if (status !== 'completed') {
        // The verification checkpoint itself requires fresh successful evidence, so the
        // next valid action is to record it first when none exists yet.
        const needsEvidence = requiredSkill === 'verification' && !await hasFreshSuccessfulVerification(root, meta);
        blockers.push({
          text: `${requiredSkill} checkpoint is ${status}`,
          action: needsEvidence ? `yallaflow verify ${meta.id} -- <command>` : checkpointAction(meta.id, requiredSkill)
        });
      } else {
        const gateName = SKILL_TO_GATE[requiredSkill];
        if (gateName) {
          const reviewBlocker = await reviewGateBlocker(root, meta.id, gateName, { mutate });
          if (reviewBlocker) blockers.push({ text: reviewBlocker, action: `yallaflow approve ${meta.id} --stage ${gateName}   (human review; or: feedback ${meta.id} --stage ${gateName} --changes-requested)` });
        }
      }
    }
  }

  if (['SPECIFICATION', 'PLAN'].includes(stage)) {
    const unresolved = summarizeQuestions(questionsLedger).materialOpen;
    if (unresolved.length) {
      blockers.push({
        text: `unresolved material decisions: ${unresolved.length} (${unresolved.map((entry) => entry.id).join(', ')})`,
        action: `yallaflow question answer ${meta.id} --id ${unresolved[0].id} --answer "..."   (then: question resolve ${meta.id} --id ${unresolved[0].id})`
      });
    }
  }
  return blockers;
}

// Shared by the stage-exit gate above and `decompose execute` (for the 'decomposition'
// gate, which has no skill/stage of its own). Autonomous mode's gate map is all-false,
// so this never fires there; hard safety checks (checkpoint completion, verification
// evidence, knowledge review, dependency completion) are never routed through here and
// so can never be bypassed by any interaction mode.
export async function reviewGateBlocker(root, workId, gateName, { mutate = true } = {}) {
  const config = await getConfig(root);
  const policy = resolveInteractionPolicy(config);
  if (!policy.gates[gateName]) return null;
  const { ledger } = await loadReviews(root, workId);
  const status = gateStatus(ledger, gateName);
  if (status === 'approved') return null;
  if (mutate) await ensureGateRequested(root, workId, gateName);
  return `${gateName} review is ${status === 'not_requested' ? 'awaiting_review' : status} in the current interaction mode — ` +
    `awaiting approval before execution. Run \`yallaflow approve ${workId} --stage ${gateName}\` or \`yallaflow feedback ${workId} --stage ${gateName} --changes-requested\`.`;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}
