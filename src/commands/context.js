import { findProjectRoot } from '../core/workspace.js';
import { gitChangedPaths, gitHead } from '../core/git.js';
import { factOrigins, findFact, lineageOf, loadContextLedger, validateContextLedger } from '../context/ledger.js';
import { factFreshness, factsAffectedByPaths } from '../context/freshness.js';
import { writeContextProjection } from '../context/projection.js';
import { adoptLegacyContext, adoptionRefusal } from '../context/adopt.js';
import { findActiveReconciliation, pendingLegacyCandidates } from '../reconciliation/store.js';
import { formatEvidence } from '../context/evidence.js';
import { describe, summarizeProjectContext } from '../context/summary.js';
import { CONTEXT_AREAS, FRESHNESS_LABELS } from '../context/constants.js';

async function requireRoot() {
  const root = await findProjectRoot();
  if (!root) throw new Error('No .yallaflow workspace found. Run `yallaflow init` first.');
  return root;
}

// Read-only. Never scans the repository beyond hashing the files facts cite.
export async function contextStatusCommand() {
  const root = await requireRoot();
  const summary = await summarizeProjectContext(root);
  console.log('Project Context');
  if (!summary.exists) {
    console.log('\nNo canonical project-context ledger yet (.yallaflow/context/index.yaml).');
    console.log('It is created by the first approved baseline, promoted knowledge candidate, or applied reconciliation.');
    await printLegacyStatus(root, true);
    return;
  }
  for (const entry of summary.areas) {
    console.log(`\n${entry.label}`);
    console.log(`  ${entry.current} current`);
    if (entry.mayBeStale) console.log(`  ${entry.mayBeStale} may be stale`);
    if (entry.staleEvidence) console.log(`  ${entry.staleEvidence} stale evidence`);
    if (entry.disputed) console.log(`  ${entry.disputed} disputed`);
    if (entry.unresolved) console.log(`  ${entry.unresolved} unresolved`);
    if (entry.superseded) console.log(`  ${entry.superseded} superseded (historical)`);
  }
  const { totals } = summary;
  console.log(`\nTotals: ${totals.current} current · ${totals.disputed} disputed · ${totals.superseded} superseded (historical)`);
  console.log(`Freshness: ${totals.fresh} fresh · ${totals.mayBeStale} may be stale · ${totals.staleEvidence} stale evidence · ${totals.unknown} unknown (no verification point)`);
  // Contextual (v0.3.9): only where there is no Git commit to compare against, which is
  // exactly when freshness behaves differently from the Git-backed case.
  if (!gitHead(root)) {
    console.log('This workspace is not Git-backed (no Git commit to compare evidence against):');
    console.log('  - repository file evidence is still checked by SHA-256 content hash: a changed file becomes MAY_BE_STALE, a missing file STALE_EVIDENCE;');
    console.log('  - directory evidence has no content hash, so without Git it is UNKNOWN (no verification point) — UNKNOWN does not mean stale.');
  }
  if (summary.revalidate.length) {
    console.log(`\nNext: ${summary.revalidate.length} fact(s) should be revalidated before relying on them for affected work.`);
    for (const fact of summary.revalidate) console.log(`  ${describe(fact, summary.freshness.get(fact.id))}`);
    console.log('Revalidate with targeted rediscovery, then `yallaflow knowledge propose --reconfirms|--supersedes|--disputes CTX-####`.');
  } else {
    console.log('\nNo facts currently need revalidation.');
  }
  await printLegacyStatus(root, false);
}

// Legacy v0.3.5 knowledge is counted from the structured work records (not Markdown),
// minus whatever is already governed or deliberately settled by reconciliation.
async function printLegacyStatus(root, noLedger) {
  const pending = await pendingLegacyCandidates(root);
  const active = await findActiveReconciliation(root);
  if (active) {
    console.log(`\nLegacy context reconciliation in progress: ${active.meta.id} (${pending.length} legacy item(s) not yet reconciled).`);
    console.log(`Next: yallaflow context reconcile status ${active.meta.id}`);
  } else if (pending.length) {
    console.log(`\n${pending.length} v0.3.5 context section(s) are not yet governed by the ledger.`);
    console.log(`Next: yallaflow context reconcile start${noLedger ? ' (inspect first with `yallaflow context adopt --dry-run`)' : ''}`);
  }
}

export async function contextListCommand({ area, all } = {}) {
  const root = await requireRoot();
  if (area && !CONTEXT_AREAS.includes(area)) throw new Error(`--area must be one of: ${CONTEXT_AREAS.join(', ')}.`);
  const { ledger } = await loadContextLedger(root);
  const facts = ledger.facts.filter((fact) => (!area || fact.area === area) && (all || fact.state !== 'superseded'));
  if (!facts.length) {
    console.log(all ? 'No project context facts.' : 'No current project context facts.');
    return;
  }
  for (const fact of facts) {
    const freshness = await factFreshness(root, fact);
    console.log(`${fact.id} [${fact.area}] ${fact.state}/${fact.confidence} ${FRESHNESS_LABELS[freshness.status]} — ${fact.summary}`);
  }
}

export async function contextShowCommand(factId) {
  const root = await requireRoot();
  const { ledger } = await loadContextLedger(root);
  const fact = findFact(ledger, factId);
  if (!fact) throw new Error(`Project context fact ${factId} was not found.`);
  const freshness = await factFreshness(root, fact);
  console.log(`${fact.id} — ${fact.summary}`);
  console.log(`Area: ${fact.area}`);
  console.log(`State: ${fact.state}${fact.state === 'disputed' ? ' (not settled truth)' : ''}`);
  console.log(`Confidence: ${fact.confidence}`);
  console.log(`Provenance: ${fact.provenance}`);
  const [origin, ...others] = factOrigins(fact);
  console.log(`Introduced by: ${describeOrigin(origin)}`);
  if (others.length) {
    console.log('Also established by:');
    for (const extra of others) console.log(`  - ${describeOrigin(extra)}`);
  }
  console.log(`Verified: ${fact.verifiedAt}${fact.verifiedAtCommit ? ` at commit ${fact.verifiedAtCommit}` : ' (no Git verification point)'}`);
  console.log(`Freshness: ${FRESHNESS_LABELS[freshness.status]}`);
  if (freshness.changed.length) console.log(`  changed since verification: ${freshness.changed.join(', ')}`);
  if (freshness.missing.length) console.log(`  missing: ${freshness.missing.join(', ')}`);
  console.log('Evidence:');
  for (const entry of fact.evidence) console.log(`  - ${formatEvidence(entry)}`);
  if (fact.note) console.log(`Note: ${fact.note}`);
  if (fact.supersedes?.length) console.log(`Supersedes: ${fact.supersedes.join(', ')}`);
  if (fact.supersededBy) console.log(`Superseded by: ${fact.supersededBy}`);
  if (fact.dispute) {
    const raisedBy = fact.dispute.raisedBy ?? {};
    console.log(`Dispute: ${fact.dispute.summary} (raised by ${raisedBy.workId ?? 'unknown'}${raisedBy.candidateId ? ` ${raisedBy.candidateId}` : ''} at ${fact.dispute.raisedAt})`);
    for (const entry of fact.dispute.evidence) console.log(`  - ${formatEvidence(entry)}`);
  }
  if (freshness.status === 'may-be-stale' || freshness.status === 'stale-evidence') {
    console.log('\nMAY_BE_STALE does not mean false: supporting evidence changed after verification. Revalidate before relying on it.');
  }
}

function describeOrigin(origin) {
  const id = origin.candidateId ? ` (${origin.candidateId})` : origin.baselineFactId ? ` (baseline ${origin.baselineFactId})` : '';
  const via = origin.reconciliation ? `, reconciled in ${origin.reconciliation.workId} ${origin.reconciliation.candidate}` : '';
  return `${origin.workId}${id}${origin.adopted ? ` — adopted from v0.3.5 context${via}` : ''}`;
}

export async function contextHistoryCommand(factId) {
  const root = await requireRoot();
  const { ledger } = await loadContextLedger(root);
  const fact = findFact(ledger, factId);
  if (!fact) throw new Error(`Project context fact ${factId} was not found.`);
  const lineage = lineageOf(ledger, factId);
  console.log(`Lineage (oldest → newest): ${lineage.map((entry) => `${entry.id} [${entry.state}]`).join(' → ')}`);
  for (const entry of lineage) {
    console.log(`\n${entry.id} [${entry.state}] ${entry.summary}`);
    for (const event of entry.history) {
      const who = [event.workId, event.candidateId, event.baselineFactId, event.reconciliation && `via ${event.reconciliation.workId} ${event.reconciliation.candidate}`].filter(Boolean).join(' ');
      const detail = event.supersedes ? ` supersedes ${event.supersedes}` : event.supersededBy ? ` by ${event.supersededBy}` : event.resolution ? ` (${event.resolution})` : event.summary ? `: ${event.summary}` : '';
      console.log(`  ${event.at} ${event.action}${detail}${who ? ` — ${who}` : ''}`);
    }
  }
}

// Mechanical change-impact: which non-superseded facts cite a changed path. No
// semantic judgment, no mutation.
export async function contextAffectedCommand({ since, paths = [] } = {}) {
  const root = await requireRoot();
  const changed = new Set(paths);
  if (since || !paths.length) {
    const fromGit = gitChangedPaths(root, since ?? 'HEAD');
    if (fromGit === null) {
      if (!paths.length) throw new Error(`Could not read changed paths from Git${since ? ` since ${since}` : ''}. Pass paths explicitly: yallaflow context affected <path> [...]`);
    } else {
      for (const entry of fromGit) changed.add(entry);
    }
  }
  const changedPaths = [...changed].sort();
  console.log(`Changed paths${since ? ` since ${since}` : ''}: ${changedPaths.length ? '' : 'none'}`);
  for (const entry of changedPaths) console.log(`  ${entry}`);
  const { ledger } = await loadContextLedger(root);
  const affected = factsAffectedByPaths(ledger, changedPaths);
  console.log(`\nAffected knowledge: ${affected.length ? '' : 'none'}`);
  for (const { fact, paths: matched } of affected) {
    const freshness = await factFreshness(root, fact);
    console.log(`  ${fact.id} [${fact.area}] ${FRESHNESS_LABELS[freshness.status]} — ${fact.summary} (via ${matched.join(', ')})`);
  }
  if (affected.length) console.log('\nRevalidate these before relying on them; YallaFlow does not decide whether they are still true.');
}

export async function contextAdoptCommand({ dryRun } = {}) {
  const root = await requireRoot();
  const result = await adoptLegacyContext(root, { dryRun });
  if (!result.items.length) {
    console.log(`Nothing to adopt${result.alreadyAdopted ? ` (${result.alreadyAdopted} legacy item(s) already adopted)` : ''}.`);
    return;
  }
  if (dryRun) {
    console.log(`Would adopt ${result.items.length} legacy fact(s) into .yallaflow/context/index.yaml:`);
    for (const item of result.items) console.log(`  ${item.origin.workId} ${item.origin.baselineFactId ?? item.origin.candidateId} [${item.area}] ${item.summary}`);
    console.log('\nWork records (baseline.yaml, knowledge.yaml) are never modified.');
    const refusal = await adoptionRefusal(root, result);
    console.log(refusal
      ? `Direct adoption is not available: ${refusal}`
      : 'This adoption is provably duplicate-free (one legacy item, no current facts); run without --dry-run to adopt, or reconcile it with `yallaflow context reconcile start`.');
    return;
  }
  console.log(`Adopted ${result.facts.length} legacy fact(s): ${result.facts.map((fact) => fact.id).join(', ')}`);
  console.log(`Legacy Markdown sections replaced by the managed projection: ${result.removed.length}`);
  if (result.leftInPlace.length) {
    console.log('Hand-edited legacy sections left in place (review and remove manually):');
    for (const entry of result.leftInPlace) console.log(`  ${entry.relative}: ${entry.marker}`);
  }
  console.log('Adopted facts have UNKNOWN freshness until reconfirmed with fresh evidence.');
}

// Explicit repair of managed Markdown blocks from the canonical ledger. Content
// outside the managed blocks is never touched.
export async function contextRenderCommand() {
  const root = await requireRoot();
  const { exists, ledger } = await loadContextLedger(root);
  if (!exists) {
    console.log('No canonical project-context ledger yet; nothing to render.');
    return;
  }
  const errors = validateContextLedger(ledger);
  if (errors.length) throw new Error(`The project context ledger is invalid; refusing to render:\n${errors.map((entry) => `- ${entry}`).join('\n')}`);
  await writeContextProjection(root, ledger);
  console.log('Project context Markdown projection regenerated from .yallaflow/context/index.yaml.');
}
