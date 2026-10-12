import path from 'node:path';
import { rm } from 'node:fs/promises';
import { initWorkspace, workspacePath } from '../core/workspace.js';
import {
  agentLabels,
  assertAllBootstrapsInstallable,
  bootstrapFileNames,
  installAllBootstraps,
  restoreBootstrapFiles,
  snapshotBootstrapFiles
} from '../agent/bootstrap.js';
import { classifyProject, inventoryRepository } from '../inventory/inventory.js';
import { deterministicDiscovery, writeDiscovery } from '../core/discovery.js';
import { INTERACTION_MODES } from '../behavior/interaction.js';

export async function initCommand(options = {}) {
  const root = process.cwd();
  const inventory = await inventoryRepository(root);
  const classification = classifyProject(inventory);
  const kind = options.type ?? classification.kind;
  const name = options.name ?? path.basename(root);
  const mode = options.mode ?? 'adaptive';
  if (!INTERACTION_MODES.includes(mode)) throw new Error(`--mode must be one of: ${INTERACTION_MODES.join(', ')}`);
  // v0.3.10-internal.3: init also installs the thin repository bootstrap for every
  // first-party agent (src/agent/bootstrap.js) so a fresh agent session finds YallaFlow
  // on its own — one setup command. Checked read-only before anything is written: a
  // file whose managed block is hand-edited, newer, or malformed stops init with
  // nothing changed.
  await assertAllBootstrapsInstallable(root);
  const snapshot = await snapshotBootstrapFiles(root);
  await initWorkspace(root, name, kind, mode);
  let bootstraps;
  try {
    if (kind === 'brownfield') await writeDiscovery(root, await deterministicDiscovery(root, inventory));
    bootstraps = await installAllBootstraps(root);
  } catch (error) {
    // Never leave a half-configured repository that looks initialized: remove the
    // workspace this run created and restore each agent file to its original bytes.
    await rm(workspacePath(root), { recursive: true, force: true });
    await restoreBootstrapFiles(snapshot);
    throw new Error(`YallaFlow init failed and was rolled back (no .yallaflow workspace, agent files unchanged): ${error instanceof Error ? error.message : String(error)}`);
  }
  console.log(`Initialized YallaFlow workspace for ${name}`);
  console.log(`Project kind: ${kind}${options.type ? ' (explicit --type)' : ` (${classification.reasons[0]})`}`);
  console.log(`Interaction mode: ${mode}`);
  console.log(`Workspace: ${path.join(root, '.yallaflow')}`);
  console.log(`Agent bootstrap: ${bootstraps.map((item) => `${item.file} ${item.action}`).join(', ')} — each points to .yallaflow/AGENT.md`);
  console.log(`\nNext: open ${agentLabels()} in this repository and describe the work. The agent orients itself with YallaFlow; you do not need to say "use YallaFlow".`);
  console.log(`Commit .yallaflow/, ${bootstrapFileNames()} so every session and teammate starts from the same project.`);
  console.log(kind === 'brownfield'
    ? 'Existing project: before changing application code the agent establishes an evidence-backed project understanding and asks you to approve it. (Manual: `yallaflow inspect`, `yallaflow baseline start`.)'
    : 'New project: describe the product; understanding grows from your intent and requirements. (Manual: `yallaflow start "<request>"` or `yallaflow intake <file>`.)');
}
