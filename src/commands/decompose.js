import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  childProgressView,
  loadDecompositionTraceability,
  executeDecomposition,
  loadDecomposition,
  proposeDecomposition,
  validateDecomposition
} from '../decomposition/store.js';
import { advanceActiveWork, reviewGateBlocker } from '../core/transitions.js';
import { findProjectRoot } from '../core/workspace.js';

async function readProposalFile(filePath) {
  if (!filePath) throw new Error('Usage: yallaflow decompose propose <parent-id> --file <decomposition.json>');
  let raw;
  try {
    raw = await readFile(path.resolve(filePath), 'utf8');
  } catch {
    throw new Error(`Could not read decomposition file: ${filePath}`);
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Decomposition file is not valid JSON: ${filePath}`);
  }
}

export async function decomposeProposeCommand(parentId, input) {
  const root = await findProjectRoot();
  if (!root) throw new Error('No .yallaflow workspace found. Run `yallaflow init` first.');
  if (!parentId) throw new Error('Usage: yallaflow decompose propose <parent-id> --file <decomposition.json>');
  const proposal = await readProposalFile(input.file);
  const { ledger } = await proposeDecomposition(root, parentId, proposal);
  console.log(`${parentId} — decomposition proposed: ${ledger.children.length} child work item(s).`);
  for (const child of ledger.children) console.log(`- ${child.key}: ${child.title} (${child.type}/${child.scope}${child.required ? '' : ', optional'})`);
  console.log('\nNext: `yallaflow decompose validate ' + parentId + '`');
}

export async function decomposeValidateCommand(parentId) {
  const root = await findProjectRoot();
  if (!root) throw new Error('No .yallaflow workspace found. Run `yallaflow init` first.');
  if (!parentId) throw new Error('Usage: yallaflow decompose validate <parent-id>');
  const result = await validateDecomposition(root, parentId);
  if (!result.valid) {
    console.log(`${parentId} — decomposition is invalid:`);
    for (const error of result.errors) console.log(`- ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(`${parentId} — decomposition ${result.ledger.status}.`);
  printCoverage(result.coverage);
}

export async function decomposeExecuteCommand(parentId) {
  const root = await findProjectRoot();
  if (!root) throw new Error('No .yallaflow workspace found. Run `yallaflow init` first.');
  if (!parentId) throw new Error('Usage: yallaflow decompose execute <parent-id>');
  const reviewBlocker = await reviewGateBlocker(root, parentId, 'decomposition');
  if (reviewBlocker) throw new Error(reviewBlocker);
  const { ledger } = await executeDecomposition(root, parentId);
  console.log(`${parentId} — decomposition executed. Created/linked ${ledger.children.length} child work item(s):`);
  for (const child of ledger.children) console.log(`- ${child.workId}: ${child.title}`);
  const transition = await advanceActiveWork(root, parentId);
  console.log(`\n${transition.id}: ${transition.from} → ${transition.to}`);
}

export async function decomposeStatusCommand(parentId) {
  const root = await findProjectRoot();
  if (!root) throw new Error('No .yallaflow workspace found. Run `yallaflow init` first.');
  if (!parentId) throw new Error('Usage: yallaflow decompose status <parent-id>');
  const { exists: hasDecomposition, ledger } = await loadDecomposition(root, parentId);
  if (!hasDecomposition) {
    console.log(`${parentId} has no decomposition.`);
    return;
  }
  console.log(`${parentId} — decomposition: ${ledger.status}`);
  const view = await childProgressView(root, ledger);
  for (const child of view) {
    const marker = { done: '✓', active: '→', ready: '○', blocked: '⊘', not_created: '·' }[child.state] ?? '?';
    const suffix = child.state === 'blocked' ? ` — blocked by ${child.blockedBy.join(', ')}` : '';
    console.log(`${marker} ${child.workId ?? child.key} — ${child.title}${child.required ? '' : ' (optional)'}${suffix}`);
  }
  printCoverage(await loadDecompositionTraceability(root, parentId, ledger));
}

function printCoverage(coverage) {
  console.log('\nTraceability:');
  for (const [label, summary] of [['Requirements', coverage.requirements], ['Acceptance criteria', coverage.acceptanceCriteria]]) {
    console.log(`${label}: ${summary.referenced.length} referenced`);
    if (summary.duplicated.length) console.log(`  cross-cutting (referenced by more than one child): ${summary.duplicated.join(', ')}`);
    if (summary.unassigned === null) console.log('  coverage vs. total: not available (no universe declared)');
    else if (summary.unassigned.length) console.log(`  unassigned: ${summary.unassigned.join(', ')}`);
    else console.log('  unassigned: none');
    if (summary.inactive?.length) console.log(`  no longer active in the requirements ledger: ${summary.inactive.join(', ')}`);
  }
}
