import path from 'node:path';
import { initWorkspace } from '../core/workspace.js';
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
  await initWorkspace(root, name, kind, mode);
  if (kind === 'brownfield') await writeDiscovery(root, await deterministicDiscovery(root, inventory));
  console.log(`Initialized YallaFlow workspace for ${name}`);
  console.log(`Project kind: ${kind}${options.type ? ' (explicit --type)' : ` (${classification.reasons[0]})`}`);
  console.log(`Interaction mode: ${mode}`);
  console.log(`Workspace: ${path.join(root, '.yallaflow')}`);
  console.log(kind === 'brownfield'
    ? 'Next: run `yallaflow inspect` (bounded repository inventory), then `yallaflow baseline start` to establish evidence-backed project memory — or `yallaflow start "<request>"` for immediate work; let the agent deepen repository discovery before asking business-only questions.'
    : 'Next: run `yallaflow start "<request>"` (or `yallaflow intake <file>` if you already have a requirements file) and capture purpose, users, constraints, and the first work item.');
}
