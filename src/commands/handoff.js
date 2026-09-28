import path from 'node:path';
import { exists } from '../utils/fs.js';
import { findProjectRoot, getCurrentState, workspacePath } from '../core/workspace.js';
import { readYaml } from '../core/yaml.js';
import { loadWorkProgress } from '../core/progress.js';
import { buildBehaviorGuidance } from '../behavior/guidance.js';
import { evaluateReadiness } from '../behavior/readiness.js';
import { loadWorkQuestions } from '../questions/store.js';
import { latestVerification } from '../core/evidence.js';
import { discoverGitState } from '../core/git.js';
import { loadWorkKnowledge, summarizeKnowledge } from '../knowledge/store.js';
import { loadReviews } from '../reviews/store.js';
import { GATE_NAMES } from '../behavior/interaction.js';
import { childProgressView, loadDecomposition, loadDecompositionTraceability, readyChildren } from '../decomposition/store.js';
import { formatSourceList } from '../intake/normalize.js';
import { resolvePrimaryObjective } from '../behavior/objective.js';
import { projectContextLines } from '../context/summary.js';
import { loadWorkLimitations } from '../limitations/store.js';
import { describeWorkSourceLocations } from '../core/sources.js';
import { reconciliationSummaryLines } from '../reconciliation/store.js';
import { loadDeliverySummary } from '../delivery/summary.js';

// Read-only by construction: every call below is a loader (loadWorkProgress,
// evaluateReadiness, discoverGitState, ...), never a mutator — the same shared
// resolvers `guide`/`resume` already use, just assembled into one compact report for
// a new agent/session that has no access to the previous one's chat history.
export async function handoffCommand(requestedWorkId) {
  const root = await findProjectRoot();
  if (!root) throw new Error('No .yallaflow workspace found. Run `yallaflow init` first.');
  const state = await getCurrentState(root);
  const workId = requestedWorkId ?? state.activeWork;
  if (!workId) throw new Error('No active work item. Provide a work ID: `yallaflow handoff PF-0001`.');
  const metaFile = path.join(workspacePath(root), 'work', workId, 'meta.yaml');
  if (!await exists(metaFile)) throw new Error(`Work item ${workId} was not found.`);
  const meta = await readYaml(metaFile);
  const isActive = workId === state.activeWork;
  const stage = isActive ? (state.stage ?? meta.status) : meta.status;

  console.log(`${meta.id} — ${meta.title ?? `${meta.type ?? 'work'} item`}`);
  if (meta.parent) console.log(`Parent: ${meta.parent}`);
  if (meta.sources?.length) console.log(`Source: ${formatSourceList(meta.sources)}`);
  if (meta.routingStatus === 'pending') {
    console.log('Routing: pending');
    console.log(`Raw request: ${meta.rawRequest}`);
    console.log('\nNext objective:\nClassify work type and scope with `yallaflow route`, then re-run handoff.');
    return;
  }

  console.log(`Type: ${meta.type} / Scope: ${meta.scope ?? 'unspecified'}`);
  console.log(`Workflow: ${meta.workflow ?? meta.type}`);
  console.log(`Stage: ${stage}`);
  if (!isActive) console.log(`(read-only inspection; active work remains ${state.activeWork ?? 'none'})`);
  if (meta.status === 'DONE') {
    console.log(`\n${meta.id} DONE. This is one work item, not necessarily the whole project — see Parent below if this has one.`);
  }

  const progress = await loadWorkProgress(root, meta);
  const delivery = await loadDeliverySummary(root, meta);
  const guidance = buildBehaviorGuidance(meta, stage, progress.ledger, delivery);
  const questions = await loadWorkQuestions(root, meta);
  const readiness = evaluateReadiness(meta, progress, questions);
  const verification = await latestVerification(root, meta.id);
  const knowledge = await loadWorkKnowledge(root, meta);
  const git = discoverGitState(root);
  const { ledger: reviewLedger } = await loadReviews(root, workId);

  const reconciliation = meta.reconciliation ? await reconciliationSummaryLines(root, meta) : null;
  const primaryObjective = reconciliation && meta.status !== 'DONE'
    ? 'Reconcile legacy project context.'
    : delivery.pendingImpact
      ? guidance.nextObjective
      : resolvePrimaryObjective(meta, progress.ledger, guidance.modification);
  if (primaryObjective) console.log(`\nPRIMARY UNRESOLVED OBJECTIVE:\n${primaryObjective}`);
  if (reconciliation) {
    console.log('\nReconciliation:');
    for (const line of reconciliation.lines) console.log(line);
  }

  console.log(`\nDelivery status: ${readiness.deliveryStatus ?? 'NOT_READY'}`);
  printChecklist('Completed skills', progress ? guidance.progress.completed : []);
  printChecklist('Pending skills', guidance.progress.pending);
  if (guidance.progress.blocked.length) printChecklist('Blocked skills', guidance.progress.blocked);
  console.log(`Current/incomplete skill: ${guidance.progress.current?.skillId ?? 'none'}`);

  const blockers = [];
  if (questions.exists || readiness.questions.open.length) {
    const openQuestions = readiness.questions;
    if (openQuestions.open.length) blockers.push(`${openQuestions.open.length} open question(s) (${openQuestions.materialOpen.length} material)`);
  }
  const awaitingReview = GATE_NAMES.filter((name) => reviewLedger.gates[name]?.status && reviewLedger.gates[name].status !== 'approved');
  if (awaitingReview.length) blockers.push(`review gate(s) not approved: ${awaitingReview.map((name) => `${name} (${reviewLedger.gates[name].status})`).join(', ')}`);
  if (delivery.pendingImpact) blockers.push(`impact ${delivery.pendingImpact.id} pending assessment`);
  if (reconciliation) blockers.push(...reconciliation.status.blockers.filter((entry) => !entry.startsWith('review ') && !entry.includes('open reconciliation question')));
  console.log(`\nBlockers: ${blockers.length ? blockers.join('; ') : 'none'}`);
  printOpenQuestions(readiness.questions);
  if (awaitingReview.length) {
    console.log('\nReview gates awaiting approval:');
    for (const name of awaitingReview) console.log(`- ${name}: ${reviewLedger.gates[name].status}`);
  }

  console.log(`\nVerification: ${verification ? (verification.success ? 'passed' : 'failed') : 'not recorded'}${verification ? ` (${verification.id}, ${verification.verifiedAt})` : ''}`);
  if (delivery.lines.length) console.log(delivery.lines.join('\n'));
  const knowledgeSummary = summarizeKnowledge(knowledge.ledger);
  console.log(`Knowledge review: ${knowledgeSummary.reviewStatus}`);
  await printProjectMemory(root, meta, knowledge.ledger);
  console.log(`\nGit: ${git.summary}`);

  console.log(`\nApplication code modification: ${guidance.modification.authorized ? 'AUTHORIZED' : 'NOT AUTHORIZED'}`);
  console.log(`Reason: ${guidance.modification.reason}`);
  console.log(`\nNext objective:\n${reconciliation ? reconciliation.status.nextAction : guidance.nextObjective}`);

  if (git.available && !git.clean) {
    console.log(`\n${meta.id} has uncommitted Git changes (${git.summary}). Consider a source-control checkpoint before continuing; YallaFlow never commits automatically.`);
  }

  const { exists: hasDecomposition, ledger: decomposition } = await loadDecomposition(root, workId);
  if (hasDecomposition) {
    const view = await childProgressView(root, decomposition);
    const required = view.filter((child) => child.required !== false);
    const doneCount = required.filter((child) => child.state === 'done').length;
    console.log(meta.status === 'DONE'
      ? `\n--- Decomposition (${decomposition.status}) --- Project ${meta.id} is DONE (${doneCount}/${required.length} required children complete).`
      : `\n--- Decomposition (${decomposition.status}) --- Project NOT complete: ${doneCount}/${required.length} required children DONE.`);
    const grouped = { done: [], active: [], blocked: [], ready: [], not_created: [] };
    for (const child of view) grouped[child.state].push(child);
    console.log(`DONE: ${grouped.done.length} | active: ${grouped.active.length} | blocked: ${grouped.blocked.length} | ready: ${grouped.ready.length}`);
    for (const child of grouped.blocked) console.log(`⊘ ${child.workId ?? child.key} — blocked by ${child.blockedBy.join(', ')}`);
    const ready = readyChildren(view);
    console.log(`Next executable candidates: ${ready.length ? ready.map((child) => child.workId).join(', ') : 'none'}`);
    const coverage = await loadDecompositionTraceability(root, workId, decomposition);
    const unassigned = [
      ...(coverage.requirements.unassigned ?? []),
      ...(coverage.acceptanceCriteria.unassigned ?? [])
    ];
    console.log(`Unresolved traceability gaps: ${unassigned.length ? unassigned.join(', ') : 'none declared'}`);
  }

  console.log(`\nRead: .yallaflow/work/${meta.id}/work.md, progress.md, and progress.yaml when present before taking action.`);
  console.log('Durable YallaFlow state + the git working tree + verification evidence are authoritative; prior chat history is not.');
}

function printChecklist(label, entries) {
  if (!entries?.length) return;
  console.log(`${label}: ${entries.map((entry) => entry.skillId).join(', ')}`);
}

function printOpenQuestions(summary) {
  if (!summary.open.length) return;
  console.log(`\nOpen decisions: ${summary.open.length} (${summary.materialOpen.length} material)`);
  for (const entry of summary.open) console.log(`- ${entry.id} [${entry.status}] ${entry.question}`);
}

// Relevant project-memory integrity (stale/disputed facts, facts this work relates to)
// plus this work item's own discovery limitations — never the whole ledger.
async function printProjectMemory(root, meta, knowledgeLedger) {
  if (meta.sources?.length) {
    console.log('\nSources (original user/project inputs, immutable — open these rather than relying on prior conversation):');
    for (const line of await describeWorkSourceLocations(root, meta.sources)) console.log(`- ${line}`);
  }
  const lines = await projectContextLines(root, knowledgeLedger);
  if (lines.length) {
    console.log('\nRelevant project context:');
    for (const line of lines) console.log(line);
  }
  const { ledger } = await loadWorkLimitations(root, meta.id);
  if (ledger.limitations.length) {
    console.log(`\nDiscovery limitations (${meta.id}, work-scoped — not project facts):`);
    for (const entry of ledger.limitations) console.log(`- ${entry.id} [${entry.type}] ${entry.area} — ${entry.summary}`);
  }
}
