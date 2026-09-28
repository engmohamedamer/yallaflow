import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { findProjectRoot } from '../core/workspace.js';
import {
  applyReconciliation,
  approveReconciliation,
  feedbackReconciliation,
  previewReconciliation,
  reconciliationStatus,
  recordDecisions,
  startReconciliation
} from '../reconciliation/store.js';
import { RECONCILIATION_SKILL } from '../reconciliation/constants.js';

async function requireRoot() {
  const root = await findProjectRoot();
  if (!root) throw new Error('No .yallaflow workspace found. Run `yallaflow init` first.');
  return root;
}

const origin = (candidate) => `${candidate.origin.workId} ${candidate.origin.baselineFactId ?? candidate.origin.candidateId}`;
const decisionText = (decision) => {
  if (!decision) return 'PENDING';
  const target = decision.target ? ` ${decision.target}` : '';
  const extra = decision.limitationType ? ` (${decision.limitationType})` : '';
  return `${decision.action.toUpperCase()}${target}${extra}`;
};

export async function reconcileStartCommand() {
  const root = await requireRoot();
  const result = await startReconciliation(root);
  const { meta, plan } = result;
  if (!result.created) {
    console.log(`${meta.id} — existing legacy-context reconciliation (in progress).`);
    console.log(`Run \`yallaflow context reconcile status ${meta.id}\` to see where it stands.`);
    return;
  }
  const duplicates = plan.candidates.filter((candidate) => candidate.exactDuplicateOf).length;
  const same = plan.candidates.filter((candidate) => candidate.sameStatementAs).length;
  console.log(`${meta.id} — Legacy Context Reconciliation started (read-only).`);
  console.log(`${plan.candidates.length} legacy candidate(s): RC-0001 … ${plan.candidates.at(-1).id}. Historical work items are not modified.`);
  if (duplicates) console.log(`${duplicates} exact duplicate(s) flagged (same area, normalized text, and evidence) — each still needs an explicit decision.`);
  if (same) console.log(`${same} candidate(s) word-for-word identical to an existing CTX fact (flagged sameStatementAs).`);
  if (!result.becameActive) console.log(`Workspace focus remains ${result.previousActive}; reconciliation commands find ${meta.id} automatically.`);
  console.log('\nNext (Agent):');
  console.log(`  yallaflow skill ${RECONCILIATION_SKILL}`);
  console.log(`  yallaflow context reconcile show ${meta.id}`);
  console.log(`  yallaflow context reconcile plan ${meta.id} --file <decisions.json>`);
}

export async function reconcileStatusCommand(workId) {
  const root = await requireRoot();
  const status = await reconciliationStatus(root, workId);
  const { meta, plan, counts } = status;
  console.log(`${meta.id} — Legacy Context Reconciliation (${meta.status}${plan.status === 'applied' ? ', fully applied' : ''})`);
  console.log(`Candidates: ${counts.total} · decided ${counts.decided} · applied ${counts.applied} · pending ${counts.pending}`);
  const actions = Object.entries(counts.byAction).filter(([, count]) => count).map(([action, count]) => `${action} ${count}`);
  if (actions.length) console.log(`Decisions: ${actions.join(' · ')}`);
  console.log(`Review: ${status.review}`);
  if (status.problems.length) {
    console.log('\nProblems (revise the plan):');
    for (const entry of status.problems) console.log(`- ${entry}`);
  }
  if (status.questions.length) {
    console.log('\nOpen reconciliation questions:');
    for (const question of status.questions) console.log(`- ${question.id} [${question.status}] ${question.question}`);
  }
  const pending = plan.candidates.filter((candidate) => !candidate.decision);
  if (pending.length) {
    console.log(`\nPending candidates (${pending.length}):`);
    for (const candidate of pending.slice(0, 10)) console.log(`- ${candidate.id} [${candidate.area}] ${origin(candidate)} — ${candidate.summary}`);
    if (pending.length > 10) console.log(`- … ${pending.length - 10} more (yallaflow context reconcile show ${meta.id})`);
  }
  const kept = plan.candidates.filter((candidate) => candidate.applied?.markdown === 'left-in-place');
  if (kept.length) console.log(`\nHand-edited legacy sections kept for manual review: ${kept.map((candidate) => `${candidate.id} (${candidate.legacySection.file})`).join(', ')}`);
  console.log(`\nBlockers: ${status.blockers.length ? status.blockers.join('; ') : 'none'}`);
  console.log(`Next: ${status.nextAction}`);
}

export async function reconcileShowCommand(workId, { candidate: candidateId } = {}) {
  const root = await requireRoot();
  const { meta, plan } = await reconciliationStatus(root, workId);
  const candidates = candidateId ? plan.candidates.filter((candidate) => candidate.id === candidateId) : plan.candidates;
  if (candidateId && !candidates.length) throw new Error(`Reconciliation candidate ${candidateId} was not found in ${meta.id}.`);
  console.log(`${meta.id} — reconciliation candidates (${plan.source})`);
  for (const candidate of candidates) {
    console.log(`\n${candidate.id} [${candidate.area}] ${candidate.confidence} — ${decisionText(candidate.decision)}${candidate.applied ? ` · applied${candidate.applied.factId ? ` → ${candidate.applied.factId}` : ''}` : ''}`);
    console.log(`  ${candidate.summary}`);
    console.log(`  Origin: ${origin(candidate)} (${candidate.kind === 'baseline' ? 'approved baseline fact' : 'promoted knowledge'}${candidate.workTitle ? ` — ${candidate.workTitle}` : ''}${candidate.recordedAt ? `, recorded ${candidate.recordedAt}` : ''})`);
    if (candidate.provenance) console.log(`  Provenance: ${candidate.provenance}`);
    console.log(`  Evidence: ${candidate.evidence.join(', ')}`);
    if (candidate.note) console.log(`  Note: ${candidate.note}`);
    if (candidate.legacySection?.file) console.log(`  Legacy section: ${candidate.legacySection.file} ${candidate.legacySection.marker}`);
    if (candidate.exactDuplicateOf) console.log(`  Exact duplicate of ${candidate.exactDuplicateOf} (same area, normalized text, and evidence)`);
    if (candidate.sameStatementAs) console.log(`  Same wording as current fact ${candidate.sameStatementAs} (textual identity only — not a semantic judgement)`);
    if (candidate.decision?.summary) console.log(`  Canonical summary: ${candidate.decision.summary}`);
    if (candidate.decision?.area) console.log(`  Canonical area: ${candidate.decision.area}`);
    if (candidate.decision?.reason) console.log(`  Reason: ${candidate.decision.reason}`);
  }
}

export async function reconcilePlanCommand(workId, { file } = {}) {
  const root = await requireRoot();
  if (!file) throw new Error('Usage: yallaflow context reconcile plan [work-id] --file <decisions.json>');
  let raw;
  try {
    raw = await readFile(path.resolve(file), 'utf8');
  } catch {
    throw new Error(`Could not read decisions file: ${file}`);
  }
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    throw new Error(`Decisions file is not valid JSON: ${file}`);
  }
  const result = await recordDecisions(root, workId, input);
  if (!result.changed) {
    console.log(`${result.meta.id} — decisions unchanged; nothing recorded.`);
    return;
  }
  const status = await reconciliationStatus(root, result.meta.id);
  console.log(`${result.meta.id} — reconciliation decisions recorded (${status.counts.decided}/${status.counts.total} decided, ${status.counts.pending} pending).`);
  if (result.invalidatedApproval) console.log('The previous approval no longer covers this plan; it is awaiting review again.');
  console.log(`Next: yallaflow context reconcile preview ${result.meta.id}`);
}

export async function reconcilePreviewCommand(workId) {
  const root = await requireRoot();
  const preview = await previewReconciliation(root, workId);
  const { meta, counts, simulated } = preview;
  console.log(`${meta.id} — Reconciliation preview (read-only; nothing is changed)`);
  console.log(`\n${counts.total} legacy candidate(s) · ${counts.applied} already applied · ${counts.decided - counts.applied} to apply · ${counts.pending} pending`);
  console.log(`Review: ${preview.review}`);
  if (preview.problems.length) {
    console.log('\nThe plan cannot be applied as it stands:');
    for (const entry of preview.problems) console.log(`- ${entry}`);
    process.exitCode = 1;
    return;
  }
  const members = [...simulated.groups.flatMap((group) => group.members), ...simulated.attachments.map(({ candidate }) => candidate)];
  const mergedCount = members.filter((candidate) => candidate.decision.action === 'merge-with').length;
  const reconfirmCount = members.length - mergedCount;
  console.log('\nResult:');
  console.log(`  ${simulated.after} canonical current fact(s) (${simulated.before} before)`);
  console.log(`  ${simulated.groups.length} new fact(s) · ${mergedCount} merged (candidates collapsed into one fact) · ${reconfirmCount} reconfirmation(s) (${simulated.attachments.length} candidate(s) joining existing facts)`);
  console.log(`  ${simulated.groups.filter((group) => group.target).length} supersession(s) · ${simulated.disputes.length} dispute(s) · ${simulated.limitations.length} limitation(s) · ${simulated.skips.length} skipped · ${counts.pending} pending`);
  if (simulated.areas.length) {
    console.log('\nAreas (current facts after apply):');
    const width = Math.max(...simulated.areas.map((entry) => entry.label.length));
    for (const entry of simulated.areas) console.log(`  ${entry.label.padEnd(width)}  ${entry.current}`);
  }
  if (simulated.groups.length) {
    console.log('\nNew canonical facts:');
    for (const group of simulated.groups) {
      const ids = [group.root.id, ...group.members.map((candidate) => `${candidate.id} (${candidate.decision.action})`)].join(' + ');
      const relation = group.target ? ` (supersedes ${group.target.ctx ?? group.target.rc})` : '';
      console.log(`  ${ids} → ${group.factId}${relation} [${group.input.area}] ${group.input.summary}`);
      if (group.members.length) console.log(`    origins: ${[group.root, ...group.members].map(origin).join(', ')}`);
    }
  }
  if (simulated.attachments.length) {
    console.log('\nJoining existing facts (provenance added; evidence and verification unchanged):');
    for (const { candidate, factId } of simulated.attachments) {
      const via = candidate.decision.target === factId ? '' : ` → ${factId}`;
      console.log(`  ${candidate.id} ${candidate.decision.action} ${candidate.decision.target}${via} (${origin(candidate)})`);
    }
  }
  if (simulated.disputes.length) {
    console.log('\nDisputes (target marked DISPUTED, not overwritten):');
    for (const candidate of simulated.disputes) console.log(`  ${candidate.id} disputes ${candidate.decision.target} — ${candidate.summary}`);
  }
  if (simulated.limitations.length) {
    console.log('\nLimitations (work-scoped, never project memory):');
    for (const candidate of simulated.limitations) console.log(`  ${candidate.id} [${candidate.decision.limitationType}] ${candidate.summary}`);
  }
  if (simulated.skips.length) {
    console.log('\nSkipped (not migrated):');
    for (const candidate of simulated.skips) console.log(`  ${candidate.id} — ${candidate.decision.reason}`);
  }
  const pending = preview.plan.candidates.filter((candidate) => !candidate.decision);
  if (pending.length) {
    console.log('\nPending (unchanged by this apply; their legacy sections stay):');
    for (const candidate of pending) console.log(`  ${candidate.id} [${candidate.area}] ${candidate.summary}`);
  }
  if (simulated.markdown.retire.length || simulated.markdown.keep.length) {
    console.log(`\nLegacy Markdown: ${simulated.markdown.retire.length} section(s) retired (archived verbatim with ${meta.id}) · ${simulated.markdown.keep.length} hand-edited section(s) kept for manual review`);
    for (const entry of simulated.markdown.keep) console.log(`  kept: ${entry.file} ${entry.marker} (${entry.candidate})`);
  }
}

export async function reconcileApproveCommand(workId, { note } = {}) {
  const root = await requireRoot();
  const result = await approveReconciliation(root, workId, note);
  console.log(result.unchanged
    ? `${result.meta.id} — reconciliation plan already approved; nothing changed.`
    : `${result.meta.id} — reconciliation plan approved (${result.plan.approval.hash.slice(0, 19)}…).`);
  console.log(`Next: yallaflow context reconcile apply ${result.meta.id}`);
}

export async function reconcileFeedbackCommand(workId, { changesRequested, note } = {}) {
  const root = await requireRoot();
  if (!changesRequested) throw new Error('yallaflow context reconcile feedback currently only supports --changes-requested.');
  const { meta } = await feedbackReconciliation(root, workId, note);
  console.log(`${meta.id} — reconciliation: changes requested.`);
  if (note) console.log(`Note: ${note}`);
}

export async function reconcileApplyCommand(workId) {
  const root = await requireRoot();
  const result = await applyReconciliation(root, workId);
  if (!result.newlyApplied.length) {
    console.log(`${result.meta.id} — nothing new to apply: every decided candidate is already applied (Markdown projection re-checked).`);
    return;
  }
  const facts =[...new Set(result.newlyApplied.map((candidate) => candidate.applied.factId).filter(Boolean))];
  console.log(`${result.meta.id} — reconciliation applied: ${result.newlyApplied.length} candidate(s)${facts.length ? ` → ${facts.join(', ')}` : ''}.`);
  console.log(`Legacy sections retired: ${result.archived} (archived verbatim in .yallaflow/work/${result.meta.id}/legacy-context.md)`);
  if (result.leftInPlace.length) {
    console.log('Hand-edited legacy sections kept in place (review and remove manually):');
    for (const entry of result.leftInPlace) console.log(`  ${entry.file}: ${entry.marker} (${entry.candidate})`);
  }
  console.log(result.completed
    ? `All candidates reconciled; ${result.meta.id} is DONE. Reconciled facts have UNKNOWN freshness until reconfirmed with fresh evidence.`
    : `${result.plan.candidates.filter((candidate) => !candidate.applied).length} candidate(s) still pending; decide them, then review and apply again.`);
}
