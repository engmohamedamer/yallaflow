import path from 'node:path';
import { exists } from '../utils/fs.js';
import { findProjectRoot, getConfig, workspacePath } from '../core/workspace.js';
import { classifyProject, inventoryRepository } from '../inventory/inventory.js';
import { describeHint } from '../inventory/frameworks.js';
import { INSPECT_DOCUMENT_LIMIT, INSPECT_MANIFEST_LIMIT } from '../inventory/constants.js';
import { baselineNextStep, findBaselineWork } from '../baseline/store.js';

// `yallaflow inspect` (v0.3.9): a read-only, bounded, deterministic repository
// inventory for onboarding. It works with or without a workspace, writes nothing,
// persists nothing, never reads documents, and names exactly one next action.
export async function inspectCommand() {
  const workspaceRoot = await findProjectRoot();
  const root = workspaceRoot ?? process.cwd();
  const config = workspaceRoot ? await getConfig(workspaceRoot) : null;
  const inventory = await inventoryRepository(root);
  const classification = classifyProject(inventory);
  const name = config?.project?.name ?? path.basename(root);

  console.log(`YallaFlow Inspect — ${name}`);
  console.log('Read-only bounded repository inventory: nothing is written or persisted; documents are listed, never read.');
  console.log(`\nClassification: ${classification.kind}`);
  for (const reason of classification.reasons) console.log(`  - ${reason}`);
  console.log(`Git: ${inventory.git ? '.git present (Git never decides the classification)' : 'no .git at the inspected root'}`);
  const recorded = config?.project?.kind;
  console.log(`Workspace: ${workspaceRoot
    ? `.yallaflow present (recorded kind: ${recorded ?? 'unknown'}${recorded && recorded !== classification.kind ? ' — differs from this classification; the recorded kind is never rewritten automatically' : ''})`
    : 'not initialized'}`);
  const { scanned, truncated, skipped, limits } = inventory;
  const truncation = [truncated.entries ? `entry limit ${limits.maxEntries} reached` : null,
    truncated.depthLimitedDirectories ? `${truncated.depthLimitedDirectories} director${truncated.depthLimitedDirectories === 1 ? 'y' : 'ies'} beyond depth ${limits.maxDepth} not descended` : null].filter(Boolean);
  console.log(`Scan: ${scanned.entries} entries in ${scanned.directories} directories (limits: depth ${limits.maxDepth}, ${limits.maxEntries} entries) · skipped ${skipped.ignoredDirectories} ignored director${skipped.ignoredDirectories === 1 ? 'y' : 'ies'}, ${skipped.symlinks} symlink(s)${skipped.unreadableDirectories ? `, ${skipped.unreadableDirectories} unreadable director${skipped.unreadableDirectories === 1 ? 'y' : 'ies'}` : ''} · truncated: ${truncation.length ? truncation.join('; ') : 'no'}`);

  console.log(`\nManifests (${inventory.manifests.length})${inventory.manifests.length ? ':' : ': none recognized'}`);
  for (const manifest of inventory.manifests.slice(0, INSPECT_MANIFEST_LIMIT)) {
    const details = manifest.unreadable ? [`unreadable: ${manifest.unreadable}`] : manifest.frameworks.map(describeHint);
    console.log(`  ${manifest.path}${details.length ? ` — ${details.join('; ')}` : ''}`);
  }
  if (inventory.manifests.length > INSPECT_MANIFEST_LIMIT) console.log(`  … +${inventory.manifests.length - INSPECT_MANIFEST_LIMIT} more`);

  const byExtension = Object.entries(inventory.sourceFiles.byExtension)
    .sort(([a, countA], [b, countB]) => countB - countA || (a < b ? -1 : 1))
    .map(([ext, count]) => `${ext} ${count}`);
  console.log(`Source files: ${inventory.sourceFiles.total} recognized${byExtension.length ? ` — ${byExtension.join(' · ')}` : ''}`);

  const { documents } = inventory;
  console.log(`Documentation candidates (${documents.total})${documents.total ? ' — listed, never read; register material ones with `yallaflow intake add <work-id> <path>`:' : ': none'}`);
  for (const doc of documents.entries.slice(0, INSPECT_DOCUMENT_LIMIT)) console.log(`  ${doc.path} — ${doc.extension.slice(1)}, ${doc.handling}`);
  if (documents.total > INSPECT_DOCUMENT_LIMIT) console.log(`  … +${documents.total - INSPECT_DOCUMENT_LIMIT} more`);

  const ci = inventory.containerCi;
  if (ci.length) {
    console.log(`Container/CI configuration (${ci.length}, ${ci.filter((entry) => entry.meaningful).length} meaningful):`);
    for (const entry of ci.slice(0, INSPECT_MANIFEST_LIMIT)) console.log(`  ${entry.path} — ${entry.kind}${entry.unreadable ? ` — unreadable: ${entry.unreadable}` : entry.meaningful ? '' : ' — empty or comment-only'}`);
    if (ci.length > INSPECT_MANIFEST_LIMIT) console.log(`  … +${ci.length - INSPECT_MANIFEST_LIMIT} more`);
  } else {
    console.log('Container/CI configuration: none recognized');
  }

  const next = await nextAction(workspaceRoot, classification, recorded);
  console.log(`\nNext: ${next.command}`);
  if (next.text) console.log(`  ${next.text}`);
}

async function nextAction(workspaceRoot, classification, recorded) {
  if (!workspaceRoot) return { command: 'yallaflow init', text: `this repository would be initialized as ${classification.kind} (override with --type)` };
  if (await exists(path.join(workspacePath(workspaceRoot), 'context', 'index.yaml'))) return { command: 'yallaflow brief', text: 'project memory exists — orient from it' };
  const baseline = await findBaselineWork(workspaceRoot);
  if (baseline) {
    const step = await baselineNextStep(workspaceRoot, baseline);
    return { command: step.command, text: step.state === 'approved' ? null : step.text };
  }
  if (classification.kind === 'brownfield' || recorded === 'brownfield') {
    return { command: 'yallaflow baseline start', text: 'no project memory yet — establish an evidence-backed Brownfield baseline (a human approves it)' };
  }
  return { command: 'yallaflow brief', text: null };
}
