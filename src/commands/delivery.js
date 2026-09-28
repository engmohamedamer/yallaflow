import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { findProjectRoot, loadWorkMetaOrThrow } from '../core/workspace.js';
import { loadWorkProgress } from '../core/progress.js';
import { resolveDeliveryCriteria } from '../delivery/requirements.js';
import { describeFindingEvidence, evaluateConvergence, loadWorkConvergence } from '../delivery/convergence.js';
import { describeTrigger, loadWorkImpacts, pendingImpact } from '../delivery/impact.js';
import { assessImpact, assessableStages, recordConvergenceAndReconcile, recordRequirementsWithImpact } from '../delivery/assess.js';
import { convergenceRequired, intentSkill } from '../delivery/policy.js';

// requirement / convergence / impact (v0.3.8). Read commands (list, show, status) are
// strictly read-only; record/assess validate the whole input file first and change
// nothing on any error.

async function requireRoot() {
  const root = await findProjectRoot();
  if (!root) throw new Error('No .yallaflow workspace found. Run `yallaflow init` first.');
  return root;
}

async function readJsonFile(filePath, label, usage) {
  if (!filePath) throw new Error(`Usage: ${usage}`);
  let raw;
  try {
    raw = await readFile(path.resolve(filePath), 'utf8');
  } catch {
    throw new Error(`Could not read ${label} file: ${filePath}`);
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`${label[0].toUpperCase()}${label.slice(1)} file is not valid JSON: ${filePath}`);
  }
}

function notApplicable(meta) {
  return `${meta.id} does not carry a delivery-convergence contract (${meta.type ?? 'unrouted'}/${meta.scope ?? '—'}, ` +
    `registry v${meta.behaviorContract?.registryVersion ?? '—'}): requirement identity and convergence do not apply. ` +
    'They apply to feature work (bounded, architectural) and architectural changes routed on Skill Registry v5+.';
}

function describeFinding(entry) {
  if (entry.status === 'not-assessed') return 'not assessed';
  return `${entry.status}${entry.stale ? ' (STALE)' : ''} — ${entry.assessment}`;
}

// ---- requirement ---------------------------------------------------------------

export async function requirementRecordCommand(workId, { file }) {
  const root = await requireRoot();
  const usage = 'yallaflow requirement record <work-id> --file <requirements.json>';
  if (!workId) throw new Error(`Usage: ${usage}`);
  const input = await readJsonFile(file, 'requirements', usage);
  const result = await recordRequirementsWithImpact(root, workId, input);
  if (result.unchanged) {
    console.log(`${workId} — requirements unchanged (revision ${result.ledger.revision}); nothing recorded.`);
    return;
  }
  const active = (list) => list.filter((entry) => entry.status === 'active').length;
  console.log(`${workId} — requirements recorded (revision ${result.ledger.revision}).`);
  for (const change of result.changes) console.log(`- ${change.id} ${change.action}${change.action === 'revised' && change.from !== change.to ? ` (${change.from} → ${change.to})` : ` (${change.to})`}`);
  console.log(`Requirements: ${active(result.ledger.requirements)} active · Acceptance criteria: ${active(result.ledger.acceptanceCriteria)} active`);
  console.log(`Ledger: .yallaflow/work/${workId}/requirements.yaml`);
  if (result.impact) {
    console.log(`\nImpact ${result.impact.id} pending: the approved intent was already fixed, so this change needs an impact assessment before the work continues.`);
    console.log(`Next: yallaflow impact status ${workId}`);
  }
}

export async function requirementListCommand(workId) {
  const root = await requireRoot();
  const meta = await loadWorkMetaOrThrow(root, workId);
  const resolved = await resolveDeliveryCriteria(root, meta);
  const required = convergenceRequired(meta);
  console.log(`${meta.id} — ${meta.title ?? meta.rawRequest ?? 'work item'}`);
  if (!required && resolved.source === 'none') {
    console.log(notApplicable(meta));
    return;
  }
  if (resolved.source === 'none') {
    const progress = await loadWorkProgress(root, meta);
    console.log(`No requirements recorded yet. The ${intentSkill(progress.contract)} checkpoint requires them: yallaflow requirement record ${meta.id} --file requirements.json`);
    return;
  }
  const convergence = required ? await evaluateConvergence(root, meta) : null;
  const byRef = new Map((convergence?.criteria ?? []).map((entry) => [entry.ref, entry]));
  const count = (list, status) => list.filter((entry) => entry.status === status).length;
  console.log(resolved.source === 'inherited'
    ? `Acceptance criteria assigned from ${resolved.owner} (canonical there): ${resolved.criteria.length}`
    : `Requirements: ${count(resolved.requirements, 'active')} active${summarizeInactive(resolved.requirements)} · Acceptance criteria: ${count(resolved.criteria, 'active')} active${summarizeInactive(resolved.criteria)} · revision ${resolved.ledger.revision}`);
  if (required) console.log('Convergence: required');
  for (const requirement of resolved.requirements) {
    console.log(`\n${requirement.id} [${requirement.status}] ${requirement.statement}`);
    for (const criterion of resolved.criteria.filter((entry) => entry.requirement === requirement.id)) {
      const finding = criterion.status === 'active' && byRef.get(criterion.ref);
      console.log(`  ${criterion.ref} [${criterion.status}] ${criterion.statement}${finding ? ` → ${describeFinding(finding)}` : ''}`);
    }
  }
}

function summarizeInactive(list) {
  const withdrawn = list.filter((entry) => entry.status === 'withdrawn').length;
  const deferred = list.filter((entry) => entry.status === 'deferred').length;
  const parts = [withdrawn ? `${withdrawn} withdrawn` : null, deferred ? `${deferred} deferred` : null].filter(Boolean);
  return parts.length ? ` (${parts.join(', ')})` : '';
}

export async function requirementShowCommand(workId, id) {
  const root = await requireRoot();
  const meta = await loadWorkMetaOrThrow(root, workId);
  const resolved = await resolveDeliveryCriteria(root, meta);
  const requirement = resolved.requirements.find((entry) => entry.id === id);
  const criterion = resolved.criteria.find((entry) => entry.id === id || entry.ref === id);
  const entry = requirement ?? criterion;
  if (!entry) throw new Error(`${id} is not a requirement or acceptance criterion of ${workId}${resolved.source === 'inherited' ? ` (criteria assigned from ${resolved.owner})` : ''}.`);
  console.log(`${criterion ? criterion.ref : entry.id} — ${entry.statement}`);
  console.log(`Status: ${entry.status}${entry.reason ? ` (${entry.reason})` : ''}`);
  if (resolved.source === 'inherited') console.log(`Owner: ${resolved.owner} (assigned to ${workId} by decomposition)`);
  if (criterion) console.log(`Requirement: ${criterion.requirement}`);
  console.log('Provenance:');
  for (const item of entry.provenance) console.log(`- ${describeProvenance(item)}`);
  if (requirement) {
    console.log('Acceptance criteria:');
    for (const child of resolved.criteria.filter((candidate) => candidate.requirement === requirement.id)) console.log(`- ${child.ref} [${child.status}] ${child.statement}`);
  }
  const history = resolved.ledger.history.filter((item) => item.id === entry.id);
  console.log(`History: ${history.map((item) => `${item.action} at ${item.at} (revision ${item.revision})`).join('; ') || 'none'}`);
  if (criterion && convergenceRequired(meta)) {
    const convergence = await evaluateConvergence(root, meta);
    const current = convergence.criteria.find((candidate) => candidate.ref === criterion.ref);
    if (current) {
      console.log(`Convergence: ${describeFinding(current)}`);
      if (current.reason) console.log(`Reason: ${current.reason}`);
      for (const evidence of current.evidence ?? []) console.log(`- ${describeFindingEvidence(evidence)}`);
      for (const reason of current.staleReasons) console.log(`Stale: ${reason}`);
    }
  }
}

function describeProvenance(item) {
  if (item.type === 'request') return 'the recorded raw request';
  if (item.type === 'specification') return `specification — ${item.section}`;
  if (item.type === 'source') return `source ${item.source}${item.locator ? ` (${item.locator})` : ''}`;
  return `answered question ${item.question}`;
}

// ---- convergence ---------------------------------------------------------------

export async function convergenceRecordCommand(workId, { file }) {
  const root = await requireRoot();
  const usage = 'yallaflow convergence record <work-id> --file <convergence.json>';
  if (!workId) throw new Error(`Usage: ${usage}`);
  const input = await readJsonFile(file, 'convergence', usage);
  const { assessment, reopened } = await recordConvergenceAndReconcile(root, workId, input);
  console.log(`${workId} — convergence assessment ${assessment.id} recorded (${assessment.findings.length} finding(s), ${assessment.unrequested.length} unrequested item(s)).`);
  for (const finding of assessment.findings) console.log(`- ${finding.criterion} → ${finding.status}`);
  for (const item of assessment.unrequested) console.log(`- ${item.id} → unrequested (${item.disposition})`);
  if (reopened) console.log(`delivery-convergence checkpoint reopened (in_progress): ${reopened}`);
  const meta = await loadWorkMetaOrThrow(root, workId);
  printConvergenceSummary(await evaluateConvergence(root, meta), workId);
}

export async function convergenceStatusCommand(workId) {
  const root = await requireRoot();
  const meta = await loadWorkMetaOrThrow(root, workId);
  console.log(`${meta.id} — ${meta.title ?? meta.rawRequest ?? 'work item'}`);
  if (!convergenceRequired(meta)) {
    console.log(`Convergence: not required. ${notApplicable(meta)}`);
    return;
  }
  const convergence = await evaluateConvergence(root, meta);
  console.log(`Requirements: ${convergence.requirements.filter((entry) => entry.status === 'active').length} · Acceptance criteria: ${convergence.criteria.length}${convergence.source === 'inherited' ? ` (assigned from ${convergence.owner})` : ''}`);
  console.log(`Assessments: ${convergence.assessments}${convergence.latestAssessment ? ` (latest ${convergence.latestAssessment.id} at ${convergence.latestAssessment.recordedAt})` : ''}`);
  printConvergenceSummary(convergence, meta.id);
}

function printConvergenceSummary(convergence, workId) {
  const { counts } = convergence;
  console.log(`\nConvergence: satisfied ${counts.satisfied} · partial ${counts.partial} · missing ${counts.missing} · contradicts ${counts.contradicts} · not assessed ${counts['not-assessed']}${counts.stale ? ` · stale ${counts.stale}` : ''}`);
  const open = convergence.unrequested.filter((item) => item.disposition === 'open').length;
  if (convergence.unrequested.length) console.log(`Unrequested behavior: ${convergence.unrequested.length} (${open} open)`);
  if (convergence.converged) {
    console.log('Converged: every active acceptance criterion is currently satisfied.');
    return;
  }
  console.log('\nBlocking:');
  for (const blocker of convergence.blockers.slice(0, 10)) console.log(`- ${blocker.text}`);
  if (convergence.blockers.length > 10) console.log(`- … ${convergence.blockers.length - 10} more`);
  console.log(`\nNext valid action: ${convergence.pendingImpact
    ? `yallaflow impact assess ${workId} --file impact.json`
    : `resolve the gaps, then yallaflow convergence record ${workId} --file convergence.json`}`);
}

export async function convergenceShowCommand(workId, id) {
  const root = await requireRoot();
  const meta = await loadWorkMetaOrThrow(root, workId);
  const { ledger } = await loadWorkConvergence(root, meta);
  if (!ledger.assessments.length) {
    console.log(`${workId} has no convergence assessments.`);
    return;
  }
  if (!id) {
    for (const assessment of ledger.assessments) {
      console.log(`${assessment.id} ${assessment.recordedAt} at ${assessment.stage}: ${assessment.findings.map((finding) => `${finding.criterion} ${finding.status}`).join(', ') || 'no findings'}${assessment.unrequested.length ? `; unrequested ${assessment.unrequested.map((item) => `${item.id} ${item.disposition}`).join(', ')}` : ''}`);
    }
    return;
  }
  const assessment = ledger.assessments.find((entry) => entry.id === id);
  if (assessment) {
    console.log(`${assessment.id} — recorded ${assessment.recordedAt} at ${assessment.stage} (requirements revision ${assessment.basis.requirementsRevision}${assessment.basis.gitCommit ? `, commit ${assessment.basis.gitCommit.slice(0, 7)}` : ''})`);
    if (assessment.summary) console.log(assessment.summary);
    for (const finding of assessment.findings) printFinding(finding.criterion, finding);
    for (const item of assessment.unrequested) {
      console.log(`\n${item.id} [unrequested, ${item.disposition}]${item.summary ? ` ${item.summary}` : ''}`);
      if (item.reason) console.log(`  Reason: ${item.reason}`);
      for (const evidence of item.evidence ?? []) console.log(`  - ${describeFindingEvidence(evidence)}`);
    }
    return;
  }
  const history = ledger.assessments.flatMap((entry) => entry.findings.filter((finding) => finding.criterion === id || finding.criterion.endsWith(`/${id}`)).map((finding) => ({ finding, entry })));
  const unrequested = ledger.assessments.flatMap((entry) => entry.unrequested.filter((item) => item.id === id).map((item) => ({ item, entry })));
  if (!history.length && !unrequested.length) throw new Error(`${id} is not an assessment, assessed criterion, or unrequested item of ${workId}.`);
  for (const { finding, entry } of history) printFinding(`${finding.criterion} in ${entry.id} (${entry.recordedAt})`, finding);
  for (const { item, entry } of unrequested) console.log(`${item.id} in ${entry.id} (${entry.recordedAt}): ${item.disposition}${item.reason ? ` — ${item.reason}` : ''}${item.summary ? ` — ${item.summary}` : ''}`);
  const convergence = await evaluateConvergence(root, meta);
  const current = convergence.criteria.find((entry) => entry.ref === id || entry.ref.endsWith(`/${id}`));
  if (current) console.log(`\nCurrent: ${describeFinding(current)}${current.staleReasons.length ? `\nStale: ${current.staleReasons.join('; ')}` : ''}`);
}

function printFinding(label, finding) {
  console.log(`\n${label} → ${finding.status}`);
  console.log(`  Reason: ${finding.reason}`);
  for (const evidence of finding.evidence) console.log(`  - ${describeFindingEvidence(evidence)}`);
}

// ---- impact ---------------------------------------------------------------------

export async function impactStatusCommand(workId) {
  const root = await requireRoot();
  const meta = await loadWorkMetaOrThrow(root, workId);
  console.log(`${meta.id} — ${meta.title ?? meta.rawRequest ?? 'work item'}`);
  if (!convergenceRequired(meta)) {
    console.log(`Impact assessment: not applicable. ${notApplicable(meta)}`);
    return;
  }
  const { ledger } = await loadWorkImpacts(root, meta);
  const pending = pendingImpact(ledger);
  const assessed = ledger.impacts.filter((impact) => impact.status === 'assessed');
  console.log(`Impacts: ${ledger.impacts.length} (${assessed.length} assessed${pending ? ', 1 pending' : ''})`);
  for (const impact of assessed) {
    const verdicts = Object.entries(impact.assessment.stages);
    const affected = verdicts.filter(([, value]) => value.verdict === 'affected').map(([skill]) => skill);
    console.log(`- ${impact.id} assessed ${impact.assessment.assessedAt}: ${impact.triggers.map(describeTrigger).join('; ')} → affected ${affected.join(', ') || 'none'}`);
  }
  if (!pending) {
    console.log('\nNo pending impact.');
    return;
  }
  console.log(`\nPENDING ${pending.id} (raised ${pending.raisedAt} at ${pending.stageAtRaise}):`);
  for (const trigger of pending.triggers) console.log(`- ${describeTrigger(trigger)}`);
  const progress = await loadWorkProgress(root, meta);
  const stages = await assessableStages(root, meta);
  console.log('\nStages with completed work the change could affect (one verdict each):');
  for (const skill of stages) console.log(`- ${skill} (${progress.ledger.skills[skill]?.status ?? 'pending'})`);
  console.log('\nYallaFlow does not judge what the change means. Decide per stage, then record:');
  console.log(`  yallaflow impact assess ${meta.id} --file impact.json`);
  console.log(`  {"impact":"${pending.id}","stages":{${stages.map((skill) => `"${skill}":{"verdict":"affected|unaffected","reason":"..."}`).join(',')}}}`);
  console.log('Affected stages are revised through the audited checkpoint-revision path; prior evidence is kept.');
}

export async function impactAssessCommand(workId, { file }) {
  const root = await requireRoot();
  const usage = 'yallaflow impact assess <work-id> --file <impact.json>';
  if (!workId) throw new Error(`Usage: ${usage}`);
  const input = await readJsonFile(file, 'impact', usage);
  const result = await assessImpact(root, workId, input);
  console.log(`${workId} — impact ${result.impact.id} assessed.`);
  console.log(`Affected: ${result.affected.join(', ') || 'none'}`);
  console.log(`Unaffected: ${result.unaffected.join(', ') || 'none'}`);
  if (result.revised.length) console.log(`Revised (audited, evidence kept): ${result.revised.join(', ')}`);
  if (result.stage) console.log(`Stage corrected: ${result.stage.from} → ${result.stage.to}`);
  if (result.impact.assessment.applied.convergenceInvalidated) console.log('Convergence findings recorded before this assessment are now stale.');
  console.log(`\nNext: yallaflow guide ${workId}`);
}
