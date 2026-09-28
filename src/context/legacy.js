import path from 'node:path';
import { exists } from '../utils/fs.js';
import { readYaml } from '../core/yaml.js';
import { listWork, workspacePath } from '../core/workspace.js';
import { loadWorkKnowledge } from '../knowledge/store.js';
import { CONTEXT_TARGETS } from '../knowledge/constants.js';
import { appliedTransition, originKey } from './ledger.js';

// v0.3.5 durable project knowledge, read from the structured historical work records
// that produced it — approved baseline.yaml facts and promoted (non-decision)
// knowledge.yaml candidates that never became a canonical CTX fact — never from the
// Markdown prose. Those records are immutable history: nothing here writes them.
//
// Deterministic order (work ID, then baseline facts, then knowledge candidates, each
// in recorded order) is what gives reconciliation candidates stable RC IDs.
export async function collectLegacyItems(root) {
  const items = [];
  for (const meta of await listWork(root)) {
    if (meta.baseline) {
      const file = path.join(workspacePath(root), 'work', meta.id, 'baseline.yaml');
      if (await exists(file)) {
        const baseline = await readYaml(file);
        if (baseline.status === 'approved') {
          for (const fact of baseline.facts ?? []) {
            items.push({
              origin: { workId: meta.id, baselineFactId: fact.id },
              kind: 'baseline',
              workTitle: meta.title ?? null,
              area: fact.area,
              summary: fact.summary,
              confidence: fact.status,
              provenance: fact.source ?? null,
              evidence: [...(fact.evidence ?? [])],
              recordedAt: baseline.approvedAt ?? baseline.updatedAt ?? null,
              ...(fact.note ? { note: fact.note } : {}),
              legacySection: legacySectionRef(fact.area, `<!-- yallaflow-baseline:${meta.id}:${fact.id} -->`)
            });
          }
        }
      }
    }
    const knowledge = await loadWorkKnowledge(root, meta);
    for (const candidate of knowledge.ledger.candidates) {
      if (candidate.status !== 'promoted' || candidate.kind === 'decision' || candidate.factId) continue;
      items.push({
        origin: { workId: meta.id, candidateId: candidate.id },
        kind: 'knowledge',
        workTitle: meta.title ?? null,
        area: candidate.kind,
        summary: candidate.summary,
        confidence: candidate.confidence ?? 'confirmed',
        provenance: candidate.provenance ?? null,
        evidence: [...candidate.evidence],
        recordedAt: candidate.promotedAt ?? null,
        legacySection: legacySectionRef(candidate.kind, `<!-- yallaflow-knowledge:${meta.id}:${candidate.id} -->`)
      });
    }
  }
  return items;
}

function legacySectionRef(area, marker) {
  return { file: CONTEXT_TARGETS[area] ?? null, marker };
}

// Legacy items not yet governed: not represented in the canonical ledger (adopted in
// v0.3.6 or applied through reconciliation), and not settled by an applied
// reconciliation decision that deliberately keeps them out of project memory (skip /
// limitation). `settledKeys` comes from reconciliation plans (reconciliation/store.js).
export function pendingLegacyItems(items, ledger, settledKeys = new Set()) {
  return items.filter((item) => !appliedTransition(ledger, item.origin) && !settledKeys.has(originKey(item.origin)));
}

export function legacyItemLabel(item) {
  return `${item.origin.workId} ${item.origin.baselineFactId ?? item.origin.candidateId}`;
}
