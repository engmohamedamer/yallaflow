// Work-history reconciliation plan (1.4.0, PF-0052): a read-only dry-run comparing this
// workspace with another side (a Git ref, optionally with that ref's checkout folder for
// uncommitted records) against their merge base.
//
// Per identity (PF work item, SRC source, CTX fact, ADR):
//   identical            same content on both sides                       → nothing to do
//   other-only           only on the other side                          → Git merge (or, if
//                        uncommitted, preserve: a merge cannot carry it)
//   diverged-other       existed at the base, changed only on the other   → Git takes the other
//                        side; the workspace copy is preserved (owner decision 3)
//   diverged-workspace   changed only here                               → Git keeps ours
//   diverged-both        changed on both sides                           → keep ours, preserve other
//   colliding            created independently on both sides under one ID → keep ours, preserve other
//   workspace-only       only here                                       → nothing to do
// Memory identities (CTX) never get an automatic relation: they are reported for a
// knowledge decision made through the normal Core path (owner decision 1).
import path from 'node:path';
import { createHash } from 'node:crypto';
import { dirSource, gitSource, labelOrigins, mergeBase, overlay, resolveCommit, sha256 } from './source.js';
import { containsSecret } from '../security/redact.js';

export const PLAN_SCHEMA = 'yallaflow.history-plan/1';
export const LABEL = /^[a-z0-9][a-z0-9.-]{0,47}$/;

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}
export const hashOf = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

// Groups files into identities: work/<id>/**, sources/<id>/**, decisions/<file>.
function groups(side) {
  const map = new Map();
  for (const [relative, file] of side.files) {
    const m = /^\.yallaflow\/(work|sources)\/([^/]+)\/(.+)$/.exec(relative) ?? /^\.yallaflow\/(decisions)\/([^/]+)$/.exec(relative);
    if (!m) continue;
    const kind = { work: 'work', sources: 'source', decisions: 'adr' }[m[1]];
    const key = `${kind}:${m[2]}`;
    if (!map.has(key)) map.set(key, { kind, id: m[2], files: new Map() });
    map.get(key).files.set(relative, file);
  }
  return map;
}

const groupHash = (group) => (group ? hashOf([...group.files].map(([relative, file]) => [relative, file.sha256]).sort()) : null);

function facts(side) {
  const file = side.files.get('.yallaflow/context/index.yaml');
  if (!file) return new Map();
  try {
    const ledger = JSON.parse(file.read().toString('utf8'));
    return new Map((ledger.facts ?? []).map((fact) => [fact.id, fact]));
  } catch {
    throw Object.assign(new Error('A context ledger could not be parsed; resolve it before reconciling.'), { code: 'HISTORY_LEDGER' });
  }
}

function classify(ws, ot, base) {
  if (!ws && !ot && !base) return 'identical';
  if (base && (!ws || !ot)) throw Object.assign(new Error('A historical identity was deleted on one side; restore or reconcile it explicitly before planning a merge.'), { code: 'HISTORY_DELETED_IDENTITY' });
  if (ws && ot && ws === ot) return 'identical';
  if (!ws && ot) return base ? 'diverged-other' : 'other-only';
  if (ws && !ot) return 'workspace-only';
  if (!base) return 'colliding';
  if (ws === base) return 'diverged-other';
  if (ot === base) return 'diverged-workspace';
  return 'diverged-both';
}

// Derive resolution targets from reviewed identities, never from executable plan text.
export function gitResolution(identities) {
  return identities.filter((entry) => entry.kind !== 'fact' && entry.classification !== 'other-only').map((entry) => ({
    path: `.yallaflow/${{ work: 'work', source: 'sources', adr: 'decisions' }[entry.kind]}/${entry.id}`,
    take: entry.classification === 'diverged-other' ? 'theirs' : 'ours'
  }));
}

// root: this workspace's repository root. Options: { label, fromRef, fromDir? }.
export async function buildPlan(root, { label, fromRef, fromDir = null }, { now = new Date().toISOString() } = {}) {
  if (!LABEL.test(String(label ?? ''))) throw Object.assign(new Error('--label must be 1-48 characters: lowercase letters, digits, dot and dash.'), { code: 'HISTORY_USAGE' });
  const head = resolveCommit(root, 'HEAD');
  const otherCommit = resolveCommit(root, fromRef);
  const baseCommit = mergeBase(root, head, otherCommit);
  const workspace = labelOrigins(await dirSource(root));
  for (const file of workspace.files.values()) file.origin = 'workspace';
  const otherGit = labelOrigins(gitSource(root, otherCommit));
  const other = fromDir ? overlay(otherGit, await dirSource(fromDir)) : otherGit;
  const base = gitSource(root, baseCommit);

  const wsGroups = groups(workspace);
  const wsGitGroups = groups(gitSource(root, head));
  const otGroups = groups(other);
  const otGitGroups = groups(otherGit);
  const baseGroups = groups(base);
  const identities = [];
  const inventory = [];
  const preserve = []; // { side: 'other'|'workspace', path, sha256, size, origin }
  const add = (side, group) => { for (const [relative, file] of group.files) preserve.push({ side, path: relative, sha256: file.sha256, size: file.size, origin: file.origin, secretLike: containsSecret(file.read().toString('utf8')) }); };

  for (const key of [...new Set([...wsGroups.keys(), ...otGroups.keys(), ...baseGroups.keys()])].sort()) {
    const ws = wsGroups.get(key);
    const ot = otGroups.get(key);
    const bs = baseGroups.get(key);
    const classification = classify(groupHash(ws), groupHash(ot), groupHash(bs));
    const committed = classify(groupHash(wsGitGroups.get(key)), groupHash(otGitGroups.get(key)), groupHash(bs));
    const take = (value) => ['identical', 'workspace-only', 'diverged-workspace', 'other-only'].includes(value) ? null : value === 'diverged-other' ? 'theirs' : 'ours';
    if (take(committed) && take(committed) !== take(classification)) throw Object.assign(new Error(`${key}: checkout changes mask the committed merge resolution; reconcile or commit them before planning.`), { code: 'HISTORY_CHECKOUT_CONFLICT' });
    if ((take(committed) || take(classification)) && groupHash(ws) !== groupHash(wsGitGroups.get(key))) throw Object.assign(new Error(`${key}: the workspace merge target has uncommitted changes; commit them before planning exact restores.`), { code: 'HISTORY_DIRTY_TARGET' });
    inventory.push({ kind: (ws ?? ot).kind, id: (ws ?? ot).id, classification, workspace: groupHash(ws), other: groupHash(ot), base: groupHash(bs) });
    if (classification === 'identical' || classification === 'workspace-only' || classification === 'diverged-workspace') continue;
    const { kind, id } = ws ?? ot;
    const uncommitted = Boolean(fromDir) && groupHash(ot) !== groupHash(otGitGroups.get(key));
    let action;
    if (classification === 'other-only') action = uncommitted ? 'preserve-other (uncommitted: a Git merge cannot carry it)' : 'git-merge';
    else if (classification === 'diverged-other') action = uncommitted ? 'git-merge-takes-other-commit; preserve-both-copies (uncommitted changes need a separate decision)' : 'git-merge-takes-other; preserve-workspace-copy';
    else action = 'keep-workspace; preserve-other';
    if (classification === 'colliding' || classification === 'diverged-both' || (['other-only', 'diverged-other'].includes(classification) && uncommitted)) add('other', ot);
    if (classification === 'diverged-other' && ws) add('workspace', ws);
    identities.push({ kind, id, classification, action, uncommitted, workspace: ws ? groupHash(ws) : null, other: ot ? groupHash(ot) : null, base: bs ? groupHash(bs) : null });
  }

  // Project memory: facts by id. Never related automatically.
  const wsFacts = facts(workspace);
  const otFacts = facts(other);
  const baseFacts = facts(base);
  let memory = false;
  for (const id of [...new Set([...wsFacts.keys(), ...otFacts.keys(), ...baseFacts.keys()])].sort()) {
    const h = (fact) => (fact ? hashOf(fact) : null);
    const classification = classify(h(wsFacts.get(id)), h(otFacts.get(id)), h(baseFacts.get(id)));
    inventory.push({ kind: 'fact', id, classification, workspace: h(wsFacts.get(id)), other: h(otFacts.get(id)), base: h(baseFacts.get(id)) });
    if (['identical', 'workspace-only', 'diverged-workspace'].includes(classification)) continue;
    memory = true;
    const fact = otFacts.get(id);
    identities.push({
      kind: 'fact', id, classification,
      action: 'knowledge-decision (verify the meaning; propose through Core; record the mapping) — no relation is assumed',
      other: fact ? { state: fact.state, area: fact.area, summary: fact.summary, supersededBy: fact.supersededBy ?? null, origin: fact.origin ?? null } : null,
      workspace: wsFacts.get(id) ? { state: wsFacts.get(id).state, area: wsFacts.get(id).area, summary: wsFacts.get(id).summary } : null
    });
  }
  if (memory || preserve.some((entry) => entry.path.startsWith('.yallaflow/work/'))) {
    for (const [side, src] of [['other', other], ['workspace', workspace]]) {
      const file = src.files.get('.yallaflow/context/index.yaml');
      if (file) preserve.push({ side, path: '.yallaflow/context/index.yaml', sha256: file.sha256, size: file.size, origin: file.origin, secretLike: containsSecret(file.read().toString('utf8')) });
    }
  }

  const body = {
    schema: PLAN_SCHEMA,
    label,
    createdAt: now,
    workspace: { head, fingerprint: sha256(Buffer.from(path.resolve(root))).slice(0, 39) },
    other: { ref: fromRef, commit: otherCommit, checkout: fromDir ? sha256(Buffer.from(other.dir)).slice(0, 39) : null },
    mergeBase: baseCommit,
    identities,
    inventory,
    preserve: preserve.sort((a, b) => `${a.side}/${a.path}`.localeCompare(`${b.side}/${b.path}`)),
    skipped: other.skipped,
    gitResolution: gitResolution(identities)
  };
  // Exact restores for a merge: `checkout --ours` resolves only conflicting files, so a file
  // that exists only on the other side would merge in silently (security review, PF-0052).
  body.mergeCommands = [
    `git merge --no-ff --no-commit ${otherCommit}`,
    ...body.gitResolution.map((r) => (r.take === 'ours' ? `git restore --source=HEAD --staged --worktree -- ${r.path}` : `git restore --source=${otherCommit} --staged --worktree -- ${r.path}`)),
    'git restore --source=HEAD --staged --worktree -- .yallaflow/context/index.yaml .yallaflow/state/current.yaml',
    'yallaflow history verify-merge --plan <plan file>'
  ];
  return { hash: hashOf(body), body };
}
