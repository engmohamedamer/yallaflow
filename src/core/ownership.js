import path from 'node:path';
import { exists, readText } from '../utils/fs.js';
import { workspacePath } from './workspace.js';

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
  { path: 'work/<id>/meta.yaml', owner: 'cli', via: 'start, route, intake, advance, reopen, baseline, context reconcile', pattern: /^work\/PF-\d+\/meta\.yaml$/ },
  { path: 'work/<id>/progress.yaml', owner: 'cli', via: 'checkpoint, checkpoint revise', pattern: /^work\/PF-\d+\/progress\.yaml$/ },
  { path: 'work/<id>/progress.md', owner: 'cli', via: 'append-only lifecycle log written by every lifecycle command', pattern: /^work\/PF-\d+\/progress\.md$/ },
  { path: 'work/<id>/knowledge.yaml', owner: 'cli', via: 'knowledge propose|promote|reject|review', pattern: /^work\/PF-\d+\/knowledge\.yaml$/ },
  { path: 'work/<id>/reviews.yaml', owner: 'cli', via: 'approve, feedback, baseline approve|feedback, context reconcile approve|feedback', pattern: /^work\/PF-\d+\/reviews\.yaml$/ },
  { path: 'work/<id>/questions.yaml', owner: 'cli', via: 'question add|answer|resolve', pattern: /^work\/PF-\d+\/questions\.yaml$/ },
  { path: 'work/<id>/baseline.yaml', owner: 'cli', via: 'baseline draft|approve|feedback', pattern: /^work\/PF-\d+\/baseline\.yaml$/ },
  { path: 'work/<id>/discovery.yaml', owner: 'cli', via: 'limitation add (and applied reconciliation limitations)', pattern: /^work\/PF-\d+\/discovery\.yaml$/ },
  { path: 'work/<id>/decomposition.yaml', owner: 'cli', via: 'decompose propose|validate|execute', pattern: /^work\/PF-\d+\/decomposition\.yaml$/ },
  { path: 'work/<id>/reconciliation.yaml', owner: 'cli', via: 'context reconcile start|plan|approve|feedback|apply', pattern: /^work\/PF-\d+\/reconciliation\.yaml$/ },
  { path: 'work/<id>/legacy-context.md', owner: 'cli', via: 'context reconcile apply (verbatim archive of retired legacy sections)', pattern: /^work\/PF-\d+\/legacy-context\.md$/ },
  { path: 'work/<id>/evidence/', owner: 'cli', via: 'verify (append-only verification ledger and logs)', pattern: /^work\/PF-\d+\/evidence\// },
  { path: 'context/index.yaml', owner: 'cli', via: 'baseline approve, knowledge promote, context reconcile apply, context adopt', pattern: /^context\/index\.yaml$/ },
  { path: 'sources/SRC-####/', owner: 'cli', via: 'intake, intake add (immutable originals + source.json metadata)', pattern: /^sources\/SRC-\d+\// },
  { path: 'state/current.yaml', owner: 'cli', via: 'start, route, advance, reopen, baseline, context reconcile', pattern: /^state\/current\.yaml$/ },
  { path: 'decisions/ADR-*.md', owner: 'cli', via: 'knowledge promote (decision candidates)', pattern: /^decisions\/ADR-[^/]+\.md$/ },
  { path: 'PROJECT.md / context/*.md managed block', owner: 'projection', via: 'context render (regenerated from context/index.yaml); content outside the block is human-owned and preserved byte-for-byte', pattern: /^(PROJECT\.md|context\/[a-z-]+\.md)$/ },
  { path: 'AGENT.md managed block', owner: 'projection', via: 'agent refresh; content outside the block is project-owned', pattern: /^AGENT\.md$/ },
  { path: 'work/<id>/work.md', owner: 'shared', via: 'Agent writes the narrative sections (discovery notes, specification, plan, findings, result); CLI-appended records (Routing Decision, Source Added, Request Revised) are lifecycle history — never edit them', pattern: /^work\/PF-\d+\/work\.md$/ },
  { path: 'config.yaml', owner: 'human', via: 'deliberate project settings (interaction mode, gate overrides)', pattern: /^config\.yaml$/ }
]);

export function ownershipOf(relative) {
  return STATE_OWNERSHIP.find((entry) => entry.pattern.test(relative.split('\\').join('/'))) ?? null;
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
