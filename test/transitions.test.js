import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { initWorkspace, createWorkItem } from '../src/core/workspace.js';
import { advanceActiveWork } from '../src/core/transitions.js';
import { recordVerification } from '../src/core/evidence.js';
import { reviewKnowledgeNone } from '../src/knowledge/store.js';

test('bug follows deterministic workflow and DONE requires verification', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-transition-'));
  const item = await (async () => {
    await initWorkspace(root, 'demo', 'brownfield');
    return createWorkItem(root, 'bug', 'broken login', 'bounded');
  })();
  const expected = ['REPRODUCE', 'EVIDENCE', 'TRACE', 'HYPOTHESIS', 'ROOT_CAUSE', 'FIX_PLAN', 'IMPLEMENTATION', 'VERIFICATION'];
  for (const to of expected) assert.equal((await advanceActiveWork(root)).to, to);
  await assert.rejects(() => advanceActiveWork(root), /Cannot transition to DONE/);
  await recordVerification(root, item.id, { success: true, command: 'node --test', exitCode: 0 });
  await reviewKnowledgeNone(root, item.id);
  assert.equal((await advanceActiveWork(root)).to, 'DONE');
});

test('investigation has no implementation stage', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-transition-'));
  await initWorkspace(root, 'demo', 'brownfield');
  await createWorkItem(root, 'investigation', 'latency', 'spike');
  const stages = [];
  for (let i = 0; i < 6; i++) stages.push((await advanceActiveWork(root)).to);
  await reviewKnowledgeNone(root, 'PF-0001');
  stages.push((await advanceActiveWork(root)).to);
  assert.deepEqual(stages, ['QUESTION', 'DISCOVERY', 'EVIDENCE', 'HYPOTHESIS', 'FINDINGS', 'CONCLUSION', 'DONE']);
  assert.equal(stages.includes('IMPLEMENTATION'), false);
});
