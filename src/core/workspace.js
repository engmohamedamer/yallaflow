import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { lstat, readdir } from 'node:fs/promises';
import { exists, ensureDir, writeText } from '../utils/fs.js';
import { readYaml, writeYaml } from './yaml.js';
import { KNOWLEDGE_POLICY_VERSION } from '../knowledge/constants.js';
import { renderAgentContractFile } from '../agent/contract.js';
import { classifyProject, inventoryRepository } from '../inventory/inventory.js';
import { isWorkId, nextScopedId } from './ids.js';
import { allocateCheckoutId, localDirPath } from '../shared/identity.js';
import { SAFE_GIT } from '../utils/git-safety.js';

export const WORKSPACE_DIR = '.yallaflow';
// Directories `init` creates empty and fills lazily. Git does not store empty
// directories, so a fresh clone of a committed workspace legitimately lacks them: an
// absent lazy directory means "nothing recorded yet", never corruption (v0.3.9).
export const LAZY_WORKSPACE_DIRS = Object.freeze(['work', 'decisions', 'releases']);
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

// v0.3.9: classified from the bounded repository inventory (src/inventory/). A bare
// `.git` or a manifest without any recognized source file is no longer Brownfield.
export async function detectProjectKind(root) {
  return classifyProject(await inventoryRepository(root)).kind;
}

// GAP-INIT-001: a `.yallaflow` removed from the working tree but still tracked by Git
// (in the index or HEAD) must never be silently reinitialized as a blank workspace —
// that looks like, and would produce, a destructive reset of tracked history. Failure
// of `git` itself (not installed, not a repo) is treated as "nothing tracked", not as
// a reason to block init.
function trackedYallaflowPaths(root) {
  const seen = new Set();
  for (const args of [['ls-files', '--', WORKSPACE_DIR], ['ls-tree', '-r', '--name-only', 'HEAD', '--', WORKSPACE_DIR]]) {
    const result = spawnSync('git', [...SAFE_GIT, ...args], { cwd: root, encoding: 'utf8' });
    if (result.status === 0) {
      for (const line of result.stdout.split('\n')) if (line.trim()) seen.add(line.trim());
    }
  }
  return [...seen];
}

// 1.4.0: projects created by the New Project Wizard record their provenance. Only the
// wizard passes `origin`; it is validated here so nothing else can be recorded.
export function validateProjectOrigin(origin) {
  // environment and git (PF-0057) are optional; older CLIs that do not know them treat the
  // origin as unknown and fall back to the generic Greenfield wording.
  const keys = ['createdBy', 'generator', 'template', 'stack', 'planHash', 'createdAt', 'environment', 'git'];
  if (!origin || typeof origin !== 'object' || Array.isArray(origin)) throw new Error('project origin must be an object.');
  if (Object.keys(origin).some((key) => !keys.includes(key))) throw new Error(`project origin accepts only: ${keys.join(', ')}.`);
  if (origin.createdBy !== 'yallaflow new') throw new Error('project origin is recorded only by `yallaflow new`.');
  if (origin.generator !== null && (typeof origin.generator !== 'string' || !/^[@a-z0-9/._-]+@[0-9][0-9A-Za-z.+-]*$/.test(origin.generator))) throw new Error('project origin generator must be <package>@<version> or null.');
  if (typeof origin.template !== 'string' || !/^[a-z0-9-]{1,40}$/.test(origin.template)) throw new Error('project origin template is invalid.');
  if (!Array.isArray(origin.stack) || origin.stack.some((entry) => typeof entry !== 'string' || entry.length > 60)) throw new Error('project origin stack must list technologies.');
  if (!/^[0-9a-f]{64}$/.test(String(origin.planHash))) throw new Error('project origin planHash must be a SHA-256 hex digest.');
  if (typeof origin.createdAt !== 'string') throw new Error('project origin createdAt is required.');
  if ('environment' in origin && !['docker', 'local', 'later'].includes(origin.environment)) throw new Error('project origin environment must be docker, local or later.');
  if ('git' in origin && typeof origin.git !== 'boolean') throw new Error('project origin git must be true or false.');
  return origin;
}

export async function initWorkspace(root, name, kind, mode = 'adaptive', { origin = null } = {}) {
  if (origin) {
    validateProjectOrigin(origin);
    if (kind !== 'greenfield') throw new Error('A wizard-created project is initialized as greenfield.');
  }
  const base = workspacePath(root);
  // PF-0125 (security): a .yallaflow link (even a dangling one) would send every write elsewhere.
  if ((await lstat(base).catch(() => null))?.isSymbolicLink()) throw new Error(`${base} is a symbolic link. YallaFlow creates its workspace only as a real folder inside the project; remove the link, then run \`yallaflow init\` again.\n\nNo files were changed.`);
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
    project: { name, kind, root: '.', ...(origin ? { origin } : {}) },
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
  await writeText(path.join(base, 'context', 'tech-stack.md'), '# Tech Stack\n');
  await writeText(path.join(base, 'context', 'database.md'), '# Database\n');
  await writeText(path.join(base, 'context', 'integrations.md'), '# Integrations\n');
  await writeText(path.join(base, 'context', 'environments.md'), '# Environments\n');
  await writeText(path.join(base, 'context', 'conventions.md'), '# Engineering Conventions\n');
  await writeText(path.join(base, 'context', 'business-rules.md'), '# Business Rules\n');
  await writeText(path.join(base, 'AGENT.md'), renderAgentContractFile());
}

function projectTemplate(name, kind) {
  return `# ${name}\n\n## Project Kind\n\n${kind}\n\n## Purpose\n\n> Describe what the system does and who it serves.\n\n## Success Criteria\n\n> Add durable product-level success criteria here.\n\n## Core Modules\n\n> Populated progressively by bootstrap and completed work.\n`;
}

// Single-user workspaces keep the sequential PF-#### form. A Shared Project (v0.3.10)
// allocates branch-safe PF-<clone tag>-#### IDs, so two developers starting from the
// same Git base never create the same work directory (see core/ids.js).
// In a Shared Project this allocates (reserves) the ID for this checkout.
export async function nextWorkId(root) {
  return allocateScopedId(root, 'PF', await directoryNames(path.join(workspacePath(root), 'work')));
}

export async function allocateScopedId(root, prefix, existingNames) {
  return await isSharedWorkspace(root) ? allocateCheckoutId(root, prefix, existingNames, nextScopedId) : nextScopedId(prefix, existingNames);
}

export async function directoryNames(dir) {
  if (!await exists(dir)) return [];
  return (await readdir(dir, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

// Shared Project Mode is opt-in and explicit (`yallaflow shared enable`). Never throws:
// an unreadable config is reported by doctor, and reads here fall back to single-user.
export async function isSharedWorkspace(root) {
  try {
    return (await readYaml(path.join(workspacePath(root), 'config.yaml')))?.shared?.enabled === true;
  } catch {
    return false;
  }
}

// Where this developer's active-work focus lives: the tracked state/current.yaml for a
// single-user workspace, the gitignored local/state/current.yaml in a Shared Project —
// one developer's focus is never another developer's project state.
export async function currentStatePath(root) {
  return await isSharedWorkspace(root)
    ? path.join(localDirPath(root), 'state', 'current.yaml')
    : path.join(workspacePath(root), 'state', 'current.yaml');
}

export function emptyCurrentState(now = new Date().toISOString()) {
  return { schemaVersion: 1, activeWork: null, stage: null, updatedAt: now };
}

export async function writeCurrentState(root, state) {
  await writeYaml(await currentStatePath(root), state);
}

export function workSections(type, scope = null) {
  if (type === 'feature' && scope === 'architectural') return architecturalFeatureSections();
  const specific = type === 'bug'
    ? '## Reproduction\n\n## Evidence\n\n## Hypothesis\n\n## Root Cause\n\n'
    : type === 'investigation'
      ? '## Investigation Question\n\n## Evidence\n\n## Findings\n\n## Conclusion\n\n'
      : '## Requirement\n\n## Business Rules\n\n## Acceptance Criteria\n\n';

  return `## Intake\n\n## Known Facts\n\n## Open Questions\n\n${specific}## Discovery\n\n## Specification / Expected Behavior\n\n## Implementation Plan\n\n## Verification Evidence\n\n## Decisions / Rulings\n\n## Knowledge Updates\n\n## Result\n`;
}

function architecturalFeatureSections() {
  return `## Intake\n\n## Known Facts\n\n## Open Questions\n\nStructured material questions are authoritative in \`questions.yaml\`.\n\n## Confirmed Decisions\n\n## Discovery\n\n## Architecture / Technical Decisions\n\nClassify only relevant decisions as confirmed, proposed, unresolved, or not applicable.\n\n## Design\n\n## Specification\n\n### Goal and Scope\n\n### Actors and Permissions\n\n### Functional Requirements and Business Rules\n\n### Workflows and Lifecycle\n\n### Data and Integrations\n\n### Validation and Error Behavior\n\n### Security and Privacy\n\n### UI / Screens\n\n### Acceptance Criteria\n\n### Unresolved Items\n\n## Implementation Plan\n\n## Verification Evidence\n\n## Decisions / Rulings\n\n## Knowledge Updates\n\n## Result\n`;
}

// A fresh clone of a Shared Project has no local focus yet: that is "no active work",
// never an error. A single-user workspace still requires its tracked state file.
export async function getCurrentState(root) {
  const file = await currentStatePath(root);
  if (await isSharedWorkspace(root) && !await exists(file)) return emptyCurrentState(null);
  return readYaml(file);
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
  if (!await exists(workDir)) return [];
  const entries = await readdir(workDir, { withFileTypes: true });
  const items = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !isWorkId(entry.name)) continue;
    const metaFile = path.join(workDir, entry.name, 'meta.yaml');
    if (await exists(metaFile)) items.push(await readYaml(metaFile));
  }
  return items.sort((a, b) => a.id.localeCompare(b.id));
}
