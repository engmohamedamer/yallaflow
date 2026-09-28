// v0.3.8 M5 — source/requirement change impact. YallaFlow raises a pending impact
// deterministically when approved intent changes after it was fixed; the Agent
// assesses which completed stages are affected; YallaFlow applies the existing,
// audited checkpoint-revision machinery. Nothing is deleted.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { cli } from '../test-support/legacy-context.js';
import { advanceActiveWork, evaluateAdvance } from '../src/core/transitions.js';
import { checkpointWork } from '../src/core/progress.js';
import { listVerificationRuns } from '../src/core/evidence.js';
import { evaluateConvergence, recordConvergence } from '../src/delivery/convergence.js';
import { loadWorkImpacts } from '../src/delivery/impact.js';
import { assessImpact, recordRequirementsWithImpact } from '../src/delivery/assess.js';
import { recordRequirements } from '../src/delivery/requirements.js';
import { INTENT, boundedFeatureAtImplementation, complete, meta, readJson, routed, satisfied, toVerified, workspace, workspaceHash } from '../test-support/delivery-fixtures.js';

async function attach(root, id, name = 'refund-policy.txt', text = 'Refunds above 100 need two approvals.\n') {
  await writeFile(path.join(root, name), text);
  return cli(root, ['intake', 'add', id, name]);
}

// Architectural feature at IMPLEMENTATION with a converged-looking history.
async function architecturalInImplementation() {
  const root = await workspace();
  const work = await routed(root, 'feature', 'architectural', 'Contract hub');
  for (const skill of ['context-discovery', 'requirement-clarification', 'design-exploration']) {
    await complete(root, work.id, skill);
    await advanceActiveWork(root, work.id);
  }
  await recordRequirements(root, work.id, structuredClone(INTENT));
  await complete(root, work.id, 'specification');
  await advanceActiveWork(root, work.id);
  await advanceActiveWork(root, work.id);
  await complete(root, work.id, 'implementation-planning');
  await advanceActiveWork(root, work.id);
  return { root, id: work.id };
}

test('AC-501: a source attached before the intent is fixed, or to DONE work, raises no impact', async () => {
  const root = await workspace();
  const work = await routed(root, 'feature', 'bounded', 'Refunds');
  await complete(root, work.id, 'context-discovery');
  assert.doesNotMatch((await attach(root, work.id)).stdout, /Impact/);
  assert.equal((await loadWorkImpacts(root, await meta(root, work.id))).exists, false);
  const bug = await routed(root, 'bug', 'bounded');
  await complete(root, bug.id, 'context-discovery');
  assert.doesNotMatch((await attach(root, bug.id, 'log.txt')).stdout, /Impact/, 'work without a delivery contract is unchanged');
});

test('AC-501/502: a source attached after the specification raises a pending impact that blocks progress and writes', async () => {
  const { root, id } = await architecturalInImplementation();
  const out = (await attach(root, id)).stdout;
  assert.match(out, /Impact IM-001 pending: source SRC-0001 attached after PF-0001's approved intent was fixed/);
  assert.match(out, /YallaFlow does not judge what the source changes/);
  const blocked = await evaluateAdvance(root, await meta(root, id), 'IMPLEMENTATION');
  assert.match(blocked.error, /impact IM-001 is pending/);
  assert.match(blocked.action, /yallaflow impact status PF-0001/);
  await assert.rejects(() => complete(root, id, 'implementation'), /Cannot complete implementation\. PF-0001 has a pending impact assessment \(IM-001: source SRC-0001 attached\)/);
  const guide = cli(root, ['guide', id]).stdout;
  assert.match(guide, /Application code modification: NOT AUTHORIZED\nReason: impact IM-001 is pending/);
  assert.match(guide, /IMPACT IM-001 PENDING: source SRC-0001 attached/);
  assert.match(cli(root, ['resume', id]).stdout, /PRIMARY UNRESOLVED OBJECTIVE:\nAssess impact IM-001/);
  assert.match(cli(root, ['handoff', id]).stdout, /Blockers: impact IM-001 pending assessment/);
  assert.match(cli(root, ['brief']).stdout, /Primary next concern: assess impact IM-001 on PF-0001/);
  const status = cli(root, ['impact', 'status', id]).stdout;
  assert.match(status, /PENDING IM-001/);
  assert.match(status, /- specification \(completed\)\n- implementation-planning \(completed\)/);
  // A second change while pending joins the same impact.
  await attach(root, id, 'more.txt', 'Refund reasons are mandatory.\n');
  const impacts = (await loadWorkImpacts(root, await meta(root, id))).ledger.impacts;
  assert.equal(impacts.length, 1);
  assert.deepEqual(impacts[0].triggers.map((trigger) => trigger.source), ['SRC-0001', 'SRC-0002']);
});

test('AC-503: the assessment covers every completed stage with a reason and respects mechanical rules', async () => {
  const { root, id } = await architecturalInImplementation();
  await attach(root, id);
  const before = await workspaceHash(root);
  const base = { 'context-discovery': { verdict: 'unaffected', reason: 'No new technology.' }, 'requirement-clarification': { verdict: 'unaffected', reason: 'Clarified already.' }, 'design-exploration': { verdict: 'unaffected', reason: 'Same shape.' }, specification: { verdict: 'affected', reason: 'New approval rule.' }, 'implementation-planning': { verdict: 'affected', reason: 'Plan adds approval step.' } };
  const cases = [
    [{ stages: { specification: base.specification } }, /context-discovery needs a verdict/],
    [{ stages: { ...base, implementation: { verdict: 'affected', reason: 'x' } } }, /implementation has no completed work to invalidate/],
    [{ stages: { ...base, 'design-exploration': { verdict: 'unaffected' } } }, /design-exploration requires a reason/],
    [{ stages: { ...base, specification: { verdict: 'maybe', reason: 'x' } } }, /verdict must be affected or unaffected/],
    [{ stages: { ...base, 'code-review': { verdict: 'unaffected', reason: 'x' } } }, /code-review has no completed work to invalidate/],
    [{ impact: 'IM-009', stages: base }, /"IM-009" is not an impact of PF-0001; the pending impact is IM-001/]
  ];
  for (const [input, pattern] of cases) await assert.rejects(() => assessImpact(root, id, input), pattern);
  assert.equal(await workspaceHash(root), before, 'rejected assessments change nothing');
});

test('AC-504/505: affected stages are revised through the audited path; unaffected stay; evidence is kept and goes stale', async () => {
  const root = await workspace();
  const work = await boundedFeatureAtImplementation(root);
  await toVerified(root, work.id);
  await recordConvergence(root, work.id, { findings: [satisfied('AC-001'), satisfied('AC-002'), satisfied('AC-003', ['src/export.js'])] });
  await complete(root, work.id, 'delivery-convergence');
  await attach(root, work.id);
  // Implementation affected ⇒ verification and convergence must be affected too.
  await assert.rejects(() => assessImpact(root, work.id, { stages: {
    'context-discovery': { verdict: 'unaffected', reason: 'Same code.' },
    'requirement-clarification': { verdict: 'affected', reason: 'New approval rule.' },
    implementation: { verdict: 'affected', reason: 'Must implement the rule.' },
    verification: { verdict: 'unaffected', reason: 'Tests still pass.' },
    'delivery-convergence': { verdict: 'affected', reason: 'Intent changed.' }
  } }), /verification cannot be unaffected while implementation is affected/);
  await assert.rejects(() => assessImpact(root, work.id, { stages: {
    'context-discovery': { verdict: 'unaffected', reason: 'Same code.' },
    'requirement-clarification': { verdict: 'affected', reason: 'New approval rule.' },
    implementation: { verdict: 'unaffected', reason: 'Rule already enforced.' },
    verification: { verdict: 'unaffected', reason: 'Proof unchanged.' },
    'delivery-convergence': { verdict: 'unaffected', reason: 'Findings hold.' }
  } }), /delivery-convergence cannot be unaffected when another stage is affected/);

  const runsBefore = (await listVerificationRuns(root, work.id)).length;
  const result = await assessImpact(root, work.id, { summary: 'New refund policy.', stages: {
    'context-discovery': { verdict: 'unaffected', reason: 'Same code paths.' },
    'requirement-clarification': { verdict: 'affected', reason: 'New two-approval rule.' },
    implementation: { verdict: 'affected', reason: 'Must implement the second approval.' },
    verification: { verdict: 'affected', reason: 'Needs proof of the rule.' },
    'delivery-convergence': { verdict: 'affected', reason: 'Intent changed.' }
  } });
  assert.deepEqual(result.revised, ['requirement-clarification', 'implementation'], 'cascade already reset verification and convergence');
  const progress = await readJson(root, work.id, 'progress.yaml');
  assert.equal(progress.skills['context-discovery'].status, 'completed');
  for (const skill of ['requirement-clarification', 'implementation', 'verification', 'delivery-convergence']) assert.equal(progress.skills[skill].status, 'pending', skill);
  assert.ok(progress.history.some((entry) => entry.skill === 'implementation' && entry.reason === 'Impact IM-001: Must implement the second approval.'));
  assert.ok(progress.history.some((entry) => entry.skill === 'verification' && /Downstream of implementation revision: Impact IM-001/.test(entry.reason)));
  assert.equal((await listVerificationRuns(root, work.id)).length, runsBefore, 'verification evidence is never deleted');
  const current = await meta(root, work.id);
  assert.equal(current.status, 'IMPLEMENTATION');
  assert.ok(current.lastInvalidationAt, 'verification evidence is now stale');
  const view = await evaluateConvergence(root, current);
  assert.equal(view.counts.stale, 3);
  assert.equal((await readJson(root, work.id, 'convergence.yaml')).assessments.length, 1, 'convergence history is kept');
  const impact = (await readJson(root, work.id, 'impact.yaml')).impacts[0];
  assert.equal(impact.status, 'assessed');
  assert.equal(impact.assessment.applied.convergenceInvalidated, true);
  assert.match(cli(root, ['impact', 'status', work.id]).stdout, /IM-001 assessed .*source SRC-0001 attached → affected requirement-clarification, implementation, verification, delivery-convergence/);
  assert.match(cli(root, ['doctor']).stdout, /Workspace healthy\./);
  // The intent is open again: requirement changes no longer raise impacts until it is re-fixed.
  const change = await recordRequirementsWithImpact(root, work.id, { acceptanceCriteria: [{ id: 'AC-004', requirement: 'REQ-001', statement: 'Refunds above 100 need two approvals.', provenance: [{ type: 'source', source: 'SRC-0001' }] }] });
  assert.equal(change.impact, null);
});

test('AC-505: an architectural spec revision moves the stage back while the unaffected design stays completed', async () => {
  const { root, id } = await architecturalInImplementation();
  await attach(root, id);
  const result = await assessImpact(root, id, { stages: {
    'context-discovery': { verdict: 'unaffected', reason: 'No new systems.' },
    'requirement-clarification': { verdict: 'unaffected', reason: 'Owner decisions unchanged.' },
    'design-exploration': { verdict: 'unaffected', reason: 'Same architecture.' },
    specification: { verdict: 'affected', reason: 'Adds a refund approval requirement.' },
    'implementation-planning': { verdict: 'affected', reason: 'Plan needs the approval step.' }
  } });
  assert.deepEqual(result.stage, { from: 'IMPLEMENTATION', to: 'SPECIFICATION' });
  const progress = await readJson(root, id, 'progress.yaml');
  assert.equal(progress.skills['design-exploration'].status, 'completed');
  assert.equal(progress.skills.specification.status, 'pending');
  assert.equal(progress.skills['implementation-planning'].status, 'pending');
});

test('requirement changes after the intent is fixed raise an impact; an all-unaffected assessment invalidates nothing', async () => {
  const root = await workspace();
  const work = await boundedFeatureAtImplementation(root);
  const change = await recordRequirementsWithImpact(root, work.id, { acceptanceCriteria: [{ id: 'AC-003', statement: 'The export is an ICS file named after the term.' }] });
  assert.equal(change.impact.id, 'IM-001');
  assert.deepEqual(change.impact.triggers[0].changes, [{ id: 'AC-003', action: 'revised', from: 'active', to: 'active' }]);
  assert.match(cli(root, ['requirement', 'list', work.id]).stdout, /AC-003 \[active\] The export is an ICS file named after the term\./);
  const result = await assessImpact(root, work.id, { stages: {
    'context-discovery': { verdict: 'unaffected', reason: 'Wording only.' },
    'requirement-clarification': { verdict: 'unaffected', reason: 'Clarifies naming; decisions unchanged.' }
  } });
  assert.deepEqual(result.revised, []);
  assert.equal((await meta(root, work.id)).lastInvalidationAt, undefined);
  await complete(root, work.id, 'implementation');
  assert.equal((await readJson(root, work.id, 'progress.yaml')).skills.implementation.status, 'completed');
});

test('an impact assessment is refused when nothing is pending, and a CLI assessment reports what it revised', async () => {
  const { root, id } = await architecturalInImplementation();
  await assert.rejects(() => assessImpact(root, id, { stages: {} }), /has no pending impact to assess/);
  await attach(root, id);
  await writeFile(path.join(root, 'impact.json'), JSON.stringify({ impact: 'IM-001', stages: {
    'context-discovery': { verdict: 'unaffected', reason: 'a' }, 'requirement-clarification': { verdict: 'unaffected', reason: 'b' },
    'design-exploration': { verdict: 'unaffected', reason: 'c' }, specification: { verdict: 'unaffected', reason: 'd' },
    'implementation-planning': { verdict: 'affected', reason: 'Plan reorders migrations.' }
  } }));
  const out = cli(root, ['impact', 'assess', id, '--file', 'impact.json']).stdout;
  assert.match(out, /impact IM-001 assessed\.\nAffected: implementation-planning\nUnaffected: context-discovery, requirement-clarification, design-exploration, specification/);
  assert.match(out, /Stage corrected: IMPLEMENTATION → PLAN/);
  await checkpointWork(root, id, { skillId: 'implementation-planning', status: 'completed', summary: 'Replanned.' });
  assert.equal((await advanceActiveWork(root, id)).to, 'IMPLEMENTATION');
});
