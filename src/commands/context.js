import { findProjectRoot } from '../core/workspace.js';
import { gitChangedPaths } from '../core/git.js';
import { findFact, lineageOf, loadContextLedger, validateContextLedger } from '../context/ledger.js';
import { factFreshness, factsAffectedByPaths } from '../context/freshness.js';
import { findLegacySections, writeContextProjection } from '../context/projection.js';
import { adoptLegacyContext } from '../context/adopt.js';
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
    console.log('It is created by the first approved baseline or promoted knowledge candidate.');
    const legacy = await findLegacySections(root);
    if (legacy.length) {
      console.log(`\n${legacy.length} v0.3.5 context section(s) are not yet governed by the ledger.`);
      console.log('Next: yallaflow context adopt --dry-run');
    }
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
  if (summary.revalidate.length) {
    console.log(`\nNext: ${summary.revalidate.length} fact(s) should be revalidated before relying on them for affected work.`);
    for (const fact of summary.revalidate) console.log(`  ${describe(fact, summary.freshness.get(fact.id))}`);
    console.log('Revalidate with targeted rediscovery, then `yallaflow knowledge propose --reconfirms|--supersedes|--disputes CTX-####`.');
  } else {
    console.log('\nNo facts currently need revalidation.');
  }
  const legacy = await findLegacySections(root);
  if (legacy.length) console.log(`\n${legacy.length} v0.3.5 context section(s) are not yet adopted. See \`yallaflow context adopt --dry-run\`.`);
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
  const origin = fact.origin;
  console.log(`Introduced by: ${origin.workId}${origin.candidateId ? ` (${origin.candidateId})` : ''}${origin.baselineFactId ? ` (baseline ${origin.baselineFactId})` : ''}${origin.adopted ? ' — adopted from v0.3.5 context' : ''}`);
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
      const who = [event.workId, event.candidateId, event.baselineFactId].filter(Boolean).join(' ');
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
    console.log('\nWork records (baseline.yaml, knowledge.yaml) are never modified. Run without --dry-run to adopt.');
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
