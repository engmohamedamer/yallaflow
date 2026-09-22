import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { findProjectRoot, loadWorkMetaOrThrow } from '../core/workspace.js';
import { approveBaseline, draftBaseline, feedbackBaseline, findBaselineWork, loadBaseline, startBaseline, summarizeBaseline } from '../baseline/store.js';

export async function baselineStartCommand() {
  const root = await findProjectRoot();
  if (!root) throw new Error('No .yallaflow workspace found. Run `yallaflow init` first.');
  const { meta, created } = await startBaseline(root);
  if (!created) {
    console.log(`${meta.id} — existing baseline work item (created earlier).`);
    console.log(`Run \`yallaflow baseline status ${meta.id}\` to see its current state.`);
    return;
  }
  console.log(`${meta.id} — Repository Baseline started (read-only).`);
  console.log('Next: complete repository discovery, then:');
  console.log(`  yallaflow checkpoint ${meta.id} --skill repository-baseline --complete --summary "..."`);
  console.log(`  yallaflow baseline draft ${meta.id} --file <baseline.json>`);
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
  console.log(`\nNext: yallaflow baseline approve ${workId} (or \`baseline feedback ${workId} --changes-requested\`).`);
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
  if (!hasBaseline) {
    console.log('Baseline draft: none yet.');
    return;
  }
  console.log(`Baseline status: ${ledger.status}`);
  const summary = summarizeBaseline(ledger);
  console.log(`Facts: ${summary.totalCount} total (${summary.byStatus.confirmed.length} confirmed, ${summary.byStatus.inferred.length} inferred, ${summary.byStatus.unresolved.length} unresolved)`);
  for (const [area, facts] of Object.entries(summary.byArea)) {
    if (facts.length) console.log(`  ${area}: ${facts.length}`);
  }
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
}

export async function baselineApproveCommand(requestedWorkId, input) {
  const root = await findProjectRoot();
  if (!root) throw new Error('No .yallaflow workspace found. Run `yallaflow init` first.');
  const workId = await resolveWorkId(root, requestedWorkId);
  const { ledger } = await approveBaseline(root, workId, input.note);
  console.log(`${workId} — baseline approved and promoted (${ledger.facts.length} fact(s) written to durable project docs).`);
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
