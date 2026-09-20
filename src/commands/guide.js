import path from 'node:path';
import { exists } from '../utils/fs.js';
import { buildBehaviorGuidance } from '../behavior/guidance.js';
import { findProjectRoot, getCurrentState, workspacePath } from '../core/workspace.js';
import { readYaml } from '../core/yaml.js';
import { loadWorkProgress } from '../core/progress.js';
import { isKnowledgeReviewRelevant, isKnowledgeReviewStage, loadWorkKnowledge, summarizeKnowledge } from '../knowledge/store.js';
import { evaluateReadiness } from '../behavior/readiness.js';
import { loadWorkQuestions } from '../questions/store.js';
import { formatSourceList } from '../intake/normalize.js';

export async function guideCommand(requestedWorkId) {
  const root = await findProjectRoot();
  if (!root) throw new Error('No .yallaflow workspace found. Run `yallaflow init` first.');
  const state = await getCurrentState(root);
  const workId = requestedWorkId ?? state.activeWork;
  if (!workId) throw new Error('No active work item. Provide a work ID: `yallaflow guide PF-0001`.');
  const metaFile = path.join(workspacePath(root), 'work', workId, 'meta.yaml');
  if (!await exists(metaFile)) throw new Error(`Work item ${workId} was not found.`);
  const meta = await readYaml(metaFile);
  if (meta.routingStatus === 'pending') {
    console.log(`${meta.id} — ${meta.rawRequest}`);
    if (meta.sources?.length) console.log(`\nSource:\n${formatSourceList(meta.sources)}`);
    console.log('\nRouting: pending');
    console.log(meta.sources?.length
      ? 'Next engineering objective: Review the source and classify work type and scope with `yallaflow route`.'
      : 'Next engineering objective: Classify work type and scope with `yallaflow route`.');
    return;
  }

  const stage = workId === state.activeWork ? state.stage : meta.status;
  const progress = await loadWorkProgress(root, meta);
  const result = buildBehaviorGuidance(meta, stage, progress.ledger);
  const questions = await loadWorkQuestions(root, meta);
  const readiness = evaluateReadiness(meta, progress, questions);
  const knowledge = await loadWorkKnowledge(root, meta);
  const knowledgeSummary = summarizeKnowledge(knowledge.ledger);
  const knowledgeRelevant = isKnowledgeReviewRelevant(meta, stage, knowledge, readiness);
  console.log(`${meta.id} — ${meta.title ?? `${capitalize(meta.type)} work`}`);
  if (meta.sources?.length) console.log(`\nSource: ${formatSourceList(meta.sources)}`);
  console.log(`\nType: ${meta.type}`);
  console.log(`Scope: ${meta.scope ?? meta.complexity ?? 'unspecified'}`);
  console.log(`Workflow: ${result.workflow}`);
  console.log(`Stage: ${result.stage ?? 'none'}`);
  printReopenContext(meta);
  console.log(`Delivery status: ${readiness.deliveryStatus ?? 'NOT_READY'}`);
  console.log(`\nBehavior contract: ${result.contract.label}`);
  if (result.progress.entries.length) {
    result.progress.entries.forEach((entry) => console.log(`${statusSymbol(entry.status)} ${entry.skillId}`));
  } else {
    console.log('(no skill contract available)');
  }
  console.log('\nCurrent guidance:');
  for (const line of result.guidance) console.log(`- ${line}`);
  if (knowledgeRelevant) {
    console.log('- Preserve only stable knowledge that will matter to future engineering work.');
    console.log(`\nProject knowledge review: ${knowledgeSummary.reviewStatus.toUpperCase()}`);
  }
  printOpenQuestions(readiness.questions);
  console.log(`\nApplication code modification: ${result.modification.authorized ? 'AUTHORIZED' : 'NOT AUTHORIZED'}`);
  console.log(`Reason: ${result.modification.reason}`);
  const atCompletionStage = isKnowledgeReviewStage(meta, stage);
  const nextObjective = readiness.questions.materialOpen.length && ['specification', 'implementation-planning'].includes(result.progress.current?.skillId)
    ? `Resolve ${readiness.questions.materialOpen.length} material open decision(s) before completing ${result.progress.current.skillId}.`
    : knowledgeRelevant && knowledgeSummary.reviewStatus === 'pending'
    ? 'Review completed work for durable project knowledge.'
    : atCompletionStage && knowledgeSummary.reviewStatus === 'reviewed'
      ? 'Advance the reviewed work to DONE.'
    : result.nextObjective;
  console.log(`\nNext engineering objective:\n${nextObjective}`);
}

function printOpenQuestions(summary) {
  if (!summary.open.length) return;
  console.log(`\nOpen decisions: ${summary.open.length} (${summary.materialOpen.length} material)`);
  for (const category of ['business', 'architecture']) {
    if (!summary.byCategory[category].length) continue;
    console.log(`${capitalize(category)}:`);
    for (const entry of summary.byCategory[category]) console.log(`- ${entry.id} ${entry.question}`);
  }
}

function capitalize(value) {
  return `${value[0].toUpperCase()}${value.slice(1)}`;
}

function statusSymbol(status) {
  return { completed: '✓', in_progress: '→', pending: '○', blocked: '!' }[status] ?? '?';
}

function printReopenContext(meta) {
  const lastReopen = [...(meta.lifecycleHistory ?? [])].reverse().find((entry) => entry.action === 'reopen');
  if (!lastReopen || meta.status === 'DONE') return;
  const priorCompletion = meta.completionHistory?.at(-1);
  console.log('Status: reopened');
  if (priorCompletion) console.log(`Previous completion: DONE at ${priorCompletion.completedAt}`);
  console.log(`Reopened: ${lastReopen.changedAt}`);
  console.log(`Reopen reason: ${lastReopen.reason}`);
}
