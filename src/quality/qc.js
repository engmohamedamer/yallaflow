import path from 'node:path';
import { createHash } from 'node:crypto';
import { exists } from '../utils/fs.js';
import { readYaml, writeYamlAtomic } from '../core/yaml.js';
import { loadWorkMetaOrThrow } from '../core/workspace.js';
import { listVerificationRuns } from '../core/evidence.js';
import { gitHead } from '../core/git.js';
import { uncommittedPaths } from '../shared/git.js';
import { activeCriteria, bareRef, resolveDeliveryCriteria } from '../delivery/requirements.js';
import { loadProjectConfig } from '../shared/config.js';
import { SKILL_INSTRUCTION_VERSIONS, latestInstructionVersion } from '../skills/instructions.js';
import {
  DEFAULT_QC_POLICY, PLAN_ID, QC_ORIGINS, QC_POLICIES, QC_SCENARIO_KINDS, QC_SCHEMA_VERSION, QC_STATUSES, QC_TOOLS,
  RUN_ID, SCENARIO_ID, isLocalTarget
} from './constants.js';
import { nextId, nonEmpty, normalizeTarget, stringList, unknown } from './input.js';
import { inspectArtifacts, qualityDirPath, removeRecordMedia, storeArtifacts, validateArtifactEntry } from './artifacts.js';

// AI QC ledger (v1.1.0): work/<id>/quality/qc.json — append-only plans (QP-###) and
// runs (QC-###), separate from the V-### verification ledger. A QC failure never
// reopens verification, never moves a stage, and never blocks DONE; it is reported.
//
// Policy: advisory (default) or strict (explicit opt-in: the plan's `policy`, else
// config.yaml quality.qc.policy). Under strict, quality approval is GRANTED only when
// every required scenario's latest result is passed — a quality signal distinct from,
// and never changing, lifecycle completion.
const LEDGER_FIELDS = new Set(['schemaVersion', 'plans', 'runs', 'updatedAt']);
const PLAN_INPUT_FIELDS = new Set(['policy', 'target', 'scenarios', 'summary']);
const SCENARIO_INPUT_FIELDS = new Set(['id', 'kind', 'title', 'criteria', 'required', 'charter', 'steps', 'rationale']);
const RUN_INPUT_FIELDS = new Set(['plan', 'tool', 'origin', 'verificationRun', 'target', 'scenarios', 'limitations', 'summary']);
const RESULT_INPUT_FIELDS = new Set(['id', 'status', 'steps', 'expected', 'actual', 'artifacts', 'notes', 'reason']);

export function qcFilePath(root, workId) {
  return path.join(qualityDirPath(root, workId), 'qc.json');
}

function emptyLedger() {
  return { schemaVersion: QC_SCHEMA_VERSION, plans: [], runs: [], updatedAt: null };
}

export async function loadQcLedger(root, workId) {
  const file = qcFilePath(root, workId);
  if (!await exists(file)) return { exists: false, ledger: emptyLedger() };
  const ledger = await readYaml(file);
  const errors = validateQcLedger(ledger);
  if (errors.length) throw new Error(`QC ledger for ${workId} is invalid:\n- ${errors.join('\n- ')}`);
  return { exists: true, ledger };
}

export function validateQcLedger(ledger) {
  const errors = [];
  if (!ledger || typeof ledger !== 'object' || Array.isArray(ledger)) return ['qc.json must be an object'];
  if (ledger.schemaVersion !== QC_SCHEMA_VERSION) return [`qc.json schemaVersion ${JSON.stringify(ledger.schemaVersion)} is not supported (expected ${QC_SCHEMA_VERSION})`];
  const extra = Object.keys(ledger).filter((key) => !LEDGER_FIELDS.has(key));
  if (extra.length) errors.push(`qc.json has unknown field(s): ${extra.join(', ')}`);
  if (!Array.isArray(ledger.plans) || !Array.isArray(ledger.runs)) return [...errors, 'qc.json plans and runs must be arrays'];
  for (const plan of ledger.plans) {
    if (!PLAN_ID.test(plan?.id ?? '')) errors.push(`qc plan ${JSON.stringify(plan?.id)} has an invalid id`);
    if (!QC_POLICIES.includes(plan?.policy)) errors.push(`qc plan ${plan?.id} has an invalid policy`);
    if (!Array.isArray(plan?.scenarios) || !plan.scenarios.length) errors.push(`qc plan ${plan?.id} has no scenarios`);
  }
  for (const run of ledger.runs) {
    if (!RUN_ID.test(run?.id ?? '')) { errors.push(`qc run ${JSON.stringify(run?.id)} has an invalid id`); continue; }
    if (!ledger.plans.some((plan) => plan.id === run.planId)) errors.push(`${run.id} names unknown plan ${run.planId}`);
    if (!QC_ORIGINS.includes(run.origin)) errors.push(`${run.id} has an invalid origin`);
    for (const result of run.scenarios ?? []) {
      if (!QC_STATUSES.includes(result?.status)) errors.push(`${run.id} ${result?.id}: invalid status`);
      for (const [index, artifact] of (result?.artifacts ?? []).entries()) errors.push(...validateArtifactEntry(artifact, `${run.id} ${result.id} artifact #${index + 1}`));
    }
  }
  return errors;
}

// Quality records attach to routed work at any stage — DONE included — without
// rerouting, reopening, or changing it.
export async function assertQualityTarget(root, workId) {
  const meta = await loadWorkMetaOrThrow(root, workId);
  if (meta.routingStatus === 'pending') throw new Error(`${workId} is awaiting routing. Route the work before recording QC or demo results for it.`);
  return meta;
}

export async function loadQualitySettings(root) {
  const config = await loadProjectConfig(root).catch(() => ({}));
  const quality = config?.quality ?? {};
  return {
    qcPolicy: QC_POLICIES.includes(quality.qc?.policy) ? quality.qc.policy : null,
    commitMedia: quality.media?.commit === true
  };
}

export function skillStamp(skillId) {
  const version = latestInstructionVersion(skillId);
  const entry = SKILL_INSTRUCTION_VERSIONS[skillId]?.[version];
  return entry ? { id: skillId, version, sha256: entry.sha256 } : null;
}

export async function recordQcPlan(root, workId, input, now = new Date().toISOString()) {
  const meta = await assertQualityTarget(root, workId);
  const errors = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw rejection(['the plan file must be a JSON object']);
  unknown(input, PLAN_INPUT_FIELDS, 'plan', errors);
  if (input.policy !== undefined && !QC_POLICIES.includes(input.policy)) errors.push(`policy must be one of: ${QC_POLICIES.join(', ')}`);
  const target = normalizeTarget(input.target, 'plan target', errors);
  const resolved = await resolveDeliveryCriteria(root, meta);
  const active = activeCriteria(resolved);
  const scenarios = [];
  if (!Array.isArray(input.scenarios) || !input.scenarios.length) errors.push('scenarios must be a non-empty array');
  for (const [index, raw] of (Array.isArray(input.scenarios) ? input.scenarios : []).entries()) {
    const label = `scenario ${raw?.id ?? `#${index + 1}`}`;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { errors.push(`${label} must be an object`); continue; }
    unknown(raw, SCENARIO_INPUT_FIELDS, label, errors);
    if (!SCENARIO_ID.test(raw.id ?? '')) errors.push(`${label}: id must look like S-01`);
    if (scenarios.some((entry) => entry.id === raw.id)) errors.push(`${label}: duplicate id`);
    if (!QC_SCENARIO_KINDS.includes(raw.kind)) errors.push(`${label}: kind must be one of ${QC_SCENARIO_KINDS.join(', ')}`);
    if (!nonEmpty(raw.title)) errors.push(`${label} requires a title`);
    const criteria = [];
    for (const ref of raw.criteria ?? []) {
      const match = typeof ref === 'string' ? active.find((entry) => entry.id === bareRef(ref.trim(), resolved.owner)) : null;
      if (!match) errors.push(`${label}: ${JSON.stringify(ref)} is not an active acceptance criterion of ${workId}`);
      else criteria.push(match.ref);
    }
    if (raw.criteria !== undefined && !Array.isArray(raw.criteria)) errors.push(`${label}: criteria must be an array`);
    if (raw.kind === 'functional') {
      if (active.length && !criteria.length) errors.push(`${label}: a functional scenario must cover at least one active acceptance criterion`);
      if (!active.length && !nonEmpty(raw.rationale)) errors.push(`${label}: ${workId} has no recorded acceptance criteria, so a functional scenario needs a rationale naming the behavior it checks`);
    }
    if (raw.kind === 'exploratory' && !nonEmpty(raw.charter)) errors.push(`${label}: an exploratory scenario requires a charter (what to explore, and why)`);
    if (raw.required !== undefined && typeof raw.required !== 'boolean') errors.push(`${label}: required must be true or false`);
    const steps = stringList(raw.steps, `${label} steps`, errors);
    scenarios.push({
      id: raw.id,
      kind: raw.kind,
      title: nonEmpty(raw.title) ? raw.title.trim() : raw.title,
      criteria,
      required: raw.required ?? raw.kind === 'functional',
      ...(nonEmpty(raw.charter) ? { charter: raw.charter.trim() } : {}),
      ...(nonEmpty(raw.rationale) ? { rationale: raw.rationale.trim() } : {}),
      ...(steps.length ? { steps } : {})
    });
  }
  if (errors.length) throw rejection(errors);

  const settings = await loadQualitySettings(root);
  // A project-wide strict policy is a floor: a plan may not weaken it.
  if (settings.qcPolicy === 'strict' && input.policy === 'advisory') {
    throw rejection(['the project requires the strict QC policy (config.yaml quality.qc.policy: strict); a plan cannot weaken it to advisory']);
  }
  const loaded = await loadQcLedger(root, workId);
  const ledger = loaded.ledger;
  const plan = {
    id: nextId('QP', ledger.plans),
    recordedAt: now,
    workStatus: meta.status,
    policy: input.policy ?? settings.qcPolicy ?? DEFAULT_QC_POLICY,
    policySource: input.policy ? 'plan' : settings.qcPolicy ? 'config' : 'default',
    ...(target ? { target } : {}),
    ...(nonEmpty(input.summary) ? { summary: input.summary.trim() } : {}),
    criteriaCovered: [...new Set(scenarios.flatMap((scenario) => scenario.criteria))],
    criteriaNotCovered: active.map((entry) => entry.ref).filter((ref) => !scenarios.some((scenario) => scenario.criteria.includes(ref))),
    scenarios,
    sha256: createHash('sha256').update(JSON.stringify(scenarios)).digest('hex'),
    skill: skillStamp('ai-qc')
  };
  ledger.plans.push(plan);
  ledger.updatedAt = now;
  await writeYamlAtomic(qcFilePath(root, workId), ledger);
  return { meta, plan, ledger };
}

export async function recordQcRun(root, workId, input, { now = new Date().toISOString(), cwd = process.cwd(), allowRemote = false } = {}) {
  const meta = await assertQualityTarget(root, workId);
  const errors = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw rejection(['the result file must be a JSON object']);
  unknown(input, RUN_INPUT_FIELDS, 'result', errors);
  const loaded = await loadQcLedger(root, workId);
  const ledger = loaded.ledger;
  if (!ledger.plans.length) throw rejection([`${workId} has no QC plan: record one first (yallaflow qc plan ${workId} --file plan.json)`]);
  const plan = input.plan === undefined ? ledger.plans.at(-1) : ledger.plans.find((entry) => entry.id === input.plan);
  if (!plan) throw rejection([`plan ${JSON.stringify(input.plan)} does not exist`]);
  if (!QC_TOOLS.includes(input.tool)) errors.push(`tool must be one of: ${QC_TOOLS.join(', ')}`);
  if (!QC_ORIGINS.includes(input.origin)) errors.push(`origin must be one of: ${QC_ORIGINS.join(', ')}`);
  let verificationRun = null;
  if (input.origin === 'yallaflow-verified') {
    const runs = await listVerificationRuns(root, workId);
    verificationRun = runs.find((entry) => entry.id === input.verificationRun) ?? null;
    if (!verificationRun) errors.push(`origin yallaflow-verified requires verificationRun naming an existing verification run of ${workId} (yallaflow verify ${workId} -- npx playwright test …)`);
    else if (meta.lastInvalidationAt && !(verificationRun.verifiedAt > meta.lastInvalidationAt)) {
      errors.push(`verification run ${verificationRun.id} predates the latest reopen/revision of ${workId} (${meta.lastInvalidationAt}); run the tests again and cite the new run`);
    }
  } else if (input.verificationRun !== undefined) {
    errors.push('verificationRun is only valid with origin yallaflow-verified');
  }
  const target = normalizeTarget(input.target, 'result target', errors) ?? plan.target ?? null;
  if (target && !isLocalTarget(target.baseUrl) && !allowRemote) {
    errors.push(`target ${target.baseUrl} is not a local address; QC against a shared or production system needs an explicit --allow-remote (and test data only)`);
  }
  const limitations = stringList(input.limitations, 'limitations', errors);
  const results = [];
  const inspectedByResult = new Map();
  for (const [index, raw] of (Array.isArray(input.scenarios) ? input.scenarios : []).entries()) {
    const label = `scenario ${raw?.id ?? `#${index + 1}`}`;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { errors.push(`${label} must be an object`); continue; }
    unknown(raw, RESULT_INPUT_FIELDS, label, errors);
    const planned = plan.scenarios.find((entry) => entry.id === raw.id);
    if (!planned) { errors.push(`${label} is not in plan ${plan.id}`); continue; }
    if (results.some((entry) => entry.id === raw.id)) { errors.push(`${label}: reported more than once`); continue; }
    if (!QC_STATUSES.includes(raw.status)) { errors.push(`${label}: status must be one of ${QC_STATUSES.join(', ')}`); continue; }
    const steps = stringList(raw.steps, `${label} steps`, errors);
    let inspected = [];
    try {
      inspected = await inspectArtifacts(raw.artifacts, { cwd, label: `${label} artifact` });
    } catch (error) {
      errors.push(error.message);
    }
    // Honesty rules: a status must carry the evidence that makes it true.
    if (raw.status === 'passed') {
      if (!steps.length) errors.push(`${label}: passed requires the steps that were actually executed`);
      const verified = input.origin === 'yallaflow-verified' && verificationRun;
      if (verified && !verificationRun.success) errors.push(`${label}: cannot be passed — verification run ${verificationRun.id} failed`);
      if (!inspected.length && !verified) errors.push(`${label}: passed requires execution evidence — at least one artifact (screenshot, trace, video, log) or origin yallaflow-verified with a passed verification run`);
    }
    if (raw.status === 'failed') {
      if (!steps.length) errors.push(`${label}: failed requires reproducible steps`);
      if (!nonEmpty(raw.actual)) errors.push(`${label}: failed requires the actual behavior observed`);
    }
    if ((raw.status === 'blocked' || raw.status === 'not-run') && !nonEmpty(raw.reason)) errors.push(`${label}: ${raw.status} requires a reason`);
    inspectedByResult.set(raw.id, inspected);
    results.push({
      id: raw.id,
      status: raw.status,
      ...(steps.length ? { steps } : {}),
      ...(nonEmpty(raw.expected) ? { expected: raw.expected.trim() } : {}),
      ...(nonEmpty(raw.actual) ? { actual: raw.actual.trim() } : {}),
      ...(nonEmpty(raw.notes) ? { notes: raw.notes.trim() } : {}),
      ...(nonEmpty(raw.reason) ? { reason: raw.reason.trim() } : {})
    });
  }
  if (!results.length) errors.push('scenarios must report at least one planned scenario');
  if (errors.length) throw rejection(errors);

  const id = nextId('QC', ledger.runs);
  const settings = await loadQualitySettings(root);
  try {
    const used = new Set();
    for (const result of results) {
      const artifacts = await storeArtifacts(root, workId, id, inspectedByResult.get(result.id), { commitMedia: settings.commitMedia, used });
      if (artifacts.length) result.artifacts = artifacts;
    }
    const head = gitHead(root);
    const dirty = uncommittedPaths(root);
    const notReported = plan.scenarios.filter((scenario) => !results.some((result) => result.id === scenario.id)).map((scenario) => scenario.id);
    const run = {
      id,
      planId: plan.id,
      recordedAt: now,
      workStatus: meta.status,
      tool: input.tool,
      origin: input.origin,
      ...(verificationRun ? { verificationRun: verificationRun.id } : {}),
      ...(target ? { target } : {}),
      environment: { ...(head ? { gitCommit: head } : {}), ...(dirty ? { uncommittedChanges: dirty.length > 0 } : {}) },
      ...(nonEmpty(input.summary) ? { summary: input.summary.trim() } : {}),
      scenarios: results,
      ...(notReported.length ? { notReported } : {}),
      limitations,
      skill: skillStamp('ai-qc')
    };
    ledger.runs.push(run);
    ledger.updatedAt = now;
    await writeYamlAtomic(qcFilePath(root, workId), ledger);
    return { meta, plan, run, ledger };
  } catch (error) {
    await removeRecordMedia(root, workId, id);
    throw error;
  }
}

// The current QC view: per planned scenario (latest plan), its latest result across
// runs of any plan; and, under the strict policy, whether quality approval is granted.
// A scenario's identity is its definition, not just its id: a result recorded against an
// earlier plan counts only when that plan defined the scenario identically.
export function scenarioFingerprint(scenario) {
  const { kind, title, criteria, required, charter, rationale, steps } = scenario ?? {};
  return createHash('sha256').update(JSON.stringify({ kind, title, criteria, required, charter, rationale, steps })).digest('hex');
}

function plannedScenario(ledger, planId, scenarioId) {
  return ledger.plans.find((plan) => plan.id === planId)?.scenarios.find((scenario) => scenario.id === scenarioId) ?? null;
}

// The stricter of the plan's policy and the project's current config governs: a project
// that switches to strict after an advisory plan is judged strictly from then on.
export function evaluateQc(ledger, meta = null, { configPolicy = null } = {}) {
  const plan = ledger.plans.at(-1) ?? null;
  if (!plan) return { plan: null, scenarios: [], policy: null, failures: [], approval: null, runs: 0 };
  const policy = plan.policy === 'strict' || configPolicy === 'strict' ? 'strict' : 'advisory';
  const scenarios = plan.scenarios.map((scenario) => {
    const fingerprint = scenarioFingerprint(scenario);
    let latest = null;
    for (const run of ledger.runs) {
      const result = run.scenarios.find((entry) => entry.id === scenario.id);
      if (!result || scenarioFingerprint(plannedScenario(ledger, run.planId, scenario.id)) !== fingerprint) continue;
      latest = { ...result, runId: run.id, recordedAt: run.recordedAt, origin: run.origin, tool: run.tool };
    }
    const stale = Boolean(latest && meta?.lastInvalidationAt && !(latest.recordedAt > meta.lastInvalidationAt));
    return { ...scenario, latest, stale };
  });
  const failures = scenarios.filter((scenario) => scenario.latest && scenario.latest.status !== 'passed');
  let approval = null;
  if (policy === 'strict') {
    const required = scenarios.filter((scenario) => scenario.required);
    const missing = required.filter((scenario) => scenario.latest?.status !== 'passed' || scenario.stale);
    approval = {
      granted: required.length > 0 && missing.length === 0,
      required: required.length,
      reasons: required.length
        ? missing.map((scenario) => `${scenario.id} ${scenario.latest ? (scenario.stale ? 'passed before the latest reopen/revision' : scenario.latest.status) : 'has not been run'}`)
        : ['the plan marks no scenario as required']
    };
  }
  return { plan, scenarios, policy, failures, approval, runs: ledger.runs.length };
}

// A finding may cite `qc:QC-001#S-01`. Returns the evidence entry, or throws.
export async function resolveQcEvidence(root, workId, runId, scenarioId) {
  const { exists: present, ledger } = await loadQcLedger(root, workId);
  if (!present) throw new Error(`${workId} has no QC records`);
  const run = ledger.runs.find((entry) => entry.id === runId);
  if (!run) throw new Error(`QC run ${runId} was not found for ${workId}`);
  const result = run.scenarios.find((entry) => entry.id === scenarioId);
  if (!result) throw new Error(`${runId} has no result for ${scenarioId}`);
  return {
    type: 'runtime',
    description: `QC ${runId} ${scenarioId} ${result.status} (${run.origin} via ${run.tool})`,
    workId,
    qcRunId: runId,
    qcScenario: scenarioId,
    qcStatus: result.status,
    qcRecordedAt: run.recordedAt
  };
}

// Why a cited QC result no longer reflects the current state, or null.
export async function qcEvidenceStaleness(root, meta, entry) {
  const { ledger } = await loadQcLedger(root, meta.id).catch(() => ({ ledger: emptyLedger() }));
  const cited = ledger.runs.find((run) => run.id === entry.qcRunId);
  const fingerprint = cited ? scenarioFingerprint(plannedScenario(ledger, cited.planId, entry.qcScenario)) : null;
  const current = ledger.plans.at(-1)?.scenarios.find((scenario) => scenario.id === entry.qcScenario);
  if (fingerprint && current && scenarioFingerprint(current) !== fingerprint) return `QC ${entry.qcScenario} was redefined by plan ${ledger.plans.at(-1).id} after ${entry.qcRunId}`;
  const later = ledger.runs
    .filter((run) => run.recordedAt > entry.qcRecordedAt && scenarioFingerprint(plannedScenario(ledger, run.planId, entry.qcScenario)) === fingerprint)
    .map((run) => ({ run, result: run.scenarios.find((item) => item.id === entry.qcScenario) }))
    .filter((item) => item.result);
  const latest = later.at(-1);
  if (latest && latest.result.status !== 'passed') return `QC ${entry.qcScenario} was recorded ${latest.result.status} by later run ${latest.run.id}`;
  if (meta.lastInvalidationAt && !(entry.qcRecordedAt > meta.lastInvalidationAt)) return `cites QC ${entry.qcRunId}, recorded before the latest reopen/revision`;
  return null;
}

function rejection(errors) {
  return new Error(`QC record rejected:\n- ${errors.join('\n- ')}\n\nNo files were changed.`);
}

