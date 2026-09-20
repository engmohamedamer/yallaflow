import { loadWorkProgress } from './progress.js';
import { loadWorkKnowledge } from '../knowledge/store.js';
import { latestVerification } from './evidence.js';

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
export async function checkWorkIntegrity(root, meta) {
  if (meta.routingStatus === 'pending') return [];
  const stage = meta.status;
  const progress = await loadWorkProgress(root, meta);
  const { contract, ledger } = progress;
  const issues = [];

  const implementationStatus = ledger.skills.implementation?.status ?? 'pending';
  if (contract.skills.includes('implementation')) {
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

  return issues;
}
