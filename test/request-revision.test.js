import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { canReviseRequest, createPendingIntake, reviseRequest, routeWorkItem } from '../src/behavior/routing.js';
import { initWorkspace, listWork, workspacePath } from '../src/core/workspace.js';
import { readYaml } from '../src/core/yaml.js';
import { checkpointWork, reviseCheckpoint } from '../src/core/progress.js';
import { run, workspaceHash } from '../test-support/optional.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));

async function freshRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-request-revision-'));
  await initWorkspace(root, 'demo', 'greenfield');
  return root;
}

test('completed work is never editable, even with an empty progress ledger', () => {
  assert.equal(canReviseRequest({ status: 'DONE', routingStatus: 'routed' }, { ledger: { skills: {}, history: [] } }), false);
});

test('a pending raw request can be revised through a supported operation', async () => {
  const root = await freshRoot();
  const intake = await createPendingIntake(root, '--help');
  const revised = await reviseRequest(root, intake.id, {
    text: 'Add refund summary to revenue dashboard',
    reason: 'Accidental --help intake.'
  });
  assert.equal(revised.rawRequest, 'Add refund summary to revenue dashboard');
});

test('revision requires a non-empty reason', async () => {
  const root = await freshRoot();
  const intake = await createPendingIntake(root, '--help');
  await assert.rejects(
    () => reviseRequest(root, intake.id, { text: 'Real request text', reason: '' }),
    /non-empty --reason/
  );
});

test('revision requires non-empty replacement text', async () => {
  const root = await freshRoot();
  const intake = await createPendingIntake(root, '--help');
  await assert.rejects(
    () => reviseRequest(root, intake.id, { text: '', reason: 'Accidental intake.' }),
    /non-empty replacement request/
  );
});

test('revision history is preserved and auditable', async () => {
  const root = await freshRoot();
  const intake = await createPendingIntake(root, '--help');
  await reviseRequest(root, intake.id, { text: 'First correction', reason: 'Accidental --help intake.' });
  await reviseRequest(root, intake.id, { text: 'Second correction', reason: 'Still not quite right.' });
  const meta = await readYaml(path.join(workspacePath(root), 'work', intake.id, 'meta.yaml'));
  assert.equal(meta.rawRequest, 'Second correction');
  assert.equal(meta.requestHistory.length, 2);
  assert.equal(meta.requestHistory[0].previousRequest, '--help');
  assert.equal(meta.requestHistory[1].previousRequest, 'First correction');
  const work = await readFile(path.join(workspacePath(root), 'work', intake.id, 'work.md'), 'utf8');
  assert.match(work, /## Request Revised/);
  assert.match(work, /Second correction/);
});

test('classified INTAKE can be revised without changing its title, classification or focus', async () => {
  const root = await freshRoot();
  const intake = await createPendingIntake(root, 'Add refund summary to revenue dashboard');
  const meta = await routeWorkItem(root, intake.id, {
    work_type: 'feature', scope: 'bounded', confidence: 'high', reason: 'Clear scope.'
  });
  const stateFile = path.join(workspacePath(root), 'state', 'current.yaml');
  const before = await readFile(stateFile, 'utf8');
  const revised = await reviseRequest(root, meta.id, { text: 'Different text', reason: 'Clarify before starting.' });
  assert.equal(revised.rawRequest, 'Different text');
  for (const key of ['title', 'type', 'scope', 'status', 'routingStatus', 'routedAt']) assert.equal(revised[key], meta[key]);
  assert.equal(revised.requestHistory[0].previousRequest, meta.rawRequest);
  assert.equal(await readFile(stateFile, 'utf8'), before);
});

test('started checkpoints, including reset checkpoints, prevent revision while still in INTAKE', async () => {
  const root = await freshRoot();
  const intake = await createPendingIntake(root, 'Original');
  const meta = await routeWorkItem(root, intake.id, { work_type: 'feature', scope: 'bounded', confidence: 'high', reason: 'Clear scope.' });
  await checkpointWork(root, meta.id, { skillId: 'context-discovery', status: 'in_progress' });
  for (const reset of [false, true]) {
    if (reset) await reviseCheckpoint(root, meta.id, { skillId: 'context-discovery', status: 'pending', reason: 'Restart discovery.' });
    const before = await workspaceHash(root);
    await assert.rejects(() => reviseRequest(root, meta.id, { text: 'Changed', reason: 'Too late.' }), /already started/);
    assert.equal(await workspaceHash(root), before);
  }
});

test('leaving INTAKE prevents revision even before any checkpoint is recorded', async () => {
  const root = await freshRoot();
  const intake = await createPendingIntake(root, 'Original');
  await routeWorkItem(root, intake.id, { work_type: 'feature', scope: 'bounded', confidence: 'high', reason: 'Clear scope.' });
  run(root, ['advance', intake.id]);
  const before = await workspaceHash(root);
  const result = run(root, ['request', 'revise', intake.id, '--text', 'Changed', '--reason', 'Too late.'], { ok: false });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /already started/);
  assert.equal(await workspaceHash(root), before);
});

test('held and closed pending requests reject direct Core revisions without writes', async () => {
  const root = await freshRoot();
  const intake = await createPendingIntake(root, 'Original');
  for (const action of ['hold', 'close']) {
    run(root, ['work', action, intake.id, '--reason', 'Waiting.', '--accept-minimum-version', '1.4.0', ...(action === 'close' ? ['--outcome', 'cancelled'] : [])]);
    const before = await workspaceHash(root);
    await assert.rejects(() => reviseRequest(root, intake.id, { text: 'Changed', reason: 'Too late.' }), /not allowed/);
    assert.equal(await workspaceHash(root), before);
  }
});

test('a file-backed source remains byte-identical after a request correction', async () => {
  const root = await freshRoot();
  const filePath = path.join(root, 'requirements.txt');
  await (await import('node:fs/promises')).writeFile(filePath, 'Original requirements text.\n', 'utf8');
  const intakeResult = spawnSync(process.execPath, [cli, 'intake', filePath], { cwd: root, encoding: 'utf8' });
  assert.equal(intakeResult.status, 0, intakeResult.stderr);

  const [item] = await listWork(root);
  const sourceFile = path.join(workspacePath(root), 'sources', item.sources[0].id, item.sources[0].name);
  const before = await readFile(sourceFile, 'utf8');

  await reviseRequest(root, item.id, { text: 'Corrected title/summary', reason: 'Title was wrong.' });
  await routeWorkItem(root, item.id, { work_type: 'feature', scope: 'bounded', confidence: 'high', reason: 'Clear scope.' });
  await reviseRequest(root, item.id, { text: 'Clarified after classification', reason: 'Not started yet.' });

  const after = await readFile(sourceFile, 'utf8');
  assert.equal(after, before);
});

test('CLI: request revise corrects an accidental --help intake end to end', async () => {
  const root = await freshRoot();
  const help = spawnSync(process.execPath, [cli, 'start', '--help'], { cwd: root, encoding: 'utf8' });
  assert.equal(help.status, 0, help.stderr);

  const start = spawnSync(process.execPath, [cli, 'start', 'Accidental request'], { cwd: root, encoding: 'utf8' });
  assert.equal(start.status, 0, start.stderr);
  const workId = /^Created (PF-\d+)/.exec(start.stdout)[1];

  const revise = spawnSync(process.execPath, [
    cli, 'request', 'revise', workId, '--text', 'Add refund summary to revenue dashboard', '--reason', 'Original request was a typo.'
  ], { cwd: root, encoding: 'utf8' });
  assert.equal(revise.status, 0, revise.stderr);
  assert.match(revise.stdout, /request revised/);

  const route = spawnSync(process.execPath, [
    cli, 'route', workId, '--type', 'feature', '--scope', 'bounded', '--confidence', 'high', '--reason', 'Clear bounded scope.'
  ], { cwd: root, encoding: 'utf8' });
  assert.equal(route.status, 0, route.stderr);

  const meta = await readYaml(path.join(workspacePath(root), 'work', workId, 'meta.yaml'));
  assert.equal(meta.rawRequest, 'Add refund summary to revenue dashboard');
  assert.equal(meta.requestHistory.length, 1);
});
