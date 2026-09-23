import path from 'node:path';
import { exists } from '../utils/fs.js';
import { workspacePath } from '../core/workspace.js';
import { loadContextLedger, validateContextLedger } from './ledger.js';
import { findLegacySections, projectionIssues } from './projection.js';
import { ledgerFreshness } from './freshness.js';
import { listAllLimitations, sameStatement } from '../limitations/store.js';
import { FRESHNESS } from './constants.js';

// Workspace-level project-memory integrity, reported by `doctor` (never repaired).
// errors   — structural corruption: malformed ledger, broken lineage, impossible
//            lifecycle state, missing origin work, projection drift, a discovery
//            limitation promoted as a fact.
// warnings — informational: freshness (changed/missing evidence), unadopted v0.3.5
//            context. A stale fact is a revalidation signal, not corruption.
export async function checkContextIntegrity(root) {
  const errors = [];
  const warnings = [];
  const { exists: hasLedger, ledger } = await loadContextLedger(root);
  const legacy = await findLegacySections(root);

  if (!hasLedger) {
    if (legacy.length) warnings.push(legacyWarning(legacy.length));
    return { errors, warnings, factCount: 0, hasLedger };
  }

  const structural = validateContextLedger(ledger);
  errors.push(...structural.map((entry) => `context ledger: ${entry}`));
  if (!Array.isArray(ledger?.facts)) return { errors, warnings, factCount: 0, hasLedger };

  for (const fact of ledger.facts) {
    const workId = fact?.origin?.workId;
    if (workId && /^PF-\d+$/.test(workId) && !await exists(path.join(workspacePath(root), 'work', workId, 'meta.yaml'))) {
      errors.push(`context ledger: ${fact.id} originates from work item ${workId}, which does not exist.`);
    }
  }

  const limitations = await listAllLimitations(root);
  for (const fact of ledger.facts) {
    const match = limitations.find((entry) => sameStatement(entry.summary, fact.summary));
    if (match) errors.push(`context ledger: ${fact.id} repeats discovery limitation ${match.workId} ${match.id}; discovery limitations are work-scoped and must not be promoted as project knowledge.`);
  }

  // Projection drift is only deterministic once the ledger itself is sound.
  if (!structural.length) errors.push(...(await projectionIssues(root, ledger)).map((entry) => `context projection: ${entry}`));

  if (!structural.length) {
    const freshness = await ledgerFreshness(root, ledger);
    for (const fact of ledger.facts) {
      const result = freshness.get(fact.id);
      if (result.status === FRESHNESS.MAY_BE_STALE) warnings.push(`${fact.id} may be stale because ${result.changed.join(', ')} changed since it was verified.`);
      if (result.status === FRESHNESS.STALE_EVIDENCE) warnings.push(`${fact.id} has stale evidence: ${result.missing.join(', ')} no longer exists.`);
      if (fact.state === 'disputed') warnings.push(`${fact.id} is disputed and must be reconfirmed or superseded before it is treated as settled.`);
    }
  }

  if (legacy.length) warnings.push(legacyWarning(legacy.length));
  return { errors, warnings, factCount: ledger.facts.length, hasLedger };
}

function legacyWarning(count) {
  return `${count} v0.3.5 append-only context section(s) are not yet governed by the canonical ledger. Run \`yallaflow context adopt --dry-run\`, then \`yallaflow context adopt\` when ready.`;
}
