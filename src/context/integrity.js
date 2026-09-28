import path from 'node:path';
import { exists } from '../utils/fs.js';
import { workspacePath } from '../core/workspace.js';
import { factOrigins, loadContextLedger, validateContextLedger } from './ledger.js';
import { projectionIssues } from './projection.js';
import { checkReconciliationIntegrity } from '../reconciliation/integrity.js';
import { ledgerFreshness } from './freshness.js';
import { listAllLimitations, sameStatement } from '../limitations/store.js';
import { FRESHNESS } from './constants.js';

// Workspace-level project-memory integrity, reported by `doctor` (never repaired).
// errors   — structural corruption: malformed ledger, broken lineage, impossible
//            lifecycle state, missing origin work, projection drift, a discovery
//            limitation promoted as a fact.
// warnings — informational: freshness (changed/missing evidence), unreconciled
//            v0.3.5 context. A stale fact is a revalidation signal, not corruption.
// Reconciliation plans and legacy-section presentation: reconciliation/integrity.js.
export async function checkContextIntegrity(root) {
  const errors = [];
  const warnings = [];
  const { exists: hasLedger, ledger } = await loadContextLedger(root);
  const structural = hasLedger ? validateContextLedger(ledger) : [];
  const ledgerValid = !structural.length && Array.isArray(ledger?.facts);

  if (hasLedger) {
    errors.push(...structural.map((entry) => `context ledger: ${entry}`));
    if (!Array.isArray(ledger?.facts)) return { errors, warnings, factCount: 0, hasLedger };

    for (const fact of ledger.facts) {
      for (const origin of ledgerValid ? factOrigins(fact) : [fact?.origin]) {
        const workId = origin?.workId;
        if (workId && /^PF-\d+$/.test(workId) && !await exists(path.join(workspacePath(root), 'work', workId, 'meta.yaml'))) {
          errors.push(`context ledger: ${fact.id} originates from work item ${workId}, which does not exist.`);
        }
      }
    }

    const limitations = await listAllLimitations(root);
    for (const fact of ledger.facts) {
      const match = limitations.find((entry) => sameStatement(entry.summary, fact.summary));
      if (match) errors.push(`context ledger: ${fact.id} repeats discovery limitation ${match.workId} ${match.id}; discovery limitations are work-scoped and must not be promoted as project knowledge.`);
    }

    // Projection drift is only deterministic once the ledger itself is sound.
    if (ledgerValid) errors.push(...(await projectionIssues(root, ledger)).map((entry) => `context projection: ${entry}`));

    if (ledgerValid) {
      const freshness = await ledgerFreshness(root, ledger);
      for (const fact of ledger.facts) {
        const result = freshness.get(fact.id);
        if (result.status === FRESHNESS.MAY_BE_STALE) warnings.push(`${fact.id} may be stale because ${result.changed.join(', ')} changed since it was verified.`);
        if (result.status === FRESHNESS.STALE_EVIDENCE) warnings.push(`${fact.id} has stale evidence: ${result.missing.join(', ')} no longer exists.`);
        if (fact.state === 'disputed') warnings.push(`${fact.id} is disputed and must be reconfirmed or superseded before it is treated as settled.`);
      }
    }
  }

  // Legacy knowledge reconciliation (v0.3.7): plan integrity, lineage, and the
  // presentation status of v0.3.5 append-only sections.
  const reconciliation = await checkReconciliationIntegrity(root, ledger, ledgerValid);
  errors.push(...reconciliation.errors);
  warnings.push(...reconciliation.warnings);
  if (reconciliation.unreconciledSections) warnings.push(legacyWarning(reconciliation.unreconciledSections));
  return { errors, warnings, factCount: hasLedger ? ledger.facts.length : 0, hasLedger };
}

function legacyWarning(count) {
  return `${count} v0.3.5 append-only context section(s) are not yet governed by the canonical ledger. Reconcile them explicitly with \`yallaflow context reconcile start\` (inspect first with \`yallaflow context adopt --dry-run\` or \`yallaflow upgrade status\`).`;
}
