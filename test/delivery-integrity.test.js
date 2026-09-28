// v0.3.8 — ledger-backed decomposition (AC-207), doctor delivery integrity (AC-701),
// and compatibility with workspaces written before v0.3.8 (AC-702).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { rm, writeFile } from 'node:fs/promises';
import { cli } from '../test-support/legacy-context.js';
import { advanceActiveWork } from '../src/core/transitions.js';
import { reviewKnowledgeNone } from '../src/knowledge/store.js';
import { executeDecomposition, proposeDecomposition, validateDecomposition } from '../src/decomposition/store.js';
import { recordRequirements, resolveDeliveryCriteria } from '../src/delivery/requirements.js';
import { evaluateConvergence, recordConvergence } from '../src/delivery/convergence.js';
import { pinRegistryV4Contract } from '../test-support/delivery.js';
import { INTENT, boundedFeatureAtImplementation, complete, meta, readJson, routed, satisfied, toVerified, workspace, workspaceHash, writeJson } from '../test-support/delivery-fixtures.js';

async function planReadyParent(root) {
  const parent = await routed(root, 'feature', 'architectural', 'Contract hub');
  for (const skill of ['context-discovery', 'requirement-clarification', 'design-exploration']) await complete(root, parent.id, skill);
  await recordRequirements(root, parent.id, structuredClone(INTENT));
  await complete(root, parent.id, 'specification');
  await complete(root, parent.id, 'implementation-planning');
  return parent;
}

test('AC-207: with a parent requirements ledger, child coverage must resolve against it', async () => {
  const root = await workspace();
  const parent = await planReadyParent(root);
  await assert.rejects(() => proposeDecomposition(root, parent.id, { children: [{ key: 'a', title: 'A', type: 'feature', scope: 'bounded', requirements: ['FR-01'] }] }), /child a: requirement "FR-01" is not recorded in PF-0001's requirements ledger/);
  await assert.rejects(() => proposeDecomposition(root, parent.id, { children: [{ key: 'a', title: 'A', type: 'feature', scope: 'bounded', acceptanceCriteria: ['AC-001'] }], acceptanceCriteriaUniverse: ['AC-001'] }), /acceptanceCriteriaUniverse must match PF-0001's active acceptance criteria \(AC-001, AC-002, AC-003\) or be omitted/);
  const { ledger } = await proposeDecomposition(root, parent.id, { children: [
    { key: 'refunds', title: 'Refunds', type: 'feature', scope: 'bounded', requirements: ['REQ-001'], acceptanceCriteria: ['AC-001', 'PF-0001/AC-002'] },
    { key: 'export', title: 'Export', type: 'feature', scope: 'bounded', requirements: ['REQ-002'] }
  ] });
  assert.deepEqual(ledger.acceptanceCriteriaUniverse, [], 'the universe is never copied into decomposition.yaml');
  assert.deepEqual(ledger.children[0].acceptanceCriteria, ['AC-001', 'AC-002']);
  const validated = await validateDecomposition(root, parent.id);
  assert.deepEqual(validated.coverage.acceptanceCriteria.unassigned, ['AC-003']);
  const executed = await executeDecomposition(root, parent.id);
  const child = executed.ledger.children[0].workId;
  const resolved = await resolveDeliveryCriteria(root, await meta(root, child));
  assert.equal(resolved.source, 'inherited');
  assert.deepEqual(resolved.criteria.map((entry) => entry.ref), ['PF-0001/AC-001', 'PF-0001/AC-002']);
  await assert.rejects(() => recordRequirements(root, child, structuredClone(INTENT)), /answers for acceptance criteria owned by its parent PF-0001/);
  // The child's intent checkpoint is satisfied by the inherited criteria.
  await complete(root, child, 'context-discovery');
  await complete(root, child, 'requirement-clarification');
  for (let index = 0; index < 5; index++) await advanceActiveWork(root, child);
  await toVerified(root, child);
  await recordConvergence(root, child, { findings: [satisfied('AC-001'), satisfied('PF-0001/AC-002')] });
  await complete(root, child, 'delivery-convergence');
  await reviewKnowledgeNone(root, child);
  assert.equal((await advanceActiveWork(root, child)).to, 'DONE');
  const list = cli(root, ['requirement', 'list', child]).stdout;
  assert.match(list, /Acceptance criteria assigned from PF-0001 \(canonical there\): 2/);
  assert.match(list, /PF-0001\/AC-002 \[active\] A refund requires manager approval\. → satisfied — CV-001/);
  assert.match(cli(root, ['doctor']).stdout, /Workspace healthy\./);
});

test('AC-701: doctor fails on delivery contradictions and warns (only) on evidence drift', async () => {
  const root = await workspace();
  const work = await boundedFeatureAtImplementation(root);
  await toVerified(root, work.id);
  await recordConvergence(root, work.id, { findings: [satisfied('AC-001', ['src/refund.js', 'verification:V-001']), satisfied('AC-002'), satisfied('AC-003', ['src/export.js'])] });
  await complete(root, work.id, 'delivery-convergence');
  await reviewKnowledgeNone(root, work.id);
  await advanceActiveWork(root, work.id);
  assert.match(cli(root, ['doctor']).stdout, /PASS delivery integrity \(1 work item\(s\) checked\)/);

  // Drift after DONE: a warning that never rewrites DONE.
  await writeFile(path.join(root, 'src', 'export.js'), 'export function exportCalendar() { return "changed"; }\n');
  const drift = cli(root, ['doctor']).stdout;
  assert.match(drift, /WARN PF-0001: AC-003 convergence may be stale — evidence src\/export\.js changed since CV-001 \(DONE history is unchanged; reopen to revalidate if needed\)/);
  assert.match(drift, /Workspace healthy\./);
  assert.equal((await meta(root, work.id)).status, 'DONE');
  assert.match(cli(root, ['handoff', work.id]).stdout, /No longer current since DONE: AC-003 \(stale\)/);

  const requirements = await readJson(root, work.id, 'requirements.yaml');
  const convergence = await readJson(root, work.id, 'convergence.yaml');
  const tamper = async (file, value, pattern) => {
    const original = await readJson(root, work.id, file).catch(() => null);
    await writeJson(root, work.id, file, value);
    const doctor = cli(root, ['doctor'], false);
    assert.equal(doctor.status, 1, `${file}: ${pattern}`);
    assert.match(doctor.stdout, pattern);
    if (original) await writeJson(root, work.id, file, original);
    else await rm(path.join(root, '.yallaflow', 'work', work.id, file));
  };
  await tamper('requirements.yaml', { ...requirements, acceptanceCriteria: [...requirements.acceptanceCriteria, { ...requirements.acceptanceCriteria[0], id: 'AC-009', requirement: 'REQ-404' }] }, /FAIL PF-0001: requirements\.yaml: acceptance criterion AC-009 references unknown requirement "REQ-404"/);
  await tamper('requirements.yaml', { ...requirements, acceptanceCriteria: [...requirements.acceptanceCriteria, requirements.acceptanceCriteria[0]] }, /duplicate acceptance criterion id AC-001/);
  const withFinding = (finding) => ({ ...convergence, assessments: [{ ...convergence.assessments[0], findings: [...convergence.assessments[0].findings, finding] }] });
  await tamper('convergence.yaml', withFinding({ criterion: 'AC-777', status: 'satisfied', reason: 'x', evidence: [{ type: 'runtime', description: 'x' }] }), /FAIL PF-0001: CV-001 assesses AC-777, which is not an acceptance criterion of PF-0001/);
  await tamper('convergence.yaml', { ...convergence, assessments: [{ ...convergence.assessments[0], findings: convergence.assessments[0].findings.map((finding, index) => (index ? finding : { ...finding, status: 'mostly' })) }] }, /impossible status "mostly"/);
  await tamper('convergence.yaml', { ...convergence, assessments: [{ ...convergence.assessments[0], findings: convergence.assessments[0].findings.map((finding, index) => (index ? finding : { ...finding, evidence: [{ type: 'reference', ref: 'trust me' }] })) }] }, /is satisfied without evidence beyond free-text references/);
  await tamper('convergence.yaml', { ...convergence, assessments: [{ ...convergence.assessments[0], findings: convergence.assessments[0].findings.map((finding, index) => (index ? finding : { ...finding, evidence: [{ type: 'runtime', description: 'x', verificationRunId: 'V-099' }] })) }] }, /cites verification V-099, which does not exist/);
  await tamper('convergence.yaml', { ...convergence, assessments: [{ ...convergence.assessments[0], findings: convergence.assessments[0].findings.map((finding) => (finding.criterion === 'AC-002' ? { ...finding, status: 'missing' } : finding)) }] }, /FAIL PF-0001: is DONE but AC-002 is missing/);
  await tamper('convergence.yaml', { ...convergence, assessments: [] }, /FAIL PF-0001: is DONE but AC-001 is not-assessed/);
  await tamper('impact.yaml', { schemaVersion: 1, impacts: [{ id: 'IM-001', status: 'pending', raisedAt: new Date().toISOString(), stageAtRaise: 'IMPLEMENTATION', triggers: [{ type: 'requirements', changes: [{ id: 'AC-001', action: 'revised' }], at: new Date().toISOString() }] }], updatedAt: null }, /FAIL PF-0001: is DONE with impact IM-001 still pending assessment/);
  await tamper('impact.yaml', { schemaVersion: 1, impacts: [{ id: 'IM-001', status: 'assessed', raisedAt: 'x', stageAtRaise: 'IMPLEMENTATION', triggers: [{ type: 'requirements', changes: [{ id: 'AC-001', action: 'revised' }], at: 'x' }], assessment: { assessedAt: 'x', stages: { implementation: { verdict: 'affected', reason: 'r' } }, applied: { revised: ['implementation'], convergenceInvalidated: true } } }], updatedAt: null }, /IM-001 claims it revised implementation, but progress\.yaml has no matching revision/);
  assert.match(cli(root, ['doctor']).stdout, /Workspace healthy\./, 'restored');
});

test('AC-701: delivery state on work without a delivery contract is a contradiction', async () => {
  const root = await workspace();
  const bug = await routed(root, 'bug', 'bounded');
  await writeJson(root, bug.id, 'convergence.yaml', { schemaVersion: 1, assessments: [], updatedAt: null });
  assert.match(cli(root, ['doctor'], false).stdout, /FAIL PF-0001: convergence\.yaml exists but the work item's Behavior Contract has no delivery-convergence/);
});

test('AC-501: attaching a source to DONE work stays a recovered source and raises no impact', async () => {
  const root = await workspace();
  const work = await boundedFeatureAtImplementation(root);
  await toVerified(root, work.id);
  await recordConvergence(root, work.id, { findings: [satisfied('AC-001'), satisfied('AC-002'), satisfied('AC-003', ['src/export.js'])] });
  await complete(root, work.id, 'delivery-convergence');
  await reviewKnowledgeNone(root, work.id);
  await advanceActiveWork(root, work.id);
  await writeFile(path.join(root, 'screenshot.txt'), 'original screenshot\n');
  const out = cli(root, ['intake', 'add', work.id, 'screenshot.txt', '--reason', 'Not captured during the work.']).stdout;
  assert.match(out, /remains DONE; recorded as recovered source/);
  assert.doesNotMatch(out, /Impact/);
  assert.match(cli(root, ['doctor']).stdout, /Workspace healthy\./);
});

test('AC-702: a v0.3.7-routed workspace reads, reports, and passes doctor with zero bytes changed', async () => {
  const root = await workspace();
  const legacy = await routed(root, 'feature', 'bounded', 'Legacy feature');
  await pinRegistryV4Contract(root, legacy.id);
  await complete(root, legacy.id, 'context-discovery');
  await complete(root, legacy.id, 'requirement-clarification');
  for (let index = 0; index < 5; index++) await advanceActiveWork(root, legacy.id);
  await toVerified(root, legacy.id);
  await reviewKnowledgeNone(root, legacy.id);
  assert.equal((await advanceActiveWork(root, legacy.id)).to, 'DONE', 'no convergence ceremony for pre-v0.3.8 work');
  const before = await workspaceHash(root);
  for (const args of [['doctor'], ['guide', legacy.id], ['resume', legacy.id], ['handoff', legacy.id], ['brief'], ['status'], ['upgrade', 'status'],
    ['requirement', 'list', legacy.id], ['convergence', 'status', legacy.id], ['impact', 'status', legacy.id]]) {
    const result = cli(root, args);
    assert.doesNotMatch(result.stdout, /Delivery intent|FAIL/, args.join(' '));
  }
  assert.match(cli(root, ['convergence', 'status', legacy.id]).stdout, /Convergence: not required/);
  assert.equal(await workspaceHash(root), before);
  assert.equal((await evaluateConvergence(root, await meta(root, legacy.id))).required, false);
});

test('every file a delivery lifecycle writes has a declared owner, and bootstrap files are repository-root projections', async () => {
  const { readdir } = await import('node:fs/promises');
  const { ownershipOf } = await import('../src/core/ownership.js');
  const root = await workspace();
  const work = await boundedFeatureAtImplementation(root);
  await writeFile(path.join(root, 'policy.txt'), 'Refund policy v2.\n');
  cli(root, ['intake', 'add', work.id, 'policy.txt']);
  cli(root, ['agent', 'setup', 'claude']);
  async function files(dir, base = dir) {
    const out = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...await files(absolute, base));
      else out.push(path.relative(base, absolute).split(path.sep).join('/'));
    }
    return out;
  }
  const all = await files(path.join(root, '.yallaflow'));
  for (const expected of [`work/${work.id}/requirements.yaml`, `work/${work.id}/impact.yaml`]) assert.ok(all.includes(expected), expected);
  assert.deepEqual(all.filter((relative) => !ownershipOf(relative)), []);
  assert.equal(ownershipOf('CLAUDE.md', { base: 'repository' }).owner, 'projection');
});

test('lifecycle invariant: command-reachable delivery states pass doctor', async () => {
  const { recordConvergenceAndReconcile, recordRequirementsWithImpact, assessImpact } = await import('../src/delivery/assess.js');
  // (1) A gap recorded after the convergence checkpoint was completed reopens it, audited.
  const root = await workspace();
  const work = await boundedFeatureAtImplementation(root);
  await toVerified(root, work.id);
  await recordConvergence(root, work.id, { findings: [satisfied('AC-001'), satisfied('AC-002'), satisfied('AC-003', ['src/export.js'])] });
  await complete(root, work.id, 'delivery-convergence');
  const result = await recordConvergenceAndReconcile(root, work.id, { findings: [{ criterion: 'AC-002', status: 'partial', reason: 'Approval bypass found in review.', evidence: ['src/refund.js'] }] });
  assert.match(result.reopened, /Convergence CV-002 recorded gaps: AC-002 → partial/);
  const progress = await readJson(root, work.id, 'progress.yaml');
  assert.equal(progress.skills['delivery-convergence'].status, 'in_progress');
  assert.equal(progress.history.at(-1).skill, 'delivery-convergence');
  assert.match(cli(root, ['doctor']).stdout, /Workspace healthy\./);

  // (2) Changed criteria cannot leave convergence unaffected.
  await recordConvergence(root, work.id, { findings: [satisfied('AC-002')] });
  await complete(root, work.id, 'delivery-convergence');
  await recordRequirementsWithImpact(root, work.id, { acceptanceCriteria: [{ id: 'AC-004', requirement: 'REQ-002', statement: 'The export includes holidays.', provenance: [{ type: 'request' }] }] });
  assert.match(cli(root, ['doctor']).stdout, /Workspace healthy\./, 'a pending impact is not corruption');
  const unaffected = Object.fromEntries(['context-discovery', 'requirement-clarification', 'implementation', 'verification', 'delivery-convergence'].map((skill) => [skill, { verdict: 'unaffected', reason: 'n/a' }]));
  await assert.rejects(() => assessImpact(root, work.id, { stages: unaffected }), /delivery-convergence cannot be unaffected: acceptance criteria changed \(AC-004\)/);
  await assessImpact(root, work.id, { stages: { ...unaffected, 'delivery-convergence': { verdict: 'affected', reason: 'New criterion to prove.' } } });
  assert.equal((await readJson(root, work.id, 'progress.yaml')).skills['delivery-convergence'].status, 'pending');
  assert.match(cli(root, ['doctor']).stdout, /Workspace healthy\./);
});

test('lifecycle invariant: a parent revising an inherited criterion stales the child without corrupting it', async () => {
  const { recordRequirementsWithImpact } = await import('../src/delivery/assess.js');
  const root = await workspace();
  const parent = await planReadyParent(root);
  await proposeDecomposition(root, parent.id, { children: [{ key: 'refunds', title: 'Refunds', type: 'feature', scope: 'bounded', requirements: ['REQ-001'], acceptanceCriteria: ['AC-001'] }] });
  await validateDecomposition(root, parent.id);
  const child = (await executeDecomposition(root, parent.id)).ledger.children[0].workId;
  await complete(root, child, 'context-discovery');
  await complete(root, child, 'requirement-clarification');
  for (let index = 0; index < 5; index++) await advanceActiveWork(root, child);
  await toVerified(root, child);
  await recordConvergence(root, child, { findings: [satisfied('AC-001')] });
  await complete(root, child, 'delivery-convergence');
  const change = await recordRequirementsWithImpact(root, parent.id, { acceptanceCriteria: [{ id: 'AC-001', statement: 'A refund can be created and is audited.' }] });
  assert.equal(change.impact.id, 'IM-001', 'the parent owns the change and its impact');
  const doctor = cli(root, ['doctor']).stdout;
  assert.match(doctor, new RegExp(`WARN ${child}: PF-0001/AC-001 convergence may be stale — PF-0001/AC-001 was revised after CV-001 \\(re-assess before DONE\\)`));
  assert.match(doctor, /Workspace healthy\./);
  await reviewKnowledgeNone(root, child);
  await assert.rejects(() => advanceActiveWork(root, child), /PF-0001\/AC-001 → stale/);
});
