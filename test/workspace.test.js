import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { initWorkspace, listWork } from '../src/core/workspace.js';
import { createRoutedWork } from '../src/behavior/routing.js';
import { createLegacyWorkItem } from '../test-support/legacy-work.js';
import { exists } from '../src/utils/fs.js';

test('initializes durable project structure', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-'));
  await initWorkspace(root, 'demo', 'greenfield');
  assert.equal(await exists(path.join(root, '.yallaflow/config.yaml')), true);
  assert.equal(await exists(path.join(root, '.yallaflow/state/current.yaml')), true);
  assert.equal(await exists(path.join(root, '.yallaflow/context/architecture.md')), true);
  assert.equal(await exists(path.join(root, '.yallaflow/context/business-rules.md')), true);
});

test('refuses to create a parallel workspace beside a legacy workspace', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-'));
  await mkdir(path.join(root, '.projectflow'));
  await assert.rejects(
    () => initWorkspace(root, 'demo', 'brownfield'),
    /Legacy \.projectflow workspace detected/
  );
  assert.equal(await exists(path.join(root, '.yallaflow')), false);
});

test('creates sequential work items and investigation is read-only', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-'));
  await initWorkspace(root, 'demo', 'brownfield');
  const one = await createRoutedWork(root, 'One', { work_type: 'feature', scope: 'bounded', confidence: 'high', reason: 'Test fixture.', title: 'One' });
  const two = await createRoutedWork(root, 'Two', { work_type: 'investigation', scope: 'spike', confidence: 'high', reason: 'Test fixture.', title: 'Two' });
  assert.equal(one.id, 'PF-0001');
  assert.equal(two.id, 'PF-0002');
  assert.equal(one.scope, 'bounded');
  assert.equal(two.readOnly, true);
  assert.deepEqual((await listWork(root)).map((item) => item.id), ['PF-0001', 'PF-0002']);
  const work = await readFile(path.join(root, '.yallaflow/work/PF-0002/work.md'), 'utf8');
  assert.match(work, /Read-only:\*\* yes/);
});

test('loads v0.1 work metadata without requiring migration', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-'));
  await initWorkspace(root, 'demo', 'brownfield');
  const item = await createLegacyWorkItem(root, 'bug', 'Legacy item', 'bounded');
  const metaFile = path.join(root, '.yallaflow/work', item.id, 'meta.yaml');
  const meta = JSON.parse(await readFile(metaFile, 'utf8'));
  delete meta.scope;
  meta.complexity = 'bounded';
  await writeFile(metaFile, `${JSON.stringify(meta, null, 2)}\n`);

  const [loaded] = await listWork(root);
  assert.equal(loaded.id, item.id);
  assert.equal(loaded.type, 'bug');
  assert.equal(loaded.complexity, 'bounded');
});
