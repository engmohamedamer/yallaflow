// v0.3.8 Phase F — regressions for the independent review's findings. Each case is a
// state reachable through supported commands that must not fail doctor, or a claim
// that must not count as current convergence.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { symlink } from 'node:fs/promises';
import { cli } from '../test-support/legacy-context.js';
import { advanceActiveWork, reconcileStageAfterCheckpointRevision, reopenWork } from '../src/core/transitions.js';
import { reviseCheckpoint } from '../src/core/progress.js';
import { recordVerification } from '../src/core/evidence.js';
import { reviewKnowledgeNone } from '../src/knowledge/store.js';
import { executeDecomposition, proposeDecomposition, validateDecomposition } from '../src/decomposition/store.js';
import { recordRequirements } from '../src/delivery/requirements.js';
import { evaluateConvergence, recordConvergence } from '../src/delivery/convergence.js';
import { recordRequirementsWithImpact } from '../src/delivery/assess.js';
import { inspectBootstrap, BOOTSTRAP_PROVIDERS } from '../src/agent/bootstrap.js';
import { INTENT, boundedFeatureAtImplementation, complete, meta, routed, satisfied, toVerified, workspace } from '../test-support/delivery-fixtures.js';

async function decomposedParent() {
  const root = await workspace();
  const parent = await routed(root, 'feature', 'architectural', 'Contract hub');
  for (const skill of ['context-discovery', 'requirement-clarification', 'design-exploration']) {
    await complete(root, parent.id, skill);
    await advanceActiveWork(root, parent.id);
  }
  await recordRequirements(root, parent.id, structuredClone(INTENT));
  await complete(root, parent.id, 'specification');
  await advanceActiveWork(root, parent.id);
  await advanceActiveWork(root, parent.id);
  await complete(root, parent.id, 'implementation-planning');
  await proposeDecomposition(root, parent.id, { children: [
    { key: 'refunds', title: 'Refunds', type: 'feature', scope: 'bounded', requirements: ['REQ-001'], acceptanceCriteria: ['AC-001', 'AC-002'] },
    { key: 'export', title: 'Export', type: 'feature', scope: 'bounded', requirements: ['REQ-002'], acceptanceCriteria: ['AC-003'] }
  ] });
  await validateDecomposition(root, parent.id);
  const { ledger } = await executeDecomposition(root, parent.id);
  await advanceActiveWork(root, parent.id); // PLAN -> IMPLEMENTATION (children are the implementation)
  return { root, parent: parent.id, refunds: ledger.children[0].workId, exporter: ledger.children[1].workId };
}

async function convergeChild(root, child, refs) {
  await complete(root, child, 'context-discovery');
  await complete(root, child, 'requirement-clarification');
  for (let index = 0; index < 5; index++) await advanceActiveWork(root, child);
  await toVerified(root, child);
  await recordConvergence(root, child, { findings: refs.map((ref) => satisfied(ref)) });
  await complete(root, child, 'delivery-convergence');
  await reviewKnowledgeNone(root, child);
  await advanceActiveWork(root, child);
}

test('H1: a parent cannot withdraw a criterion an in-flight child answers for; a DONE child only warns', async () => {
  const { root, parent, refunds, exporter } = await decomposedParent();
  await assert.rejects(
    () => recordRequirements(root, parent, { acceptanceCriteria: [{ id: 'AC-003', status: 'withdrawn', reason: 'Export dropped.' }] }),
    new RegExp(`AC-003 is assigned to ${exporter} \\(Export\\), which is not DONE`)
  );
  await convergeChild(root, exporter, ['PF-0001/AC-003']);
  await recordRequirements(root, parent, { requirements: [{ id: 'REQ-002', status: 'withdrawn', reason: 'Export dropped after delivery.' }], acceptanceCriteria: [{ id: 'AC-003', status: 'withdrawn', reason: 'Export dropped after delivery.' }] });
  const doctor = cli(root, ['doctor']).stdout;
  assert.match(doctor, new RegExp(`WARN ${exporter}: every acceptance criterion it delivered has since been withdrawn or deferred on PF-0001`));
  assert.match(doctor, /Workspace healthy\./);
  assert.match(cli(root, ['decompose', 'status', parent]).stdout, /no longer active in the requirements ledger: AC-003/);
  assert.equal((await meta(root, refunds)).status, 'INTAKE');
});

test('H2: revising the intent checkpoint does not reopen intent while downstream work stands', async () => {
  const root = await workspace();
  const work = await boundedFeatureAtImplementation(root);
  await toVerified(root, work.id);
  await recordConvergence(root, work.id, { findings: [satisfied('AC-001'), satisfied('AC-002'), satisfied('AC-003', ['src/export.js'])] });
  await complete(root, work.id, 'delivery-convergence');
  const revised = await reviseCheckpoint(root, work.id, { skillId: 'requirement-clarification', status: 'in_progress', reason: 'Owner has a new rule.' });
  await reconcileStageAfterCheckpointRevision(root, revised.meta, 'requirement-clarification', 'Owner has a new rule.');
  const change = await recordRequirementsWithImpact(root, work.id, { acceptanceCriteria: [{ id: 'AC-004', requirement: 'REQ-001', statement: 'Refund reasons are mandatory.', provenance: [{ type: 'request' }] }] });
  assert.equal(change.impact?.id, 'IM-001', 'the change of intent is assessed, not free');
  assert.match(cli(root, ['doctor']).stdout, /Workspace healthy\./);
});

test('H3: convergence evidence must be a direct child\'s satisfied finding for that criterion, and goes stale with it', async () => {
  const { root, parent, refunds, exporter } = await decomposedParent();
  await convergeChild(root, refunds, ['PF-0001/AC-001', 'PF-0001/AC-002']);
  await convergeChild(root, exporter, ['PF-0001/AC-003']);
  await advanceActiveWork(root, parent); // IMPLEMENTATION -> VERIFICATION once every child is DONE
  await recordVerification(root, parent, { command: 'true', success: true, exitCode: 0 });
  await complete(root, parent, 'verification');
  await assert.rejects(() => recordConvergence(root, parent, { findings: [{ criterion: 'AC-003', status: 'satisfied', reason: 'x', evidence: [`convergence:${refunds}/CV-001`] }] }), new RegExp(`${refunds}/CV-001 did not assess PF-0001/AC-003`));
  await assert.rejects(() => recordConvergence(root, parent, { findings: [{ criterion: 'AC-001', status: 'satisfied', reason: 'x', evidence: ['convergence:PF-0001/CV-001'] }] }), /must cite a direct decomposition child of PF-0001/);
  await recordConvergence(root, parent, { findings: [
    { criterion: 'AC-001', status: 'satisfied', reason: 'Delivered by refunds.', evidence: [`convergence:${refunds}/CV-001`] },
    { criterion: 'AC-002', status: 'satisfied', reason: 'Delivered by refunds.', evidence: [`convergence:${refunds}/CV-001`] },
    { criterion: 'AC-003', status: 'satisfied', reason: 'Delivered by export.', evidence: [`convergence:${exporter}/CV-001`] }
  ] });
  assert.equal((await evaluateConvergence(root, await meta(root, parent))).converged, true);
  await reopenWork(root, refunds, { toStage: 'implementation', reason: 'Refund defect found.' });
  const view = await evaluateConvergence(root, await meta(root, parent));
  assert.equal(view.converged, false);
  assert.match(view.criteria[0].staleReasons.join(), new RegExp(`${refunds}'s current finding for PF-0001/AC-001 is stale`));
});

test('M1: convergence cannot be recorded before verification is complete', async () => {
  const root = await workspace();
  const work = await boundedFeatureAtImplementation(root);
  await assert.rejects(() => recordConvergence(root, work.id, { findings: [satisfied('AC-001', ['runtime: looks fine'])] }), /complete the verification checkpoint first/);
});

test('M3: reopen to review keeps verification and convergence current and doctor healthy', async () => {
  const root = await workspace();
  const work = await boundedFeatureAtImplementation(root);
  await toVerified(root, work.id);
  await recordConvergence(root, work.id, { findings: [satisfied('AC-001'), satisfied('AC-002'), satisfied('AC-003', ['src/export.js'])] });
  await complete(root, work.id, 'delivery-convergence');
  await reviewKnowledgeNone(root, work.id);
  await advanceActiveWork(root, work.id);
  await reopenWork(root, work.id, { toStage: 'review', reason: 'A second reviewer is required.' });
  const reopened = await meta(root, work.id);
  assert.equal(reopened.status, 'VERIFICATION');
  assert.equal(reopened.lastInvalidationAt, undefined, 'nothing was re-implemented');
  assert.equal((await evaluateConvergence(root, reopened)).converged, true);
  assert.match(cli(root, ['doctor']).stdout, /Workspace healthy\./);
  assert.equal((await advanceActiveWork(root, work.id)).to, 'DONE');
});

test('L1/L2: YallaFlow state is not evidence; zero-padded twins of an ID are refused', async () => {
  const root = await workspace();
  const work = await boundedFeatureAtImplementation(root);
  await toVerified(root, work.id);
  await assert.rejects(() => recordConvergence(root, work.id, { findings: [satisfied('AC-001', [`.yallaflow/work/${work.id}/meta.yaml`])] }), /is YallaFlow's own state, not evidence/);
  const other = await routed(root, 'feature', 'bounded');
  await recordRequirements(root, other.id, structuredClone(INTENT));
  await assert.rejects(() => recordRequirements(root, other.id, { acceptanceCriteria: [{ id: 'AC-0001', requirement: 'REQ-001', statement: 'x', provenance: [{ type: 'request' }] }] }), /AC-0001 would name the same number as existing AC-001/);
});

test('L3: CLAUDE.md symlinked to AGENTS.md is reported as shared, not malformed', async () => {
  const root = await workspace();
  cli(root, ['agent', 'setup', 'codex']);
  await symlink('AGENTS.md', path.join(root, 'CLAUDE.md'));
  const status = await inspectBootstrap(root, BOOTSTRAP_PROVIDERS.claude);
  assert.equal(status.state, 'shared');
  assert.match(cli(root, ['agent', 'status']).stdout, /claude \(CLAUDE\.md\): the same file as the codex bootstrap/);
  assert.match(cli(root, ['agent', 'setup', 'claude'], false).stderr, /already carries its YallaFlow block; no separate claude block is needed/);
  assert.doesNotMatch(cli(root, ['doctor']).stdout, /bootstrap/);
});
