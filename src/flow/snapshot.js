// The versioned, machine-readable read contract (v1.2.0): `yallaflow snapshot --json`
// and `yallaflow work show <id> --json`. Read-only by construction: every loader here is
// a reader, and evaluateAdvance runs with mutate:false (no review gate is requested).
//
// Fields are only ever added within a schema major version (SemVer for the contract):
// yallaflow.snapshot/1 and yallaflow.work/1. Schemas: resources/schemas/.
import { loadReviews } from '../reviews/store.js';
import { lifecycleLabel } from '../core/lifecycle.js';
import path from 'node:path';
import { readdir } from 'node:fs/promises';
import { getCurrentState, getConfig, isSharedWorkspace, workspacePath } from '../core/workspace.js';
import { readYaml } from '../core/yaml.js';
import { isWorkId } from '../core/ids.js';
import { exists } from '../utils/fs.js';
import { checkSourceLinkIntegrity } from '../core/integrity.js';
import { checkDeliveryIntegrity } from '../delivery/integrity.js';
import { loadWorkProgress } from '../core/progress.js';
import { workflowStagesFor } from '../core/workflows.js';
import { evaluateAdvance } from '../core/transitions.js';
import { listVerificationRuns } from '../core/evidence.js';
import { loadWorkQuestions, summarizeQuestions } from '../questions/store.js';
import { loadWorkKnowledge } from '../knowledge/store.js';
import { loadSource } from '../core/sources.js';
import { describeFindingEvidence, evaluateConvergence } from '../delivery/convergence.js';
import { resolveDeliveryCriteria } from '../delivery/requirements.js';
import { convergenceRequired } from '../delivery/policy.js';
import { loadDecomposition } from '../decomposition/store.js';
import { PACKAGE_VERSION } from '../version.js';
import { buildStations, itemState, stationForSkill } from './stations.js';
import { lineageReferenceResolver } from '../history/lineage.js';

export const SNAPSHOT_SCHEMA = 'yallaflow.snapshot/1';
export const WORK_SCHEMA = 'yallaflow.work/1';

export async function collectSnapshot(root, { now = new Date().toISOString() } = {}) {
  const [state, listed, config, shared] = await Promise.all([getCurrentState(root), readWorkMetas(root), getConfig(root), isSharedWorkspace(root)]);
  const items = [];
  // One work item whose records fail Core validation never hides the project: it is
  // listed under `invalid` with Core's own message, and is never counted as valid,
  // in progress, or proven. Its records are left exactly as they are.
  const invalid = [...listed.invalid];
  const metas = new Map(listed.metas.map((entry) => [entry.id, entry]));
  for (const meta of listed.metas) {
    try {
      const item = await collectItem(root, meta, state, metas);
      const problems = await integrityErrors(root, meta);
      if (problems.length) invalid.push(invalidEntry(meta.id, item.title, new Error(problems.join(' '))));
      else items.push(item);
    } catch (error) {
      invalid.push(invalidEntry(meta.id, meta.title ?? meta.rawRequest ?? null, error));
    }
  }
  invalid.sort((a, b) => a.id.localeCompare(b.id));
  // Closed work is neither done nor open: it never counts toward delivery or progress.
  const counted = items.filter((item) => item.state !== 'closed');
  const open = counted.filter((item) => item.state !== 'done');
  return {
    schema: SNAPSHOT_SCHEMA,
    generatedAt: now,
    yallaflowVersion: PACKAGE_VERSION,
    project: {
      name: config.project?.name ?? path.basename(root),
      kind: config.project?.kind ?? null,
      shared: Boolean(shared),
      activeWork: state.activeWork ?? null
    },
    completion: counted.length ? Math.round(counted.reduce((sum, item) => sum + item.completion, 0) / counted.length) : 0,
    // The average completion of open (not DONE) valid work only; null when nothing is open,
    // so a project whose recorded work is all DONE is never shown as "100% complete".
    openCompletion: open.length ? Math.round(open.reduce((sum, item) => sum + item.completion, 0) / open.length) : null,
    counts: countStates(items),
    items,
    invalid
  };
}

// Damaged records, judged by Core's own checks (the ones `yallaflow doctor` runs): delivery
// state that contradicts the pinned contract, and sources that do not belong to the item.
// Lifecycle checks about where a workflow stands (for example a gate not yet requested)
// are not record damage and stay in `doctor`.
async function integrityErrors(root, meta) {
  const delivery = await checkDeliveryIntegrity(root, meta);
  return [...delivery.errors, ...(await checkSourceLinkIntegrity(root, meta))];
}

function invalidEntry(id, title, error) {
  return { id, title: title ?? null, code: 'WORK_ITEM_INVALID', message: String(error?.message ?? error) };
}

// Every work item's meta.yaml, tolerating an unreadable one (reported, never skipped silently).
async function readWorkMetas(root) {
  const workDir = path.join(workspacePath(root), 'work');
  const metas = [];
  const invalid = [];
  if (!await exists(workDir)) return { metas, invalid };
  for (const entry of await readdir(workDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !isWorkId(entry.name)) continue;
    const metaFile = path.join(workDir, entry.name, 'meta.yaml');
    if (!await exists(metaFile)) continue;
    try {
      const meta = await readYaml(metaFile);
      if (!meta || typeof meta !== 'object' || meta.id !== entry.name) throw new Error(`meta.yaml in work/${entry.name} does not describe ${entry.name}.`);
      metas.push(meta);
    } catch (error) {
      invalid.push(invalidEntry(entry.name, null, error));
    }
  }
  metas.sort((a, b) => a.id.localeCompare(b.id));
  return { metas, invalid };
}

function countStates(items) {
  const counts = { new: 0, active: 0, you: 0, fail: 0, paused: 0, done: 0, held: 0, closed: 0 };
  for (const item of items) counts[item.state] = (counts[item.state] ?? 0) + 1;
  return counts;
}

async function collectItem(root, meta, state, metas = null) {
  const active = meta.id === state.activeWork;
  const stage = meta.routingStatus === 'pending' ? null : active ? (state.stage ?? meta.status) : meta.status;
  const base = {
    id: meta.id,
    type: meta.type ?? null,
    scope: meta.scope ?? meta.complexity ?? null,
    title: meta.title ?? meta.titleHint ?? meta.rawRequest ?? meta.id,
    routing: meta.routingStatus ?? 'routed',
    stage,
    parent: meta.parent ?? null,
    sourceCount: meta.sources?.length ?? 0,
    createdAt: meta.createdAt ?? null,
    updatedAt: meta.updatedAt ?? null,
    lifecycle: meta.lifecycle ?? null
  };
  // 1.4.0: held or closed work shows its lifecycle and the command that lifts it.
  const lifecycleState = meta.lifecycle?.state === 'closed' ? 'closed' : meta.lifecycle?.state === 'on_hold' ? 'held' : null;
  const lift = lifecycleState === 'held' ? `yallaflow work resume ${meta.id}` : `yallaflow reopen ${meta.id} --reason "..."`;
  if (lifecycleState && meta.routingStatus === 'pending') {
    const stations = buildStations({ workflow: null, stages: [], stage: null, state: lifecycleState });
    return { ...base, state: lifecycleState, completion: 0, currentStation: null, stations: stations.stations, waitingFor: null, blocker: lifecycleLabel(meta), nextAction: lift };
  }
  if (meta.routingStatus === 'pending') {
    const stations = buildStations({ workflow: null, stages: [], stage: null, state: 'new' });
    return { ...base, state: 'new', completion: 0, currentStation: null, stations: stations.stations, waitingFor: null, blocker: null, nextAction: `yallaflow route ${meta.id} --type TYPE --scope SCOPE --confidence LEVEL --reason "..."` };
  }

  const progress = await loadWorkProgress(root, meta);
  const runs = await listVerificationRuns(root, meta.id);
  const latest = runs.at(-1) ?? null;
  const questions = await loadWorkQuestions(root, meta);
  const unanswered = summarizeQuestions(questions.ledger).materialOpen.filter((entry) => !entry.answer);
  const knowledge = await loadWorkKnowledge(root, meta);
  const verdict = stage === 'DONE' ? { final: true } : await evaluateAdvance(root, meta, stage, { mutate: false });
  const waitingFor = verdict.human
    ? { kind: 'review', gate: verdict.gate ?? null, action: verdict.action }
    : unanswered.length
      ? { kind: 'question', questions: unanswered.map((entry) => entry.id), action: `yallaflow question answer ${meta.id} --id ${unanswered[0].id} --answer "..."` }
      : null;
  const itemStateValue = itemState({ meta, stage, waitingForHuman: Boolean(waitingFor), latestRunFailed: latest ? !latest.success : false, active });
  // Evidence behind "verified": a fresh successful run (not predating a later reopen or
  // revision) and, where required, a currently converged assessment — checked only once
  // the work is at its final stage, where it decides Verify/Remember.
  const finalStage = workflowStagesFor(meta).at(-2);
  const freshRun = Boolean(latest?.success) && !(meta.lastInvalidationAt && !((latest.verifiedAt ?? latest.finishedAt) > meta.lastInvalidationAt));
  const converged = stage === finalStage && convergenceRequired(meta) ? Boolean((await evaluateConvergence(root, meta)).converged) : true;
  const flow = buildStations({
    workflow: meta.workflow ?? meta.type,
    stages: workflowStagesFor(meta),
    stage,
    ledgerSkills: progress.ledger.skills,
    contractSkills: progress.contract.skills,
    knowledgeReviewed: knowledge.ledger?.reviewStatus === 'reviewed',
    state: itemStateValue,
    evidence: { freshRun, converged },
    children: await childSteps(root, meta, metas)
  });
  return {
    ...base,
    state: itemStateValue,
    completion: flow.completion,
    currentStation: flow.currentStation,
    stations: flow.stations,
    waitingFor: lifecycleState ? null : waitingFor,
    blocker: lifecycleState ? lifecycleLabel(meta) : verdict.final ? null : verdict.allowed ? null : verdict.blocker ?? null,
    nextAction: lifecycleState ? lift : verdict.final ? null : verdict.action ?? null,
    latestVerification: latest ? { id: latest.id, success: Boolean(latest.success), at: latest.verifiedAt ?? latest.finishedAt ?? null } : null,
    verificationRuns: { total: runs.length, passed: runs.filter((run) => run.success).length },
    completedAt: stage === 'DONE' ? (meta.completionHistory?.at(-1)?.completedAt ?? null) : null,
    lastActivityAt: lastActivity(meta, progress.ledger, latest)
  };
}

// A decomposed parent's children as Change-station steps (null when not decomposed).
async function childSteps(root, meta, metas) {
  const decomposition = await loadDecomposition(root, meta.id);
  if (!decomposition.exists || !['executing', 'complete'].includes(decomposition.ledger.status)) return null;
  const all = metas ?? new Map((await readWorkMetas(root)).metas.map((entry) => [entry.id, entry]));
  return decomposition.ledger.children.filter((child) => child.required !== false && child.workId).map((child) => {
    const childMeta = all.get(child.workId);
    const status = childMeta?.status;
    const lifecycle = childMeta?.lifecycle?.state === 'closed' ? 'closed' : childMeta?.lifecycle?.state === 'on_hold' ? 'held' : null;
    return { id: child.workId, status: status === 'DONE' ? 'done' : lifecycle ?? (status && status !== 'INTAKE' ? 'now' : 'todo') };
  });
}

function lastActivity(meta, ledger, latest) {
  const times = [meta.updatedAt, ledger.updatedAt, latest?.verifiedAt, ...Object.values(ledger.skills ?? {}).map((entry) => entry.completedAt ?? entry.startedAt)];
  return times.filter(Boolean).sort().at(-1) ?? null;
}

// Full detail for one work item. `snapshot` stays small; this is what the item view reads.
export async function collectWorkDetail(root, workId, options = {}) {
  const listed = await readWorkMetas(root);
  const broken = listed.invalid.find((entry) => entry.id === workId);
  if (broken) throw Object.assign(new Error(broken.message), { code: 'WORK_ITEM_INVALID' });
  const meta = listed.metas.find((entry) => entry.id === workId);
  try {
    return await workDetail(root, workId, meta, options);
  } catch (error) {
    // Records that fail Core validation are reported as such, never as a missing item.
    if (meta && !error.code) error.code = 'WORK_ITEM_INVALID';
    throw error;
  }
}

async function workDetail(root, workId, meta, { now = new Date().toISOString() } = {}) {
  if (!meta) {
    const error = new Error(`Work item ${workId} was not found.`);
    error.code = 'WORK_NOT_FOUND';
    throw error;
  }
  const state = await getCurrentState(root);
  const item = await collectItem(root, meta, state);
  const detail = { schema: WORK_SCHEMA, generatedAt: now, yallaflowVersion: PACKAGE_VERSION, item, request: { raw: meta.rawRequest ?? null, title: meta.title ?? null } };
  detail.sources = await collectSources(root, meta);
  if (meta.routingStatus === 'pending') return { ...detail, checkpoints: [], history: [], questions: [], requirements: [], criteria: [], verification: [], children: [], gates: [] };

  const progress = await loadWorkProgress(root, meta);
  detail.checkpoints = progress.contract.skills.map((skillId) => {
    const entry = progress.ledger.skills[skillId] ?? { status: 'pending' };
    return { skill: skillId, station: stationForSkill(skillId), status: entry.status, startedAt: entry.startedAt ?? null, completedAt: entry.completedAt ?? null, summary: entry.summary ?? null, evidence: entry.evidence ?? [] };
  });
  detail.history = [
    ...(progress.ledger.history ?? []).map((entry) => ({ kind: 'revision', skill: entry.skill, from: entry.from, to: entry.to, reason: entry.reason, at: entry.changedAt })),
    ...(meta.lifecycleHistory ?? []).map((entry) => ({ kind: entry.action ?? 'lifecycle', from: entry.from ?? null, to: entry.to ?? null, reason: entry.reason ?? null, at: entry.changedAt ?? null }))
  ].sort((a, b) => String(a.at).localeCompare(String(b.at)));
  detail.questions = (await loadWorkQuestions(root, meta)).ledger.questions.map((entry) => ({
    id: entry.id, category: entry.category, material: entry.material !== false, status: entry.status, question: entry.question, answer: entry.answer ?? null, resolution: entry.resolution ?? null
  }));
  const resolved = await resolveDeliveryCriteria(root, meta);
  detail.requirements = resolved.requirements.map((entry) => ({ id: entry.id, statement: entry.statement, status: entry.status ?? 'active', provenance: entry.provenance ?? [] }));
  const assessed = convergenceRequired(meta) ? await evaluateConvergence(root, meta) : null;
  const byRef = new Map((assessed?.criteria ?? []).map((entry) => [entry.ref, entry]));
  detail.criteria = resolved.criteria.map((entry) => {
    const finding = byRef.get(entry.ref);
    return { id: entry.id, ref: entry.ref, requirement: entry.requirement, statement: entry.statement, status: entry.status ?? 'active', convergence: finding?.status ?? 'not-assessed', stale: Boolean(finding?.stale), reason: finding?.reason ?? null, evidence: (finding?.evidence ?? []).map(evidenceRef) };
  });
  detail.convergence = assessed ? { converged: Boolean(assessed.converged) } : null;
  detail.verification = (await listVerificationRuns(root, meta.id)).map((run) => ({ id: run.id, success: Boolean(run.success), command: run.command ?? null, at: run.verifiedAt ?? run.finishedAt ?? null, summary: run.summary ?? null }));
  const knowledge = (await loadWorkKnowledge(root, meta)).ledger;
  const resolveLineageRef = await lineageReferenceResolver(root).catch(() => null);
  detail.knowledge = {
    reviewStatus: knowledge?.reviewStatus ?? 'pending',
    candidates: (knowledge?.candidates ?? []).map((entry) => {
      const promotedAs = entry.promotedAs ?? entry.contextId ?? entry.factId ?? null;
      // 1.4.0: a record taken from another branch keeps that branch's fact IDs; show how
      // they resolve here through the preserved lineage (PF-0052).
      const lineage = promotedAs ? resolveLineageRef?.(meta.id, promotedAs) : null;
      return { id: entry.id, kind: entry.kind ?? null, status: entry.status, summary: entry.summary ?? null, promotedAs, ...(lineage ? { lineage } : {}) };
    })
  };
  // 1.4.0 (additive): review gates with their decisions; console decisions carry
  // provenance { via: 'console', identity: 'not verified', ... }.
  const reviews = (await loadReviews(root, meta.id)).ledger;
  detail.gates = Object.entries(reviews.gates ?? {}).map(([gate, entry]) => ({
    gate, status: entry.status, requestedAt: entry.requestedAt ?? null, respondedAt: entry.respondedAt ?? null, note: entry.note ?? null, provenance: entry.provenance ?? null,
    history: (entry.history ?? []).map((event) => ({ status: event.status, at: event.at ?? null, note: event.note ?? null, reason: event.reason ?? null, provenance: event.provenance ?? null }))
  }));
  const decomposition = await loadDecomposition(root, meta.id);
  detail.children = decomposition.exists ? decomposition.ledger.children.map((child) => ({ key: child.key, workId: child.workId ?? null, title: child.title, required: child.required !== false })) : [];
  return detail;
}

// A convergence finding's evidence as a stable, display-ready shape: `ref` is the
// verification run, repository path, or assessment it cites; `text` is Core's own wording.
function evidenceRef(entry) {
  if (typeof entry === 'string') return { type: 'text', ref: null, text: entry };
  return { type: entry.type ?? null, ref: entry.verificationRunId ?? entry.path ?? (entry.assessmentId ? `${entry.workId}/${entry.assessmentId}` : null), text: describeFindingEvidence(entry) };
}

export function availabilityNote(record) {
  const metadata = record?.metadata ?? {};
  if (metadata.extractionError) return `Text extraction failed: ${metadata.extractionError}`;
  if (metadata.extractionSkipped === 'exceeds-extraction-size-limit') return 'Larger than the text-extraction limit; preserved without text.';
  if (record?.contentAvailability === 'original-only') return 'This format is preserved as the original only; YallaFlow reads no text from it.';
  return null;
}

async function collectSources(root, meta) {
  const out = [];
  for (const link of meta.sources ?? []) {
    let record = null;
    try {
      record = await loadSource(root, link.id);
    } catch {
      record = null;
    }
    out.push({
      id: link.id,
      name: record?.sourceName ?? link.name ?? link.id,
      format: record?.detectedFormat ?? link.detectedFormat ?? null,
      contentType: record?.contentType ?? null,
      contentAvailability: record?.contentAvailability ?? link.contentAvailability ?? null,
      // Why no text exists, when intake recorded a reason (additive, 1.2.0).
      availabilityNote: availabilityNote(record),
      sizeBytes: record?.original?.sizeBytes ?? null,
      capturedAt: record?.capturedAt ?? null,
      relationship: link.relationship ?? 'work-input',
      linkedAt: link.linkedAt ?? null,
      available: Boolean(record)
    });
  }
  return out;
}
