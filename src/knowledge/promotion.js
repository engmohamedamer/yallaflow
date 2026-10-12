import path from 'node:path';
import { writeRedactedText } from '../security/redact.js';
import { exists, readText } from '../utils/fs.js';
import { isSharedWorkspace, workspacePath } from '../core/workspace.js';
import { integrateSharedMemory, stageCandidateDelta } from '../shared/memory.js';
import { loadSharedPolicy } from '../shared/config.js';
import { currentBranch } from '../shared/git.js';
import { factFingerprint } from '../shared/fingerprint.js';
import { findFact } from '../context/ledger.js';
import { listVerificationRuns } from '../core/evidence.js';
import { appliedTransition, loadContextLedger, mutateContextLedger, validateContextLedger } from '../context/ledger.js';
import { writeContextProjection } from '../context/projection.js';
import { hasResolvableEvidence, normalizeEvidenceRefs } from '../context/evidence.js';
import { CONTEXT_TARGETS } from './constants.js';
import {
  assertKnowledgeReviewAllowed,
  loadWorkKnowledge,
  loadWorkMeta,
  requireCandidate,
  updateReviewStatus,
  writeKnowledgeLedger
} from './store.js';

export async function promoteKnowledge(root, workId, candidateId, now = new Date().toISOString()) {
  const meta = await loadWorkMeta(root, workId);
  const loaded = await loadWorkKnowledge(root, meta);
  const candidate = requireCandidate(loaded.ledger, candidateId);
  await assertKnowledgeReviewAllowed(root, meta, candidate);
  if (candidate.status === 'rejected') throw new Error(`Candidate ${candidateId} was rejected and cannot be promoted.`);
  if (candidate.status === 'promoted') throw new Error(`Candidate ${candidateId} is already promoted to ${candidate.target}.`);
  if (candidate.kind !== 'decision' && await isSharedWorkspace(root)) return stageKnowledge(root, meta, loaded, candidate, now);
  if (candidate.status === 'staged') throw new Error(`Candidate ${candidateId} is staged for shared project memory; \`yallaflow shared integrate\` integrates it.`);

  let target;
  if (candidate.kind === 'decision') {
    target = await promoteDecision(root, workId, candidate, now);
  } else {
    const promoted = await promoteContext(root, workId, candidate, now);
    target = promoted.target;
    candidate.factId = promoted.factId;
  }
  candidate.status = 'promoted';
  candidate.promotedAt = now;
  candidate.target = target;
  updateReviewStatus(loaded.ledger, now);
  await writeKnowledgeLedger(root, workId, loaded.ledger);
  return { meta, candidate, target, ledger: loaded.ledger };
}

// Shared Project (v0.3.10): a reviewed context candidate becomes part of the work
// item's memory delta ('staged') instead of being written into canonical memory from
// whatever branch the work is on. On the integration branch it is integrated at once,
// through the one integration boundary; elsewhere it integrates after the work is
// merged. ADRs (decisions/ADR-<work>-<K>.md) are already branch-safe and are promoted
// directly.
async function stageKnowledge(root, meta, loaded, candidate, now) {
  const workId = meta.id;
  if (!CONTEXT_TARGETS[candidate.kind]) throw new Error(`No project-memory target exists for knowledge kind ${candidate.kind}.`);
  if (candidate.status === 'proposed') {
    const relation = candidate.relation;
    if (relation) {
      const evidence = await normalizeEvidenceRefs(root, candidate.evidence, { workId, verificationRuns: await listVerificationRuns(root, workId) });
      if (!hasResolvableEvidence(evidence)) {
        throw new Error(
          `Candidate ${candidate.id} ${relation.type} ${relation.factId} but cites no resolvable evidence. ` +
          'Knowledge evolution requires at least one existing repository path, runtime:<observation>, verification:V-###, or user:<confirmation> reference.'
        );
      }
      if (!relation.factFingerprint) {
        throw new Error(`Candidate ${candidate.id} was proposed before this project became shared, so a parallel change to ${relation.factId} cannot be ruled out. Reject it and propose it again against the current fact. Nothing was changed.`);
      }
      const { ledger } = await loadContextLedger(root);
      const fact = findFact(ledger, relation.factId);
      if (!fact || factFingerprint(fact) !== relation.factFingerprint) {
        throw new Error(
          `${relation.factId} changed after ${candidate.id} was proposed${fact?.state === 'superseded' ? ` (superseded by ${fact.supersededBy})` : ''}. ` +
          `Revalidate against the current fact: reject ${candidate.id} (yallaflow knowledge reject ${workId} --candidate ${candidate.id} --reason "...") and propose again. Nothing was changed.`
        );
      }
    }
    await stageCandidateDelta(root, meta, candidate, now);
    candidate.status = 'staged';
    candidate.stagedAt = now;
    updateReviewStatus(loaded.ledger, now);
    await writeKnowledgeLedger(root, workId, loaded.ledger);
  }
  const policy = await loadSharedPolicy(root);
  if (currentBranch(root) === policy.integrationBranch) {
    await integrateSharedMemory(root, { onlyWorkIds: [workId] });
    const reloaded = await loadWorkKnowledge(root, meta);
    const current = requireCandidate(reloaded.ledger, candidate.id);
    if (current.status === 'promoted') return { meta, candidate: current, target: current.target, ledger: reloaded.ledger, integrated: true };
    return { meta, candidate: current, target: CONTEXT_TARGETS[current.kind], ledger: reloaded.ledger, staged: true, blocked: true };
  }
  return { meta, candidate, target: CONTEXT_TARGETS[candidate.kind], ledger: loaded.ledger, staged: true };
}

// Context knowledge enters (or evolves) the canonical project-context ledger, whose
// single writer then re-renders the affected Markdown projection — the same path an
// approved Brownfield Baseline takes, so no durable document is ever written by two
// competing mechanisms. The candidate itself (this work item's historical record)
// keeps its original evidence strings and only records which CTX fact it produced or
// affected.
async function promoteContext(root, workId, candidate, now) {
  if (!CONTEXT_TARGETS[candidate.kind]) throw new Error(`No project-memory target exists for knowledge kind ${candidate.kind}.`);
  const evidence = await normalizeEvidenceRefs(root, candidate.evidence, {
    workId,
    verificationRuns: await listVerificationRuns(root, workId)
  });
  const relation = candidate.relation;
  if (relation && !hasResolvableEvidence(evidence)) {
    throw new Error(
      `Candidate ${candidate.id} ${relation.type} ${relation.factId} but cites no resolvable evidence. ` +
      'Knowledge evolution requires at least one existing repository path, runtime:<observation>, verification:V-###, or user:<confirmation> reference.'
    );
  }
  const origin = { workId, candidateId: candidate.id };
  // Retry after a partially completed promotion (ledger written, projection or
  // candidate update failed): never re-apply the transition; re-render and finish.
  const { ledger: existing } = await loadContextLedger(root);
  const already = appliedTransition(existing, origin);
  if (already) {
    if (!validateContextLedger(existing).length) await writeContextProjection(root, existing);
    return { target: CONTEXT_TARGETS[already.area], factId: already.id };
  }
  const factInput = {
    area: candidate.kind,
    summary: candidate.summary,
    confidence: candidate.confidence,
    provenance: candidate.provenance,
    evidence,
    origin
  };
  const { result: fact } = await mutateContextLedger(root, (ops) => {
    if (!relation) return ops.introduce(factInput);
    if (relation.type === 'supersedes') return ops.supersede(relation.factId, factInput).fact;
    if (relation.type === 'reconfirms') return ops.reconfirm(relation.factId, { evidence, confidence: candidate.confidence, origin }).fact;
    return ops.dispute(relation.factId, { summary: candidate.summary, evidence, origin }).fact;
  }, now);
  return { target: CONTEXT_TARGETS[fact.area], factId: fact.id };
}

async function promoteDecision(root, workId, candidate, now) {
  const relative = `decisions/ADR-${workId}-${candidate.id}.md`;
  const file = path.join(workspacePath(root), relative);
  const marker = knowledgeMarker(workId, candidate.id);
  if (await exists(file)) {
    const current = await readText(file);
    if (!current.includes(marker)) throw new Error(`Refusing to overwrite existing ADR at ${relative}.`);
    return relative;
  }
  await writeRedactedText(file, adrDocument(workId, candidate, now, marker));
  return relative;
}

function adrDocument(workId, candidate, now, marker) {
  const details = candidate.decisionDetails;
  const evidence = candidate.evidence.map((entry) => `- ${entry}`).join('\n');
  const ruling = details.sourceRuling ? `Source ruling: ${details.sourceRuling}\n` : '';
  return `# ${candidate.summary}\n\n${marker}\nStatus: Accepted\nDate: ${now}\nSource work: ${workId}\nKnowledge ID: ${candidate.id}\n${ruling}\n## Context\n\n${details.context}\n\n## Decision\n\n${details.decision}\n\n## Reason\n\n${details.reason}\n\n## Risks / Cost if wrong\n\n${details.costIfWrong}\n\n## Evidence\n\n${evidence}\n`;
}

function knowledgeMarker(workId, candidateId) {
  return `<!-- yallaflow-knowledge:${workId}:${candidateId} -->`;
}
