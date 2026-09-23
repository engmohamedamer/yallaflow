import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { exists, ensureDir, writeText } from '../utils/fs.js';
import { readYaml, writeYaml } from './yaml.js';
import { KNOWLEDGE_POLICY_VERSION } from '../knowledge/constants.js';
import { renderAgentContractFile } from '../agent/contract.js';

export const WORKSPACE_DIR = '.yallaflow';
const LEGACY_WORKSPACE_DIR = '.projectflow';

export function workspacePath(root) {
  return path.join(root, WORKSPACE_DIR);
}

export async function findProjectRoot(start = process.cwd()) {
  let current = path.resolve(start);
  while (true) {
    if (await exists(workspacePath(current))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export async function detectProjectKind(root) {
  const markers = ['.git', 'package.json', 'composer.json', 'pyproject.toml', 'go.mod', 'Cargo.toml', 'pom.xml'];
  const results = await Promise.all(markers.map((marker) => exists(path.join(root, marker))));
  return results.some(Boolean) ? 'brownfield' : 'greenfield';
}

// GAP-INIT-001: a `.yallaflow` removed from the working tree but still tracked by Git
// (in the index or HEAD) must never be silently reinitialized as a blank workspace —
// that looks like, and would produce, a destructive reset of tracked history. Failure
// of `git` itself (not installed, not a repo) is treated as "nothing tracked", not as
// a reason to block init.
function trackedYallaflowPaths(root) {
  const seen = new Set();
  for (const args of [['ls-files', '--', WORKSPACE_DIR], ['ls-tree', '-r', '--name-only', 'HEAD', '--', WORKSPACE_DIR]]) {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    if (result.status === 0) {
      for (const line of result.stdout.split('\n')) if (line.trim()) seen.add(line.trim());
    }
  }
  return [...seen];
}

export async function initWorkspace(root, name, kind, mode = 'adaptive') {
  const base = workspacePath(root);
  if (await exists(base)) throw new Error(`Workspace already exists at ${base}`);
  if (await exists(path.join(root, LEGACY_WORKSPACE_DIR))) {
    throw new Error('Legacy .projectflow workspace detected. YallaFlow does not migrate it automatically; migrate it deliberately before running `yallaflow init`.');
  }
  const tracked = trackedYallaflowPaths(root);
  if (tracked.length) {
    throw new Error(
      `Existing YallaFlow history is tracked by Git but missing from the working tree ` +
      `(${tracked.length} tracked path(s) under ${WORKSPACE_DIR}, e.g. ${tracked[0]}).\n\n` +
      'Restore it (e.g. `git checkout -- .yallaflow`) or deliberately start a clean repository/baseline.\n\n' +
      'No files were changed.'
    );
  }

  for (const dir of ['context', 'work', 'decisions', 'releases', 'state']) {
    await ensureDir(path.join(base, dir));
  }

  const config = {
    schemaVersion: 1,
    project: { name, kind, root: '.' },
    workflow: {
      discoverBeforeAsk: true,
      verifyBeforeDone: true,
      knowledgeUpdateOnClose: true
    },
    quality: {
      testingStrategy: kind === 'brownfield' ? 'project-convention' : 'tdd'
    },
    interaction: {
      profile: 'developer',
      mode,
      gates: {}
    }
  };

  const state = {
    schemaVersion: 1,
    activeWork: null,
    stage: null,
    updatedAt: new Date().toISOString()
  };

  await writeYaml(path.join(base, 'config.yaml'), config);
  await writeYaml(path.join(base, 'state', 'current.yaml'), state);
  await writeText(path.join(base, 'PROJECT.md'), projectTemplate(name, kind));
  await writeText(path.join(base, 'context', 'architecture.md'), '# Architecture\n\n> YallaFlow-maintained project knowledge. Update only with durable facts.\n');
  await writeText(path.join(base, 'context', 'tech-stack.md'), '# Tech Stack\n\n');
  await writeText(path.join(base, 'context', 'database.md'), '# Database\n\n');
  await writeText(path.join(base, 'context', 'integrations.md'), '# Integrations\n\n');
  await writeText(path.join(base, 'context', 'environments.md'), '# Environments\n\n');
  await writeText(path.join(base, 'context', 'conventions.md'), '# Engineering Conventions\n\n');
  await writeText(path.join(base, 'context', 'business-rules.md'), '# Business Rules\n\n');
  await writeText(path.join(base, 'AGENT.md'), renderAgentContractFile());
}

function projectTemplate(name, kind) {
  return `# ${name}\n\n## Project Kind\n\n${kind}\n\n## Purpose\n\n> Describe what the system does and who it serves.\n\n## Success Criteria\n\n> Add durable product-level success criteria here.\n\n## Core Modules\n\n> Populated progressively by bootstrap and completed work.\n`;
}

export async function nextWorkId(root) {
  const workDir = path.join(workspacePath(root), 'work');
  const entries = await readdir(workDir, { withFileTypes: true });
  const ids = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => /^PF-(\d+)$/.exec(entry.name)?.[1])
    .filter(Boolean)
    .map(Number);
  const next = (ids.length ? Math.max(...ids) : 0) + 1;
  return `PF-${String(next).padStart(4, '0')}`;
}

export function workSections(type, scope = null) {
  if (type === 'feature' && scope === 'architectural') return architecturalFeatureSections();
  const specific = type === 'bug'
    ? '## Reproduction\n\n## Evidence\n\n## Hypothesis\n\n## Root Cause\n\n'
    : type === 'investigation'
      ? '## Investigation Question\n\n## Evidence\n\n## Findings\n\n## Conclusion\n\n'
      : '## Requirement\n\n## Business Rules\n\n## Acceptance Criteria\n\n';

  return `## Intake\n\n## Known Facts\n\n## Open Questions\n\n${specific}## Discovery\n\n## Specification / Expected Behavior\n\n## Implementation Plan\n\n## Verification Evidence\n\n## Decisions / Rulings\n\n## Knowledge Updates\n\n## Result\n\n`;
}

function architecturalFeatureSections() {
  return `## Intake\n\n## Known Facts\n\n## Open Questions\n\nStructured material questions are authoritative in \`questions.yaml\`.\n\n## Confirmed Decisions\n\n## Discovery\n\n## Architecture / Technical Decisions\n\nClassify only relevant decisions as confirmed, proposed, unresolved, or not applicable.\n\n## Design\n\n## Specification\n\n### Goal and Scope\n\n### Actors and Permissions\n\n### Functional Requirements and Business Rules\n\n### Workflows and Lifecycle\n\n### Data and Integrations\n\n### Validation and Error Behavior\n\n### Security and Privacy\n\n### UI / Screens\n\n### Acceptance Criteria\n\n### Unresolved Items\n\n## Implementation Plan\n\n## Verification Evidence\n\n## Decisions / Rulings\n\n## Knowledge Updates\n\n## Result\n\n`;
}

export async function getCurrentState(root) {
  return readYaml(path.join(workspacePath(root), 'state', 'current.yaml'));
}

export async function getConfig(root) {
  return readYaml(path.join(workspacePath(root), 'config.yaml'));
}

export async function loadWorkMetaOrThrow(root, workId) {
  const file = path.join(workspacePath(root), 'work', workId, 'meta.yaml');
  if (!await exists(file)) throw new Error(`Work item ${workId} was not found.`);
  return readYaml(file);
}

export async function listWork(root) {
  const workDir = path.join(workspacePath(root), 'work');
  const entries = await readdir(workDir, { withFileTypes: true });
  const items = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('PF-')) continue;
    const metaFile = path.join(workDir, entry.name, 'meta.yaml');
    if (await exists(metaFile)) items.push(await readYaml(metaFile));
  }
  return items.sort((a, b) => a.id.localeCompare(b.id));
}
