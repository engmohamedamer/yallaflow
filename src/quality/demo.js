import path from 'node:path';
import { createHash } from 'node:crypto';
import { exists } from '../utils/fs.js';
import { readYaml, writeYamlAtomic } from '../core/yaml.js';
import { gitHead } from '../core/git.js';
import { redactDeep } from '../security/redact.js';
import { activeCriteria, bareRef, resolveDeliveryCriteria } from '../delivery/requirements.js';
import {
  DEMO_AUDIENCES, DEMO_DISCLAIMER, DEMO_PROPOSAL_ID, DEMO_RESULT_STATUSES, DEMO_RUN_ID, DEMO_SCENARIO_ID, DEMO_SCHEMA_VERSION,
  QC_TOOLS, isLocalTarget
} from './constants.js';
import { allocateRecordId, duplicateIds, nonEmpty, normalizeTarget, stringList, unknown } from './input.js';
import { createRecordMedia, inspectArtifacts, qualityDirPath, validateArtifactEntry } from './artifacts.js';
import { assertQualityTarget, loadQualitySettings, skillStamp } from './qc.js';

// Smart Demo ledger (v1.1.0): work/<id>/quality/demo.json — independent of QC.
//   proposals (DP-###)  the Agent's prioritized demo scope: which user-facing scenarios
//                       are worth showing, for which audience, and why
//   approvals           the developer's explicit approval of one exact proposal (bound
//                       by its SHA-256), recorded with their words — never inferred
//   runs (DM-###)       what was actually shown; video and screenshots optional
// A demo is never test evidence: every run carries the disclaimer, and convergence
// refuses demo citations.
const LEDGER_FIELDS = new Set(['schemaVersion', 'proposals', 'approvals', 'runs', 'updatedAt']);
const PROPOSAL_INPUT_FIELDS = new Set(['target', 'scenarios', 'excluded', 'summary']);
const SCENARIO_INPUT_FIELDS = new Set(['id', 'title', 'audience', 'priority', 'criteria', 'rationale', 'steps', 'record', 'data']);
const RUN_INPUT_FIELDS = new Set(['proposal', 'tool', 'target', 'audience', 'video', 'scenarios', 'limitations', 'summary']);
const RESULT_INPUT_FIELDS = new Set(['id', 'status', 'notes', 'artifacts']);

export function demoFilePath(root, workId) {
  return path.join(qualityDirPath(root, workId), 'demo.json');
}

function emptyLedger() {
  return { schemaVersion: DEMO_SCHEMA_VERSION, proposals: [], approvals: [], runs: [], updatedAt: null };
}

export async function loadDemoLedger(root, workId) {
  const file = demoFilePath(root, workId);
  if (!await exists(file)) return { exists: false, ledger: emptyLedger() };
  const ledger = await readYaml(file);
  const errors = validateDemoLedger(ledger);
  if (errors.length) throw new Error(`Demo ledger for ${workId} is invalid:\n- ${errors.join('\n- ')}`);
  return { exists: true, ledger };
}

export function validateDemoLedger(ledger) {
  const errors = [];
  if (!ledger || typeof ledger !== 'object' || Array.isArray(ledger)) return ['demo.json must be an object'];
  if (ledger.schemaVersion !== DEMO_SCHEMA_VERSION) return [`demo.json schemaVersion ${JSON.stringify(ledger.schemaVersion)} is not supported (expected ${DEMO_SCHEMA_VERSION})`];
  const extra = Object.keys(ledger).filter((key) => !LEDGER_FIELDS.has(key));
  if (extra.length) errors.push(`demo.json has unknown field(s): ${extra.join(', ')}`);
  if (![ledger.proposals, ledger.approvals, ledger.runs].every(Array.isArray)) return [...errors, 'demo.json proposals, approvals and runs must be arrays'];
  for (const proposal of ledger.proposals) {
    if (!DEMO_PROPOSAL_ID.test(proposal?.id ?? '')) errors.push(`demo proposal ${JSON.stringify(proposal?.id)} has an invalid id`);
    if (!/^[0-9a-f]{64}$/.test(proposal?.sha256 ?? '')) errors.push(`demo proposal ${proposal?.id} has an invalid sha256`);
    // The approval is bound to this content: an edited proposal no longer matches its hash.
    else if (proposalHash(proposal) !== proposal.sha256) errors.push(`demo proposal ${proposal.id} no longer matches its recorded sha256 (edited after it was proposed?)`);
  }
  for (const approval of ledger.approvals) {
    const proposal = ledger.proposals.find((entry) => entry.id === approval?.proposalId);
    if (!proposal) errors.push(`demo approval names unknown proposal ${approval?.proposalId}`);
    else if (proposal.sha256 !== approval.sha256) errors.push(`demo approval of ${approval.proposalId} does not match the proposal it approved`);
    if (typeof approval?.note !== 'string' || !approval.note.trim()) errors.push(`demo approval of ${approval?.proposalId} has no recorded developer note`);
  }
  for (const run of ledger.runs) {
    if (!DEMO_RUN_ID.test(run?.id ?? '')) { errors.push(`demo run ${JSON.stringify(run?.id)} has an invalid id`); continue; }
    const approval = ledger.approvals.find((entry) => entry.proposalId === run.proposalId && entry.sha256 === run.proposalSha256);
    if (!approval) errors.push(`${run.id} was not recorded against an approved proposal`);
    if (run.disclaimer !== DEMO_DISCLAIMER) errors.push(`${run.id} is missing the demo disclaimer`);
    for (const [index, artifact] of [...(run.video ? [run.video] : []), ...(run.scenarios ?? []).flatMap((entry) => entry.artifacts ?? [])].entries()) {
      errors.push(...validateArtifactEntry(artifact, `${run.id} artifact #${index + 1}`));
    }
  }
  return errors;
}

export async function proposeDemo(root, workId, input, now = new Date().toISOString()) {
  const meta = await assertQualityTarget(root, workId);
  const errors = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw rejection(['the scope file must be a JSON object'], 'Demo proposal');
  unknown(input, PROPOSAL_INPUT_FIELDS, 'scope', errors);
  const target = normalizeTarget(input.target, 'scope target', errors);
  const resolved = await resolveDeliveryCriteria(root, meta);
  const active = activeCriteria(resolved);
  const scenarios = [];
  if (!Array.isArray(input.scenarios) || !input.scenarios.length) errors.push('scenarios must be a non-empty array');
  for (const [index, raw] of (Array.isArray(input.scenarios) ? input.scenarios : []).entries()) {
    const label = `scenario ${raw?.id ?? `#${index + 1}`}`;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { errors.push(`${label} must be an object`); continue; }
    unknown(raw, SCENARIO_INPUT_FIELDS, label, errors);
    if (!DEMO_SCENARIO_ID.test(raw.id ?? '')) errors.push(`${label}: id must look like D-01`);
    if (scenarios.some((entry) => entry.id === raw.id)) errors.push(`${label}: duplicate id`);
    if (!nonEmpty(raw.title)) errors.push(`${label} requires a title`);
    if (!DEMO_AUDIENCES.includes(raw.audience)) errors.push(`${label}: audience must be one of ${DEMO_AUDIENCES.join(', ')}`);
    if (!Number.isInteger(raw.priority) || raw.priority < 1) errors.push(`${label}: priority must be a positive integer (1 = most important)`);
    if (!nonEmpty(raw.rationale)) errors.push(`${label} requires a rationale: why this scenario matters to show (workflow, business rule, risk)`);
    const steps = stringList(raw.steps, `${label} steps`, errors);
    if (!steps.length) errors.push(`${label} requires the steps to demonstrate`);
    if (raw.record !== undefined && typeof raw.record !== 'boolean') errors.push(`${label}: record must be true or false`);
    const criteria = [];
    if (raw.criteria !== undefined && !Array.isArray(raw.criteria)) errors.push(`${label}: criteria must be an array`);
    for (const ref of Array.isArray(raw.criteria) ? raw.criteria : []) {
      const match = typeof ref === 'string' ? active.find((entry) => entry.id === bareRef(ref.trim(), resolved.owner)) : null;
      if (!match) {
        errors.push(active.length
          ? `${label}: ${JSON.stringify(ref)} is not an active acceptance criterion of ${workId} (active: ${active.map((entry) => entry.id).join(', ')})`
          : `${label}: ${JSON.stringify(ref)} cannot be cited — ${workId} has no recorded acceptance criteria; the rationale explains why the scenario matters`);
      }
      else criteria.push(match.ref);
    }
    scenarios.push({
      id: raw.id,
      title: nonEmpty(raw.title) ? raw.title.trim() : raw.title,
      audience: raw.audience,
      priority: raw.priority,
      criteria,
      rationale: nonEmpty(raw.rationale) ? raw.rationale.trim() : raw.rationale,
      steps,
      record: raw.record ?? false,
      ...(nonEmpty(raw.data) ? { data: raw.data.trim() } : {})
    });
  }
  const excluded = [];
  if (input.excluded !== undefined && !Array.isArray(input.excluded)) errors.push('excluded must be an array');
  for (const [index, raw] of (Array.isArray(input.excluded) ? input.excluded : []).entries()) {
    if (!raw || !nonEmpty(raw.title) || !nonEmpty(raw.reason)) { errors.push(`excluded #${index + 1} requires a title and a reason`); continue; }
    excluded.push({ title: raw.title.trim(), reason: raw.reason.trim() });
  }
  if (errors.length) throw rejection(errors, 'Demo proposal');

  scenarios.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  const loaded = await loadDemoLedger(root, workId);
  const ledger = loaded.ledger;
  const proposal = {
    id: await allocateRecordId(root, 'DP', ledger.proposals),
    recordedAt: now,
    workStatus: meta.status,
    ...(target ? { target } : {}),
    ...(nonEmpty(input.summary) ? { summary: input.summary.trim() } : {}),
    scenarios,
    excluded,
    criteriaShown: [...new Set(scenarios.flatMap((scenario) => scenario.criteria))],
    criteriaNotShown: active.map((entry) => entry.ref).filter((ref) => !scenarios.some((scenario) => scenario.criteria.includes(ref))),
    sha256: null,
    skill: skillStamp('smart-demo')
  };
  // Hash what is persisted: demo.json is written redacted, so the hash is taken over the
  // redacted proposal and still matches when the ledger is loaded again.
  proposal.sha256 = proposalHash(redactDeep(proposal));
  ledger.proposals.push(proposal);
  ledger.updatedAt = now;
  await writeYamlAtomic(demoFilePath(root, workId), ledger);
  return { meta, proposal, ledger };
}

// The developer's explicit approval of the latest proposal, in their words. A subset
// (--only) is an approval of just those scenarios; anything else stays unapproved.
export async function approveDemo(root, workId, { note, only = null }, now = new Date().toISOString()) {
  await assertQualityTarget(root, workId);
  if (!nonEmpty(note)) throw new Error('Record the developer\'s own approval: yallaflow demo approve <work-id> --note "Approved by <who> in the agent session: <their words>". Never approve a demo scope on the developer\'s behalf.');
  const loaded = await loadDemoLedger(root, workId);
  const ledger = loaded.ledger;
  const proposal = ledger.proposals.at(-1);
  if (!proposal) throw new Error(`${workId} has no demo proposal to approve (yallaflow demo propose ${workId} --file scope.json).`);
  let scenarios = proposal.scenarios.map((scenario) => scenario.id);
  if (only) {
    const unknownIds = only.filter((id) => !scenarios.includes(id));
    if (unknownIds.length) throw new Error(`--only names scenario(s) not in ${proposal.id}: ${unknownIds.join(', ')}.`);
    scenarios = scenarios.filter((id) => only.includes(id));
    if (!scenarios.length) throw new Error('--only must name at least one scenario.');
  }
  if (ledger.approvals.some((entry) => entry.proposalId === proposal.id && entry.sha256 === proposal.sha256 && sameList(entry.scenarios, scenarios))) {
    throw new Error(`${proposal.id} is already approved with that scope.`);
  }
  const approval = { proposalId: proposal.id, sha256: proposal.sha256, approvedAt: now, note: note.trim(), scenarios };
  ledger.approvals.push(approval);
  ledger.updatedAt = now;
  await writeYamlAtomic(demoFilePath(root, workId), ledger);
  return { proposal, approval, ledger };
}

// The approved content of a proposal: what will be shown, against what, and what is left out.
export function proposalHash(proposal) {
  return createHash('sha256').update(JSON.stringify({ target: proposal.target ?? null, scenarios: proposal.scenarios, excluded: proposal.excluded })).digest('hex');
}

// Which approved scenarios have been shown so far, across every recording of the
// approved proposal (one video per feature or audience is normal). A scenario shown in
// any run counts; what remains is approved but not yet shown in any run.
export function approvedCoverage(ledger) {
  const approved = currentApproval(ledger);
  if (!approved) return null;
  const runs = ledger.runs.filter((run) => run.proposalId === approved.proposal.id && run.proposalSha256 === approved.proposal.sha256);
  const shownIn = new Map();
  for (const run of runs) {
    for (const result of run.scenarios) {
      if (result.status === 'shown' && approved.approval.scenarios.includes(result.id)) shownIn.set(result.id, [...(shownIn.get(result.id) ?? []), run.id]);
    }
  }
  return {
    approved: approved.approval.scenarios,
    shownIn,
    remaining: approved.approval.scenarios.filter((scenarioId) => !shownIn.has(scenarioId)),
    runs: runs.map((run) => run.id)
  };
}

export function demoDuplicateIds(ledger) {
  return [...duplicateIds(ledger.proposals), ...duplicateIds(ledger.runs)];
}

export function currentApproval(ledger) {
  const proposal = ledger.proposals.at(-1);
  if (!proposal) return null;
  const approval = ledger.approvals.filter((entry) => entry.proposalId === proposal.id && entry.sha256 === proposal.sha256).at(-1);
  return approval ? { proposal, approval } : null;
}

export async function recordDemo(root, workId, input, { now = new Date().toISOString(), cwd = process.cwd(), allowRemote = false } = {}) {
  const meta = await assertQualityTarget(root, workId);
  const errors = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw rejection(['the result file must be a JSON object']);
  unknown(input, RUN_INPUT_FIELDS, 'result', errors);
  const loaded = await loadDemoLedger(root, workId);
  const ledger = loaded.ledger;
  const approved = currentApproval(ledger);
  if (!approved) {
    const latest = ledger.proposals.at(-1);
    throw rejection([latest
      ? `the current demo proposal ${latest.id} has not been approved by the developer. Present it, then record their approval: yallaflow demo approve ${workId} --note "Approved by …: <their words>"`
      : `${workId} has no demo proposal: propose the scope first (yallaflow demo propose ${workId} --file scope.json)`]);
  }
  const { proposal, approval } = approved;
  if (input.proposal !== undefined && input.proposal !== proposal.id) errors.push(`recordings are made against the current approved proposal ${proposal.id}, not ${input.proposal}`);
  if (!QC_TOOLS.includes(input.tool)) errors.push(`tool must be one of: ${QC_TOOLS.join(', ')}`);
  if (input.audience !== undefined && !DEMO_AUDIENCES.includes(input.audience)) errors.push(`audience must be one of: ${DEMO_AUDIENCES.join(', ')}`);
  const target = normalizeTarget(input.target, 'result target', errors) ?? proposal.target ?? null;
  if (target && !isLocalTarget(target.baseUrl) && !allowRemote) {
    errors.push(`target ${target.baseUrl} is not a local address; demonstrating against a shared or production system needs an explicit --allow-remote (and test data only)`);
  }
  const limitations = stringList(input.limitations, 'limitations', errors);
  let video = [];
  if (input.video !== undefined) {
    try {
      video = await inspectArtifacts([input.video], { cwd, label: 'video' });
    } catch (error) {
      errors.push(error.message);
    }
  }
  const results = [];
  const inspectedByResult = new Map();
  for (const [index, raw] of (Array.isArray(input.scenarios) ? input.scenarios : []).entries()) {
    const label = `scenario ${raw?.id ?? `#${index + 1}`}`;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { errors.push(`${label} must be an object`); continue; }
    unknown(raw, RESULT_INPUT_FIELDS, label, errors);
    if (!approval.scenarios.includes(raw.id)) { errors.push(`${label} is not in the approved scope of ${proposal.id} (${approval.scenarios.join(', ')})`); continue; }
    if (results.some((entry) => entry.id === raw.id)) { errors.push(`${label}: reported more than once`); continue; }
    if (!DEMO_RESULT_STATUSES.includes(raw.status)) { errors.push(`${label}: status must be one of ${DEMO_RESULT_STATUSES.join(', ')}`); continue; }
    if (raw.status !== 'shown' && !nonEmpty(raw.notes)) errors.push(`${label}: ${raw.status} requires notes explaining what happened`);
    try {
      inspectedByResult.set(raw.id, await inspectArtifacts(raw.artifacts, { cwd, label: `${label} artifact` }));
    } catch (error) {
      errors.push(error.message);
    }
    results.push({ id: raw.id, status: raw.status, ...(nonEmpty(raw.notes) ? { notes: raw.notes.trim() } : {}) });
  }
  if (!results.length) errors.push('scenarios must report at least one approved scenario');
  if (errors.length) throw rejection(errors);

  const id = await allocateRecordId(root, 'DM', ledger.runs);
  const settings = await loadQualitySettings(root);
  const media = await createRecordMedia(root, workId, id, { commitMedia: settings.commitMedia });
  try {
    const [storedVideo] = await media.add(video);
    for (const result of results) {
      const artifacts = await media.add(inspectedByResult.get(result.id));
      if (artifacts.length) result.artifacts = artifacts;
    }
    const head = gitHead(root);
    const run = {
      id,
      proposalId: proposal.id,
      proposalSha256: proposal.sha256,
      recordedAt: now,
      workStatus: meta.status,
      tool: input.tool,
      ...(input.audience ? { audience: input.audience } : {}),
      ...(target ? { target } : {}),
      ...(head ? { gitCommit: head } : {}),
      ...(storedVideo ? { video: storedVideo } : {}),
      ...(nonEmpty(input.summary) ? { summary: input.summary.trim() } : {}),
      scenarios: results,
      limitations,
      disclaimer: DEMO_DISCLAIMER,
      skill: skillStamp('smart-demo')
    };
    ledger.runs.push(run);
    ledger.updatedAt = now;
    await writeYamlAtomic(demoFilePath(root, workId), ledger);
    return { meta, proposal, approval, run, ledger };
  } catch (error) {
    await media.remove();
    throw error;
  }
}

function sameList(a = [], b = []) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function rejection(errors, action = 'Demo record') {
  return new Error(`${action} rejected:\n- ${errors.join('\n- ')}\n\nNo files were changed.`);
}

