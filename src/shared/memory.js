import path from 'node:path';
import { appendFile } from 'node:fs/promises';
import { exists } from '../utils/fs.js';
import { readYaml, writeYaml } from '../core/yaml.js';
import { isSharedWorkspace, listWork, workspacePath } from '../core/workspace.js';
import { gitHead } from '../core/git.js';
import { listVerificationRuns } from '../core/evidence.js';
import { isWorkId } from '../core/ids.js';
import { appliedTransition, findFact, loadContextLedger, mutateContextLedger } from '../context/ledger.js';
import { FACT_ID_PATTERN } from '../context/constants.js';
import { normalizeEvidenceRefs } from '../context/evidence.js';
import { CONTEXT_TARGETS } from '../knowledge/constants.js';
import { loadWorkKnowledge, writeKnowledgeLedger, updateReviewStatus } from '../knowledge/store.js';
import { sameStatement } from '../limitations/store.js';
import { currentBranch } from './git.js';
import { ensureLocalIdentity, gitActor, validateActor } from './identity.js';
import { loadSharedPolicy } from './config.js';
import { factFingerprint, ledgerFingerprint } from './fingerprint.js';

// Shared Project memory flow (v0.3.10):
//
//   Shared project memory (context/index.yaml)
//          │ read                                   work/<id>/memory.yaml
//          ▼                                          contextBase  — the memory state the work started from
//   work item ── knowledge propose/promote ──►        staged[]     — the work-local memory delta
//          │                                          integrations — what canonical integration did with it
//          ▼
//   `yallaflow shared integrate` (integration branch only, one writer)
//          ▼
//   canonical ledger
//
// The delta itself is the work item's ordinary knowledge.yaml: a reviewed context
// candidate is `staged` (approved, awaiting canonical integration) instead of being
// written into the ledger from a feature branch. There is no second knowledge system:
// integration applies a staged candidate through the same ledger operations promotion
// always used, and marks it `promoted` with the CTX fact it produced.
//
// What is never guessed: semantic duplicates, which of two competing updates is right,
// and whether a fact that changed after the work related to it still supports the
// work's conclusion. Those become blockers for the Agent and human to reconcile.

export const MEMORY_SCHEMA_VERSION = 1;
const MEMORY_FIELDS = new Set(['schemaVersion', 'workId', 'createdBy', 'contextBase', 'staged', 'integrations', 'updatedAt']);
const BASE_FIELDS = new Set(['ledgerFingerprint', 'contextSchemaVersion', 'factCount', 'facts', 'gitCommit', 'branch', 'capturedAt', 'capturedLate']);
const STAGED_FIELDS = new Set(['candidate', 'stagedAt', 'actor', 'branch', 'relation']);
const INTEGRATION_FIELDS = new Set(['candidate', 'factId', 'action', 'integratedAt', 'branch', 'ledgerFingerprint']);
export const INTEGRATION_ACTIONS = Object.freeze(['introduced', 'superseded', 'reconfirmed', 'disputed', 'merged-duplicate']);

export function memoryFilePath(root, workId) {
  return path.join(workspacePath(root), 'work', workId, 'memory.yaml');
}

export async function loadWorkMemory(root, workId) {
  const file = memoryFilePath(root, workId);
  if (!await exists(file)) return { exists: false, record: null };
  return { exists: true, record: await readYaml(file) };
}

async function writeWorkMemory(root, record) {
  const errors = validateWorkMemory(record, record.workId);
  if (errors.length) throw new Error(`Refusing to write an invalid memory record for ${record.workId}:\n${errors.map((entry) => `- ${entry}`).join('\n')}`);
  await writeYaml(memoryFilePath(root, record.workId), record);
}

// ---------------------------------------------------------------------------
// Memory base

// The project-memory state "now", identified by content. Deterministic across clones;
// needs no Git (gitCommit is informational and null outside Git).
export async function captureContextBase(root, now = new Date().toISOString()) {
  const { exists: hasLedger, ledger } = await loadContextLedger(root);
  const live = ledger.facts.filter((fact) => fact.state !== 'superseded');
  return {
    ledgerFingerprint: ledgerFingerprint(ledger),
    contextSchemaVersion: hasLedger ? ledger.schemaVersion : null,
    factCount: live.length,
    facts: Object.fromEntries(live.map((fact) => [fact.id, factFingerprint(fact)])),
    gitCommit: gitHead(root),
    branch: currentBranch(root),
    capturedAt: now
  };
}

// Called when a Shared Project work item is created. Single-user workspaces get no
// memory record (and therefore no new file).
export async function recordWorkMemoryBase(root, workId, now = new Date().toISOString()) {
  if (!await isSharedWorkspace(root)) return null;
  const identity = await ensureLocalIdentity(root, now);
  const actor = gitActor(root);
  const record = {
    schemaVersion: MEMORY_SCHEMA_VERSION,
    workId,
    createdBy: { ...(actor ? { actor } : {}), cloneTag: identity.cloneTag, branch: currentBranch(root) },
    contextBase: await captureContextBase(root, now),
    staged: [],
    integrations: [],
    updatedAt: now
  };
  await writeWorkMemory(root, record);
  return record;
}

// Which facts changed between a work's base and the current ledger. Pure.
export function diffAgainstBase(base, ledger) {
  const current = new Map(ledger.facts.map((fact) => [fact.id, fact]));
  const changed = [];
  for (const [id, fingerprint] of Object.entries(base?.facts ?? {})) {
    const fact = current.get(id);
    if (!fact) changed.push({ id, change: 'missing' });
    else if (factFingerprint(fact) !== fingerprint) changed.push({ id, change: fact.state === 'superseded' ? `superseded by ${fact.supersededBy}` : fact.state === 'disputed' ? 'disputed' : 'updated', area: fact.area });
  }
  const known = new Set(Object.keys(base?.facts ?? {}));
  const added = ledger.facts.filter((fact) => fact.state !== 'superseded' && !known.has(fact.id) && !(fact.supersedes ?? []).some((id) => known.has(id)))
    .map((fact) => ({ id: fact.id, area: fact.area }));
  return {
    unchanged: base?.ledgerFingerprint === ledgerFingerprint(ledger),
    changed,
    added
  };
}

// ---------------------------------------------------------------------------
// Work-local delta

// Records a reviewed context candidate as part of this work's memory delta. The
// candidate's own relation fingerprint (captured when the Agent proposed it, against
// the fact it actually saw) is what integration later compares.
export async function stageCandidateDelta(root, meta, candidate, now = new Date().toISOString()) {
  let { record } = await loadWorkMemory(root, meta.id);
  if (!record) {
    // Work created before the project became shared: its base is captured now.
    record = (await recordWorkMemoryBase(root, meta.id, now));
    record.contextBase.capturedLate = true;
  }
  if (record.staged.some((entry) => entry.candidate === candidate.id)) return record;
  const actor = gitActor(root);
  record.staged.push({
    candidate: candidate.id,
    stagedAt: now,
    ...(actor ? { actor } : {}),
    branch: currentBranch(root),
    ...(candidate.relation ? { relation: { type: candidate.relation.type, factId: candidate.relation.factId, factFingerprint: candidate.relation.factFingerprint ?? null } } : {})
  });
  record.updatedAt = now;
  await writeWorkMemory(root, record);
  return record;
}

// Every staged (not yet integrated) context candidate visible in this checkout.
export async function collectPendingDeltas(root) {
  const pending = [];
  for (const meta of await listWork(root)) {
    let knowledge;
    try {
      knowledge = await loadWorkKnowledge(root, meta);
    } catch {
      continue; // malformed knowledge ledgers are reported by doctor
    }
    const staged = knowledge.ledger.candidates.filter((candidate) => candidate.status === 'staged');
    if (!staged.length) continue;
    const { record } = await loadWorkMemory(root, meta.id).catch(() => ({ record: null }));
    for (const candidate of staged) {
      const staging = record?.staged?.find((entry) => entry.candidate === candidate.id) ?? null;
      pending.push({ meta, candidate, staging, memory: record });
    }
  }
  return pending.sort((a, b) => (a.staging?.stagedAt ?? a.candidate.stagedAt ?? '').localeCompare(b.staging?.stagedAt ?? b.candidate.stagedAt ?? '') ||
    a.meta.id.localeCompare(b.meta.id) || a.candidate.id.localeCompare(b.candidate.id));
}

// ---------------------------------------------------------------------------
// Integration planning — pure and deterministic over (ledger, pending deltas).
//
// Per staged candidate, one of:
//   already-applied   the ledger already carries this origin (an interrupted integration); only bookkeeping remains
//   introduce         independent new knowledge
//   duplicate         exactly the same statement already exists as a current fact in that area → recorded as an
//                     additional origin of that fact (mechanically provable; nothing semantic is inferred)
//   supersede | reconfirm | dispute   the related fact is unchanged since the Agent related to it
//   blocked           reconciliation required (see blocker codes below); nothing is applied for it
//
// Blocker codes:
//   missing-fact         the related CTX fact does not exist in this checkout's memory
//   changed-since-base   the related fact changed after the Agent related to it (superseded, disputed, reconfirmed, ...)
//   competing-update     another work's pending delta supersedes/disputes the same fact differently
//   no-base              the relation was recorded without a fingerprint, so a change cannot be ruled out
//   missing-staging      knowledge.yaml says staged but the work's memory record has no staging entry
export function planIntegration(ledger, pending) {
  const items = pending.map(({ meta, candidate, staging }) => ({
    workId: meta.id,
    candidateId: candidate.id,
    kind: candidate.kind,
    summary: candidate.summary,
    stagedAt: staging?.stagedAt ?? candidate.stagedAt ?? null,
    relation: candidate.relation ? { ...candidate.relation } : null,
    staging,
    action: null,
    blockers: []
  }));

  for (const item of items) {
    if (appliedTransition(ledger, { workId: item.workId, candidateId: item.candidateId })) item.action = 'already-applied';
  }

  // Competing updates: a fact that two different works want to change, where at least
  // one of them supersedes or disputes it. Never resolved by order or by guessing.
  const byFact = new Map();
  for (const item of items) {
    if (item.action === 'already-applied' || !item.relation) continue;
    if (!byFact.has(item.relation.factId)) byFact.set(item.relation.factId, []);
    byFact.get(item.relation.factId).push(item);
  }
  for (const [factId, group] of byFact) {
    const works = new Set(group.map((item) => item.workId));
    const changing = group.some((item) => item.relation.type !== 'reconfirms');
    if ((works.size > 1 && changing) || (group.length > 1 && new Set(group.map((item) => item.relation.type)).size > 1)) {
      for (const item of group) {
        const others = group.filter((other) => other !== item).map((other) => `${other.workId} ${other.candidateId} (${other.relation.type})`);
        item.blockers.push({ code: 'competing-update', message: `${factId} is also changed by ${others.join(', ')} — parallel work disagrees about this fact` });
      }
    }
  }

  const plannedNew = [];
  for (const item of items) {
    if (item.action === 'already-applied') continue;
    if (!item.staging) item.blockers.push({ code: 'missing-staging', message: `${item.workId} has no memory-delta staging record for ${item.candidateId}` });
    if (item.relation) {
      const fact = findFact(ledger, item.relation.factId);
      if (!fact) {
        item.blockers.push({ code: 'missing-fact', message: `${item.relation.factId} does not exist in this checkout's project memory` });
      } else if (!item.relation.factFingerprint) {
        item.blockers.push({ code: 'no-base', message: `${item.relation.factId} was related without a recorded fingerprint, so a parallel change cannot be ruled out` });
      } else if (factFingerprint(fact) !== item.relation.factFingerprint) {
        const now = fact.state === 'superseded' ? `superseded by ${fact.supersededBy}` : fact.state === 'disputed' ? 'now disputed' : 'updated (e.g. reconfirmed with new evidence)';
        item.blockers.push({ code: 'changed-since-base', message: `${item.relation.factId} changed after this work related to it — ${now}` });
      }
      if (!item.blockers.length) item.action = { supersedes: 'supersede', reconfirms: 'reconfirm', disputes: 'dispute' }[item.relation.type];
    } else if (!item.blockers.length) {
      const existing = ledger.facts.find((fact) => fact.state === 'current' && fact.area === item.kind && sameStatement(fact.summary, item.summary));
      const earlier = plannedNew.find((other) => other.kind === item.kind && sameStatement(other.summary, item.summary));
      if (existing) {
        item.action = 'duplicate';
        item.duplicateOf = existing.id;
      } else if (earlier) {
        item.action = 'duplicate';
        item.duplicateOf = `${earlier.workId} ${earlier.candidateId}`;
      } else {
        item.action = 'introduce';
        plannedNew.push(item);
      }
    }
    if (item.blockers.length) item.action = 'blocked';
  }
  return {
    items,
    applicable: items.filter((item) => item.action !== 'blocked'),
    blocked: items.filter((item) => item.action === 'blocked')
  };
}

export async function planSharedIntegration(root) {
  const { ledger } = await loadContextLedger(root);
  return { ledger, plan: planIntegration(ledger, await collectPendingDeltas(root)) };
}

// ---------------------------------------------------------------------------
// Canonical integration — the one boundary where a staged delta becomes canonical.
//
// Integration-branch only. All applicable items are written in ONE ledger mutation
// (atomic temp-file + rename): never half-applied. Bookkeeping (knowledge.yaml →
// promoted, memory.yaml integration record) follows; if it is interrupted, retrying
// finds each origin already applied and finishes the bookkeeping without re-applying.
//
// Deterministic: same ledger + same pending deltas + same HEAD → byte-identical
// result. The integration timestamp is the latest stagedAt of what is applied, not the
// wall clock, so two maintainers integrating the same merge produce the same files.
export async function integrateSharedMemory(root, { onlyWorkIds = null, dryRun = false } = {}) {
  const policy = await loadSharedPolicy(root);
  if (!policy.enabled) throw new Error('This project is not a Shared Project; knowledge is promoted directly. (`yallaflow shared enable` turns Shared Project Mode on.)');
  const branch = currentBranch(root);
  const { ledger, plan } = await planSharedIntegration(root);
  const selected = (items) => items.filter((item) => !onlyWorkIds || onlyWorkIds.includes(item.workId));
  const applicable = selected(plan.applicable);
  const blocked = selected(plan.blocked);
  const result = { branch, integrationBranch: policy.integrationBranch, applicable, blocked, applied: [], dryRun };
  if (dryRun || !applicable.length) return result;
  if (branch !== policy.integrationBranch) {
    throw new Error(
      `Canonical project memory is integrated only on the integration branch (${policy.integrationBranch}); this checkout is on ${branch ?? 'a detached HEAD'}.\n\n` +
      'Reviewed knowledge stays staged with its work item and integrates after the work is merged. Nothing was changed.'
    );
  }

  const at = applicable.map((item) => item.stagedAt ?? '').sort().at(-1) || new Date().toISOString();
  const prepared = [];
  for (const item of applicable) {
    if (item.action === 'already-applied') {
      prepared.push({ item });
      continue;
    }
    const loaded = await loadWorkKnowledge(root, { id: item.workId, ...(await loadMeta(root, item.workId)) });
    const candidate = loaded.ledger.candidates.find((entry) => entry.id === item.candidateId);
    const evidence = await normalizeEvidenceRefs(root, candidate.evidence, { workId: item.workId, verificationRuns: await listVerificationRuns(root, item.workId) });
    prepared.push({ item, candidate, evidence });
  }

  let after;
  const { ledger: written } = await mutateContextLedger(root, (ops) => {
    for (const entry of prepared) {
      const { item, candidate, evidence } = entry;
      const origin = { workId: item.workId, candidateId: item.candidateId };
      const done = appliedTransition(ops.ledger, origin);
      if (done) {
        Object.assign(entry, { factId: done.id, action: appliedAction(done, origin) });
        continue;
      }
      const input = { area: candidate.kind, summary: candidate.summary, confidence: candidate.confidence, provenance: candidate.provenance, evidence, origin };
      if (item.action === 'duplicate') {
        const same = ops.ledger.facts.find((fact) => fact.state === 'current' && fact.area === candidate.kind && sameStatement(fact.summary, candidate.summary));
        ops.attachOrigin(same.id, origin, 'reconfirmed');
        Object.assign(entry, { factId: same.id, action: 'merged-duplicate' });
      } else if (item.action === 'introduce') {
        Object.assign(entry, { factId: ops.introduce(input).id, action: 'introduced' });
      } else if (item.action === 'supersede') {
        Object.assign(entry, { factId: ops.supersede(item.relation.factId, input).fact.id, action: 'superseded' });
      } else if (item.action === 'reconfirm') {
        Object.assign(entry, { factId: ops.reconfirm(item.relation.factId, { evidence, confidence: candidate.confidence, origin }).fact.id, action: 'reconfirmed' });
      } else if (item.action === 'dispute') {
        Object.assign(entry, { factId: ops.dispute(item.relation.factId, { summary: candidate.summary, evidence, origin }).fact.id, action: 'disputed' });
      }
    }
  }, at);
  after = ledgerFingerprint(written);

  // Already-applied items (an interrupted earlier run): the ledger itself says what happened.
  for (const entry of prepared) {
    if (entry.factId) continue;
    const origin = { workId: entry.item.workId, candidateId: entry.item.candidateId };
    const fact = appliedTransition(written, origin);
    Object.assign(entry, { factId: fact?.id, action: fact ? appliedAction(fact, origin) : 'introduced' });
  }

  const byWork = new Map();
  for (const entry of prepared) {
    if (!byWork.has(entry.item.workId)) byWork.set(entry.item.workId, []);
    byWork.get(entry.item.workId).push(entry);
  }
  for (const [workId, entries] of [...byWork].sort(([a], [b]) => a.localeCompare(b))) {
    const meta = await loadMeta(root, workId);
    const loaded = await loadWorkKnowledge(root, meta);
    for (const entry of entries) {
      const candidate = loaded.ledger.candidates.find((item) => item.id === entry.item.candidateId);
      if (candidate.status !== 'staged') continue;
      const fact = written.facts.find((item) => item.id === entry.factId);
      candidate.status = 'promoted';
      candidate.promotedAt = at;
      candidate.target = CONTEXT_TARGETS[fact?.area ?? candidate.kind];
      candidate.factId = entry.factId;
    }
    updateReviewStatus(loaded.ledger, at);
    loaded.ledger.updatedAt = at;
    await writeKnowledgeLedger(root, workId, loaded.ledger);

    const { record } = await loadWorkMemory(root, workId);
    if (record) {
      for (const entry of entries) {
        if (record.integrations.some((existing) => existing.candidate === entry.item.candidateId)) continue;
        record.integrations.push({
          candidate: entry.item.candidateId,
          factId: entry.factId,
          action: entry.action ?? 'introduced',
          integratedAt: at,
          branch,
          ledgerFingerprint: after
        });
      }
      record.updatedAt = at;
      await writeWorkMemory(root, record);
    }
    await appendFile(path.join(workspacePath(root), 'work', workId, 'progress.md'),
      `- ${at} Shared memory integrated: ${entries.map((entry) => `${entry.item.candidateId} → ${entry.factId}`).join(', ')}\n`, 'utf8');
    result.applied.push(...entries.map((entry) => ({ workId, candidateId: entry.item.candidateId, factId: entry.factId, action: entry.action ?? 'introduced' })));
  }
  result.ledgerFingerprint = after;
  return result;
}

// What an applied origin did to a fact, read back from the ledger — so a retried
// integration records exactly what the interrupted one did.
function appliedAction(fact, origin) {
  const same = (entry) => entry?.workId === origin.workId && entry?.candidateId === origin.candidateId;
  const origins = fact.origins ?? (fact.origin ? [fact.origin] : []);
  if (same(origins[0])) return (fact.supersedes ?? []).length ? 'superseded' : 'introduced';
  if (origins.slice(1).some(same)) return 'merged-duplicate';
  const event = [...(fact.history ?? [])].reverse().find((item) => same(item) && ['reconfirmed', 'disputed'].includes(item.action));
  return event?.action ?? 'introduced';
}

async function loadMeta(root, workId) {
  return readYaml(path.join(workspacePath(root), 'work', workId, 'meta.yaml'));
}

// ---------------------------------------------------------------------------
// Validation (doctor / shared check)

export function validateWorkMemory(record, workId) {
  const errors = [];
  const label = `${workId} memory.yaml`;
  if (!record || typeof record !== 'object' || Array.isArray(record)) return [`${label} must be an object.`];
  const unknown = Object.keys(record).filter((key) => !MEMORY_FIELDS.has(key));
  if (unknown.length) errors.push(`${label} has unknown field(s): ${unknown.join(', ')}.`);
  if (record.schemaVersion !== MEMORY_SCHEMA_VERSION) errors.push(`${label} schemaVersion must be ${MEMORY_SCHEMA_VERSION}.`);
  if (record.workId !== workId) errors.push(`${label} names work ${JSON.stringify(record.workId)}.`);
  const createdBy = record.createdBy;
  if (!createdBy || typeof createdBy !== 'object') errors.push(`${label} requires createdBy.`);
  else errors.push(...validateActor(createdBy.actor, `${label} createdBy`));
  const base = record.contextBase;
  if (!base || typeof base !== 'object' || Array.isArray(base)) {
    errors.push(`${label} requires a contextBase.`);
  } else {
    const extra = Object.keys(base).filter((key) => !BASE_FIELDS.has(key));
    if (extra.length) errors.push(`${label} contextBase has unknown field(s): ${extra.join(', ')}.`);
    if (!/^[0-9a-f]{64}$/.test(base.ledgerFingerprint ?? '')) errors.push(`${label} contextBase has a malformed ledgerFingerprint.`);
    if (!base.facts || typeof base.facts !== 'object' || Array.isArray(base.facts)) errors.push(`${label} contextBase requires a facts map.`);
    else {
      for (const [id, fingerprint] of Object.entries(base.facts)) {
        if (!FACT_ID_PATTERN.test(id) || !/^[0-9a-f]{16}$/.test(fingerprint)) errors.push(`${label} contextBase has a malformed fact entry ${JSON.stringify(id)}.`);
      }
      if (base.factCount !== Object.keys(base.facts).length) errors.push(`${label} contextBase factCount does not match its facts.`);
    }
    if (typeof base.capturedAt !== 'string' || Number.isNaN(Date.parse(base.capturedAt))) errors.push(`${label} contextBase requires capturedAt.`);
    if (base.gitCommit !== null && base.gitCommit !== undefined && !/^[0-9a-f]{7,64}$/.test(base.gitCommit)) errors.push(`${label} contextBase has a malformed gitCommit.`);
  }
  if (!Array.isArray(record.staged)) errors.push(`${label} requires a staged array.`);
  else {
    const seen = new Set();
    for (const entry of record.staged) {
      const extra = Object.keys(entry ?? {}).filter((key) => !STAGED_FIELDS.has(key));
      if (extra.length) errors.push(`${label} staged entry has unknown field(s): ${extra.join(', ')}.`);
      if (!/^K-\d{3,}$/.test(entry?.candidate ?? '')) errors.push(`${label} staged entry has a malformed candidate.`);
      if (seen.has(entry?.candidate)) errors.push(`${label} stages ${entry.candidate} twice.`);
      seen.add(entry?.candidate);
      errors.push(...validateActor(entry?.actor, `${label} staged ${entry?.candidate}`));
      if (entry?.relation !== undefined && (!['supersedes', 'reconfirms', 'disputes'].includes(entry.relation?.type) || !FACT_ID_PATTERN.test(entry.relation?.factId ?? ''))) {
        errors.push(`${label} staged ${entry.candidate} has a malformed relation.`);
      }
    }
  }
  if (!Array.isArray(record.integrations)) errors.push(`${label} requires an integrations array.`);
  else {
    for (const entry of record.integrations) {
      const extra = Object.keys(entry ?? {}).filter((key) => !INTEGRATION_FIELDS.has(key));
      if (extra.length) errors.push(`${label} integration entry has unknown field(s): ${extra.join(', ')}.`);
      if (!/^K-\d{3,}$/.test(entry?.candidate ?? '') || !FACT_ID_PATTERN.test(entry?.factId ?? '') || !INTEGRATION_ACTIONS.includes(entry?.action)) {
        errors.push(`${label} has a malformed integration entry.`);
      }
      if (!(record.staged ?? []).some((staged) => staged.candidate === entry?.candidate)) errors.push(`${label} records integration of ${entry?.candidate}, which was never staged.`);
    }
  }
  return errors;
}

// Structural + cross-file integrity for every shared memory record in the checkout.
// Returns { errors, warnings }. Read-only.
export async function checkSharedMemoryIntegrity(root, { ledger, policy }) {
  const errors = [];
  const warnings = [];
  const facts = new Map(ledger.facts.map((fact) => [fact.id, fact]));
  const integratedOrigins = new Set();
  const enabledAt = policy?.enabledAt ?? null;
  for (const meta of await listWork(root)) {
    if (!isWorkId(meta.id)) continue;
    let memory;
    try {
      memory = await loadWorkMemory(root, meta.id);
    } catch (error) {
      errors.push(`${meta.id} memory.yaml is unreadable: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    let knowledge = null;
    try {
      knowledge = await loadWorkKnowledge(root, meta);
    } catch {
      knowledge = null; // doctor reports malformed knowledge ledgers
    }
    const candidates = knowledge?.ledger.candidates ?? [];
    if (memory.exists) {
      const record = memory.record;
      errors.push(...validateWorkMemory(record, meta.id));
      // An impossible base: facts never disappear from the ledger, so every fact a
      // work started from must still exist.
      for (const id of Object.keys(record.contextBase?.facts ?? {})) {
        if (!facts.has(id)) errors.push(`${meta.id} memory base references ${id}, which does not exist in project memory (impossible memory base — was the ledger rewritten?).`);
      }
      for (const entry of record.staged ?? []) {
        const candidate = candidates.find((item) => item.id === entry.candidate);
        if (!candidate) errors.push(`${meta.id} stages ${entry.candidate}, which is not a knowledge candidate of this work.`);
        else if (!['staged', 'promoted', 'rejected'].includes(candidate.status)) errors.push(`${meta.id} stages ${entry.candidate}, but the candidate is ${candidate.status}.`);
        if (entry.relation && !facts.has(entry.relation.factId)) errors.push(`${meta.id} pending memory delta ${entry.candidate} refers to ${entry.relation.factId}, which does not exist in project memory.`);
      }
      for (const entry of record.integrations ?? []) {
        const fact = facts.get(entry.factId);
        const origin = { workId: meta.id, candidateId: entry.candidate };
        if (!fact || appliedTransition({ facts: [fact] }, origin) === null) {
          errors.push(`${meta.id} records ${entry.candidate} as integrated into ${entry.factId}, but project memory has no such provenance.`);
        }
        integratedOrigins.add(`${meta.id}:${entry.candidate}`);
      }
    }
    for (const candidate of candidates) {
      if (candidate.status === 'staged' && !(memory.record?.staged ?? []).some((entry) => entry.candidate === candidate.id)) {
        errors.push(`${meta.id} ${candidate.id} is staged but has no memory-delta record (memory.yaml).`);
      }
      // Canonical memory written outside the integration boundary: a context
      // candidate promoted after the project became shared without an integration
      // record (e.g. by an older, Shared-unaware YallaFlow on a feature branch).
      if (candidate.status === 'promoted' && candidate.kind !== 'decision' && candidate.factId && enabledAt &&
        (candidate.promotedAt ?? '') > enabledAt && !integratedOrigins.has(`${meta.id}:${candidate.id}`)) {
        errors.push(`${meta.id} ${candidate.id} was written into canonical project memory (${candidate.factId}) without a shared integration record — canonical memory was modified outside \`yallaflow shared integrate\`.`);
      }
      if (candidate.status === 'staged' && appliedTransition(ledger, { workId: meta.id, candidateId: candidate.id })) {
        warnings.push(`${meta.id} ${candidate.id} is already in project memory but its integration bookkeeping is incomplete; re-run \`yallaflow shared integrate\` on ${policy?.integrationBranch ?? 'the integration branch'} to finish it.`);
      }
    }
    // The reverse direction: canonical memory claiming an origin in a shared work item
    // that was never approved for it (a hand edit, or a write outside the boundary).
    if (memory.exists) {
      for (const fact of ledger.facts) {
        const claimed = [...(fact.origins ?? (fact.origin ? [fact.origin] : [])), ...(fact.history ?? [])]
          .filter((entry) => entry?.workId === meta.id && entry?.candidateId);
        for (const { candidateId } of claimed) {
          const candidate = candidates.find((item) => item.id === candidateId);
          if (!candidate || !['staged', 'promoted'].includes(candidate.status)) {
            errors.push(`${fact.id} claims provenance from ${meta.id} ${candidateId}, which was never approved for project memory (${candidate ? candidate.status : 'no such candidate'}) — canonical memory was changed outside the integration boundary.`);
          }
        }
      }
    }
  }
  return { errors: [...new Set(errors)], warnings };
}

// Read-only lines for handoff/resume: where this work's memory delta stands, so a
// fresh agent session continues from durable state, not from chat history.
export async function describeWorkSharedMemory(root, meta) {
  if (!await isSharedWorkspace(root)) return [];
  const { record } = await loadWorkMemory(root, meta.id).catch(() => ({ record: null }));
  const lines = [];
  try {
    const { ledger, plan } = await planSharedIntegration(root);
    if (record) {
      const diff = diffAgainstBase(record.contextBase, ledger);
      lines.push(`Shared memory base: ${diff.unchanged ? 'unchanged since this work began' : `${diff.changed.length} fact(s) changed and ${diff.added.length} added since this work began${diff.changed.length ? ` (${diff.changed.slice(0, 5).map((entry) => `${entry.id} ${entry.change}`).join(', ')})` : ''}`}`);
    }
    for (const item of plan.items.filter((entry) => entry.workId === meta.id)) {
      lines.push(item.action === 'blocked'
        ? `Staged knowledge ${item.candidateId}: needs reconciliation — ${item.blockers.map((entry) => entry.message).join('; ')}`
        : `Staged knowledge ${item.candidateId}: reviewed; integrates into shared memory on the integration branch (${item.action})`);
    }
    for (const entry of record?.integrations ?? []) lines.push(`Integrated knowledge ${entry.candidate} → ${entry.factId} (${entry.action})`);
  } catch (error) {
    lines.push(`Shared memory: could not be assessed (${error instanceof Error ? error.message : String(error)}); run yallaflow doctor`);
  }
  return lines;
}
