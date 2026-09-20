import path from 'node:path';
import { detectProjectKind, initWorkspace } from '../core/workspace.js';
import { deterministicDiscovery, writeDiscovery } from '../core/discovery.js';
import { INTERACTION_MODES } from '../behavior/interaction.js';

export async function initCommand(options = {}) {
  const root = process.cwd();
  const kind = options.type ?? await detectProjectKind(root);
  const name = options.name ?? path.basename(root);
  const mode = options.mode ?? 'adaptive';
  if (!INTERACTION_MODES.includes(mode)) throw new Error(`--mode must be one of: ${INTERACTION_MODES.join(', ')}`);
  await initWorkspace(root, name, kind, mode);
  if (kind === 'brownfield') await writeDiscovery(root, await deterministicDiscovery(root));
  console.log(`Initialized YallaFlow workspace for ${name}`);
  console.log(`Project kind: ${kind}`);
  console.log(`Interaction mode: ${mode}`);
  console.log(`Workspace: ${path.join(root, '.yallaflow')}`);
  console.log(kind === 'brownfield'
    ? 'Next: run `yallaflow start "<request>"` (or `yallaflow intake <file>` if you already have a requirements file); let the agent deepen repository discovery before asking business-only questions.'
    : 'Next: run `yallaflow start "<request>"` (or `yallaflow intake <file>` if you already have a requirements file) and capture purpose, users, constraints, and the first work item.');
}
