import { findProjectRoot, getCurrentState } from '../core/workspace.js';
import {
  loadWorkKnowledge,
  loadWorkMeta,
  proposeKnowledge,
  rejectKnowledge,
  reviewKnowledgeNone,
  summarizeKnowledge
} from '../knowledge/store.js';
import { promoteKnowledge } from '../knowledge/promotion.js';

export async function knowledgeCommand(action, requestedWorkId, options = {}) {
  const root = await findProjectRoot();
  if (!root) throw new Error('No .yallaflow workspace found. Run `yallaflow init` first.');
  const state = await getCurrentState(root);
  const workId = requestedWorkId ?? state.activeWork;
  if (!workId) throw new Error(`No active work item. Provide a work ID: \`yallaflow knowledge ${action} PF-0001 ...\`.`);

  if (action === 'propose') {
    const result = await proposeKnowledge(root, workId, options);
    console.log(`Proposed ${result.candidate.id} [${result.candidate.kind}]`);
    if (result.candidate.source) console.log(`Source: ${result.candidate.source}`);
    console.log(result.candidate.summary);
    console.log(`Review: ${result.ledger.reviewStatus}`);
    return;
  }
  if (action === 'list') {
    const meta = await loadWorkMeta(root, workId);
    const loaded = await loadWorkKnowledge(root, meta);
    const summary = summarizeKnowledge(loaded.ledger);
    console.log(`${workId} project knowledge`);
    console.log(`Policy: ${loaded.policy.label}`);
    console.log(`Review: ${summary.reviewStatus}`);
    if (!summary.totalCount) console.log('(no candidates)');
    for (const candidate of loaded.ledger.candidates) {
      console.log(`${candidate.id} [${candidate.status}] ${candidate.kind}${candidate.source ? ` / ${candidate.source}` : ''} — ${candidate.summary}`);
    }
    return;
  }
  if (action === 'promote') {
    const result = await promoteKnowledge(root, workId, options.candidateId);
    console.log(`Promoted ${result.candidate.id} to .yallaflow/${result.target}`);
    console.log(`Review: ${result.ledger.reviewStatus}`);
    return;
  }
  if (action === 'reject') {
    const result = await rejectKnowledge(root, workId, options.candidateId, options.reason);
    console.log(`Rejected ${result.candidate.id}: ${result.candidate.rejectionReason}`);
    console.log(`Review: ${result.ledger.reviewStatus}`);
    return;
  }
  if (action === 'review') {
    if (!options.none) throw new Error('Usage: yallaflow knowledge review [work-id] --none');
    const result = await reviewKnowledgeNone(root, workId);
    console.log(`${workId} project knowledge review: reviewed`);
    console.log('No durable project knowledge identified.');
    return;
  }
  throw new Error(`Unknown knowledge action: ${action}. Use propose, list, promote, reject, or review.`);
}
