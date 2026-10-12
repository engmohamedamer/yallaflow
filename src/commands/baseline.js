import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { findProjectRoot, loadWorkMetaOrThrow } from '../core/workspace.js';
import { describePurpose, loadWorkPurpose, setWorkPurpose } from '../purpose/store.js';
import { CORE_COVERAGE } from '../baseline/constants.js';
import { inventoryRepository } from '../inventory/inventory.js';
import { gitWorkingTreeStates } from '../core/git.js';
import { WORKING_TREE_LABELS } from '../context/evidence.js';
import { shellQuote } from '../security/redact.js';
import { approveBaseline, baselineNextStep, draftBaseline, feedbackBaseline, findBaselineWork, loadBaseline, pendingOriginalRequest, repositoryPathOf, startBaseline, summarizeBaseline, summarizeCoverage } from '../baseline/store.js';

// `purpose` (v0.3.10, optional): what the understanding is for — a discovery lens on
// top of the canonical core baseline, stored as work intent (purpose.yaml), never as a
// project fact.
export async function baselineStartCommand(purpose) {
  const root = await findProjectRoot();
  if (!root) throw new Error('No .yallaflow workspace found. Run `yallaflow init` first.');
  const { meta, created } = await startBaseline(root);
  if (purpose) await setWorkPurpose(root, meta.id, { ...purpose, mode: 'bootstrap' });
  const lens = describePurpose(await loadWorkPurpose(root, meta.id));
  if (!created) {
    console.log(`${meta.id} — existing baseline work item (created earlier).`);
    if (lens) console.log(`Discovery lens: ${lens}`);
    console.log(`Run \`yallaflow baseline status ${meta.id}\` to see its current state.`);
    return;
  }
  console.log(`${meta.id} — Repository Baseline started (read-only: no application code changes).`);
  if (lens) console.log(`Discovery lens: ${lens} (work intent — never promoted as project truth)`);
  console.log(`Canonical core coverage: ${CORE_COVERAGE.join(', ')} — plus extra depth where the discovery lens points.`);
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
  printCoverage(await summarizeCoverage(root, ledger), await inventoryTotals(root), { brief: true });
  console.log(`\nNext: present the draft to the developer (yallaflow baseline show ${workId}) and ask them to review it. Only after they explicitly approve, record it: \`yallaflow baseline approve ${workId} --note "<their approval>"\` (changes: \`baseline feedback ${workId} --changes-requested\`). The Agent never approves on its own judgment.`);
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
  printCoverage(await summarizeCoverage(root, ledger), await inventoryTotals(root), { brief: true });
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
  const coverage = await summarizeCoverage(root, ledger);
  // Working-tree provenance of the cited files, observed now (provenance only — the
  // recorded content hash decides freshness after approval).
  const states = gitWorkingTreeStates(root, coverage.citedPaths) ?? new Map();
  const describe = (ref) => {
    const state = states.get(repositoryPathOf(ref));
    return state && state !== 'head' ? `${ref} [${WORKING_TREE_LABELS[state]}]` : ref;
  };
  for (const fact of ledger.facts) {
    console.log(`\n${fact.id} [${fact.area}] ${fact.status} (${fact.source})`);
    console.log(`  ${fact.summary}`);
    if (fact.note) console.log(`  Note: ${fact.note}`);
    console.log(`  Evidence: ${fact.evidence.map(describe).join(', ')}`);
  }
  const limitations = ledger.limitations ?? [];
  if (limitations.length) {
    console.log('\nDiscovery limitations (what this baseline could not inspect — work-scoped, never promoted as project facts):');
    for (const entry of limitations) console.log(`${entry.id} [${entry.type}] ${entry.area} — ${entry.summary} (reason: ${entry.reason})`);
  }
  console.log('');
  printCoverage(coverage, await inventoryTotals(root), { brief: false });
}

async function inventoryTotals(root) {
  try {
    const inventory = await inventoryRepository(root);
    return { sourceFiles: inventory.sourceFiles.total, documents: inventory.documents.total };
  } catch {
    return null;
  }
}

// Coverage transparency (v0.3.10-internal.4): what the discovery actually covered,
// in the categories the review needs. A fact count is never presented as a reading
// count, and nothing here claims completeness.
function printCoverage(coverage, totals, { brief }) {
  const section = (label, entries, limit, empty) => {
    if (!entries.length) return console.log(`  ${label}: ${empty}`);
    if (!brief) {
      console.log(`  ${label} (${entries.length}):`);
      for (const entry of entries) console.log(`    - ${entry}`);
      return;
    }
    const shown = entries.slice(0, limit);
    console.log(`  ${label} (${entries.length}): ${shown.join('; ')}${shown.length < entries.length ? `; … (+${entries.length - shown.length} more — yallaflow baseline show)` : ''}`);
  };
  const describeLimitation = (entry) => `${entry.summary} [${entry.type}]`;
  console.log('Discovery coverage (what this baseline actually covered — not a completeness claim):');
  if (!coverage.declared) {
    console.log('  Inspected / sampled: not declared by this draft — only the evidence citations and limitations below describe what was read.');
  } else {
    section('Inspected', coverage.inspected, 5, 'none declared');
    section('Sampled (selectively inspected)', coverage.sampled, 5, 'none declared');
  }
  section('Not inspected', coverage.notInspected.map(describeLimitation), 2, 'none recorded');
  section('Unavailable', coverage.unavailable.map(describeLimitation), 2, 'none recorded');
  section('Unresolved facts', coverage.unresolved.map((fact) => brief ? fact.id : `${fact.id} ${fact.summary}`), 10, 'none');
  const total = totals ? `; the inventory recognizes ${totals.sourceFiles} source file(s) and ${totals.documents} documentation candidate(s)` : '';
  console.log(`  Evidence cites ${coverage.citedPaths.length} distinct repository path(s)${total}. A fact count is not a count of files read.`);
}

export async function baselineApproveCommand(requestedWorkId, input) {
  const root = await findProjectRoot();
  if (!root) throw new Error('No .yallaflow workspace found. Run `yallaflow init` first.');
  const workId = await resolveWorkId(root, requestedWorkId);
  const { ledger } = await approveBaseline(root, workId, input.note);
  console.log(`${workId} — baseline approved and promoted (${ledger.facts.length} fact(s) recorded in .yallaflow/context/index.yaml and projected into durable project docs).`);
  console.log(`${workId} status: DONE.`);
  const original = await pendingOriginalRequest(root);
  if (original) {
    console.log(`\nProject understanding is established. Continue the original request now — do not ask the developer to repeat it, and do not run another repository-wide discovery (later work reuses the approved memory with targeted intent/freshness discovery):`);
    console.log(`  ${original.objective}`);
    console.log(`Next: yallaflow start ${shellQuote(original.objective)}   (then classify it with yallaflow route)`);
  } else {
    console.log('\nProject understanding is established. Continue with the developer\'s request (yallaflow start "<request>"); later work reuses the approved memory instead of rescanning.');
  }
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
