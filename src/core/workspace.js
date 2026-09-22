import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { exists, ensureDir, writeText } from '../utils/fs.js';
import { readYaml, writeYaml } from './yaml.js';
import { KNOWLEDGE_POLICY_VERSION } from '../knowledge/constants.js';

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
  await writeText(path.join(base, 'AGENT.md'), agentContract());
}

function projectTemplate(name, kind) {
  return `# ${name}\n\n## Project Kind\n\n${kind}\n\n## Purpose\n\n> Describe what the system does and who it serves.\n\n## Success Criteria\n\n> Add durable product-level success criteria here.\n\n## Core Modules\n\n> Populated progressively by bootstrap and completed work.\n`;
}

function agentContract() {
  return `# YallaFlow Agent Contract\n\nYallaFlow is the engineering source of truth for this repository and applies Adaptive Spec-Driven Development. Specification depth must match the work type and scope.\n\n## Core rules\n\n1. Discover before asking. Technical unknowns belong in repository discovery; ask only about material business ambiguity or unavailable information.\n2. Understand before changing. Route the request to the correct workflow and establish the required evidence/spec first.\n3. Prove before claiming. No work item may become DONE without fresh verification evidence.\n4. Remember after finishing. Promote only durable knowledge into context/ or decisions/; keep execution noise with the work item.\n5. Investigation is read-only unless the work item is explicitly converted to an implementation workflow.\n6. Record material deviations or assumptions as rulings in the work item progress ledger.\n\n## Start sequence\n\nFor a brownfield project with an approved baseline (.yallaflow/PROJECT.md and context/ populated by \`yallaflow baseline approve\`), read PROJECT.md and only the context docs relevant to the current request first; do not blindly rescan the whole repository for every request — but repository evidence remains authoritative if durable context appears stale (code changed since the baseline). Otherwise read .yallaflow/config.yaml, .yallaflow/PROJECT.md, .yallaflow/state/current.yaml, then load only the context relevant to the current work item.\n\n## Routing sequence\n\nFor an unclassified request, create an intake with yallaflow start, classify it using the allowed work_type, scope, and confidence values, explain the reason, then apply the decision with yallaflow route. The CLI validates and persists the decision; it does not perform semantic inference. Scope classification is not just about code size: consider financial/accounting invariants, security/privacy impact, authorization changes, persistent data-model/migration changes, cross-module derived state, external integration contracts, public APIs, irreversible behavior, and concurrency/transaction rules. A small UI change can stay bounded; a small-looking change touching system-wide financial correctness may warrant architectural depth and its specification/planning review gates. YallaFlow validates the allowed values only — it never classifies semantically itself.\n\n## Behavior contract sequence\n\nSkills define engineering behavior. Work items pin the behavior they were created with. Before engineering work, run yallaflow guide for the work item. Follow the pinned skill order and retrieve exact package-owned instructions with yallaflow skill. Record completed work explicitly with yallaflow checkpoint; never infer completion from conversation. Workflow stages remain authoritative; do not modify application code when guidance reports that modification is not authorized. Once a required review gate is approved, continue automatically to the next configured boundary or blocker — do not ask again for permission that was already given (e.g. after \"approve and execute\", proceed to the next ready step without a redundant confirmation prompt).\n\n## Brownfield baseline sequence\n\nFor an existing repository with no durable project context yet, run yallaflow baseline start (read-only), perform repository/runtime discovery, complete the repository-baseline checkpoint, then record findings with yallaflow baseline draft --file <baseline.json> — every fact needs a status (confirmed/inferred/unresolved), evidence, and source (repository/runtime/user-confirmed); prior chat/model memory is never evidence. A human reviews the draft (yallaflow baseline show/status) and either yallaflow baseline approve or yallaflow baseline feedback --changes-requested. Only an approved baseline updates durable PROJECT.md/context/ docs.\n\n## Knowledge sequence\n\nWork progress is not project knowledge, and a local ruling is not automatically an ADR. Near completion, propose only stable future-facing knowledge with yallaflow knowledge propose. Promote or reject every candidate, or explicitly record yallaflow knowledge review --none. Never promote execution noise or infer durable knowledge with keyword matching.\n\n## Handoff and completion language\n\nConversation context is disposable; project state is durable. At a safe boundary — or when the session itself is getting large — checkpoint progress, leave the working tree intact, and run yallaflow handoff before continuing in a fresh session; it surfaces the PRIMARY UNRESOLVED OBJECTIVE when one exists (from a reopen reason, a checkpoint revision reason, or an active blocker) so a new session does not have to infer it from lifecycle history alone. Only say a project is complete when the parent/project work item itself is DONE; a child reaching DONE is child-level completion (e.g. \"PF-0006 DONE, 5/7 required children complete\"), never \"project complete\". YallaFlow never commits automatically and never requires a clean Git tree for DONE, but a dirty tree at a DONE boundary is worth a source-control checkpoint before unrelated work begins.\n`;
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

export async function createWorkItem(root, type, title, scope = null) {
  const id = await nextWorkId(root);
  const now = new Date().toISOString();
  const readOnly = type === 'investigation';
  const meta = {
    id,
    type,
    title,
    status: 'INTAKE',
    scope,
    readOnly,
    knowledgePolicy: {
      version: KNOWLEDGE_POLICY_VERSION,
      reviewRequired: true
    },
    createdAt: now,
    updatedAt: now
  };
  const dir = path.join(workspacePath(root), 'work', id);
  await ensureDir(path.join(dir, 'attachments'));
  await ensureDir(path.join(dir, 'evidence'));
  await ensureDir(path.join(dir, 'execution'));
  await writeYaml(path.join(dir, 'meta.yaml'), meta);
  await writeText(path.join(dir, 'work.md'), workTemplate(meta));
  await writeText(path.join(dir, 'progress.md'), `# Work Ledger — ${id}\n\nCreated: ${now}\n\n`);

  const state = {
    schemaVersion: 1,
    activeWork: id,
    stage: 'INTAKE',
    updatedAt: now
  };
  await writeYaml(path.join(workspacePath(root), 'state', 'current.yaml'), state);
  return meta;
}

function workTemplate(meta) {
  return `# ${meta.id} — ${meta.title}\n\n**Type:** ${meta.type}\n**Status:** ${meta.status}\n**Scope:** ${meta.scope ?? 'unspecified'}\n**Read-only:** ${meta.readOnly ? 'yes' : 'no'}\n\n${workSections(meta.type, meta.scope)}`;
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
