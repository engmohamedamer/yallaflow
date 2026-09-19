import path from 'node:path';
import { detectProjectKind, initWorkspace } from '../core/workspace.js';
import { deterministicDiscovery, writeDiscovery } from '../core/discovery.js';

export async function initCommand(options = {}) {
  const root = process.cwd();
  const kind = options.type ?? await detectProjectKind(root);
  const name = options.name ?? path.basename(root);
  await initWorkspace(root, name, kind);
  if (kind === 'brownfield') await writeDiscovery(root, await deterministicDiscovery(root));
  console.log(`Initialized YallaFlow workspace for ${name}`);
  console.log(`Project kind: ${kind}`);
  console.log(`Workspace: ${path.join(root, '.yallaflow')}`);
  console.log(kind === 'brownfield'
    ? 'Next: run `yallaflow start "<request>"` (or `yallaflow intake <file>` if you already have a requirements file); let the agent deepen repository discovery before asking business-only questions.'
    : 'Next: run `yallaflow start "<request>"` (or `yallaflow intake <file>` if you already have a requirements file) and capture purpose, users, constraints, and the first work item.');
}
