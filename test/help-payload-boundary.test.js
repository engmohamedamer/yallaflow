// v0.3.5 pre-freeze hardening, Freeze Blocker 2: `--help`/`-h` must trigger YallaFlow
// help only when it belongs to YallaFlow's own command/subcommand parsing — never
// when it is payload passed to another command (after a documented `--` separator)
// or legitimate request/option text. Exercises the exact seven scenarios from the
// blocker report.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { createPendingIntake, routeWorkItem } from '../src/behavior/routing.js';
import { listVerificationRuns } from '../src/core/evidence.js';
import { getCurrentState, initWorkspace, listWork, workspacePath } from '../src/core/workspace.js';
import { readYaml } from '../src/core/yaml.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));

async function freshRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-help-boundary-'));
  await initWorkspace(root, 'demo', 'greenfield');
  return root;
}

async function stateSnapshot(root) {
  const [state, work] = await Promise.all([getCurrentState(root), listWork(root)]);
  return JSON.stringify({ state, workIds: work.map((item) => item.id) });
}

// 1. yallaflow start --help -> YallaFlow help, zero mutation
test('1. `start --help` shows YallaFlow help and mutates nothing', async () => {
  const root = await freshRoot();
  const before = await stateSnapshot(root);
  const result = spawnSync(process.execPath, [cli, 'start', '--help'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage:\n\s*yallaflow start \[request\]/);
  assert.equal(await stateSnapshot(root), before);
});

// 2. yallaflow baseline start --help -> baseline-start help, zero mutation
test('2. `baseline start --help` shows the baseline-start usage line and mutates nothing', async () => {
  const root = await freshRoot();
  const before = await stateSnapshot(root);
  const result = spawnSync(process.execPath, [cli, 'baseline', 'start', '--help'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage:\n\s*yallaflow baseline start\s*$/m);
  assert.equal(await stateSnapshot(root), before);
});

// 3. yallaflow request revise --help -> request-revise help, zero mutation
test('3. `request revise --help` shows the request-revise usage line and mutates nothing', async () => {
  const root = await freshRoot();
  const before = await stateSnapshot(root);
  const result = spawnSync(process.execPath, [cli, 'request', 'revise', '--help'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage:\n\s*yallaflow request revise <work-id> --text TEXT --reason TEXT/);
  assert.equal(await stateSnapshot(root), before);
});

// 4. yallaflow verify PF-0001 -- node --help -> executes `node --help` as verification
test('4. `verify <id> -- node --help` runs node --help as verification, not YallaFlow help', async () => {
  const root = await freshRoot();
  const intake = await createPendingIntake(root, 'help-boundary fixture');
  const meta = await routeWorkItem(root, intake.id, { work_type: 'bug', scope: 'bounded', confidence: 'high', reason: 'r' });

  const result = spawnSync(process.execPath, [cli, 'verify', meta.id, '--', 'node', '--help'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  // node's own --help output, not YallaFlow's usage banner.
  assert.match(result.stdout, /Usage: node \[options\]/);
  assert.doesNotMatch(result.stdout, /yallaflow verify \[work-id\]/);
  assert.match(result.stdout, /Verification PASSED.*\[argv\]/);

  const runs = await listVerificationRuns(root, meta.id);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].executable, 'node');
  assert.deepEqual(runs[0].args, ['--help']);
  assert.equal(runs[0].success, true);
});

// 5. yallaflow verify PF-0001 -- npm test -- --help -> everything after -- is child argv
test('5. `verify <id> -- npm test -- --help` treats everything after the separator as child argv', async () => {
  const root = await freshRoot();
  const intake = await createPendingIntake(root, 'help-boundary fixture 2');
  const meta = await routeWorkItem(root, intake.id, { work_type: 'bug', scope: 'bounded', confidence: 'high', reason: 'r' });

  // Use `node` as a stand-in executable that just echoes its own argv, so the test is
  // deterministic without depending on a real npm project/test runner being present.
  const result = spawnSync(process.execPath, [
    cli, 'verify', meta.id, '--', 'node', '-e', 'console.log(JSON.stringify(process.argv.slice(1)))', '--', '--help'
  ], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /yallaflow verify \[work-id\]/);

  const runs = await listVerificationRuns(root, meta.id);
  assert.equal(runs.length, 1);
  // YallaFlow forwarded everything after its own `--` to the child verbatim, `--help`
  // included — proof it was never consumed as a YallaFlow help request. (Node's own
  // CLI then strips the literal `--` from what it exposes via process.argv, which is
  // Node's behavior, not YallaFlow's — the recorded run below is the authoritative
  // check of what YallaFlow actually passed.)
  assert.deepEqual(runs[0].args, ['-e', 'console.log(JSON.stringify(process.argv.slice(1)))', '--', '--help']);
  assert.match(result.stdout, /\["--help"\]/);
});

// 6. yallaflow start "Fix --help handling in our CLI" -> creates the intake, not help
test('6. `start` with request text containing "--help" creates the intake normally', async () => {
  const root = await freshRoot();
  const before = await stateSnapshot(root);
  const result = spawnSync(process.execPath, [cli, 'start', 'Fix --help handling in our CLI'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^Created PF-0001/);
  assert.notEqual(await stateSnapshot(root), before);
  const meta = await readYaml(path.join(workspacePath(root), 'work', 'PF-0001', 'meta.yaml'));
  assert.equal(meta.rawRequest, 'Fix --help handling in our CLI');
});

// 7. yallaflow request revise PF-0001 --text "Document --help behavior" --reason "Clarification"
test('7. `request revise` with option text containing "--help" revises normally, not treated as help', async () => {
  const root = await freshRoot();
  const intake = await createPendingIntake(root, 'original text');
  const result = spawnSync(process.execPath, [
    cli, 'request', 'revise', intake.id, '--text', 'Document --help behavior', '--reason', 'Clarification'
  ], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /request revised/);
  const meta = await readYaml(path.join(workspacePath(root), 'work', intake.id, 'meta.yaml'));
  assert.equal(meta.rawRequest, 'Document --help behavior');
  assert.equal(meta.requestHistory.length, 1);
});

// Additional coverage explicitly requested: nested help remains zero-mutation even
// when combined with an otherwise-valid work-id/payload.
test('nested YallaFlow help remains zero-mutation when a work-id is also present', async () => {
  const root = await freshRoot();
  const intake = await createPendingIntake(root, 'nested help fixture');
  const meta = await routeWorkItem(root, intake.id, { work_type: 'feature', scope: 'bounded', confidence: 'high', reason: 'r' });
  const before = await stateSnapshot(root);

  const result = spawnSync(process.execPath, [cli, 'baseline', 'draft', meta.id, '--help'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage:\n\s*yallaflow baseline draft <work-id>/);
  assert.equal(await stateSnapshot(root), before);
});

test('`--help` positioned before the -- separator still triggers YallaFlow help (it is unambiguously YallaFlow-scoped)', async () => {
  const root = await freshRoot();
  const intake = await createPendingIntake(root, 'help-before-separator fixture');
  const meta = await routeWorkItem(root, intake.id, { work_type: 'bug', scope: 'bounded', confidence: 'high', reason: 'r' });
  const before = await stateSnapshot(root);

  const result = spawnSync(process.execPath, [cli, 'verify', meta.id, '--help', '--', 'true'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage:/);
  assert.equal(await stateSnapshot(root), before);
  const runs = await listVerificationRuns(root, meta.id);
  assert.equal(runs.length, 0); // no verification was recorded — help won, correctly, before the separator
});
