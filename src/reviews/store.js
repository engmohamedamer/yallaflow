import path from 'node:path';
import { exists } from '../utils/fs.js';
import { readYaml, writeYaml } from '../core/yaml.js';
import { workspacePath } from '../core/workspace.js';
import { GATE_NAMES } from '../behavior/interaction.js';

export const REVIEW_SCHEMA_VERSION = 1;
export const REVIEW_STATUSES = Object.freeze(['awaiting_review', 'approved', 'changes_requested']);

function reviewsFilePath(root, workId) {
  return path.join(workspacePath(root), 'work', workId, 'reviews.yaml');
}

function emptyLedger() {
  return { schemaVersion: REVIEW_SCHEMA_VERSION, gates: {}, updatedAt: null };
}

export async function loadReviews(root, workId) {
  const file = reviewsFilePath(root, workId);
  if (!await exists(file)) return { exists: false, ledger: emptyLedger() };
  const ledger = await readYaml(file);
  return { exists: true, ledger };
}

// Present state only; absence of a gate entry means the boundary has never been hit.
// This is workflow evidence, not authentication — a CLI approval records who ran the
// command in the sense of "this workflow state was asserted", nothing stronger.
export function gateStatus(ledger, gateName) {
  return ledger.gates[gateName]?.status ?? 'not_requested';
}

async function persist(root, workId, ledger, now) {
  ledger.updatedAt = now;
  await writeYaml(reviewsFilePath(root, workId), ledger);
  return ledger;
}

// Called by the stage-exit gate the first time a configured boundary is reached; a
// no-op if a gate record already exists (approved, changes_requested, or already
// awaiting_review) so it never clobbers a prior decision.
export async function ensureGateRequested(root, workId, gateName, now = new Date().toISOString()) {
  requireGateName(gateName);
  const { ledger } = await loadReviews(root, workId);
  if (ledger.gates[gateName]) return ledger;
  ledger.gates[gateName] = { status: 'awaiting_review', requestedAt: now, history: [{ status: 'awaiting_review', at: now }] };
  return persist(root, workId, ledger, now);
}

export async function setGateStatus(root, workId, gateName, status, note, now = new Date().toISOString()) {
  requireGateName(gateName);
  if (!['approved', 'changes_requested'].includes(status)) throw new Error(`Unsupported review status ${JSON.stringify(status)}.`);
  const { ledger } = await loadReviews(root, workId);
  const current = ledger.gates[gateName] ?? { history: [] };
  ledger.gates[gateName] = {
    status, respondedAt: now, ...(note ? { note: note.trim() } : {}),
    history: [...(current.history ?? []), { status, at: now, ...(note ? { note: note.trim() } : {}) }]
  };
  return persist(root, workId, ledger, now);
}

// A material revision to the reviewed artifact invalidates its approval. History is
// preserved (the prior approval is never deleted); the gate goes back to
// awaiting_review with a recorded reason so the next reviewer sees exactly why.
export async function invalidateGateIfApproved(root, workId, gateName, reason, now = new Date().toISOString()) {
  requireGateName(gateName);
  const { ledger } = await loadReviews(root, workId);
  const current = ledger.gates[gateName];
  if (!current || current.status !== 'approved') return null;
  ledger.gates[gateName] = {
    status: 'awaiting_review', requestedAt: now,
    history: [...(current.history ?? []), { status: 'awaiting_review', at: now, reason }]
  };
  await persist(root, workId, ledger, now);
  return { gateName, reason };
}

function requireGateName(gateName) {
  if (!GATE_NAMES.includes(gateName)) throw new Error(`--stage must be one of: ${GATE_NAMES.join(', ')}; received ${JSON.stringify(gateName)}.`);
}
