import path from 'node:path';
import { stat } from 'node:fs/promises';
import { gitPathChangedSince } from '../core/git.js';
import { hashFile } from './evidence.js';
import { FRESHNESS } from './constants.js';

// Mechanical, evidence-aware freshness. It answers only "has the repository evidence
// behind this fact changed since the fact was verified?" — never "is the fact still
// true?". Changed evidence means revalidation is needed; it never rewrites,
// supersedes, or invalidates a fact on its own. Purely read-only.
//
// Per repository evidence entry:
//   contentHash recorded  → compare against the current file's hash
//   only gitCommit        → `git diff <commit> -- <path>` (+ untracked files beneath)
//   neither               → no verification point (unknown)
// Runtime, user-confirmed, and free-text evidence cannot be checked mechanically.
export async function evidenceStatus(root, entry) {
  if (entry.type !== 'repository') return 'unchecked';
  const absolute = path.resolve(root, entry.path);
  let info = null;
  try {
    info = await stat(absolute);
  } catch {
    info = null;
  }
  if (entry.contentHash) {
    if (!info || !info.isFile()) return 'missing';
    return (await hashFile(absolute)) === entry.contentHash ? 'unchanged' : 'changed';
  }
  if (entry.gitCommit) {
    if (!info) return 'missing';
    return gitPathChangedSince(root, entry.gitCommit, entry.path);
  }
  return 'unknown';
}

export async function factFreshness(root, fact) {
  if (fact.state === 'superseded') return { status: FRESHNESS.HISTORICAL, changed: [], missing: [] };
  const changed = [];
  const missing = [];
  let checked = 0;
  for (const entry of fact.evidence ?? []) {
    const status = await evidenceStatus(root, entry);
    if (status === 'changed') changed.push(entry.path);
    if (status === 'missing') missing.push(entry.path);
    if (['changed', 'missing', 'unchanged'].includes(status)) checked += 1;
  }
  const status = missing.length
    ? FRESHNESS.STALE_EVIDENCE
    : changed.length
      ? FRESHNESS.MAY_BE_STALE
      : checked
        ? FRESHNESS.FRESH
        : FRESHNESS.UNKNOWN;
  return { status, changed: [...new Set(changed)], missing: [...new Set(missing)] };
}

export async function ledgerFreshness(root, ledger) {
  const results = new Map();
  for (const fact of ledger.facts) results.set(fact.id, await factFreshness(root, fact));
  return results;
}

export function needsRevalidation(fact, freshness) {
  if (fact.state === 'superseded') return false;
  return fact.state === 'disputed' || [FRESHNESS.MAY_BE_STALE, FRESHNESS.STALE_EVIDENCE].includes(freshness?.status);
}

// Path → fact mapping only (no semantic judgment): a non-superseded fact is affected
// when any of its repository evidence paths equals, or lies beneath, a changed path —
// or a changed path lies beneath a directory it cites.
export function factsAffectedByPaths(ledger, changedPaths) {
  const normalized = changedPaths.map(normalizePath).filter(Boolean);
  const affected = [];
  for (const fact of ledger.facts) {
    if (fact.state === 'superseded') continue;
    const matched = new Set();
    for (const entry of fact.evidence ?? []) {
      if (entry.type !== 'repository') continue;
      const evidencePath = normalizePath(entry.path);
      for (const changed of normalized) {
        if (changed === evidencePath || changed.startsWith(`${evidencePath}/`) || evidencePath.startsWith(`${changed}/`)) matched.add(entry.path);
      }
    }
    if (matched.size) affected.push({ fact, paths: [...matched] });
  }
  return affected;
}

function normalizePath(value) {
  return String(value ?? '').trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
}
