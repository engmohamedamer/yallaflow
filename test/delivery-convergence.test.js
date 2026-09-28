// v0.3.8 M3/M4 — the convergence ledger and convergence as a delivery gate.
// Verification: do the recorded technical checks pass? Review: is the implementation
// technically acceptable? Convergence: does the delivered implementation match the
// approved intent? The Agent judges; YallaFlow validates, records, and gates.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { cli } from '../test-support/legacy-context.js';
import { advanceActiveWork, evaluateAdvance, reconcileStageAfterCheckpointRevision, reopenWork } from '../src/core/transitions.js';
import { checkpointWork, reviseCheckpoint } from '../src/core/progress.js';
import { recordVerification } from '../src/core/evidence.js';
import { reviewKnowledgeNone } from '../src/knowledge/store.js';
import { evaluateConvergence, recordConvergence } from '../src/delivery/convergence.js';
import { recordRequirements } from '../src/delivery/requirements.js';
import { loadWorkReadiness } from '../src/behavior/readiness.js';
import { INTENT, boundedFeatureAtImplementation, complete, meta, readJson, routed, satisfied, toVerified, workspace } from '../test-support/delivery-fixtures.js';

const ALL_SATISFIED = [satisfied('AC-001'), satisfied('AC-002'), satisfied('AC-003', ['src/export.js'])];

async function verifiedFeature() {
  const root = await workspace();
  const work = await boundedFeatureAtImplementation(root);
  await toVerified(root, work.id);
  await reviewKnowledgeNone(root, work.id);
  return { root, id: work.id };
}

test('AC-301: every finding status is recorded exactly as declared, with normalized evidence', async () => {
  const { root, id } = await verifiedFeature();
  const { assessment } = await recordConvergence(root, id, {
    summary: 'First pass.',
    findings: [
      satisfied('AC-001', ['src/refund.js#refund', 'verification:V-001']),
      { criterion: 'AC-002', status: 'partial', reason: 'Refund creation exists; the approval rule is not implemented.', evidence: ['src/refund.js'] },
      { criterion: 'AC-003', status: 'contradicts', reason: 'Exports CSV, not ICS.', evidence: ['src/export.js:1'] }
    ]
  });
  assert.equal(assessment.id, 'CV-001');
  assert.deepEqual(assessment.findings.map((finding) => finding.status), ['satisfied', 'partial', 'contradicts']);
  const refund = assessment.findings[0].evidence[0];
  assert.equal(refund.type, 'repository');
  assert.equal(refund.symbol, 'refund');
  assert.match(refund.contentHash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(assessment.findings[0].evidence[1].verificationRunId, 'V-001');
  assert.deepEqual(assessment.basis.verificationRunIds, ['V-001']);
  const second = await recordConvergence(root, id, { findings: [{ criterion: 'AC-003', status: 'missing', reason: 'Export removed pending redesign.', evidence: ['reference: product review notes'] }] });
  assert.equal(second.assessment.id, 'CV-002');
  const view = await evaluateConvergence(root, await meta(root, id));
  assert.deepEqual(view.criteria.map((entry) => `${entry.ref}:${entry.status}`), ['AC-001:satisfied', 'AC-002:partial', 'AC-003:missing']);
  const ledger = await readJson(root, id, 'convergence.yaml');
  assert.equal(ledger.assessments.length, 2, 'append-only: CV-001 is kept after CV-002');
  assert.equal(ledger.assessments[0].findings[2].status, 'contradicts');
});

test('AC-302: unsupported claims are rejected with zero mutation', async () => {
  const { root, id } = await verifiedFeature();
  await recordVerification(root, id, { command: 'false', success: false, exitCode: 1 });
  const cases = [
    [{ findings: [{ criterion: 'AC-001', status: 'satisfied', reason: 'Trust me.', evidence: [] }] }, /requires at least one evidence reference/],
    [{ findings: [{ criterion: 'AC-001', status: 'satisfied', reason: 'Trust me.', evidence: ['it works'] }] }, /satisfied requires evidence beyond free-text references/],
    [{ findings: [{ criterion: 'AC-001', status: 'satisfied', reason: 'x', evidence: ['verification:V-002'] }] }, /cannot rest on failed verification run V-002/],
    [{ findings: [{ criterion: 'AC-001', status: 'satisfied', reason: 'x', evidence: ['verification:V-404'] }] }, /verification run V-404 was not found/],
    [{ findings: [{ criterion: 'AC-009', status: 'missing', reason: 'x', evidence: ['src/refund.js'] }] }, /"AC-009" is not an acceptance criterion of PF-0001/],
    [{ findings: [{ criterion: 'AC-001', status: 'done', reason: 'x', evidence: ['src/refund.js'] }] }, /status must be one of satisfied, partial, missing, contradicts/],
    [{ findings: [{ criterion: 'AC-001', status: 'partial', evidence: ['src/refund.js'] }] }, /requires a reason/],
    [{ findings: [satisfied('AC-001'), satisfied('AC-001')] }, /AC-001 is assessed more than once/],
    [{ findings: [] }, /records nothing/],
    [{ unrequested: [{ summary: 'CSV export.', evidence: ['src/export.js'], disposition: 'accepted' }] }, /accepted requires an explicit reason/],
    [{ unrequested: [{ summary: 'CSV export.' }] }, /new unrequested behavior requires evidence/],
    [{ unrequested: [{ id: 'UR-007', disposition: 'removed', reason: 'x' }] }, /UR-007 was never recorded/]
  ];
  for (const [input, pattern] of cases) {
    await assert.rejects(() => recordConvergence(root, id, input), (error) => pattern.test(error.message) && /No files were changed/.test(error.message), String(pattern));
  }
  assert.deepEqual((await evaluateConvergence(root, await meta(root, id))).assessments, 0);
});

test('AC-302: withdrawn criteria are not assessed; assessment needs the verified implementation', async () => {
  const root = await workspace();
  const early = await routed(root, 'feature', 'bounded');
  await recordRequirements(root, early.id, { requirements: [{ id: 'REQ-001', statement: 's', provenance: [{ type: 'request' }] }], acceptanceCriteria: [{ id: 'AC-001', requirement: 'REQ-001', statement: 'a', provenance: [{ type: 'request' }] }] });
  await assert.rejects(() => recordConvergence(root, early.id, { findings: [satisfied('AC-001')] }), /convergence judges the verified implementation; complete the verification checkpoint first/);
  const intent = structuredClone(INTENT);
  intent.acceptanceCriteria[1] = { ...intent.acceptanceCriteria[1], status: 'withdrawn', reason: 'Dropped before implementation.' };
  const work = await boundedFeatureAtImplementation(root, intent);
  await assert.rejects(() => recordConvergence(root, work.id, { findings: [satisfied('AC-001')] }), /complete the verification checkpoint first/, 'not at IMPLEMENTATION either');
  await toVerified(root, work.id);
  await assert.rejects(() => recordConvergence(root, work.id, { findings: [satisfied('AC-002')] }), /AC-002 is withdrawn; only active criteria are assessed/);
  const view = await evaluateConvergence(root, await meta(root, work.id));
  assert.deepEqual(view.criteria.map((entry) => entry.ref), ['AC-001', 'AC-003'], 'withdrawn criteria do not gate DONE');
});

test('AC-401: DONE is blocked by partial, missing, contradicting, not-assessed, and stale criteria and by open unrequested behavior', async () => {
  const { root, id } = await verifiedFeature();
  const work = await meta(root, id);
  let verdict = await evaluateAdvance(root, work, 'VERIFICATION');
  assert.equal(verdict.allowed, false);
  assert.match(verdict.error, /DONE blocked:\n- AC-001 → not-assessed\n- AC-002 → not-assessed\n- AC-003 → not-assessed/);
  assert.match(verdict.error, /Next valid action: resolve the convergence gaps and record a new convergence assessment\./);
  assert.match(verdict.action, /yallaflow convergence status PF-0001/);

  await recordConvergence(root, id, { findings: [satisfied('AC-001'), { criterion: 'AC-002', status: 'partial', reason: 'No approval rule.', evidence: ['src/refund.js'] }, { criterion: 'AC-003', status: 'missing', reason: 'No export.', evidence: ['src/export.js'] }], unrequested: [{ summary: 'Added a CSV export.', evidence: ['src/export.js'] }] });
  verdict = await evaluateAdvance(root, work, 'VERIFICATION');
  assert.match(verdict.error, /- AC-002 → partial\n- AC-003 → missing\n- UR-001 → unrequested behavior is open/);
  await assert.rejects(() => complete(root, id, 'delivery-convergence'), /has not converged on the approved intent:\n- AC-002 → partial/);

  await recordConvergence(root, id, { findings: [satisfied('AC-002'), satisfied('AC-003', ['src/export.js'])], unrequested: [{ id: 'UR-001', disposition: 'accepted', reason: 'Product owner asked for CSV as well.' }] });
  await writeFile(path.join(root, 'src', 'export.js'), 'export function exportCalendar() { return "csv"; }\n');
  verdict = await evaluateAdvance(root, work, 'VERIFICATION');
  assert.match(verdict.error, /- AC-003 → stale \(evidence src\/export\.js changed since CV-002\)/);
  const status = cli(root, ['convergence', 'status', id]).stdout;
  assert.match(status, /satisfied 3 · partial 0 · missing 0 · contradicts 0 · not assessed 0 · stale 1/);

  await recordConvergence(root, id, { findings: [satisfied('AC-003', ['src/export.js'])] });
  await complete(root, id, 'delivery-convergence');
  const done = await advanceActiveWork(root, id);
  assert.equal(done.to, 'DONE');
  const history = await readJson(root, id, 'convergence.yaml');
  assert.equal(history.assessments.length, 3);
  assert.equal(history.assessments[1].unrequested[0].disposition, 'accepted', 'accepted unrequested behavior stays in history');
  assert.match(cli(root, ['doctor']).stdout, /Workspace healthy\./);
});

test('AC-402: non-applicable and legacy work reaches DONE without any convergence ceremony', async () => {
  const root = await workspace();
  const bug = await routed(root, 'bug', 'bounded');
  await complete(root, bug.id, 'context-discovery');
  await checkpointWork(root, bug.id, { skillId: 'systematic-debugging', status: 'completed', summary: 'Root cause.', evidence: ['src/refund.js'] });
  for (let index = 0; index < 7; index++) await advanceActiveWork(root, bug.id);
  await toVerified(root, bug.id);
  await reviewKnowledgeNone(root, bug.id);
  assert.equal((await advanceActiveWork(root, bug.id)).to, 'DONE');
  await assert.rejects(() => recordConvergence(root, bug.id, { findings: [satisfied('AC-001')] }), /does not carry a delivery-convergence contract/);
  assert.match(cli(root, ['convergence', 'status', bug.id]).stdout, /Convergence: not required/);
});

test('AC-403: SPEC_READY and PLAN_READY need no convergence; architectural DONE does', async () => {
  const root = await workspace();
  const work = await routed(root, 'feature', 'architectural');
  for (const skill of ['context-discovery', 'requirement-clarification', 'design-exploration']) {
    await complete(root, work.id, skill);
    await advanceActiveWork(root, work.id);
  }
  await recordRequirements(root, work.id, { requirements: [{ id: 'REQ-001', statement: 'Contracts can be signed.', provenance: [{ type: 'specification', section: 'Functional requirements' }] }], acceptanceCriteria: [{ id: 'AC-001', requirement: 'REQ-001', statement: 'A signature is stored.', provenance: [{ type: 'specification', section: 'Acceptance criteria' }] }] });
  await complete(root, work.id, 'specification');
  assert.equal((await loadWorkReadiness(root, await meta(root, work.id))).deliveryStatus, 'SPEC_READY');
  await advanceActiveWork(root, work.id); // DESIGN -> SPECIFICATION
  await advanceActiveWork(root, work.id); // -> PLAN
  await complete(root, work.id, 'implementation-planning');
  assert.equal((await loadWorkReadiness(root, await meta(root, work.id))).deliveryStatus, 'PLAN_READY');
  await advanceActiveWork(root, work.id); // -> IMPLEMENTATION
  await toVerified(root, work.id);
  await reviewKnowledgeNone(root, work.id);
  const blocked = await evaluateAdvance(root, await meta(root, work.id), 'VERIFICATION');
  assert.match(blocked.error, /DONE blocked:\n- AC-001 → not-assessed/);
});

test('AC-404: reopen and checkpoint revision invalidate convergence through the cascade; history stays', async () => {
  const { root, id } = await verifiedFeature();
  await recordConvergence(root, id, { findings: ALL_SATISFIED });
  await complete(root, id, 'delivery-convergence');
  await advanceActiveWork(root, id);
  await reopenWork(root, id, { toStage: 'implementation', reason: 'Refund approval regressed in production.' });
  const reopened = await meta(root, id);
  const progress = await readJson(root, id, 'progress.yaml');
  assert.equal(progress.skills['delivery-convergence'].status, 'pending');
  const view = await evaluateConvergence(root, reopened);
  assert.equal(view.counts.stale, 3);
  assert.match(view.criteria[0].staleReasons[0], /recorded before the reopen\/revision/);
  assert.equal((await readJson(root, id, 'convergence.yaml')).assessments.length, 1, 'no finding is deleted');

  // Revising verification cascades to convergence; revising convergence alone keeps
  // the verification freshness boundary where it was.
  await complete(root, id, 'implementation');
  await advanceActiveWork(root, id);
  await recordVerification(root, id, { command: 'true', success: true, exitCode: 0 });
  await complete(root, id, 'verification');
  await recordConvergence(root, id, { findings: ALL_SATISFIED });
  await complete(root, id, 'delivery-convergence');
  const before = (await meta(root, id)).lastInvalidationAt;
  const revised = await reviseCheckpoint(root, id, { skillId: 'delivery-convergence', status: 'in_progress', reason: 'AC-002 evidence was the wrong file.' });
  await reconcileStageAfterCheckpointRevision(root, revised.meta, 'delivery-convergence', 'AC-002 evidence was the wrong file.');
  assert.equal((await meta(root, id)).lastInvalidationAt, before, 'verification evidence stays fresh');
  assert.equal((await evaluateConvergence(root, await meta(root, id))).counts.stale, 0);
  const cascade = await reviseCheckpoint(root, id, { skillId: 'verification', status: 'in_progress', reason: 'Flaky proof.' });
  assert.deepEqual(cascade.ledger.history.at(-1).skill, 'delivery-convergence');
});

test('change/architectural requires convergence; change/bounded never does', async () => {
  const root = await workspace();
  const bounded = await routed(root, 'change', 'bounded');
  for (const skill of ['context-discovery', 'requirement-clarification', 'implementation-planning']) await complete(root, bounded.id, skill);
  for (let index = 0; index < 6; index++) await advanceActiveWork(root, bounded.id);
  await toVerified(root, bounded.id);
  await reviewKnowledgeNone(root, bounded.id);
  assert.equal((await advanceActiveWork(root, bounded.id)).to, 'DONE');
  const architectural = await routed(root, 'change', 'architectural');
  assert.ok((await meta(root, architectural.id)).behaviorContract.skills.includes('delivery-convergence'));
});

test('M6: guide, resume, handoff, and brief show a compact delivery block, never the full ledger', async () => {
  const { root, id } = await verifiedFeature();
  await recordConvergence(root, id, { findings: [satisfied('AC-001'), { criterion: 'AC-002', status: 'partial', reason: 'No approval.', evidence: ['src/refund.js'] }, { criterion: 'AC-003', status: 'missing', reason: 'No export.', evidence: ['src/export.js'] }] });
  for (const command of ['guide', 'resume', 'handoff']) {
    const out = cli(root, [command, id]).stdout;
    assert.match(out, /Delivery intent: 2 requirement\(s\) · 3 acceptance criteria · convergence required/, command);
    assert.match(out, /Convergence: satisfied 1 · partial 1 · missing 1 · contradicts 0 · not assessed 0 \(latest CV-001\)/, command);
    assert.match(out, /Blocking criteria: AC-002 \(partial\), AC-003 \(missing\)/, command);
    assert.doesNotMatch(out, /A refund requires manager approval/, `${command} does not dump criterion statements`);
  }
  assert.match(cli(root, ['guide', id]).stdout, /BLOCKER:\nconvergence: AC-002 → partial \(\+1 more\)/);
  assert.match(cli(root, ['brief']).stdout, /Delivery \(PF-0001\): 2 requirement\(s\) · 3 acceptance criteria/);
  const show = cli(root, ['convergence', 'show', id, 'AC-002']).stdout;
  assert.match(show, /AC-002 in CV-001 .* → partial\n  Reason: No approval\./);
});
