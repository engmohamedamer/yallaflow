import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readText, exists } from '../utils/fs.js';
import { loadWorkProgress } from './progress.js';
import { getConfig, workspacePath, WORKSPACE_DIR } from './workspace.js';
import { loadWorkKnowledge } from '../knowledge/store.js';
import { latestVerification, listVerificationRuns } from './evidence.js';
import { resolveInteractionPolicy, SKILL_TO_GATE } from '../behavior/interaction.js';
import { gateStatus, loadReviews } from '../reviews/store.js';
import { childProgressView, loadDecomposition, validateChildren } from '../decomposition/store.js';
import { stageForSkill } from './workflows.js';
import { loadBaseline } from '../baseline/store.js';
import { CONTEXT_TARGETS } from '../knowledge/constants.js';
import { BASELINE_AREAS, BASELINE_FACT_SOURCES, BASELINE_FACT_STATUSES } from '../baseline/constants.js';

// The single place that answers "does this work item's durable state contradict
// itself" — consumed by `doctor` today. advance/guide/resume/ready already share the
// same underlying primitives (loadWorkProgress, evaluateReadiness, buildBehaviorGuidance)
// that this function also builds on, so integrity checking reuses rather than
// duplicates the stage/checkpoint/verification/knowledge interpretation logic that
// already lives in transitions.js, progress.js, readiness.js, and knowledge/store.js.
//
// Named contradictions map onto YallaFlow's actual stage vocabulary (no workflow
// defines a distinct REVIEW stage — see the code-review DONE gate in transitions.js):
//   A: stage DONE, implementation checkpoint incomplete
//   B: stage VERIFICATION, implementation checkpoint incomplete
//   C: stage DONE, verification checkpoint incomplete (VERIFICATION → DONE is this
//      workflow's REVIEW-equivalent exit gate)
//   D: stage DONE, code-review checkpoint or required knowledge review incomplete
//   E: verification checkpoint completed but no valid verification evidence exists
// A and B are skipped for a decomposed parent (status executing/complete): its
// 'implementation' checkpoint is never meant to complete — its required children are
// the implementation (see decomposition-graph checks below).
export async function checkWorkIntegrity(root, meta) {
  if (meta.routingStatus === 'pending') return [];
  const stage = meta.status;
  const progress = await loadWorkProgress(root, meta);
  const { contract, ledger } = progress;
  const issues = [];

  const { exists: hasDecomposition, ledger: decomposition } = await loadDecomposition(root, meta.id);
  const isDecomposedParent = hasDecomposition && ['executing', 'complete'].includes(decomposition.status);

  const implementationStatus = ledger.skills.implementation?.status ?? 'pending';
  if (contract.skills.includes('implementation') && !isDecomposedParent) {
    if (stage === 'DONE' && implementationStatus !== 'completed') {
      issues.push(`${meta.id}: stage is DONE but implementation checkpoint is ${implementationStatus}.`);
    }
    if (stage === 'VERIFICATION' && implementationStatus !== 'completed') {
      issues.push(`${meta.id}: stage is VERIFICATION but implementation checkpoint is ${implementationStatus}.`);
    }
  }

  const verificationStatus = ledger.skills.verification?.status ?? 'pending';
  if (contract.skills.includes('verification')) {
    if (stage === 'DONE' && verificationStatus !== 'completed') {
      issues.push(`${meta.id}: stage is DONE but verification checkpoint is ${verificationStatus}.`);
    }
    if (verificationStatus === 'completed') {
      const verification = await latestVerification(root, meta.id);
      if (!verification) {
        issues.push(`${meta.id}: verification checkpoint is completed but no verification evidence exists.`);
      } else if (!verification.success) {
        issues.push(`${meta.id}: verification checkpoint is completed but the latest recorded evidence failed.`);
      } else if (meta.lastInvalidationAt && !(verification.verifiedAt > meta.lastInvalidationAt)) {
        issues.push(`${meta.id}: verification checkpoint is completed but its evidence predates a later implementation reopen/revision.`);
      }
    }
  }

  if (stage === 'DONE') {
    if (contract.skills.includes('code-review') && ledger.skills['code-review']?.status !== 'completed') {
      issues.push(`${meta.id}: stage is DONE but code-review checkpoint is ${ledger.skills['code-review']?.status ?? 'pending'}.`);
    }
    if (meta.knowledgePolicy?.reviewRequired === true) {
      const knowledge = await loadWorkKnowledge(root, meta);
      if (knowledge.ledger.reviewStatus !== 'reviewed') {
        issues.push(`${meta.id}: stage is DONE but project knowledge review is ${knowledge.ledger.reviewStatus}.`);
      }
    }
  }

  if (meta.parent) {
    const parentFile = path.join(workspacePath(root), 'work', meta.parent, 'meta.yaml');
    if (!await exists(parentFile)) issues.push(`${meta.id}: references parent ${meta.parent}, which does not exist.`);
  }

  if (hasDecomposition) {
    issues.push(...await checkDecompositionIntegrity(root, meta, decomposition));
  }

  if (meta.baseline) {
    issues.push(...await checkBaselineIntegrity(root, meta));
  }

  if (meta.requestHistory) {
    issues.push(...checkRequestHistoryIntegrity(meta));
  }

  issues.push(...await checkVerificationMetadataIntegrity(root, meta));

  const config = await getConfig(root);
  const policy = resolveInteractionPolicy(config);
  const { ledger: reviewLedger } = await loadReviews(root, meta.id);
  for (const [skillId, gateName] of Object.entries(SKILL_TO_GATE)) {
    if (!policy.gates[gateName]) continue;
    if (!stageForSkill(meta, skillId)) continue; // this workflow never gates this skill's stage exit
    if (ledger.skills[skillId]?.status !== 'completed') continue;
    const status = gateStatus(reviewLedger, gateName);
    if (status !== 'approved') issues.push(`${meta.id}: ${gateName} checkpoint is completed but its review is ${status}.`);
  }

  return issues;
}

async function checkDecompositionIntegrity(root, meta, decomposition) {
  const issues = [];
  const structural = validateChildren(decomposition.children);
  issues.push(...structural.map((entry) => `${meta.id}: decomposition ${entry}`));

  if (!['executing', 'complete'].includes(decomposition.status)) return issues;

  for (const child of decomposition.children) {
    if (!child.workId) {
      issues.push(`${meta.id}: decomposition child ${child.key} was never created despite status ${decomposition.status}.`);
      continue;
    }
    const childFile = path.join(workspacePath(root), 'work', child.workId, 'meta.yaml');
    if (!await exists(childFile)) issues.push(`${meta.id}: decomposition references child ${child.workId}, which does not exist.`);
  }

  if (meta.status === 'DONE') {
    const view = await childProgressView(root, decomposition);
    const incomplete = view.filter((child) => child.required !== false && child.state !== 'done');
    if (incomplete.length) {
      issues.push(`${meta.id}: parent is DONE but required child ${incomplete.map((child) => child.workId ?? child.key).join(', ')} is not DONE.`);
    }
  }

  const config = await getConfig(root);
  const policy = resolveInteractionPolicy(config);
  if (policy.gates.decomposition) {
    const { ledger: reviewLedger } = await loadReviews(root, meta.id);
    if (gateStatus(reviewLedger, 'decomposition') !== 'approved') {
      issues.push(`${meta.id}: decomposition execution started without required review approval.`);
    }
  }
  return issues;
}

async function checkBaselineIntegrity(root, meta) {
  const issues = [];
  const { exists: hasBaseline, ledger } = await loadBaseline(root, meta.id);
  if (!hasBaseline) return issues;

  for (const fact of ledger.facts) {
    if (!BASELINE_AREAS.includes(fact.area)) issues.push(`${meta.id}: baseline fact ${fact.id} has unknown area ${JSON.stringify(fact.area)}.`);
    if (!BASELINE_FACT_STATUSES.includes(fact.status)) issues.push(`${meta.id}: baseline fact ${fact.id} has unknown status ${JSON.stringify(fact.status)}.`);
    if (!BASELINE_FACT_SOURCES.includes(fact.source)) issues.push(`${meta.id}: baseline fact ${fact.id} has unknown source ${JSON.stringify(fact.source)}.`);
    if (!Array.isArray(fact.evidence) || !fact.evidence.length) issues.push(`${meta.id}: baseline fact ${fact.id} has no evidence references.`);
  }

  if (ledger.status === 'approved') {
    for (const fact of ledger.facts) {
      const relative = CONTEXT_TARGETS[fact.area];
      const marker = `<!-- yallaflow-baseline:${meta.id}:${fact.id} -->`;
      const file = path.join(workspacePath(root), relative);
      if (!await exists(file) || !(await readText(file)).includes(marker)) {
        issues.push(`${meta.id}: baseline is approved but fact ${fact.id} was never promoted into ${relative}.`);
      }
    }
  }
  return issues;
}

function checkRequestHistoryIntegrity(meta) {
  const issues = [];
  if (!Array.isArray(meta.requestHistory)) {
    issues.push(`${meta.id}: requestHistory must be an array.`);
    return issues;
  }
  meta.requestHistory.forEach((entry, index) => {
    const label = `${meta.id}: requestHistory[${index}]`;
    if (!entry || typeof entry !== 'object') { issues.push(`${label} must be an object.`); return; }
    for (const field of ['previousRequest', 'reason', 'revisedAt']) {
      if (typeof entry[field] !== 'string' || !entry[field].trim()) issues.push(`${label} has an invalid or missing ${field}.`);
    }
  });
  return issues;
}

async function checkVerificationMetadataIntegrity(root, meta) {
  const issues = [];
  const runs = await listVerificationRuns(root, meta.id);
  for (const run of runs) {
    if (run.executionMode === undefined) continue; // legacy run, nothing to validate
    if (!['argv', 'shell', 'script'].includes(run.executionMode)) {
      issues.push(`${meta.id}: verification run ${run.id} has unknown executionMode ${JSON.stringify(run.executionMode)}.`);
    }
    if (run.executionMode === 'argv' && !Array.isArray(run.args)) {
      issues.push(`${meta.id}: verification run ${run.id} is argv mode but has no args array.`);
    }
    if (!run.executable || typeof run.executable !== 'string') {
      issues.push(`${meta.id}: verification run ${run.id} is missing its executable.`);
    }
  }
  return issues;
}

// Workspace-level (not per-work-item) check: `.yallaflow` is durable project state and
// is expected to be committed like any other project file. Neither tracked nor
// deliberately gitignored suggests accidental drift, not a deliberate choice — reported
// only, never repaired, and skipped entirely outside a Git repository.
export function checkWorkspaceIntegrity(root) {
  const issues = [];
  const insideRepo = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: root, encoding: 'utf8' });
  if (insideRepo.status !== 0) return issues;
  const tracked = spawnSync('git', ['ls-files', '--', WORKSPACE_DIR], { cwd: root, encoding: 'utf8' });
  const ignored = spawnSync('git', ['check-ignore', '-q', WORKSPACE_DIR], { cwd: root });
  const isTracked = tracked.status === 0 && tracked.stdout.trim().length > 0;
  const isIgnored = ignored.status === 0;
  if (!isTracked && !isIgnored) {
    issues.push(`${WORKSPACE_DIR} exists but is neither tracked by Git nor gitignored; project state is not shared/durable across clones until it is committed or deliberately ignored.`);
  }
  return issues;
}
