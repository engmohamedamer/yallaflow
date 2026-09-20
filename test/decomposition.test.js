import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPendingIntake, routeWorkItem } from '../src/behavior/routing.js';
import { checkpointWork } from '../src/core/progress.js';
import { advanceActiveWork } from '../src/core/transitions.js';
import { initWorkspace, workspacePath } from '../src/core/workspace.js';
import { readYaml } from '../src/core/yaml.js';
import {
  childProgressView,
  computeTraceability,
  decompositionBlockers,
  executeDecomposition,
  loadDecomposition,
  proposeDecomposition,
  readyChildren,
  validateDecomposition
} from '../src/decomposition/store.js';

async function planReadyParent() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-decomposition-'));
  await initWorkspace(root, 'demo', 'greenfield', 'autonomous');
  const intake = await createPendingIntake(root, 'Nice Day Contract Hub');
  const meta = await routeWorkItem(root, intake.id, {
    work_type: 'feature', scope: 'architectural', confidence: 'high',
    reason: 'Large project requiring decomposition.', title: 'Nice Day Contract Hub'
  });
  await complete(root, meta, 'context-discovery');
  await advanceActiveWork(root); // -> DISCOVERY
  await complete(root, meta, 'requirement-clarification');
  await advanceActiveWork(root); // -> CLARIFICATION
  await complete(root, meta, 'design-exploration');
  await advanceActiveWork(root); // -> DESIGN
  await complete(root, meta, 'specification');
  await advanceActiveWork(root); // -> SPECIFICATION
  await advanceActiveWork(root); // -> PLAN
  await complete(root, meta, 'implementation-planning');
  return { root, meta };
}

async function complete(root, meta, skillId) {
  return checkpointWork(root, meta.id, { skillId, status: 'completed', summary: `${skillId} completed.`, evidence: [] });
}

const TWO_CHILDREN = {
  children: [
    { key: 'foundation', title: 'Foundation & Authentication', type: 'feature', scope: 'bounded', required: true, requirements: ['FR-01'], acceptanceCriteria: ['AC-01'] },
    { key: 'templates', title: 'Templates & Versioning', type: 'feature', scope: 'bounded', required: true, requirements: ['FR-02'], acceptanceCriteria: ['AC-02'], dependsOn: ['foundation'] }
  ],
  requirementsUniverse: ['FR-01', 'FR-02', 'FR-03'],
  acceptanceCriteriaUniverse: ['AC-01', 'AC-02']
};

test('PLAN_READY work can begin decomposition', async () => {
  const { root, meta } = await planReadyParent();
  const { ledger } = await proposeDecomposition(root, meta.id, TWO_CHILDREN);
  assert.equal(ledger.status, 'proposed');
  assert.equal(ledger.children.length, 2);
});

test('work not ready for decomposition is rejected', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-decomposition-'));
  await initWorkspace(root, 'demo', 'greenfield', 'autonomous');
  const intake = await createPendingIntake(root, 'Too early');
  const meta = await routeWorkItem(root, intake.id, {
    work_type: 'feature', scope: 'architectural', confidence: 'high', reason: 'Not ready yet.'
  });
  await assert.rejects(
    () => proposeDecomposition(root, meta.id, TWO_CHILDREN),
    /not ready for decomposition; delivery status is/
  );
});

test('proposed children preserve the parent relation and remain a normal work item once created', async () => {
  const { root, meta } = await planReadyParent();
  await proposeDecomposition(root, meta.id, TWO_CHILDREN);
  await validateDecomposition(root, meta.id);
  const { ledger } = await executeDecomposition(root, meta.id);
  for (const child of ledger.children) {
    const childMeta = await readYaml(path.join(workspacePath(root), 'work', child.workId, 'meta.yaml'));
    assert.equal(childMeta.parent, meta.id);
    assert.equal(childMeta.decompositionKey, child.key);
    assert.equal(childMeta.routingStatus, 'routed');
    assert.ok(childMeta.behaviorContract.skills.length > 0);
    assert.equal(childMeta.status, 'INTAKE');
  }
});

test('requirement and acceptance-criteria references are preserved on the child', async () => {
  const { root, meta } = await planReadyParent();
  await proposeDecomposition(root, meta.id, TWO_CHILDREN);
  await validateDecomposition(root, meta.id);
  const { ledger } = await executeDecomposition(root, meta.id);
  const foundation = ledger.children.find((child) => child.key === 'foundation');
  const childMeta = await readYaml(path.join(workspacePath(root), 'work', foundation.workId, 'meta.yaml'));
  assert.deepEqual(childMeta.requirements, ['FR-01']);
  assert.deepEqual(childMeta.acceptanceCriteria, ['AC-01']);
});

test('unassigned requirement/acceptance-criteria coverage can be reported', async () => {
  const { root, meta } = await planReadyParent();
  const { ledger } = await proposeDecomposition(root, meta.id, TWO_CHILDREN);
  const coverage = computeTraceability(ledger);
  assert.deepEqual(coverage.requirements.unassigned, ['FR-03']);
  assert.deepEqual(coverage.acceptanceCriteria.unassigned, []);
});

test('cross-cutting duplicate requirement references remain representable, not invalid', async () => {
  const { root, meta } = await planReadyParent();
  const proposal = {
    children: [
      { key: 'a', title: 'A', type: 'feature', scope: 'bounded', requirements: ['FR-01'] },
      { key: 'b', title: 'B', type: 'feature', scope: 'bounded', requirements: ['FR-01'] }
    ]
  };
  const { ledger } = await proposeDecomposition(root, meta.id, proposal);
  const coverage = computeTraceability(ledger);
  assert.deepEqual(coverage.requirements.duplicated, ['FR-01']);
});

test('required and deferred/optional children are supported', async () => {
  const { root, meta } = await planReadyParent();
  const proposal = {
    children: [
      { key: 'core', title: 'Core', type: 'feature', scope: 'bounded', required: true },
      { key: 'nice-to-have', title: 'Nice To Have', type: 'feature', scope: 'bounded', required: false }
    ]
  };
  const { ledger } = await proposeDecomposition(root, meta.id, proposal);
  assert.equal(ledger.children.find((child) => child.key === 'core').required, true);
  assert.equal(ledger.children.find((child) => child.key === 'nice-to-have').required, false);
});

test('a decomposition with structural errors is rejected at propose time', async () => {
  const { root, meta } = await planReadyParent();
  await assert.rejects(
    () => proposeDecomposition(root, meta.id, { children: [{ key: 'a', title: 'A', type: 'not-a-type', scope: 'bounded' }] }),
    /type must be one of/
  );
});

test('validate transitions proposed to validated and reports traceability', async () => {
  const { root, meta } = await planReadyParent();
  await proposeDecomposition(root, meta.id, TWO_CHILDREN);
  const result = await validateDecomposition(root, meta.id);
  assert.equal(result.valid, true);
  assert.equal(result.ledger.status, 'validated');
});

test('execute requires validation first', async () => {
  const { root, meta } = await planReadyParent();
  await proposeDecomposition(root, meta.id, TWO_CHILDREN);
  await assert.rejects(() => executeDecomposition(root, meta.id), /must be validated before execution/);
});

test('execute is the explicit boundary between planning and executing; it never advances the parent by itself', async () => {
  const { root, meta } = await planReadyParent();
  await proposeDecomposition(root, meta.id, TWO_CHILDREN);
  await validateDecomposition(root, meta.id);
  const { ledger } = await executeDecomposition(root, meta.id);
  const parentMeta = await readYaml(path.join(workspacePath(root), 'work', meta.id, 'meta.yaml'));
  assert.equal(parentMeta.status, 'PLAN');
  const blockers = await decompositionBlockers(root, parentMeta);
  assert.equal(blockers.length, 2); // neither required child is DONE yet
  assert.equal(ledger.status, 'executing');
  assert.ok(ledger.children.every((child) => child.workId));
});

test('the parent cannot leave IMPLEMENTATION until every required child is DONE', async () => {
  const { root, meta } = await planReadyParent();
  await proposeDecomposition(root, meta.id, TWO_CHILDREN);
  await validateDecomposition(root, meta.id);
  await executeDecomposition(root, meta.id);
  await advanceActiveWork(root, meta.id); // -> IMPLEMENTATION
  await assert.rejects(
    () => advanceActiveWork(root, meta.id),
    /required child .* is not DONE/
  );
});

test('a decomposed parent view shows done/active/ready/blocked children', async () => {
  const { root, meta } = await planReadyParent();
  await proposeDecomposition(root, meta.id, TWO_CHILDREN);
  await validateDecomposition(root, meta.id);
  const { ledger } = await executeDecomposition(root, meta.id);
  const view = await childProgressView(root, ledger);
  const foundation = view.find((child) => child.key === 'foundation');
  const templates = view.find((child) => child.key === 'templates');
  assert.equal(foundation.state, 'ready');
  assert.equal(templates.state, 'blocked');
  assert.deepEqual(templates.blockedBy, [foundation.workId]);
  assert.deepEqual(readyChildren(view).map((child) => child.key), ['foundation']);
});
