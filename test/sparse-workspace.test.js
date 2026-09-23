// v0.3.6 GAP-WORKSPACE-001/002: no artifact without a purpose, no directory until the
// first artifact exists. execution/ is reserved and no longer created.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { initWorkspace, workspacePath } from '../src/core/workspace.js';
import { createPendingIntake, createRoutedWork, routeWorkItem } from '../src/behavior/routing.js';
import { createLegacyWorkItem } from '../test-support/legacy-work.js';
import { startBaseline } from '../src/baseline/store.js';
import { exists } from '../src/utils/fs.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const OPTIONAL_DIRS = ['attachments', 'evidence', 'execution'];

function run(root, args) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, `${args.join(' ')}: ${result.stderr || result.stdout}`);
  return result;
}

async function freshRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-sparse-'));
  await initWorkspace(root, 'demo', 'greenfield');
  return root;
}

async function entries(root, workId) {
  return (await readdir(path.join(workspacePath(root), 'work', workId))).sort();
}

test('a new bounded task starts with only its lifecycle files', async () => {
  const root = await freshRoot();
  const start = run(root, ['start', 'Add CSV export']);
  const workId = /Created (PF-\d+)/.exec(start.stdout)[1];
  run(root, ['route', workId, '--type', 'feature', '--scope', 'bounded', '--confidence', 'high', '--reason', 'Small change.']);
  assert.deepEqual(await entries(root, workId), ['meta.yaml', 'progress.md', 'work.md']);
});

test('no empty evidence/, attachments/, or execution/ for any work-creation path', async () => {
  const root = await freshRoot();
  const direct = await createRoutedWork(root, 'Direct', { work_type: 'feature', scope: 'bounded', confidence: 'high', reason: 'Test fixture.', title: 'Direct' });
  const pending = await createPendingIntake(root, 'Pending');
  const baselineRoot = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-sparse-baseline-'));
  await initWorkspace(baselineRoot, 'demo', 'brownfield');
  const { meta: baseline } = await startBaseline(baselineRoot);
  for (const [workRoot, id] of [[root, direct.id], [root, pending.id], [baselineRoot, baseline.id]]) {
    for (const dir of OPTIONAL_DIRS) assert.equal(await exists(path.join(workspacePath(workRoot), 'work', id, dir)), false, `${id}/${dir}`);
  }
});

test('decomposed children are created sparse too', async () => {
  const root = await freshRoot();
  const start = run(root, ['start', 'Build billing']);
  const parentId = /Created (PF-\d+)/.exec(start.stdout)[1];
  run(root, ['route', parentId, '--type', 'feature', '--scope', 'architectural', '--confidence', 'high', '--reason', 'Large.']);
  for (const skill of ['context-discovery', 'requirement-clarification', 'design-exploration', 'specification', 'implementation-planning']) {
    run(root, ['checkpoint', parentId, '--skill', skill, '--complete', '--summary', 'done']);
  }
  await writeFile(path.join(root, 'd.json'), JSON.stringify({ children: [{ key: 'a', title: 'Child A', type: 'feature', scope: 'bounded' }] }));
  for (const approval of ['specification', 'plan']) spawnSync(process.execPath, [cli, 'approve', parentId, '--stage', approval], { cwd: root });
  for (let i = 0; i < 5; i++) spawnSync(process.execPath, [cli, 'advance', parentId], { cwd: root });
  run(root, ['decompose', 'propose', parentId, '--file', 'd.json']);
  run(root, ['decompose', 'validate', parentId]);
  spawnSync(process.execPath, [cli, 'approve', parentId, '--stage', 'decomposition'], { cwd: root });
  run(root, ['decompose', 'execute', parentId]);
  const childId = 'PF-0002';
  assert.equal(await exists(path.join(workspacePath(root), 'work', childId, 'meta.yaml')), true);
  for (const dir of OPTIONAL_DIRS) assert.equal(await exists(path.join(workspacePath(root), 'work', childId, dir)), false);
});

test('the first verification lazily creates evidence/ with the ledger and log', async () => {
  const root = await freshRoot();
  const meta = await createRoutedWork(root, 'Direct', { work_type: 'feature', scope: 'bounded', confidence: 'high', reason: 'Test fixture.', title: 'Direct' });
  const evidenceDir = path.join(workspacePath(root), 'work', meta.id, 'evidence');
  assert.equal(await exists(evidenceDir), false);
  run(root, ['verify', meta.id, '--', process.execPath, '-e', 'process.exit(0)']);
  assert.deepEqual((await readdir(evidenceDir)).sort(), ['V-001-verification.log', 'verification.json']);
});

test('the first checkpoint lazily creates progress.yaml; knowledge.yaml only on a knowledge command', async () => {
  const root = await freshRoot();
  const pending = await createPendingIntake(root, 'Fix typo');
  await routeWorkItem(root, pending.id, { work_type: 'feature', scope: 'bounded', confidence: 'high', reason: 'Tiny.' });
  run(root, ['checkpoint', pending.id, '--skill', 'context-discovery', '--complete', '--summary', 'ok']);
  const names = await entries(root, pending.id);
  assert.ok(names.includes('progress.yaml'));
  assert.ok(!names.includes('knowledge.yaml'));
});

test('file intake stores the original under workspace sources/ and creates no attachments/ directory', async () => {
  const root = await freshRoot();
  await writeFile(path.join(root, 'req.md'), '# Requirement\n\nExport invoices as CSV.\n');
  const result = run(root, ['intake', 'req.md']);
  const workId = /(PF-\d+)/.exec(result.stdout)[1];
  assert.equal(await exists(path.join(workspacePath(root), 'sources', 'SRC-0001', 'source.json')), true);
  assert.equal(await exists(path.join(workspacePath(root), 'work', workId, 'attachments')), false);
});

test('existing workspaces with eagerly created empty directories keep working and are never cleaned up', async () => {
  const root = await freshRoot();
  const meta = await createLegacyWorkItem(root, 'feature', 'Legacy layout', 'bounded'); // eager dirs, as pre-v0.3.6 wrote them
  run(root, ['verify', meta.id, '--', process.execPath, '-e', 'process.exit(0)']);
  for (const args of [['status'], ['resume', meta.id], ['handoff', meta.id], ['doctor'], ['guide', meta.id]]) run(root, args);
  for (const dir of OPTIONAL_DIRS) assert.equal(await exists(path.join(workspacePath(root), 'work', meta.id, dir)), true);
});
