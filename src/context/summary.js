import { loadContextLedger } from './ledger.js';
import { ledgerFreshness, needsRevalidation } from './freshness.js';
import { AREA_LABELS, CONTEXT_AREAS, FRESHNESS } from './constants.js';
import { findActiveReconciliation, pendingLegacyCandidates } from '../reconciliation/store.js';

// Shared, read-only project-memory summary used by `context status`, `handoff`, and
// `resume` — one interpretation of the ledger + freshness, never three.
export async function summarizeProjectContext(root) {
  const { exists, ledger } = await loadContextLedger(root);
  if (!exists) return { exists: false, ledger, freshness: new Map(), areas: [], totals: null, revalidate: [] };
  const freshness = await ledgerFreshness(root, ledger);
  const areas = [];
  for (const area of CONTEXT_AREAS) {
    const facts = ledger.facts.filter((fact) => fact.area === area);
    if (!facts.length) continue;
    const live = facts.filter((fact) => fact.state !== 'superseded');
    areas.push({
      area,
      label: AREA_LABELS[area],
      current: facts.filter((fact) => fact.state === 'current').length,
      disputed: facts.filter((fact) => fact.state === 'disputed').length,
      superseded: facts.filter((fact) => fact.state === 'superseded').length,
      unresolved: live.filter((fact) => fact.confidence === 'unresolved').length,
      mayBeStale: live.filter((fact) => freshness.get(fact.id).status === FRESHNESS.MAY_BE_STALE).length,
      staleEvidence: live.filter((fact) => freshness.get(fact.id).status === FRESHNESS.STALE_EVIDENCE).length,
      unknown: live.filter((fact) => freshness.get(fact.id).status === FRESHNESS.UNKNOWN).length
    });
  }
  const sum = (key) => areas.reduce((total, entry) => total + entry[key], 0);
  const totals = {
    current: sum('current'),
    disputed: sum('disputed'),
    superseded: sum('superseded'),
    unresolved: sum('unresolved'),
    mayBeStale: sum('mayBeStale'),
    staleEvidence: sum('staleEvidence'),
    unknown: sum('unknown'),
    fresh: ledger.facts.filter((fact) => freshness.get(fact.id).status === FRESHNESS.FRESH).length
  };
  const revalidate = ledger.facts.filter((fact) => needsRevalidation(fact, freshness.get(fact.id)));
  return { exists: true, ledger, freshness, areas, totals, revalidate };
}

// Compact block for handoff/resume: only the risk-relevant slice of project memory
// (stale/disputed facts, and facts this work item's own candidates relate to), never
// the whole ledger.
export async function projectContextLines(root, knowledgeLedger = null, limit = 5) {
  const summary = await summarizeProjectContext(root);
  const legacy = await legacyContextLine(root);
  if (!summary.exists) return legacy;
  const { totals, revalidate, freshness, ledger } = summary;
  const lines = [`Project context: ${totals.current} current, ${totals.mayBeStale + totals.staleEvidence} may be stale, ${totals.disputed} disputed, ${totals.unresolved} unresolved`];
  for (const fact of revalidate.slice(0, limit)) lines.push(`- ${describe(fact, freshness.get(fact.id))}`);
  if (revalidate.length > limit) lines.push(`- … ${revalidate.length - limit} more (yallaflow context status)`);

  const related = (knowledgeLedger?.candidates ?? []).filter((candidate) => candidate.relation);
  const dependsOnStale = related
    .map((candidate) => ({ candidate, fact: ledger.facts.find((fact) => fact.id === candidate.relation.factId) }))
    .filter(({ fact }) => fact && needsRevalidation(fact, freshness.get(fact.id)));
  for (const { candidate, fact } of dependsOnStale) {
    lines.push(`This work's ${candidate.id} ${candidate.relation.type} ${fact.id}, which ${fact.state === 'disputed' ? 'is disputed' : 'may be stale'} — revalidate it before relying on it.`);
  }
  if (revalidate.length) lines.push('Revalidate affected facts before relying on them: targeted rediscovery, then `knowledge propose --reconfirms|--supersedes|--disputes CTX-####`.');
  return [...lines, ...legacy];
}

// v0.3.5 knowledge not yet reconciled is not current truth; say so once, compactly.
async function legacyContextLine(root) {
  const [pending, active] = await Promise.all([pendingLegacyCandidates(root), findActiveReconciliation(root)]);
  if (active) return [`Legacy context: reconciliation ${active.meta.id} in progress (${pending.length} legacy item(s) not yet reconciled; not current truth until applied).`];
  if (pending.length) return [`Legacy context: ${pending.length} v0.3.5 fact(s) pending reconciliation — not canonical current truth (yallaflow context reconcile start).`];
  return [];
}

export function describe(fact, freshness) {
  const flag = fact.state === 'disputed'
    ? 'DISPUTED'
    : freshness.status === FRESHNESS.STALE_EVIDENCE
      ? `STALE_EVIDENCE (${freshness.missing.join(', ')} missing)`
      : `MAY_BE_STALE (${freshness.changed.join(', ')} changed)`;
  return `${fact.id} [${fact.area}] ${flag} — ${fact.summary}`;
}
