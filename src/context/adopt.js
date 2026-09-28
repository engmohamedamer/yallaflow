import path from 'node:path';
import { exists, readText, writeText } from '../utils/fs.js';
import { workspacePath } from '../core/workspace.js';
import { CONTEXT_TARGETS } from '../knowledge/constants.js';
import { currentFacts, loadContextLedger, mutateContextLedger } from './ledger.js';
import { collectLegacyItems } from './legacy.js';
import { deriveProvenance, normalizeEvidenceRefs } from './evidence.js';
import { generatedLegacySectionState } from './projection.js';
import { findActiveReconciliation, pendingLegacyCandidates } from '../reconciliation/store.js';

// `context adopt` (v0.3.6) imported every legacy v0.3.5 fact at once. That is migration,
// not reconciliation: two work items that recorded the same durable truth in different
// words would become two separate current facts, and nothing could tell. Since v0.3.7:
//
//   --dry-run   unchanged and read-only — lists what is not yet governed.
//   adopt       only when adoption is provably duplicate-free: exactly one legacy item
//               and no current canonical facts it could overlap with. Otherwise it is
//               refused (no mutation) and points to `yallaflow context reconcile start`,
//               the reviewable workflow. There is deliberately no --force.
//
// Adoption reads the structured historical records (never the Markdown prose) and
// never rewrites them. Adopted facts carry no verification point, so their freshness
// is UNKNOWN until reconfirmed. Only a legacy section that is byte-for-byte what v0.3.5
// generated from the item's own record is removed; any hand edit leaves it in place.
export async function planAdoption(root) {
  const all = await collectLegacyItems(root);
  const pending = await pendingLegacyCandidates(root);
  const items = pending.map((item) => ({ ...item, origin: { ...item.origin, adopted: true }, marker: item.legacySection.marker }));
  return { items, alreadyAdopted: all.length - pending.length };
}

export async function adoptionRefusal(root, plan) {
  const active = await findActiveReconciliation(root);
  if (active) return `A legacy-context reconciliation is in progress (${active.meta.id}); continue it with \`yallaflow context reconcile status ${active.meta.id}\`.`;
  const { ledger } = await loadContextLedger(root);
  const live = currentFacts(ledger).length;
  if (plan.items.length > 1 || live) {
    return `${plan.items.length} legacy item(s)${live ? ` and ${live} current canonical fact(s)` : ''} may describe overlapping truths; ` +
      'blind adoption could create duplicate current facts. Reconcile them explicitly instead: `yallaflow context reconcile start`.';
  }
  return null;
}

export async function adoptLegacyContext(root, { dryRun = false } = {}, now = new Date().toISOString()) {
  const plan = await planAdoption(root);
  if (dryRun || !plan.items.length) return { ...plan, dryRun, facts: [], removed: [], leftInPlace: [] };
  const refusal = await adoptionRefusal(root, plan);
  if (refusal) throw new Error(`Refusing to adopt legacy context: ${refusal}\nNo files were changed.`);

  const prepared = [];
  for (const item of plan.items) {
    const evidence = await normalizeEvidenceRefs(root, item.evidence, { workId: item.origin.workId, adopted: true });
    prepared.push({
      item,
      input: {
        area: item.area,
        summary: item.summary,
        confidence: item.confidence,
        provenance: item.provenance ?? deriveProvenance(evidence),
        evidence,
        origin: item.origin,
        verifiedAt: item.recordedAt ?? now,
        verifiedAtCommit: null,
        ...(item.note ? { note: item.note } : {})
      }
    });
  }
  const { result: facts } = await mutateContextLedger(root, (ops) => prepared.map(({ input }) => ops.introduce(input, 'adopted')), now);

  const removed = [];
  const leftInPlace = [];
  for (const { item } of prepared) {
    const file = path.join(workspacePath(root), CONTEXT_TARGETS[item.area]);
    if (!await exists(file)) continue;
    const content = await readText(file);
    const { state, text } = generatedLegacySectionState(content, item, item.marker);
    if (state === 'absent') continue;
    if (state === 'edited') leftInPlace.push({ marker: item.marker, relative: CONTEXT_TARGETS[item.area] });
    else {
      await writeText(file, content.replace(text, ''));
      removed.push({ marker: item.marker, relative: CONTEXT_TARGETS[item.area] });
    }
  }
  return { ...plan, dryRun, facts, removed, leftInPlace };
}
