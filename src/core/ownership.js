import path from 'node:path';
import { exists, readText } from '../utils/fs.js';
import { workspacePath } from './workspace.js';
import { BOOTSTRAP_PROVIDERS } from '../agent/bootstrap.js';
import { SOURCE_ID_SOURCE, WORK_ID_SOURCE } from './ids.js';

// Who may write each part of .yallaflow/ (v0.3.7). The invariant: an Agent never
// edits YallaFlow-owned structured or history state directly when a supported CLI
// operation exists — it runs the operation. This is guidance plus deterministic
// integrity checks (doctor), deliberately not filesystem locking: .yallaflow stays
// ordinary, reviewable, Git-tracked project files.
//
//   cli        structured state and append-only history; written only by CLI commands
//   projection generated from canonical state; regenerate (context render / agent refresh), never hand-edit
//   shared     Agent/human-authored narrative with CLI-appended lifecycle records inside it
//   human      deliberate human-owned settings and content
export const STATE_OWNERSHIP = Object.freeze([
  { path: 'work/<id>/meta.yaml', owner: 'cli', via: 'start, route, intake, advance, reopen, baseline, context reconcile', pattern: new RegExp(`^work/${WORK_ID_SOURCE}/meta\\.yaml$`) },
  { path: 'work/<id>/progress.yaml', owner: 'cli', via: 'checkpoint, checkpoint revise', pattern: new RegExp(`^work/${WORK_ID_SOURCE}/progress\\.yaml$`) },
  { path: 'work/<id>/progress.md', owner: 'cli', via: 'append-only lifecycle log written by every lifecycle command', pattern: new RegExp(`^work/${WORK_ID_SOURCE}/progress\\.md$`) },
  { path: 'work/<id>/knowledge.yaml', owner: 'cli', via: 'knowledge propose|promote|reject|review', pattern: new RegExp(`^work/${WORK_ID_SOURCE}/knowledge\\.yaml$`) },
  { path: 'work/<id>/reviews.yaml', owner: 'cli', via: 'approve, feedback, baseline approve|feedback, context reconcile approve|feedback', pattern: new RegExp(`^work/${WORK_ID_SOURCE}/reviews\\.yaml$`) },
  { path: 'work/<id>/questions.yaml', owner: 'cli', via: 'question add|answer|resolve', pattern: new RegExp(`^work/${WORK_ID_SOURCE}/questions\\.yaml$`) },
  { path: 'work/<id>/baseline.yaml', owner: 'cli', via: 'baseline draft|approve|feedback', pattern: new RegExp(`^work/${WORK_ID_SOURCE}/baseline\\.yaml$`) },
  { path: 'work/<id>/discovery.yaml', owner: 'cli', via: 'limitation add (and applied reconciliation limitations)', pattern: new RegExp(`^work/${WORK_ID_SOURCE}/discovery\\.yaml$`) },
  { path: 'work/<id>/decomposition.yaml', owner: 'cli', via: 'decompose propose|validate|execute', pattern: new RegExp(`^work/${WORK_ID_SOURCE}/decomposition\\.yaml$`) },
  { path: 'work/<id>/reconciliation.yaml', owner: 'cli', via: 'context reconcile start|plan|approve|feedback|apply', pattern: new RegExp(`^work/${WORK_ID_SOURCE}/reconciliation\\.yaml$`) },
  { path: 'work/<id>/legacy-context.md', owner: 'cli', via: 'context reconcile apply (verbatim archive of retired legacy sections)', pattern: new RegExp(`^work/${WORK_ID_SOURCE}/legacy-context\\.md$`) },
  { path: 'work/<id>/requirements.yaml', owner: 'cli', via: 'requirement record', pattern: new RegExp(`^work/${WORK_ID_SOURCE}/requirements\\.yaml$`) },
  { path: 'work/<id>/convergence.yaml', owner: 'cli', via: 'convergence record (append-only assessments)', pattern: new RegExp(`^work/${WORK_ID_SOURCE}/convergence\\.yaml$`) },
  { path: 'work/<id>/impact.yaml', owner: 'cli', via: 'intake add / requirement record (raise), impact assess', pattern: new RegExp(`^work/${WORK_ID_SOURCE}/impact\\.yaml$`) },
  { path: 'work/<id>/evidence/', owner: 'cli', via: 'verify (append-only verification ledger and logs)', pattern: new RegExp(`^work/${WORK_ID_SOURCE}/evidence/`) },
  { path: 'context/index.yaml', owner: 'cli', via: 'baseline approve, knowledge promote, context reconcile apply, context adopt', pattern: /^context\/index\.yaml$/ },
  { path: 'sources/SRC-####/', owner: 'cli', via: 'intake, intake add (immutable originals + source.json metadata)', pattern: new RegExp(`^sources/${SOURCE_ID_SOURCE}/`) },
  { path: 'state/current.yaml', owner: 'cli', via: 'start, route, advance, reopen, baseline, context reconcile', pattern: /^state\/current\.yaml$/ },
  { path: 'decisions/ADR-*.md', owner: 'cli', via: 'knowledge promote (decision candidates)', pattern: /^decisions\/ADR-[^/]+\.md$/ },
  { path: 'PROJECT.md / context/*.md managed block', owner: 'projection', via: 'context render (regenerated from context/index.yaml); content outside the block is human-owned and preserved byte-for-byte', pattern: /^(PROJECT\.md|context\/[a-z-]+\.md)$/ },
  { path: 'AGENT.md managed block', owner: 'projection', via: 'agent refresh; content outside the block is project-owned', pattern: /^AGENT\.md$/ },
  { path: 'work/<id>/work.md', owner: 'shared', via: 'Agent writes the narrative sections (discovery notes, specification, plan, findings, result); CLI-appended records (Routing Decision, Source Added, Request Revised) are lifecycle history — never edit them', pattern: new RegExp(`^work/${WORK_ID_SOURCE}/work\\.md$`) },
  { path: 'work/<id>/memory.yaml', owner: 'cli', via: 'Shared Project: work creation (memory base), knowledge promote (staged memory delta), shared integrate (integration record)', pattern: new RegExp(`^work/${WORK_ID_SOURCE}/memory\\.yaml$`) },
  { path: 'work/<id>/purpose.yaml', owner: 'cli', via: 'purpose set, baseline start --objective (discovery purpose and preservation intent; never project truth)', pattern: new RegExp(`^work/${WORK_ID_SOURCE}/purpose\\.yaml$`) },
  { path: 'local/identity.yaml', owner: 'cli', via: 'Shared Project: created on first branch-safe ID allocation (this checkout only; gitignored, never committed)', pattern: /^local\/identity\.yaml$/ },
  { path: 'local/state/current.yaml', owner: 'cli', via: 'Shared Project: this developer\'s active-work focus (gitignored, never committed)', pattern: /^local\/state\/current\.yaml$/ },
  { path: '.gitignore', owner: 'human', via: 'written once by shared enable (ignores local/); keep the local/ rule', pattern: /^\.gitignore$/ },
  { path: 'config.yaml', owner: 'human', via: 'deliberate project settings (interaction mode, gate overrides)', pattern: /^config\.yaml$/ }
]);

// Files YallaFlow may write outside .yallaflow/ (v0.3.8), relative to the repository
// root. Only the managed bootstrap block is YallaFlow's; the rest of each file belongs
// to the project and is never rewritten.
export const REPOSITORY_OWNERSHIP = Object.freeze(Object.values(BOOTSTRAP_PROVIDERS).map((provider) => ({
  path: `${provider.file} managed bootstrap block`,
  owner: 'projection',
  via: `agent setup ${provider.id}, agent refresh; content outside the block is project-owned`,
  pattern: new RegExp(`^${provider.file.replace('.', '\\.')}$`)
})));

export function ownershipOf(relative, { base = 'workspace' } = {}) {
  const table = base === 'repository' ? REPOSITORY_OWNERSHIP : STATE_OWNERSHIP;
  return table.find((entry) => entry.pattern.test(relative.split('\\').join('/'))) ?? null;
}

// Deterministic tamper check for the one CLI-appended work.md record whose exact
// content is recoverable from meta.yaml: the Routing Decision written by `route`.
// Conservative by design — only work items whose work.md carries the heading are
// checked, so earlier layouts and decomposed children are never flagged.
export async function checkWorkRecordOwnership(root, meta) {
  if (meta.routingStatus !== 'routed' || !meta.routedAt || meta.baseline || meta.reconciliation || meta.parent) return [];
  const file = path.join(workspacePath(root), 'work', meta.id, 'work.md');
  if (!await exists(file)) return [];
  const content = await readText(file);
  if (!content.includes('\n## Routing Decision\n')) return [];
  const expected = `\n## Routing Decision\n\n**Status:** routed\n**Work type:** ${meta.type}\n**Scope:** ${meta.scope}\n**Confidence:** ${meta.routingConfidence}\n**Reason:** ${meta.routingReason}\n**Timestamp:** ${meta.routedAt}\n`;
  if (content.includes(expected)) return [];
  return [`${meta.id}: work.md's CLI-recorded Routing Decision no longer matches meta.yaml (edited by hand?). Lifecycle records in work.md are history written by YallaFlow; change classification only through supported commands.`];
}
