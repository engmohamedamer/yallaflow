import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { findProjectRoot, loadWorkMetaOrThrow } from '../core/workspace.js';

// `yallaflow qc …` (v1.1.0, optional AI QC). Every command here acts only on explicit
// request: none starts a browser, a server, or a test — the Agent drives Playwright and
// these commands validate and record what it did. Modules load lazily so the normal
// lifecycle never pays for them.
async function context(workId) {
  const root = await findProjectRoot();
  if (!root) throw new Error('No .yallaflow workspace found. Run `yallaflow init` first.');
  if (!workId) throw new Error('Name the work item: yallaflow qc <action> <work-id> …');
  return { root, workId };
}

async function readJsonInput(file) {
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    throw new Error(`File not found: ${file}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${file} is not valid JSON.`);
  }
}

function relative(root, file) {
  return path.relative(root, file).split(path.sep).join('/');
}

export async function qcPlanCommand(workId, { file }) {
  const { root } = await context(workId);
  const { recordQcPlan } = await import('../quality/qc.js');
  const { writeQualityReport } = await import('../quality/report.js');
  const { plan } = await recordQcPlan(root, workId, await readJsonInput(file));
  const report = await writeQualityReport(root, workId);
  console.log(`QC plan ${plan.id} recorded for ${workId}: ${plan.scenarios.length} scenario(s) — ${plan.scenarios.filter((s) => s.kind === 'functional').length} functional, ${plan.scenarios.filter((s) => s.kind === 'exploratory').length} exploratory.`);
  console.log(`Policy: ${plan.policy}${plan.policySource === 'default' ? ' (default)' : ` (from ${plan.policySource})`} — ${plan.policy === 'strict' ? 'required scenarios must pass for quality approval; task completion is unaffected.' : 'failures are reported and never block completion.'}`);
  if (plan.criteriaCovered.length) console.log(`Criteria covered: ${plan.criteriaCovered.join(', ')}`);
  if (plan.criteriaNotCovered.length) console.log(`Criteria with no scenario: ${plan.criteriaNotCovered.join(', ')}`);
  console.log(`Nothing was run. Execute the scenarios with Playwright, then: yallaflow qc record ${workId} --file result.json`);
  console.log(`Report: ${relative(root, report.markdown)} · ${relative(root, report.html)}`);
}

export async function qcRecordCommand(workId, { file, allowRemote = false }) {
  const { root } = await context(workId);
  const { evaluateQc, loadQualitySettings, recordQcRun } = await import('../quality/qc.js');
  const { writeQualityReport } = await import('../quality/report.js');
  const input = await readJsonInput(file);
  const { run, ledger, meta } = await recordQcRun(root, workId, input, { cwd: process.cwd(), allowRemote });
  const report = await writeQualityReport(root, workId);
  const counts = Object.fromEntries(['passed', 'failed', 'blocked', 'not-run'].map((status) => [status, run.scenarios.filter((result) => result.status === status).length]));
  const artifacts = run.scenarios.reduce((sum, result) => sum + (result.artifacts?.length ?? 0), 0);
  console.log(`QC ${run.id} recorded for ${workId} (${run.origin} via ${run.tool}): ${counts.passed} passed · ${counts.failed} failed · ${counts.blocked} blocked · ${counts['not-run']} not run.`);
  if (artifacts) console.log(`Artifacts: ${artifacts} file(s) stored locally with hashes under ${relative(root, path.join(path.dirname(report.markdown), 'media', run.id))}/`);
  for (const result of run.scenarios.filter((entry) => entry.status !== 'passed')) {
    console.log(`  ${result.id} ${result.status.toUpperCase()}: ${result.actual ?? result.reason ?? ''}`.trimEnd());
  }
  if (run.notReported?.length) console.log(`Not reported in this run: ${run.notReported.join(', ')}`);
  printPolicy(evaluateQc(ledger, meta, { configPolicy: (await loadQualitySettings(root)).qcPolicy }));
  console.log(`${meta.id} stays ${meta.status}; QC never changes the lifecycle or the verification ledger.`);
  console.log(`Report: ${relative(root, report.markdown)} · ${relative(root, report.html)}`);
}

export async function qcStatusCommand(workId) {
  const { root } = await context(workId);
  const meta = await loadWorkMetaOrThrow(root, workId);
  const { evaluateQc, loadQcLedger, loadQualitySettings } = await import('../quality/qc.js');
  const { exists, ledger } = await loadQcLedger(root, workId);
  if (!exists) {
    console.log(`${workId}: no QC requested. QC is optional and runs only on request (yallaflow skill ai-qc --work ${workId}).`);
    return;
  }
  const view = evaluateQc(ledger, meta, { configPolicy: (await loadQualitySettings(root)).qcPolicy });
  console.log(`${workId} QC — plan ${view.plan.id}, ${view.runs} run(s)`);
  for (const scenario of view.scenarios) {
    const latest = scenario.latest ? `${scenario.latest.status}${scenario.stale ? ' (recorded before the latest reopen)' : ''} in ${scenario.latest.runId}` : 'not run';
    console.log(`  ${scenario.id} [${scenario.kind}${scenario.required ? ', required' : ''}] ${scenario.title} — ${latest}`);
  }
  if (view.plan.criteriaNotCovered.length) console.log(`Criteria with no scenario: ${view.plan.criteriaNotCovered.join(', ')}`);
  printPolicy(view);
  console.log(`Report: .yallaflow/work/${workId}/quality/report.md · report.html`);
}

function printPolicy(view) {
  if (view.policy === 'strict') {
    console.log(`Quality approval (strict policy): ${view.approval.granted ? 'GRANTED — every required scenario passed.' : `NOT GRANTED — ${view.approval.reasons.join('; ')}.`} Task completion is separate and unaffected.`);
  } else if (view.failures.length) {
    console.log(`Advisory policy: ${view.failures.length} scenario(s) not passing (${view.failures.map((scenario) => `${scenario.id} ${scenario.latest.status}`).join(', ')}). Reported only; completion is not blocked.`);
  } else {
    console.log('Advisory policy: failures are reported and never block completion.');
  }
}

// `yallaflow demo …` (v1.1.0, optional Smart Demo). Independent of QC. The developer
// approves the proposed scope before anything is recorded; YallaFlow records the
// approval only with the developer's own words and never on the Agent's judgment.
export async function demoProposeCommand(workId, { file }) {
  const { root } = await context(workId);
  const { proposeDemo } = await import('../quality/demo.js');
  const { writeQualityReport } = await import('../quality/report.js');
  const { proposal } = await proposeDemo(root, workId, await readJsonInput(file));
  const report = await writeQualityReport(root, workId);
  console.log(`Demo proposal ${proposal.id} recorded for ${workId} — ${proposal.scenarios.length} scenario(s), in priority order:`);
  for (const scenario of proposal.scenarios) {
    console.log(`  ${scenario.priority}. ${scenario.id} [${scenario.audience}${scenario.record ? ', recorded' : ''}] ${scenario.title}${scenario.criteria.length ? ` — ${scenario.criteria.join(', ')}` : ''}`);
    console.log(`     why: ${scenario.rationale}`);
  }
  for (const item of proposal.excluded) console.log(`  excluded: ${item.title} — ${item.reason}`);
  if (proposal.criteriaNotShown.length) console.log(`Criteria not demonstrated: ${proposal.criteriaNotShown.join(', ')}`);
  console.log('Nothing was recorded. Present this scope to the developer; record only after they explicitly approve it:');
  console.log(`  yallaflow demo approve ${workId} --note "Approved by <who> in the agent session: <their words>" [--only D-01,D-02]`);
  console.log(`Report: ${relative(root, report.markdown)} · ${relative(root, report.html)}`);
}

export async function demoApproveCommand(workId, { note, only }) {
  const { root } = await context(workId);
  const { approveDemo } = await import('../quality/demo.js');
  const { writeQualityReport } = await import('../quality/report.js');
  const ids = only ? only.split(',').map((value) => value.trim()).filter(Boolean) : null;
  const { proposal, approval } = await approveDemo(root, workId, { note, only: ids });
  await writeQualityReport(root, workId);
  console.log(`Demo scope ${proposal.id} approved for ${workId}: ${approval.scenarios.join(', ')}`);
  console.log(`Note: ${approval.note}`);
  console.log(`Next: run the approved scenarios with Playwright (video optional), then yallaflow demo record ${workId} --file result.json`);
}

export async function demoRecordCommand(workId, { file, allowRemote = false }) {
  const { root } = await context(workId);
  const { recordDemo } = await import('../quality/demo.js');
  const { DEMO_DISCLAIMER } = await import('../quality/constants.js');
  const { writeQualityReport } = await import('../quality/report.js');
  const { run, meta } = await recordDemo(root, workId, await readJsonInput(file), { cwd: process.cwd(), allowRemote });
  const report = await writeQualityReport(root, workId);
  console.log(`Demo ${run.id} recorded for ${workId}${run.audience ? ` (${run.audience} audience)` : ''}: ${run.scenarios.map((result) => `${result.id} ${result.status}`).join(', ')}.`);
  if (run.video) console.log(`Video: ${relative(root, path.join(path.dirname(report.markdown), run.video.path))} (local; sha256 ${run.video.sha256.slice(0, 12)}…)`);
  else console.log('No video recorded (recording is optional).');
  if (run.notShown.length) console.log(`Approved but not shown: ${run.notShown.join(', ')}`);
  console.log(DEMO_DISCLAIMER);
  console.log(`${meta.id} stays ${meta.status}; demos never change the lifecycle and are not acceptance evidence.`);
  console.log(`Demo summary: ${relative(root, report.markdown)} · ${relative(root, report.html)}`);
}

export async function demoStatusCommand(workId) {
  const { root } = await context(workId);
  const { currentApproval, loadDemoLedger } = await import('../quality/demo.js');
  const { exists, ledger } = await loadDemoLedger(root, workId);
  if (!exists) {
    console.log(`${workId}: no demo requested. Smart Demo is optional and runs only on request (yallaflow skill smart-demo --work ${workId}).`);
    return;
  }
  const proposal = ledger.proposals.at(-1);
  const approved = currentApproval(ledger);
  console.log(`${workId} demo — proposal ${proposal.id}: ${approved ? `approved (${approved.approval.scenarios.join(', ')}) at ${approved.approval.approvedAt}` : 'awaiting the developer\'s approval'}`);
  for (const scenario of proposal.scenarios) console.log(`  ${scenario.priority}. ${scenario.id} [${scenario.audience}] ${scenario.title}`);
  for (const run of ledger.runs) console.log(`  ${run.id} (${run.recordedAt}): ${run.scenarios.map((result) => `${result.id} ${result.status}`).join(', ')}${run.video ? ' · video' : ''}`);
  console.log(`Report: .yallaflow/work/${workId}/quality/report.md · report.html`);
}
