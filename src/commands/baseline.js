import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { findProjectRoot, loadWorkMetaOrThrow } from '../core/workspace.js';
import { approveBaseline, baselineNextStep, draftBaseline, feedbackBaseline, findBaselineWork, loadBaseline, startBaseline, summarizeBaseline } from '../baseline/store.js';

export async function baselineStartCommand() {
  const root = await findProjectRoot();
  if (!root) throw new Error('No .yallaflow workspace found. Run `yallaflow init` first.');
  const { meta, created } = await startBaseline(root);
  if (!created) {
    console.log(`${meta.id} — existing baseline work item (created earlier).`);
    console.log(`Run \`yallaflow baseline status ${meta.id}\` to see its current state.`);
    return;
  }
  console.log(`${meta.id} — Repository Baseline started (read-only: no application code changes).`);
  console.log('Next: complete repository discovery (follow `yallaflow skill repository-baseline`), then:');
  console.log('  yallaflow inspect   (bounded repository inventory: manifests, framework hints, documentation candidates)');
  console.log(`  yallaflow intake add ${meta.id} <document>   (material documents; read extracted text with \`yallaflow source show SRC-#### --content\`)`);
  console.log(`  yallaflow checkpoint ${meta.id} --skill repository-baseline --complete --summary "..."`);
  console.log(`  yallaflow baseline draft ${meta.id} --file <baseline.json>`);
  console.log(`A human then reviews (yallaflow baseline show ${meta.id}) and approves (yallaflow baseline approve ${meta.id}).`);
}

async function readBaselineFile(filePath) {
  if (!filePath) throw new Error('Usage: yallaflow baseline draft <work-id> --file <baseline.json>');
  let raw;
  try {
    raw = await readFile(path.resolve(filePath), 'utf8');
  } catch {
    throw new Error(`Could not read baseline file: ${filePath}`);
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Baseline file is not valid JSON: ${filePath}`);
  }
}

export async function baselineDraftCommand(workId, input) {
  const root = await findProjectRoot();
  if (!root) throw new Error('No .yallaflow workspace found. Run `yallaflow init` first.');
  if (!workId) throw new Error('Usage: yallaflow baseline draft <work-id> --file <baseline.json>');
  const parsed = await readBaselineFile(input.file);
  const { ledger } = await draftBaseline(root, workId, parsed);
  console.log(`${workId} — baseline draft recorded: ${ledger.facts.length} fact(s).`);
  const summary = summarizeBaseline(ledger);
  for (const status of ['confirmed', 'inferred', 'unresolved']) {
    console.log(`${status}: ${summary.byStatus[status].length}`);
  }
  if (summary.limitations.length) console.log(`discovery limitations: ${summary.limitations.length} (work-scoped, never promoted)`);
  console.log(`\nNext: a human reviews the draft (yallaflow baseline show ${workId}) and approves it with \`yallaflow baseline approve ${workId}\` (or \`baseline feedback ${workId} --changes-requested\`). The Agent never approves a baseline.`);
}

async function resolveWorkId(root, requestedWorkId) {
  if (requestedWorkId) return requestedWorkId;
  const existing = await findBaselineWork(root);
  if (!existing) throw new Error('No baseline work item found. Run `yallaflow baseline start` first.');
  return existing.id;
}

export async function baselineStatusCommand(requestedWorkId) {
  const root = await findProjectRoot();
  if (!root) throw new Error('No .yallaflow workspace found. Run `yallaflow init` first.');
  const workId = await resolveWorkId(root, requestedWorkId);
  const meta = await loadWorkMetaOrThrow(root, workId);
  const { exists: hasBaseline, ledger } = await loadBaseline(root, workId);
  console.log(`${workId} — Repository Baseline`);
  console.log(`Work stage: ${meta.status}`);
  const step = await baselineNextStep(root, meta);
  if (!hasBaseline) {
    console.log('Baseline draft: none yet.');
    console.log(`Next: ${step.command}`);
    return;
  }
  console.log(`Baseline status: ${ledger.status}`);
  const summary = summarizeBaseline(ledger);
  console.log(`Facts: ${summary.totalCount} total (${summary.byStatus.confirmed.length} confirmed, ${summary.byStatus.inferred.length} inferred, ${summary.byStatus.unresolved.length} unresolved)`);
  for (const [area, facts] of Object.entries(summary.byArea)) {
    if (facts.length) console.log(`  ${area}: ${facts.length}`);
  }
  if (summary.limitations.length) console.log(`Discovery limitations: ${summary.limitations.length} (work-scoped, never promoted)`);
  if (step.state !== 'approved') console.log(`Next: ${step.command}`);
}

export async function baselineShowCommand(requestedWorkId) {
  const root = await findProjectRoot();
  if (!root) throw new Error('No .yallaflow workspace found. Run `yallaflow init` first.');
  const workId = await resolveWorkId(root, requestedWorkId);
  const { exists: hasBaseline, ledger } = await loadBaseline(root, workId);
  if (!hasBaseline) {
    console.log(`${workId}: no baseline draft yet.`);
    return;
  }
  console.log(`${workId} — baseline draft (${ledger.status})`);
  for (const fact of ledger.facts) {
    console.log(`\n${fact.id} [${fact.area}] ${fact.status} (${fact.source})`);
    console.log(`  ${fact.summary}`);
    if (fact.note) console.log(`  Note: ${fact.note}`);
    console.log(`  Evidence: ${fact.evidence.join(', ')}`);
  }
  const limitations = ledger.limitations ?? [];
  if (limitations.length) {
    console.log('\nDiscovery limitations (what this baseline could not inspect — work-scoped, never promoted as project facts):');
    for (const entry of limitations) console.log(`${entry.id} [${entry.type}] ${entry.area} — ${entry.summary} (reason: ${entry.reason})`);
  }
}

export async function baselineApproveCommand(requestedWorkId, input) {
  const root = await findProjectRoot();
  if (!root) throw new Error('No .yallaflow workspace found. Run `yallaflow init` first.');
  const workId = await resolveWorkId(root, requestedWorkId);
  const { ledger } = await approveBaseline(root, workId, input.note);
  console.log(`${workId} — baseline approved and promoted (${ledger.facts.length} fact(s) recorded in .yallaflow/context/index.yaml and projected into durable project docs).`);
  console.log(`${workId} status: DONE.`);
}

export async function baselineFeedbackCommand(requestedWorkId, input) {
  const root = await findProjectRoot();
  if (!root) throw new Error('No .yallaflow workspace found. Run `yallaflow init` first.');
  if (!input.changesRequested) throw new Error('yallaflow baseline feedback currently only supports --changes-requested.');
  const workId = await resolveWorkId(root, requestedWorkId);
  await feedbackBaseline(root, workId, input.note);
  console.log(`${workId} — baseline: changes requested.`);
  if (input.note) console.log(`Note: ${input.note}`);
}
