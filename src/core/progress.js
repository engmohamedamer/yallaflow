import path from 'node:path';
import { exists } from '../utils/fs.js';
import { findSkill } from '../skills/registry.js';
import { resolveBehaviorContract } from '../skills/resolver.js';
import { WRITE_STAGES } from '../behavior/constants.js';
import { latestVerification } from './evidence.js';
import { readYaml, writeYaml } from './yaml.js';
import { workspacePath } from './workspace.js';
import { loadWorkQuestions, summarizeQuestions } from '../questions/store.js';

export const SKILL_STATUSES = Object.freeze(['pending', 'in_progress', 'completed', 'blocked']);

// Post-implementation dependency chain: revising an earlier link invalidates completed
// work on later links (they were built on top of what just changed), but never the
// other way around, and pre-implementation design/spec checkpoints are deliberately
// outside this chain (see reconcileStageAfterCheckpointRevision's stage-only handling).
const CASCADE_ORDER = Object.freeze(['implementation', 'verification', 'code-review']);

const LEDGER_FIELDS = new Set(['schemaVersion', 'behavior', 'skills', 'rulings', 'history', 'updatedAt']);
const CHECKPOINT_FIELDS = new Set(['status', 'startedAt', 'completedAt', 'summary', 'evidence']);
const RULING_FIELDS = new Set(['decision', 'reason', 'costIfWrong', 'createdAt']);
const HISTORY_FIELDS = new Set(['skill', 'from', 'to', 'reason', 'changedAt']);

export function progressFilePath(root, workId) {
  return path.join(workspacePath(root), 'work', workId, 'progress.yaml');
}

export async function loadWorkProgress(root, meta) {
  const contract = resolveBehaviorContract(meta);
  const file = progressFilePath(root, meta.id);
  if (!await exists(file)) {
    return { exists: false, contract, ledger: emptyLedger(contract) };
  }

  const ledger = await readYaml(file);
  validateProgressLedger(ledger, contract, meta.id);
  return { exists: true, contract, ledger: withPendingSkills(ledger, contract) };
}

export async function checkpointWork(root, workId, input, now = new Date().toISOString()) {
  const metaFile = path.join(workspacePath(root), 'work', workId, 'meta.yaml');
  if (!await exists(metaFile)) throw new Error(`Work item ${workId} was not found.`);
  const meta = await readYaml(metaFile);
  if (meta.routingStatus === 'pending') throw new Error(`${workId} is awaiting routing. Run \`yallaflow route\` first.`);

  const loaded = await loadWorkProgress(root, meta);
  if (!loaded.contract.skills.length) {
    throw new Error(`${workId} has no Behavior Contract. Checkpoints require routed work with a pinned or derived contract.`);
  }

  const hasSkillUpdate = input.skillId !== undefined || input.status !== undefined;
  const hasRuling = input.ruling !== undefined;
  if (!hasSkillUpdate && !hasRuling) {
    throw new Error('Checkpoint requires a skill status update or a complete ruling.');
  }

  let unchanged = false;
  let checkpoint = null;
  if (hasSkillUpdate) {
    checkpoint = await applySkillCheckpoint(root, meta, loaded.contract, loaded.ledger, input, now);
    unchanged = checkpoint.unchanged;
  }
  if (hasRuling) applyRuling(loaded.ledger, input.ruling, now);

  if (!unchanged || hasRuling || !loaded.exists) {
    loaded.ledger.updatedAt = now;
    await writeYaml(progressFilePath(root, workId), loaded.ledger);
  }

  return {
    meta,
    contract: loaded.contract,
    ledger: loaded.ledger,
    checkpoint: checkpoint?.value ?? null,
    unchanged: unchanged && !hasRuling
  };
}

export async function reviseCheckpoint(root, workId, input, now = new Date().toISOString()) {
  if (!isNonEmptyString(input.reason)) throw new Error('Checkpoint correction requires a non-empty --reason.');
  if (!isNonEmptyString(input.skillId)) throw new Error('--skill must be a non-empty skill ID.');
  if (!['pending', 'in_progress', 'blocked'].includes(input.status)) {
    throw new Error('Checkpoint correction status must be pending, in_progress, or blocked. Use the normal checkpoint command to complete work.');
  }

  const metaFile = path.join(workspacePath(root), 'work', workId, 'meta.yaml');
  if (!await exists(metaFile)) throw new Error(`Work item ${workId} was not found.`);
  const meta = await readYaml(metaFile);
  if (meta.status === 'DONE') {
    throw new Error(
      `${workId} is DONE.\n\nReopen the work before revising completed execution state.\n\nUse:\nyallaflow reopen ${workId} --to <stage> --reason "..."`
    );
  }
  const loaded = await loadWorkProgress(root, meta);
  if (!loaded.contract.skills.includes(input.skillId)) {
    throw new Error(`Skill ${input.skillId} is outside the Behavior Contract for ${meta.id}.`);
  }
  const current = loaded.ledger.skills[input.skillId] ?? { status: 'pending' };
  if (current.status === input.status) throw new Error(`Skill ${input.skillId} is already ${input.status}; no correction is required.`);

  const next = { status: input.status };
  if (['in_progress', 'blocked'].includes(input.status)) next.startedAt = current.startedAt ?? now;
  const summary = input.summary?.trim() || (input.status === 'blocked' ? input.reason.trim() : current.summary);
  if (summary) next.summary = summary;
  if (current.evidence?.length && input.status !== 'pending') next.evidence = [...current.evidence];
  loaded.ledger.skills[input.skillId] = next;
  loaded.ledger.history.push({
    skill: input.skillId,
    from: current.status,
    to: input.status,
    reason: input.reason.trim(),
    changedAt: now
  });

  const cascadeIndex = CASCADE_ORDER.indexOf(input.skillId);
  if (cascadeIndex >= 0) {
    for (const downstream of CASCADE_ORDER.slice(cascadeIndex + 1)) {
      if (!loaded.contract.skills.includes(downstream)) continue;
      const downstreamCurrent = loaded.ledger.skills[downstream];
      if (downstreamCurrent && downstreamCurrent.status !== 'pending') {
        loaded.ledger.skills[downstream] = { status: 'pending' };
        loaded.ledger.history.push({
          skill: downstream,
          from: downstreamCurrent.status,
          to: 'pending',
          reason: `Downstream of ${input.skillId} revision: ${input.reason.trim()}`,
          changedAt: now
        });
      }
    }
  }

  loaded.ledger.updatedAt = now;
  await writeYaml(progressFilePath(root, workId), loaded.ledger);
  return { meta, contract: loaded.contract, ledger: loaded.ledger, checkpoint: next, cascaded: cascadeIndex >= 0 };
}

export function summarizeProgress(contract, ledger = { skills: {} }) {
  const entries = contract.skills.map((skillId) => ({
    skillId,
    ...(ledger.skills[skillId] ?? { status: 'pending' })
  }));
  const completed = entries.filter((entry) => entry.status === 'completed');
  const inProgress = entries.filter((entry) => entry.status === 'in_progress');
  const blocked = entries.filter((entry) => entry.status === 'blocked');
  const pending = entries.filter((entry) => entry.status === 'pending');
  const current = blocked[0] ?? inProgress[0] ?? nextEligiblePending(entries) ?? pending[0] ?? null;
  return {
    entries,
    completed,
    inProgress,
    blocked,
    pending,
    current,
    completedCount: completed.length,
    totalCount: entries.length
  };
}

export function requiredSkillsBeforeImplementation(contract) {
  const writeIndex = contract.skills.findIndex((skillId) => findSkill(skillId)?.mode === 'write-allowed');
  if (writeIndex < 0) return [];
  return contract.skills.slice(0, writeIndex);
}

export function incompleteImplementationSkills(contract, ledger) {
  return requiredSkillsBeforeImplementation(contract)
    .filter((skillId) => ledger.skills[skillId]?.status !== 'completed');
}

export function validateProgressLedger(ledger, contract, workId = '<unknown>') {
  if (!ledger || typeof ledger !== 'object' || Array.isArray(ledger)) {
    throw new Error(`Progress ledger for ${workId} must be an object.`);
  }
  rejectUnknownFields(ledger, LEDGER_FIELDS, `progress ledger for ${workId}`);
  if (ledger.schemaVersion !== 1) throw new Error(`Progress ledger for ${workId} must use schemaVersion 1.`);
  if (!ledger.behavior || !Number.isInteger(ledger.behavior.registryVersion) || ledger.behavior.registryVersion < 1) {
    throw new Error(`Progress ledger for ${workId} must identify a valid behavior registryVersion.`);
  }
  if (contract.registryVersion && ledger.behavior.registryVersion !== contract.registryVersion) {
    throw new Error(`Progress ledger for ${workId} uses registry v${ledger.behavior.registryVersion}, but its Behavior Contract uses registry v${contract.registryVersion}.`);
  }
  if (!ledger.skills || typeof ledger.skills !== 'object' || Array.isArray(ledger.skills)) {
    throw new Error(`Progress ledger for ${workId} must contain a skills object.`);
  }
  for (const [skillId, checkpoint] of Object.entries(ledger.skills)) {
    if (!contract.skills.includes(skillId)) throw new Error(`Progress ledger skill ${skillId} is outside the Behavior Contract for ${workId}.`);
    validateCheckpoint(checkpoint, skillId);
  }
  if (!Array.isArray(ledger.rulings)) throw new Error(`Progress ledger for ${workId} must contain a rulings array.`);
  ledger.rulings.forEach((ruling, index) => validateRuling(ruling, `ruling ${index + 1}`));
  if (ledger.history !== undefined && !Array.isArray(ledger.history)) {
    throw new Error(`Progress ledger for ${workId} history must be an array.`);
  }
  (ledger.history ?? []).forEach((entry, index) => validateHistory(entry, `history entry ${index + 1}`));
  if (ledger.updatedAt !== null && !isNonEmptyString(ledger.updatedAt)) {
    throw new Error(`Progress ledger for ${workId} has an invalid updatedAt timestamp.`);
  }
  return true;
}

function emptyLedger(contract) {
  return {
    schemaVersion: 1,
    behavior: { registryVersion: contract.registryVersion },
    skills: Object.fromEntries(contract.skills.map((skillId) => [skillId, { status: 'pending' }])),
    rulings: [],
    history: [],
    updatedAt: null
  };
}

function withPendingSkills(ledger, contract) {
  return {
    ...ledger,
    behavior: { ...ledger.behavior },
    skills: Object.fromEntries(contract.skills.map((skillId) => [
      skillId,
      { ...(ledger.skills[skillId] ?? { status: 'pending' }) }
    ])),
    rulings: ledger.rulings.map((ruling) => ({ ...ruling })),
    history: (ledger.history ?? []).map((entry) => ({ ...entry }))
  };
}

async function applySkillCheckpoint(root, meta, contract, ledger, input, now) {
  if (!isNonEmptyString(input.skillId)) throw new Error('--skill must be a non-empty skill ID.');
  const registrySkill = findSkill(input.skillId);
  if (!registrySkill) throw new Error(`Unknown skill ${JSON.stringify(input.skillId)}.`);
  if (!contract.skills.includes(input.skillId)) {
    throw new Error(`Skill ${input.skillId} is outside the Behavior Contract for ${meta.id}.`);
  }
  if (!SKILL_STATUSES.includes(input.status)) {
    throw new Error(`status must be one of: ${SKILL_STATUSES.join(', ')}; received ${JSON.stringify(input.status)}.`);
  }

  if (registrySkill.mode === 'write-allowed' && ['in_progress', 'completed'].includes(input.status)) {
    const workflow = meta.workflow ?? meta.type;
    if (meta.readOnly || workflow === 'investigation') {
      throw new Error(`Cannot ${input.status === 'completed' ? 'complete' : 'start'} ${input.skillId}; work policy is read-only.`);
    }
    if (!(WRITE_STAGES[workflow] ?? []).includes(meta.status)) {
      throw new Error(`Cannot ${input.status === 'completed' ? 'complete' : 'start'} ${input.skillId} at workflow stage ${meta.status ?? 'none'}.`);
    }
  }

  const current = ledger.skills[input.skillId] ?? { status: 'pending' };
  if (current.status === 'completed') {
    if (input.status === 'completed') return { value: current, unchanged: true };
    throw new Error(`Skill ${input.skillId} is already completed and cannot return to ${input.status}.`);
  }
  if (input.status === 'pending' && current.status !== 'pending') {
    throw new Error(`Skill ${input.skillId} cannot return from ${current.status} to pending.`);
  }
  if (input.status === 'completed') {
    const incomplete = registrySkill.prerequisites.filter((skillId) => ledger.skills[skillId]?.status !== 'completed');
    if (incomplete.length) {
      throw new Error(`Cannot complete ${input.skillId}; complete prerequisite skill(s) first: ${incomplete.join(', ')}.`);
    }
    if (!isNonEmptyString(input.summary)) throw new Error(`Completing ${input.skillId} requires a non-empty --summary.`);
    if (loadedSpecificationContract(contract) && ['specification', 'implementation-planning'].includes(input.skillId)) {
      const questions = await loadWorkQuestions(root, meta);
      const unresolved = summarizeQuestions(questions.ledger).materialOpen;
      if (unresolved.length) {
        throw new Error(
          `Cannot complete ${input.skillId}; resolve material question(s) first: ${unresolved.map((entry) => entry.id).join(', ')}. ` +
          'Record a blocked checkpoint when the draft is not ready.'
        );
      }
      if (input.skillId === 'implementation-planning' && ledger.skills.specification?.status !== 'completed') {
        throw new Error('Cannot complete implementation-planning; complete the specification checkpoint first.');
      }
    }
  }
  if (input.status === 'blocked' && !isNonEmptyString(input.summary)) {
    throw new Error(`Blocking ${input.skillId} requires a non-empty --summary describing the blocker.`);
  }

  const evidence = mergeEvidence(current.evidence, input.evidence);
  if (input.status === 'completed' && input.skillId === 'systematic-debugging' && meta.type === 'bug' && !evidence.length) {
    throw new Error('Completing systematic-debugging for a bug requires at least one --evidence reference for the confirmed root cause.');
  }
  // Applies to read-only work too (investigations, bug spikes): doctor requires every
  // completed verification checkpoint to be backed by successful evidence, so the
  // checkpoint may never be completed without it. `yallaflow verify` runs a
  // read-only proof command; it does not authorize application-code changes.
  if (input.status === 'completed' && input.skillId === 'verification') {
    const verification = await latestVerification(root, meta.id);
    if (!verification?.success) {
      throw new Error('Completing verification requires fresh successful evidence from `yallaflow verify -- <command>`.');
    }
    if (meta.lastInvalidationAt && !(verification.verifiedAt > meta.lastInvalidationAt)) {
      throw new Error(
        'Completing verification requires evidence recorded after the most recent implementation reopen/revision. Run `yallaflow verify -- <command>` again.'
      );
    }
  }
  if (input.status === 'completed' && input.skillId === 'code-review' && ledger.skills.verification?.status !== 'completed') {
    throw new Error('Cannot complete code-review; complete the verification checkpoint first.');
  }

  const next = { status: input.status };
  if (current.startedAt || ['in_progress', 'completed', 'blocked'].includes(input.status)) next.startedAt = current.startedAt ?? now;
  if (input.status === 'completed') next.completedAt = now;
  if (isNonEmptyString(input.summary)) next.summary = input.summary.trim();
  else if (current.summary && input.status !== 'pending') next.summary = current.summary;
  if (evidence.length && input.status !== 'pending') next.evidence = evidence;
  ledger.skills[input.skillId] = next;
  return { value: next, unchanged: false };
}

function applyRuling(ledger, ruling, now) {
  const value = {
    decision: ruling?.decision?.trim(),
    reason: ruling?.reason?.trim(),
    costIfWrong: ruling?.costIfWrong?.trim(),
    createdAt: now
  };
  validateRuling(value, 'ruling');
  ledger.rulings.push(value);
}

function nextEligiblePending(entries) {
  const completed = new Set(entries.filter((entry) => entry.status === 'completed').map((entry) => entry.skillId));
  return entries.find((entry) => entry.status === 'pending' &&
    (findSkill(entry.skillId)?.prerequisites ?? []).every((skillId) => completed.has(skillId)));
}

function validateCheckpoint(checkpoint, skillId) {
  if (!checkpoint || typeof checkpoint !== 'object' || Array.isArray(checkpoint)) {
    throw new Error(`Checkpoint for ${skillId} must be an object.`);
  }
  rejectUnknownFields(checkpoint, CHECKPOINT_FIELDS, `checkpoint for ${skillId}`);
  if (!SKILL_STATUSES.includes(checkpoint.status)) {
    throw new Error(`Checkpoint for ${skillId} has unsupported status ${JSON.stringify(checkpoint.status)}.`);
  }
  for (const field of ['startedAt', 'completedAt', 'summary']) {
    if (checkpoint[field] !== undefined && !isNonEmptyString(checkpoint[field])) {
      throw new Error(`Checkpoint for ${skillId} has invalid ${field}.`);
    }
  }
  if (checkpoint.evidence !== undefined && (!Array.isArray(checkpoint.evidence) || checkpoint.evidence.some((entry) => !isNonEmptyString(entry)))) {
    throw new Error(`Checkpoint evidence for ${skillId} must be an array of non-empty strings.`);
  }
}

function validateRuling(ruling, label) {
  if (!ruling || typeof ruling !== 'object' || Array.isArray(ruling)) throw new Error(`${label} must be an object.`);
  rejectUnknownFields(ruling, RULING_FIELDS, label);
  for (const field of RULING_FIELDS) {
    if (!isNonEmptyString(ruling[field])) throw new Error(`${label} requires non-empty ${field}.`);
  }
}

function validateHistory(entry, label) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`${label} must be an object.`);
  rejectUnknownFields(entry, HISTORY_FIELDS, label);
  if (!isNonEmptyString(entry.skill)) throw new Error(`${label} requires a non-empty skill.`);
  if (!SKILL_STATUSES.includes(entry.from) || !SKILL_STATUSES.includes(entry.to)) {
    throw new Error(`${label} contains an unsupported checkpoint status.`);
  }
  if (!isNonEmptyString(entry.reason) || !isNonEmptyString(entry.changedAt)) {
    throw new Error(`${label} requires non-empty reason and changedAt.`);
  }
}

function loadedSpecificationContract(contract) {
  return contract.registryVersion >= 2 && contract.skills.includes('specification');
}

function mergeEvidence(existing = [], supplied = []) {
  if (!Array.isArray(supplied) || supplied.some((entry) => !isNonEmptyString(entry))) {
    throw new Error('--evidence values must be non-empty strings.');
  }
  return [...new Set([...existing, ...supplied].map((entry) => entry.trim()))];
}

function rejectUnknownFields(value, allowed, label) {
  const unknown = Object.keys(value).filter((field) => !allowed.has(field));
  if (unknown.length) throw new Error(`Unknown field(s) in ${label}: ${unknown.join(', ')}.`);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}
