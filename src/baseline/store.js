import path from 'node:path';
import { exists } from '../utils/fs.js';
import { readYaml, writeYaml } from '../core/yaml.js';
import { getCurrentState, listWork, nextWorkId, workspacePath, writeCurrentState } from '../core/workspace.js';
import { loadWorkProgress } from '../core/progress.js';
import { appliedTransition, loadContextLedger, mutateContextLedger } from '../context/ledger.js';
import { normalizeEvidenceRefs } from '../context/evidence.js';
import { nextLimitationId, normalizeLimitation, sameStatement, validateLimitation } from '../limitations/store.js';
import { invalidateGateIfApproved, setGateStatus } from '../reviews/store.js';
import { KNOWLEDGE_POLICY_VERSION } from '../knowledge/constants.js';
import { REGISTRY_VERSION } from '../skills/constants.js';
import { recordWorkMemoryBase } from '../shared/memory.js';
import { BASELINE_AREAS, BASELINE_FACT_SOURCES, BASELINE_FACT_STATUSES, BASELINE_SCHEMA_VERSION } from './constants.js';
import { appendRedactedText, writeRedactedText } from '../security/redact.js';

function baselineFilePath(root, workId) {
  return path.join(workspacePath(root), 'work', workId, 'baseline.yaml');
}

export async function findBaselineWork(root) {
  const work = await listWork(root);
  return work.find((item) => item.baseline === true) ?? null;
}

// Reuses the normal work-item lifecycle (investigation type: read-only, no
// application code modification authorized) rather than a second work engine.
// Idempotent while a baseline is still in progress: re-running `baseline start`
// resumes the existing draft work item instead of creating a competing one. Once a
// baseline has been approved and promoted, starting a new one is refused outright —
// v0.3.5 does not implement baseline refresh; a second baseline would either silently
// duplicate promoted context sections or require overwrite semantics this milestone
// does not define. No workspace mutation occurs on refusal.
export async function startBaseline(root, now = new Date().toISOString()) {
  const existing = await findBaselineWork(root);
  if (existing) {
    const { exists: hasBaseline, ledger } = await loadBaseline(root, existing.id);
    if (hasBaseline && ledger.status === 'approved') {
      throw new Error(
        'An approved Brownfield Baseline already exists.\n\n' +
        'Baseline refresh is not supported in this release.\n' +
        'Use normal YallaFlow work and knowledge promotion for incremental project changes.'
      );
    }
    return { meta: existing, created: false };
  }

  const id = await nextWorkId(root);
  const meta = {
    id,
    type: 'investigation',
    title: 'Repository Baseline',
    scope: 'architectural',
    workflow: 'investigation',
    readOnly: true,
    baseline: true,
    routingStatus: 'routed',
    routingConfidence: 'high',
    routingReason: 'Explicit brownfield baseline discovery (yallaflow baseline start).',
    routedAt: now,
    requiredCapabilities: ['baseline'],
    behaviorContract: { registryVersion: REGISTRY_VERSION, skills: ['repository-baseline'] },
    status: 'INTAKE',
    // Baseline review is governed by its own 'baseline' review gate (reviews.yaml),
    // not the ordinary feature-knowledge-candidate review gate.
    knowledgePolicy: { version: KNOWLEDGE_POLICY_VERSION, reviewRequired: false },
    createdAt: now,
    updatedAt: now
  };
  // Sparse workspace (v0.3.6): optional artifact directories are created lazily by the
  // first artifact that needs them, never eagerly.
  const dir = path.join(workspacePath(root), 'work', id);
  await writeYaml(path.join(dir, 'meta.yaml'), meta);
  await writeRedactedText(path.join(dir, 'work.md'), baselineWorkTemplate(meta));
  await writeRedactedText(path.join(dir, 'progress.md'), `# Work Ledger — ${id}\n\nCreated: ${now}\nKind: brownfield baseline discovery\n\n`);
  await recordWorkMemoryBase(root, id, now);
  await writeCurrentState(root, {
    schemaVersion: 1, activeWork: id, stage: 'INTAKE', updatedAt: now
  });
  return { meta, created: true };
}

function baselineWorkTemplate(meta) {
  return `# ${meta.id} — Repository Baseline\n\n**Type:** ${meta.type} (read-only)\n**Status:** ${meta.status}\n\nBuild an evidence-backed understanding of this repository (tech stack, architecture, database, auth, integrations, environments, testing, conventions, business rules). Record findings as a structured draft with \`yallaflow baseline draft ${meta.id} --file <baseline.json>\`, complete the \`repository-baseline\` checkpoint, then request review with \`yallaflow baseline approve ${meta.id}\` once ready.\n\n## Discovery Notes\n`;
}

export async function loadBaseline(root, workId) {
  const file = baselineFilePath(root, workId);
  if (!await exists(file)) return { exists: false, ledger: null };
  return { exists: true, ledger: await readYaml(file) };
}

async function loadMeta(root, workId) {
  const file = path.join(workspacePath(root), 'work', workId, 'meta.yaml');
  if (!await exists(file)) throw new Error(`Work item ${workId} was not found.`);
  return readYaml(file);
}

// GAP-BROWN-002/003/004: a structured, evidence-backed draft — never free-form prose,
// never filled by guessing. Requires the repository-baseline checkpoint to already be
// completed (an explicit "I've done sufficient discovery" declaration), mirroring how
// decomposition requires PLAN_READY before a proposal is accepted.
export async function draftBaseline(root, workId, input, now = new Date().toISOString()) {
  const meta = await loadMeta(root, workId);
  if (!meta.baseline) throw new Error(`${workId} is not a baseline work item.`);
  const progress = await loadWorkProgress(root, meta);
  if (progress.ledger.skills['repository-baseline']?.status !== 'completed') {
    throw new Error(`Complete the repository-baseline checkpoint before drafting: yallaflow checkpoint ${workId} --skill repository-baseline --complete --summary "..."`);
  }
  const existing = await loadBaseline(root, workId);
  if (existing.exists && existing.ledger.status === 'approved') {
    throw new Error(`${workId}'s baseline is already approved. Reopen review with \`yallaflow baseline feedback ${workId} --changes-requested\` first if it must change.`);
  }

  const facts = (input.facts ?? []).map((fact, index) => normalizeFact(fact, index));
  const errors = validateFacts(facts);
  // Discovery limitations ("lockfile versions were not inspected") describe this
  // session, not the project: they are recorded alongside the draft, shown in review,
  // and never promoted into project context.
  if (input.limitations !== undefined && !Array.isArray(input.limitations)) errors.push('limitations must be an array when supplied.');
  const limitations = [];
  for (const [index, raw] of (Array.isArray(input.limitations) ? input.limitations : []).entries()) {
    const entry = normalizeLimitation(raw, nextLimitationId(limitations), now);
    errors.push(...validateLimitation(entry, `limitation ${index + 1}`));
    limitations.push(entry);
  }
  // Coverage (v0.3.10-internal.4): what the discovery actually read, declared by the
  // Agent — so a long fact list is never mistaken for a complete reading.
  const coverage = normalizeCoverage(input.coverage, errors);
  for (const fact of facts) {
    const clash = limitations.find((entry) => sameStatement(entry.summary, fact.summary));
    if (clash) errors.push(`fact ${fact.id} repeats discovery limitation ${clash.id}; a discovery limitation is not a project fact — keep it only under limitations.`);
  }
  if (errors.length) throw new Error(`Baseline draft for ${workId} is invalid:\n${errors.map((entry) => `- ${entry}`).join('\n')}`);

  const ledger = {
    schemaVersion: BASELINE_SCHEMA_VERSION,
    status: 'draft',
    facts,
    ...(limitations.length ? { limitations } : {}),
    ...(coverage ? { coverage } : {}),
    history: [...(existing.exists ? existing.ledger.history : []), { action: 'drafted', at: now, factCount: facts.length }],
    draftedAt: now,
    updatedAt: now
  };
  await writeYaml(baselineFilePath(root, workId), ledger);
  if (existing.exists) {
    await invalidateGateIfApproved(root, workId, 'baseline', 'baseline draft revised', now);
  }
  return { meta, ledger };
}

export function summarizeBaseline(ledger) {
  const byArea = Object.fromEntries(BASELINE_AREAS.map((area) => [area, ledger.facts.filter((fact) => fact.area === area)]));
  const byStatus = Object.fromEntries(BASELINE_FACT_STATUSES.map((status) => [status, ledger.facts.filter((fact) => fact.status === status)]));
  return { byArea, byStatus, totalCount: ledger.facts.length, limitations: ledger.limitations ?? [] };
}

// Approval turns every drafted fact — confirmed, inferred, and unresolved alike — into
// a canonical project-context fact (context/index.yaml) through the ledger's single
// writer, which then renders the Markdown projection. This is the same path ordinary
// knowledge promotion takes, so each durable document still has exactly one writer. An
// unresolved fact is still durable knowledge: "this could not be established" is more
// useful to a future agent than silence. Discovery limitations are never promoted.
export async function approveBaseline(root, workId, note, now = new Date().toISOString()) {
  const meta = await loadMeta(root, workId);
  const { exists: hasBaseline, ledger } = await loadBaseline(root, workId);
  if (!hasBaseline) throw new Error(`${workId} has no baseline draft to approve. Run \`yallaflow baseline draft\` first.`);
  if (ledger.status === 'approved') throw new Error(`${workId}'s baseline is already approved.`);

  // Idempotent on retry: facts a previous, partially completed approval already
  // introduced are not introduced again (their projection is re-rendered).
  const { ledger: context } = await loadContextLedger(root);
  const prepared = [];
  const areas = new Set();
  for (const fact of ledger.facts) {
    areas.add(fact.area);
    if (appliedTransition(context, { workId, baselineFactId: fact.id })) continue;
    prepared.push({
      area: fact.area,
      summary: fact.summary,
      confidence: fact.status,
      provenance: fact.source,
      evidence: await normalizeEvidenceRefs(root, fact.evidence, { workId }),
      origin: { workId, baselineFactId: fact.id },
      ...(fact.note ? { note: fact.note } : {})
    });
  }
  await mutateContextLedger(root, (ops) => {
    for (const area of areas) ops.touch(area);
    return prepared.map((input) => ops.introduce(input));
  }, now);

  ledger.status = 'approved';
  ledger.approvedAt = now;
  ledger.history.push({ action: 'approved', at: now, ...(note ? { note: note.trim() } : {}) });
  ledger.updatedAt = now;
  await writeYaml(baselineFilePath(root, workId), ledger);
  await setGateStatus(root, workId, 'baseline', 'approved', note, now);

  // Baseline has no meaningful intermediate investigation stages (QUESTION/EVIDENCE/
  // HYPOTHESIS/...) — approval is the one deliberate transition into DONE, a narrow,
  // documented exception rather than forcing an unrelated stage vocabulary onto it.
  const metaFile = path.join(workspacePath(root), 'work', workId, 'meta.yaml');
  meta.status = 'DONE';
  meta.updatedAt = now;
  await writeYaml(metaFile, meta);
  const state = await getCurrentState(root);
  if (state.activeWork === workId) {
    await writeCurrentState(root, { schemaVersion: 1, activeWork: null, stage: null, updatedAt: now });
  }
  await appendRedactedText(path.join(workspacePath(root), 'work', workId, 'progress.md'), `- ${now} Baseline approved and promoted (${ledger.facts.length} fact(s)).\n`, 'utf8');
  return { meta, ledger };
}

export async function feedbackBaseline(root, workId, note, now = new Date().toISOString()) {
  const meta = await loadMeta(root, workId);
  const { exists: hasBaseline, ledger } = await loadBaseline(root, workId);
  if (!hasBaseline) throw new Error(`${workId} has no baseline draft yet.`);
  await setGateStatus(root, workId, 'baseline', 'changes_requested', note, now);
  ledger.history.push({ action: 'changes_requested', at: now, ...(note ? { note: note.trim() } : {}) });
  ledger.updatedAt = now;
  await writeYaml(baselineFilePath(root, workId), ledger);
  return { meta, ledger };
}

// Optional, additive baseline.yaml field (no schema bump: earlier readers ignore it).
//   inspected  areas/paths the discovery read directly
//   sampled    areas/paths it inspected selectively (some files, not all)
// What was NOT inspected or was unavailable stays in `limitations` (not-inspected,
// out-of-scope, unavailable, runtime-unavailable, insufficient-evidence); what could
// not be established stays an `unresolved` fact.
export const COVERAGE_KINDS = Object.freeze(['inspected', 'sampled']);
const MAX_COVERAGE_ENTRIES = 200;
const MAX_COVERAGE_TEXT = 500;

function normalizeCoverage(raw, errors) {
  if (raw === undefined) return null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    errors.push('coverage must be an object: { "inspected": [...], "sampled": [...] }.');
    return null;
  }
  const unknown = Object.keys(raw).filter((key) => !COVERAGE_KINDS.includes(key));
  if (unknown.length) errors.push(`coverage has unknown field(s): ${unknown.join(', ')} (allowed: ${COVERAGE_KINDS.join(', ')}; record what was not inspected or unavailable under limitations).`);
  const coverage = {};
  for (const kind of COVERAGE_KINDS) {
    if (raw[kind] === undefined) continue;
    const list = raw[kind];
    if (!Array.isArray(list) || list.some((entry) => typeof entry !== 'string' || !entry.trim() || entry.trim().length > MAX_COVERAGE_TEXT) || list.length > MAX_COVERAGE_ENTRIES) {
      errors.push(`coverage.${kind} must be a list of at most ${MAX_COVERAGE_ENTRIES} non-empty entries of at most ${MAX_COVERAGE_TEXT} characters.`);
      continue;
    }
    coverage[kind] = [...new Set(list.map((entry) => entry.trim().replace(/\s+/g, ' ')))];
  }
  if (!Object.keys(coverage).length) {
    errors.push('coverage must declare at least one of: inspected, sampled.');
    return null;
  }
  return coverage;
}

// Read-only coverage view for review: declared coverage, limitation categories,
// unresolved facts, and the repository paths the evidence actually cites. Never a
// completeness claim.
const NOT_INSPECTED_TYPES = Object.freeze(['not-inspected', 'out-of-scope']);
const UNAVAILABLE_TYPES = Object.freeze(['unavailable', 'runtime-unavailable', 'insufficient-evidence', 'uncaptured-artifact']);

export async function summarizeCoverage(root, ledger) {
  const limitations = ledger.limitations ?? [];
  const cited = new Set();
  for (const fact of ledger.facts) {
    for (const ref of fact.evidence ?? []) {
      const candidate = repositoryPathOf(ref);
      if (candidate && await exists(path.join(root, candidate))) cited.add(candidate);
    }
  }
  return {
    declared: Boolean(ledger.coverage),
    inspected: ledger.coverage?.inspected ?? [],
    sampled: ledger.coverage?.sampled ?? [],
    notInspected: limitations.filter((entry) => NOT_INSPECTED_TYPES.includes(entry.type)),
    unavailable: limitations.filter((entry) => UNAVAILABLE_TYPES.includes(entry.type)),
    unresolved: ledger.facts.filter((fact) => fact.status === 'unresolved'),
    citedPaths: [...cited].sort()
  };
}

// The repository path an evidence reference names (path, path#symbol, path:12-40),
// or null for runtime:/user:/verification: and free-text references.
export function repositoryPathOf(ref) {
  if (typeof ref !== 'string') return null;
  const value = ref.trim();
  if (!value || /\s/.test(value) || /^(?:runtime|user|user-confirmed|verification):/i.test(value)) return null;
  const candidate = value.replace(/#.*$/, '').replace(/:\d+(?:-\d+)?$/, '');
  if (!candidate || path.isAbsolute(candidate)) return null;
  const normalized = path.posix.normalize(candidate.split(path.sep).join('/'));
  return normalized.startsWith('..') ? null : normalized.replace(/\/$/, '');
}

function normalizeFact(fact, index) {
  return {
    id: `BF-${String(index + 1).padStart(3, '0')}`,
    area: fact?.area,
    status: fact?.status,
    summary: isNonEmptyString(fact?.summary) ? fact.summary.trim() : fact?.summary,
    evidence: Array.isArray(fact?.evidence) ? fact.evidence.map((entry) => (isNonEmptyString(entry) ? entry.trim() : entry)) : fact?.evidence,
    source: fact?.source,
    ...(fact?.note !== undefined ? { note: fact.note } : {})
  };
}

function validateFacts(facts) {
  const errors = [];
  if (!Array.isArray(facts) || !facts.length) return ['facts must be a non-empty array.'];
  facts.forEach((fact, index) => {
    const label = `fact ${index + 1}`;
    if (!BASELINE_AREAS.includes(fact.area)) errors.push(`${label}: area must be one of: ${BASELINE_AREAS.join(', ')}.`);
    if (!BASELINE_FACT_STATUSES.includes(fact.status)) errors.push(`${label}: status must be one of: ${BASELINE_FACT_STATUSES.join(', ')}.`);
    if (!isNonEmptyString(fact.summary)) errors.push(`${label}: summary must be a non-empty string.`);
    if (!Array.isArray(fact.evidence) || !fact.evidence.length || fact.evidence.some((entry) => !isNonEmptyString(entry))) {
      errors.push(`${label}: evidence must be a non-empty array of non-empty strings.`);
    }
    if (!BASELINE_FACT_SOURCES.includes(fact.source)) errors.push(`${label}: source must be one of: ${BASELINE_FACT_SOURCES.join(', ')}.`);
    if (fact.note !== undefined && !isNonEmptyString(fact.note)) errors.push(`${label}: note must be a non-empty string when supplied.`);
  });
  return errors;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

// Read-only: where an existing Brownfield Baseline stands and the one next step, for
// `brief`, `inspect`, and `baseline status`. It never advances anything; the last step
// is always a human running `yallaflow baseline approve`.
export async function baselineNextStep(root, meta) {
  try {
    return await resolveBaselineNextStep(root, meta);
  } catch {
    // A malformed baseline/progress ledger (e.g. an unresolved merge) must not break
    // read-only orientation; doctor reports the structural problem.
    return { state: 'unreadable', text: `baseline ${meta.id} state could not be read`, command: 'yallaflow doctor' };
  }
}

async function resolveBaselineNextStep(root, meta) {
  const id = meta.id;
  const { exists: hasBaseline, ledger } = await loadBaseline(root, id);
  if (hasBaseline && ledger.status === 'approved') {
    return { state: 'approved', text: `baseline ${id} approved`, command: 'yallaflow brief' };
  }
  const progress = await loadWorkProgress(root, meta);
  if (progress.ledger.skills['repository-baseline']?.status !== 'completed') {
    return {
      state: 'discovery',
      text: `baseline ${id} in progress — complete repository discovery (yallaflow inspect; register material documents with yallaflow intake add ${id} <path>)`,
      command: `yallaflow checkpoint ${id} --skill repository-baseline --complete --summary "..."`
    };
  }
  if (!hasBaseline) {
    return { state: 'draft', text: `baseline ${id} discovery complete — record the evidence-backed draft`, command: `yallaflow baseline draft ${id} --file <baseline.json>` };
  }
  if (ledger.history.at(-1)?.action === 'changes_requested') {
    return { state: 'changes-requested', text: `baseline ${id}: changes requested by the reviewer — revise the draft`, command: `yallaflow baseline draft ${id} --file <baseline.json>` };
  }
  return {
    state: 'awaiting-review',
    text: `baseline ${id} draft (${ledger.facts.length} fact(s)) awaits the developer's review — present it and ask; approval is theirs, never the Agent's own judgment`,
    command: `yallaflow baseline show ${id}   (after the developer explicitly approves: yallaflow baseline approve ${id} --note "<their approval>" | changes: baseline feedback ${id} --changes-requested)`
  };
}

// Original-request continuity (v0.3.10-internal.4). When a developer's first request
// made the Brownfield baseline necessary, that request is the baseline's discovery
// objective (purpose.yaml). After approval it is the next work to continue — without
// asking the developer to repeat it and without another repository-wide bootstrap —
// until some later work item exists. Derived from durable state; nothing new stored.
export async function pendingOriginalRequest(root) {
  const work = await listWork(root);
  const baseline = work.find((item) => item.baseline === true);
  if (!baseline) return null;
  const { exists: hasBaseline, ledger } = await loadBaseline(root, baseline.id);
  if (!hasBaseline || ledger.status !== 'approved') return null;
  const purposeFile = path.join(workspacePath(root), 'work', baseline.id, 'purpose.yaml');
  if (!await exists(purposeFile)) return null;
  let objective = null;
  try {
    objective = (await readYaml(purposeFile))?.objective ?? null;
  } catch {
    return null; // doctor reports an unreadable purpose
  }
  if (typeof objective !== 'string' || !objective.trim()) return null;
  const approvedAt = ledger.approvedAt ?? baseline.updatedAt ?? '';
  const continued = work.some((item) => item.id !== baseline.id && !item.reconciliation && (item.createdAt ?? '') >= approvedAt);
  return continued ? null : { baselineId: baseline.id, objective: objective.trim() };
}
