import path from 'node:path';
import { appendFile } from 'node:fs/promises';
import { exists, readText, writeText } from '../utils/fs.js';
import { workspacePath } from '../core/workspace.js';
import { CONTEXT_TARGETS } from './constants.js';
import {
  assertKnowledgeReviewAllowed,
  loadWorkKnowledge,
  loadWorkMeta,
  requireCandidate,
  updateReviewStatus,
  writeKnowledgeLedger
} from './store.js';

const CONTEXT_HEADINGS = Object.freeze({
  architecture: '# Architecture',
  database: '# Database',
  integration: '# Integrations',
  environment: '# Environments',
  convention: '# Engineering Conventions',
  'business-rule': '# Business Rules'
});

export async function promoteKnowledge(root, workId, candidateId, now = new Date().toISOString()) {
  const meta = await loadWorkMeta(root, workId);
  const loaded = await loadWorkKnowledge(root, meta);
  const candidate = requireCandidate(loaded.ledger, candidateId);
  await assertKnowledgeReviewAllowed(root, meta, candidate);
  if (candidate.status === 'rejected') throw new Error(`Candidate ${candidateId} was rejected and cannot be promoted.`);
  if (candidate.status === 'promoted') throw new Error(`Candidate ${candidateId} is already promoted to ${candidate.target}.`);

  const target = candidate.kind === 'decision'
    ? await promoteDecision(root, workId, candidate, now)
    : await promoteContext(root, workId, candidate, now);
  candidate.status = 'promoted';
  candidate.promotedAt = now;
  candidate.target = target;
  updateReviewStatus(loaded.ledger, now);
  await writeKnowledgeLedger(root, workId, loaded.ledger);
  return { meta, candidate, target, ledger: loaded.ledger };
}

async function promoteContext(root, workId, candidate, now) {
  const relative = CONTEXT_TARGETS[candidate.kind];
  if (!relative) throw new Error(`No project-memory target exists for knowledge kind ${candidate.kind}.`);
  const file = path.join(workspacePath(root), relative);
  const marker = knowledgeMarker(workId, candidate.id);
  let current = '';
  if (await exists(file)) current = await readText(file);
  else await writeText(file, `${CONTEXT_HEADINGS[candidate.kind]}\n\n`);
  if (!current.includes(marker)) {
    await appendFile(file, contextSection(workId, candidate, now, marker), 'utf8');
  }
  return relative;
}

async function promoteDecision(root, workId, candidate, now) {
  const relative = `decisions/ADR-${workId}-${candidate.id}.md`;
  const file = path.join(workspacePath(root), relative);
  const marker = knowledgeMarker(workId, candidate.id);
  if (await exists(file)) {
    const current = await readText(file);
    if (!current.includes(marker)) throw new Error(`Refusing to overwrite existing ADR at ${relative}.`);
    return relative;
  }
  await writeText(file, adrDocument(workId, candidate, now, marker));
  return relative;
}

function contextSection(workId, candidate, now, marker) {
  const evidence = candidate.evidence.map((entry) => `  - ${entry}`).join('\n');
  return `\n${marker}\n## ${candidate.id} — ${candidate.summary}\n\n- **Source work:** ${workId}\n- **Knowledge ID:** ${candidate.id}\n- **Promoted at:** ${now}\n- **Evidence:**\n${evidence}\n`;
}

function adrDocument(workId, candidate, now, marker) {
  const details = candidate.decisionDetails;
  const evidence = candidate.evidence.map((entry) => `- ${entry}`).join('\n');
  const ruling = details.sourceRuling ? `Source ruling: ${details.sourceRuling}\n` : '';
  return `# ${candidate.summary}\n\n${marker}\nStatus: Accepted\nDate: ${now}\nSource work: ${workId}\nKnowledge ID: ${candidate.id}\n${ruling}\n## Context\n\n${details.context}\n\n## Decision\n\n${details.decision}\n\n## Reason\n\n${details.reason}\n\n## Risks / Cost if wrong\n\n${details.costIfWrong}\n\n## Evidence\n\n${evidence}\n`;
}

function knowledgeMarker(workId, candidateId) {
  return `<!-- yallaflow-knowledge:${workId}:${candidateId} -->`;
}
