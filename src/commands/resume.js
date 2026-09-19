import path from 'node:path';
import { findProjectRoot, getCurrentState, workspacePath } from '../core/workspace.js';
import { readYaml } from '../core/yaml.js';
import { loadWorkProgress } from '../core/progress.js';
import { buildBehaviorGuidance } from '../behavior/guidance.js';
import { latestVerification } from '../core/evidence.js';
import { discoverGitState } from '../core/git.js';
import { isKnowledgeReviewRelevant, isKnowledgeReviewStage, loadWorkKnowledge, summarizeKnowledge } from '../knowledge/store.js';
import { evaluateReadiness } from '../behavior/readiness.js';
import { loadWorkQuestions } from '../questions/store.js';
import { formatSourceList } from '../intake/normalize.js';

export async function resumeCommand() {
  const root = await findProjectRoot();
  if (!root) throw new Error('No .yallaflow workspace found. Run `yallaflow init` first.');
  const state = await getCurrentState(root);
  if (!state.activeWork) {
    console.log('No active work item. Run `yallaflow start` or create one with `yallaflow feature`, `yallaflow bug`, or `yallaflow investigate`.');
    return;
  }
  const meta = await readYaml(path.join(workspacePath(root), 'work', state.activeWork, 'meta.yaml'));
  if (meta.routingStatus === 'pending') {
    console.log(meta.id);
    console.log('Routing: pending');
    if (meta.sources?.length) console.log(`Source: ${formatSourceList(meta.sources)}`);
    else console.log(`Raw request: ${meta.rawRequest}`);
    console.log(meta.sources?.length
      ? 'Next: review the source and classify work type and scope with `yallaflow route`.'
      : 'Next: classify work type and scope with `yallaflow route`.');
    return;
  }
  const progress = await loadWorkProgress(root, meta);
  const guidance = buildBehaviorGuidance(meta, state.stage, progress.ledger);
  const questions = await loadWorkQuestions(root, meta);
  const readiness = evaluateReadiness(meta, progress, questions);
  const verification = await latestVerification(root, meta.id);
  const git = discoverGitState(root);
  const knowledge = await loadWorkKnowledge(root, meta);
  const knowledgeSummary = summarizeKnowledge(knowledge.ledger);
  const knowledgeRelevant = isKnowledgeReviewRelevant(meta, state.stage, knowledge, readiness);

  console.log(`${meta.id} — ${meta.title ?? `${capitalize(meta.type)} work`}`);
  if (meta.sources?.length) console.log(`Source: ${formatSourceList(meta.sources)}`);
  console.log(`Type: ${meta.type}`);
  console.log(`Scope: ${meta.scope ?? meta.complexity ?? 'unspecified'}`);
  if (meta.routingStatus === 'routed') {
    console.log(`Routing confidence: ${meta.routingConfidence}`);
    console.log(`Behavior contract: ${progress.contract.label}`);
  }
  console.log(`Workflow: ${meta.workflow ?? meta.type}`);
  console.log(`Stage: ${state.stage}`);
  console.log(`Delivery status: ${readiness.deliveryStatus ?? 'NOT_READY'}`);
  printProgress(guidance.progress);
  if (guidance.progress.current?.summary) console.log(`\nCurrent finding: ${guidance.progress.current.summary}`);
  console.log(`\nVerification: ${verification ? (verification.success ? 'passed' : 'failed') : 'not recorded'}`);
  if (knowledgeRelevant) printKnowledge(knowledgeSummary);
  printOpenQuestions(readiness.questions);
  console.log(`Git: ${git.summary}`);
  const atCompletionStage = isKnowledgeReviewStage(meta, state.stage);
  const nextObjective = readiness.questions.materialOpen.length && ['specification', 'implementation-planning'].includes(guidance.progress.current?.skillId)
    ? `Resolve ${readiness.questions.materialOpen.length} material open decision(s) before completing ${guidance.progress.current.skillId}.`
    : knowledgeRelevant && knowledgeSummary.reviewStatus === 'pending'
    ? 'Review completed work for durable project knowledge.'
    : atCompletionStage && knowledgeSummary.reviewStatus === 'reviewed'
      ? 'Advance the reviewed work to DONE.'
    : guidance.nextObjective;
  console.log(`\nNext engineering objective:\n${nextObjective}`);
  console.log(`\nApplication code modification: ${guidance.modification.authorized ? 'AUTHORIZED' : 'NOT AUTHORIZED'}`);
  console.log(`Reason: ${guidance.modification.reason}`);
  console.log(`\nRead: .yallaflow/work/${meta.id}/work.md, progress.md, and progress.yaml when present before taking action.`);
  console.log('Do not repeat completed discovery recorded in the ledger; trust durable evidence and git history over conversation memory.');
}

function printOpenQuestions(summary) {
  if (!summary.open.length) return;
  console.log(`\nOpen decisions: ${summary.open.length} (${summary.materialOpen.length} material)`);
  for (const category of ['business', 'architecture']) {
    if (!summary.byCategory[category].length) continue;
    console.log(`${capitalize(category)}:`);
    for (const entry of summary.byCategory[category]) console.log(`- ${entry.id} [${entry.status}] ${entry.question}`);
  }
}

function capitalize(value) {
  return `${value[0].toUpperCase()}${value.slice(1)}`;
}

function printKnowledge(summary) {
  if (summary.reviewStatus === 'pending') {
    console.log('\nProject knowledge review: PENDING');
    if (summary.proposed.length) console.log(`Proposed candidates: ${summary.proposed.length}`);
    return;
  }
  console.log('\nProject knowledge: ✓ reviewed');
  console.log(`${summary.promoted.length} candidate${summary.promoted.length === 1 ? '' : 's'} promoted`);
  console.log(`${summary.rejected.length} rejected`);
}

function printProgress(progress) {
  if (!progress.entries.length) return;
  const groups = [
    ['Completed', progress.completed, '✓'],
    ['In progress', progress.inProgress, '→'],
    ['Blocked', progress.blocked, '!'],
    ['Pending', progress.pending, '○']
  ];
  for (const [label, entries, symbol] of groups) {
    if (!entries.length) continue;
    console.log(`\n${label}:`);
    for (const entry of entries) console.log(`${symbol} ${entry.skillId}${entry.summary ? ` — ${entry.summary}` : ''}`);
  }
}
