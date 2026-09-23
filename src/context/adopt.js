import path from 'node:path';
import { exists, readText, writeText } from '../utils/fs.js';
import { readYaml } from '../core/yaml.js';
import { listWork, workspacePath } from '../core/workspace.js';
import { loadWorkKnowledge } from '../knowledge/store.js';
import { CONTEXT_TARGETS } from '../knowledge/constants.js';
import { loadContextLedger, mutateContextLedger } from './ledger.js';
import { deriveProvenance, normalizeEvidenceRefs } from './evidence.js';
import { removeLegacySection } from './projection.js';

// Explicit, opt-in upgrade of v0.3.5 project context into the canonical ledger.
// Nothing is migrated on read: a v0.3.5 workspace stays fully usable (its legacy
// append-only sections remain valid Markdown, and doctor accepts them) until a human
// or agent deliberately runs `yallaflow context adopt`.
//
// Adoption reads the structured historical records — approved baseline.yaml facts and
// promoted knowledge.yaml candidates — never the Markdown prose, and never rewrites
// those work records. Adopted facts carry no verification point (their evidence was
// checked at an unknown earlier time), so their freshness is UNKNOWN until reconfirmed.
// Only legacy sections that still exactly match the template YallaFlow wrote are
// removed from the Markdown; a hand-edited section is left in place and reported.
export async function planAdoption(root) {
  const { ledger } = await loadContextLedger(root);
  const adopted = new Set(ledger.facts.map((fact) => originKey(fact.origin)));
  const items = [];
  let alreadyAdopted = 0;

  for (const meta of await listWork(root)) {
    if (meta.baseline) {
      const file = path.join(workspacePath(root), 'work', meta.id, 'baseline.yaml');
      if (await exists(file)) {
        const baseline = await readYaml(file);
        if (baseline.status === 'approved') {
          for (const fact of baseline.facts) {
            const origin = { workId: meta.id, baselineFactId: fact.id, adopted: true };
            if (adopted.has(originKey(origin))) { alreadyAdopted += 1; continue; }
            items.push({
              origin,
              area: fact.area,
              summary: fact.summary,
              confidence: fact.status,
              provenance: fact.source,
              evidenceRefs: fact.evidence,
              verifiedAt: baseline.approvedAt ?? baseline.updatedAt,
              note: fact.note,
              marker: `<!-- yallaflow-baseline:${meta.id}:${fact.id} -->`
            });
          }
        }
      }
    }
    const knowledge = await loadWorkKnowledge(root, meta);
    for (const candidate of knowledge.ledger.candidates) {
      if (candidate.status !== 'promoted' || candidate.kind === 'decision' || candidate.factId) continue;
      const origin = { workId: meta.id, candidateId: candidate.id, adopted: true };
      if (adopted.has(originKey(origin))) { alreadyAdopted += 1; continue; }
      items.push({
        origin,
        area: candidate.kind,
        summary: candidate.summary,
        confidence: candidate.confidence ?? 'confirmed',
        provenance: candidate.provenance,
        evidenceRefs: candidate.evidence,
        verifiedAt: candidate.promotedAt,
        marker: `<!-- yallaflow-knowledge:${meta.id}:${candidate.id} -->`
      });
    }
  }
  return { items, alreadyAdopted };
}

export async function adoptLegacyContext(root, { dryRun = false } = {}, now = new Date().toISOString()) {
  const plan = await planAdoption(root);
  if (dryRun || !plan.items.length) return { ...plan, dryRun, facts: [], removed: [], leftInPlace: [] };

  const prepared = [];
  for (const item of plan.items) {
    const evidence = await normalizeEvidenceRefs(root, item.evidenceRefs, { workId: item.origin.workId, adopted: true });
    prepared.push({
      item,
      input: {
        area: item.area,
        summary: item.summary,
        confidence: item.confidence,
        provenance: item.provenance ?? deriveProvenance(evidence),
        evidence,
        origin: item.origin,
        verifiedAt: item.verifiedAt ?? now,
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
    if (!content.includes(item.marker)) continue;
    const next = removeLegacySection(content, item.marker);
    if (next === null) leftInPlace.push({ marker: item.marker, relative: CONTEXT_TARGETS[item.area] });
    else {
      await writeText(file, next);
      removed.push({ marker: item.marker, relative: CONTEXT_TARGETS[item.area] });
    }
  }
  return { ...plan, dryRun, facts, removed, leftInPlace };
}

function originKey(origin = {}) {
  return `${origin.workId}:${origin.baselineFactId ?? origin.candidateId ?? ''}`;
}
