import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { createPendingIntake, routeWorkItem } from '../src/behavior/routing.js';
import { checkpointWork } from '../src/core/progress.js';
import { advanceActiveWork } from '../src/core/transitions.js';
import { recordVerification } from '../src/core/evidence.js';
import { reviewKnowledgeNone } from '../src/knowledge/store.js';
import { initWorkspace } from '../src/core/workspace.js';
import { executeDecomposition, proposeDecomposition, validateDecomposition } from '../src/decomposition/store.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));

async function planReadyParent() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-dependencies-'));
  await initWorkspace(root, 'demo', 'greenfield', 'autonomous');
  const intake = await createPendingIntake(root, 'Nice Day Contract Hub');
  const meta = await routeWorkItem(root, intake.id, {
    work_type: 'feature', scope: 'architectural', confidence: 'high', reason: 'Needs decomposition.'
  });
  await complete(root, meta, 'context-discovery');
  await advanceActiveWork(root);
  await complete(root, meta, 'requirement-clarification');
  await advanceActiveWork(root);
  await complete(root, meta, 'design-exploration');
  await advanceActiveWork(root);
  await complete(root, meta, 'specification');
  await advanceActiveWork(root);
  await advanceActiveWork(root);
  await complete(root, meta, 'implementation-planning');
  return { root, meta };
}

async function complete(root, meta, skillId, evidence = []) {
  return checkpointWork(root, meta.id, { skillId, status: 'completed', summary: `${skillId} completed.`, evidence });
}

async function completeChild(root, workId) {
  await complete(root, { id: workId }, 'context-discovery');
  await complete(root, { id: workId }, 'requirement-clarification');
  for (let index = 0; index < 5; index++) await advanceActiveWork(root, workId); // INTAKE..PLAN -> IMPLEMENTATION
  await complete(root, { id: workId }, 'implementation');
  await advanceActiveWork(root, workId); // -> VERIFICATION
  await recordVerification(root, workId, { command: 'true', success: true, exitCode: 0 });
  await complete(root, { id: workId }, 'verification');
  await reviewKnowledgeNone(root, workId);
  const result = await advanceActiveWork(root, workId); // -> DONE
  assert.equal(result.to, 'DONE');
}

test('a valid dependency is accepted', async () => {
  const { root, meta } = await planReadyParent();
  const proposal = {
    children: [
      { key: 'a', title: 'A', type: 'feature', scope: 'bounded' },
      { key: 'b', title: 'B', type: 'feature', scope: 'bounded', dependsOn: ['a'] }
    ]
  };
  const { ledger } = await proposeDecomposition(root, meta.id, proposal);
  assert.deepEqual(ledger.children.find((child) => child.key === 'b').dependsOn, ['a']);
});

test('an unknown dependency is rejected', async () => {
  const { root, meta } = await planReadyParent();
  await assert.rejects(
    () => proposeDecomposition(root, meta.id, { children: [{ key: 'a', title: 'A', type: 'feature', scope: 'bounded', dependsOn: ['missing'] }] }),
    /depends on unknown key missing/
  );
});

test('a self-dependency is rejected', async () => {
  const { root, meta } = await planReadyParent();
  await assert.rejects(
    () => proposeDecomposition(root, meta.id, { children: [{ key: 'a', title: 'A', type: 'feature', scope: 'bounded', dependsOn: ['a'] }] }),
    /cannot depend on itself/
  );
});

test('a dependency cycle is rejected', async () => {
  const { root, meta } = await planReadyParent();
  await assert.rejects(
    () => proposeDecomposition(root, meta.id, {
      children: [
        { key: 'a', title: 'A', type: 'feature', scope: 'bounded', dependsOn: ['b'] },
        { key: 'b', title: 'B', type: 'feature', scope: 'bounded', dependsOn: ['a'] }
      ]
    }),
    /Dependency cycle detected/
  );
});

test('a child blocked by an incomplete dependency is not executable, and dependency completion unblocks it', async () => {
  const { root, meta } = await planReadyParent();
  const proposal = {
    children: [
      { key: 'foundation', title: 'Foundation', type: 'feature', scope: 'bounded' },
      { key: 'signing', title: 'Customer Signing', type: 'feature', scope: 'bounded', dependsOn: ['foundation'] }
    ]
  };
  await proposeDecomposition(root, meta.id, proposal);
  await validateDecomposition(root, meta.id);
  const { ledger } = await executeDecomposition(root, meta.id);
  const foundation = ledger.children.find((child) => child.key === 'foundation');
  const signing = ledger.children.find((child) => child.key === 'signing');

  const cliResult = spawnSync(process.execPath, [cli, 'progress', meta.id], { cwd: root, encoding: 'utf8' });
  assert.equal(cliResult.status, 0, cliResult.stderr);
  assert.match(cliResult.stdout, new RegExp(`⊘ ${signing.workId}.*blocked by ${foundation.workId}`));

  await completeChild(root, foundation.workId);

  const afterResult = spawnSync(process.execPath, [cli, 'progress', meta.id], { cwd: root, encoding: 'utf8' });
  assert.equal(afterResult.status, 0, afterResult.stderr);
  assert.match(afterResult.stdout, new RegExp(`○ ${signing.workId}`));
  assert.doesNotMatch(afterResult.stdout, new RegExp(`⊘ ${signing.workId}`));
});

test('multiple ready children are reported without YallaFlow choosing one', async () => {
  const { root, meta } = await planReadyParent();
  const proposal = {
    children: [
      { key: 'a', title: 'Feature A', type: 'feature', scope: 'bounded' },
      { key: 'b', title: 'Feature B', type: 'feature', scope: 'bounded' }
    ]
  };
  await proposeDecomposition(root, meta.id, proposal);
  await validateDecomposition(root, meta.id);
  await executeDecomposition(root, meta.id);

  const result = spawnSync(process.execPath, [cli, 'next', meta.id], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /2 ready child work item/);
});
