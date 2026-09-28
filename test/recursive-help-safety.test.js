// v0.3.5 pre-freeze hardening: "any CLI help request must mutate zero YallaFlow
// state" checked recursively — including nested sub-actions, not only top-level
// `<command> --help`. A single `rest.some(isHelpToken)` scan in cli.js (not scattered
// per-branch exceptions) is what this test locks in.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { createPendingIntake, routeWorkItem } from '../src/behavior/routing.js';
import { checkpointWork } from '../src/core/progress.js';
import { proposeDecomposition, validateDecomposition } from '../src/decomposition/store.js';
import { draftBaseline, startBaseline } from '../src/baseline/store.js';
import { setGateStatus } from '../src/reviews/store.js';
import { initWorkspace, workspacePath } from '../src/core/workspace.js';
import { recordIntent } from '../test-support/delivery.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));

// A full recursive content hash of .yallaflow — stronger than comparing a few known
// files: any new/removed/changed file anywhere under the workspace fails this.
async function workspaceHash(root) {
  const base = workspacePath(root);
  const entries = [];
  async function walk(dir) {
    const items = await readdir(dir, { withFileTypes: true });
    for (const item of items.sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, item.name);
      if (item.isDirectory()) await walk(full);
      else entries.push([path.relative(base, full), await readFile(full)]);
    }
  }
  await walk(base);
  const hash = createHash('sha256');
  for (const [relative, content] of entries.sort(([a], [b]) => a.localeCompare(b))) {
    hash.update(relative);
    hash.update(content);
  }
  return hash.digest('hex');
}

async function richWorkspace() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-recursive-help-'));
  await initWorkspace(root, 'demo', 'greenfield');

  // An architectural parent, far enough along to have a decomposition draft and an
  // approved review gate — so "modify no review/baseline/request ledger" is a real
  // assertion, not a vacuous one.
  const intake = await createPendingIntake(root, 'Architectural feature for help-safety fixture');
  const parent = await routeWorkItem(root, intake.id, {
    work_type: 'feature', scope: 'architectural', confidence: 'high', reason: 'Fixture.'
  });
  await checkpointWork(root, parent.id, { skillId: 'context-discovery', status: 'completed', summary: 'x', evidence: [] });
  await checkpointWork(root, parent.id, { skillId: 'requirement-clarification', status: 'completed', summary: 'x', evidence: [] });
  await checkpointWork(root, parent.id, { skillId: 'design-exploration', status: 'completed', summary: 'x', evidence: [] });
  await recordIntent(root, parent.id);
  await checkpointWork(root, parent.id, { skillId: 'specification', status: 'completed', summary: 'x', evidence: [] });
  await checkpointWork(root, parent.id, { skillId: 'implementation-planning', status: 'completed', summary: 'x', evidence: [] });
  await setGateStatus(root, parent.id, 'specification', 'approved', 'Reviewed.');
  await setGateStatus(root, parent.id, 'plan', 'approved', 'Reviewed.');
  await proposeDecomposition(root, parent.id, {
    children: [{ key: 'a', title: 'Child A', type: 'feature', scope: 'bounded' }]
  });
  await validateDecomposition(root, parent.id);

  // A pending, unrouted intake — so `request revise --help` has real state to leave alone.
  const pending = await createPendingIntake(root, 'Pending request for help-safety fixture');

  // A baseline in progress — so `baseline * --help` has a real draft to leave alone.
  const { meta: baselineWork } = await startBaseline(root);
  await checkpointWork(root, baselineWork.id, { skillId: 'repository-baseline', status: 'completed', summary: 'x', evidence: [] });
  await draftBaseline(root, baselineWork.id, {
    facts: [{ area: 'tech-stack', status: 'confirmed', summary: 'Node.js.', evidence: ['package.json'], source: 'repository' }]
  });

  return { root, parent, pending };
}

const HELP_INVOCATIONS = [
  ['start', '--help'],
  ['start', '-h'],
  ['baseline', '--help'],
  ['baseline', 'start', '--help'],
  ['baseline', 'draft', '--help'],
  ['baseline', 'approve', '--help'],
  ['request', '--help'],
  ['request', 'revise', '--help'],
  ['verify', '--help'],
  ['verify', 'list', '--help'],
  ['decompose', '--help'],
  ['decompose', 'propose', '--help'],
  ['checkpoint', '--help'],
  ['knowledge', '--help'],
  ['question', '--help'],
  // v0.3.8 delivery namespaces and agent bootstrap
  ['requirement', '--help'],
  ['requirement', 'record', 'PF-0001', '--file', 'requirements.json', '--help'],
  ['convergence', 'record', 'PF-0001', '--file', 'convergence.json', '-h'],
  ['impact', 'assess', 'PF-0001', '--file', 'impact.json', '--help'],
  ['agent', 'setup', 'claude', '--help']
];

for (const args of HELP_INVOCATIONS) {
  test(`\`yallaflow ${args.join(' ')}\` exits successfully, shows usage, and mutates nothing`, async () => {
    const { root } = await richWorkspace();
    const before = await workspaceHash(root);

    const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, `expected success, got stderr:\n${result.stderr}`);
    assert.match(result.stdout, /Usage:/i);

    const after = await workspaceHash(root);
    assert.equal(after, before, `\`yallaflow ${args.join(' ')}\` changed workspace content`);
  });
}

test('a work-id positioned before --help is also non-mutating (not just rest[0])', async () => {
  const { root, parent } = await richWorkspace();
  const before = await workspaceHash(root);
  const result = spawnSync(process.execPath, [cli, 'baseline', 'draft', parent.id, '--help'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage:/i);
  const after = await workspaceHash(root);
  assert.equal(after, before);
});

test('request revise --help with a work-id argument still mutates nothing', async () => {
  const { root, pending } = await richWorkspace();
  const before = await workspaceHash(root);
  const result = spawnSync(process.execPath, [
    cli, 'request', 'revise', pending.id, '--text', 'should not be applied', '--reason', 'should not be applied', '--help'
  ], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage:/i);
  const after = await workspaceHash(root);
  assert.equal(after, before);
});

test('a bare `verify --help` (before any -- separator) shows help and creates no evidence', async () => {
  const { root, parent } = await richWorkspace();
  const before = await workspaceHash(root);
  const result = spawnSync(process.execPath, [cli, 'verify', parent.id, '--help'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage:/i);
  const after = await workspaceHash(root);
  assert.equal(after, before);
});

// This is deliberately the OPPOSITE of the case above: `--help` appearing after the
// documented `--` payload separator belongs to the verified command, not to
// YallaFlow, and must run for real (see test/help-payload-boundary.test.js for the
// full set of payload-boundary regressions this guards).
test('`--help` after the -- separator is payload for the verified command, not a YallaFlow help request', async () => {
  const { root, parent } = await richWorkspace();
  const result = spawnSync(process.execPath, [cli, 'verify', parent.id, '--', 'true', '--help'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Verification PASSED/);
  assert.doesNotMatch(result.stdout, /Usage:\n\s*yallaflow verify/);
});

test('an unrelated flag value that happens to contain "--help" text is not itself a false trigger for a real run', async () => {
  // Sanity check on the opposite direction: a normal command with no bare --help/-h
  // token must still run normally (the scan matches whole tokens, not substrings).
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-recursive-help-normal-'));
  await writeFile(path.join(root, '.marker'), '', 'utf8');
  const init = spawnSync(process.execPath, [cli, 'init'], { cwd: root, encoding: 'utf8' });
  assert.equal(init.status, 0, init.stderr);
  const result = spawnSync(process.execPath, [cli, 'start', 'please --helpme with this feature'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^Created PF-0001/);
});
