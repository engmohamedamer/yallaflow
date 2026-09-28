// v0.3.7 compatibility: a workspace written by the frozen v0.3.6 CLI (fixture) and
// v0.3.5 work history read and evolve unchanged — ledger, projection, sources,
// verification ledger, pinned Behavior Contracts, sparse layout, baseline rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { workspacePath } from '../src/core/workspace.js';
import { loadContextLedger, validateContextLedger } from '../src/context/ledger.js';
import { exists } from '../src/utils/fs.js';
import { cli, legacyWorkspace, reconcile, snapshotWorkspace } from '../test-support/legacy-context.js';

const FIXTURE = fileURLToPath(new URL('./fixtures/v0.3.6-workspace/', import.meta.url));

async function v036Workspace() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-v036-'));
  await cp(FIXTURE, root, { recursive: true });
  return root;
}

test('57. a v0.3.6 canonical ledger and its projection read unchanged; render reproduces it byte-for-byte', async () => {
  const root = await v036Workspace();
  const before = await snapshotWorkspace(root);
  const { ledger } = await loadContextLedger(root);
  assert.deepEqual(validateContextLedger(ledger), []);
  assert.ok(ledger.facts.every((fact) => fact.origins === undefined), 'v0.3.6 facts are single-origin');
  for (const args of [['status'], ['context', 'status'], ['context', 'list', '--all'], ['context', 'show', 'CTX-0003'], ['context', 'history', 'CTX-0003'],
    ['resume', 'PF-0002'], ['handoff', 'PF-0002'], ['guide', 'PF-0002'], ['upgrade', 'status'], ['upgrade', 'plan'], ['brief'], ['context', 'adopt', '--dry-run']]) cli(root, args);
  const doctor = cli(root, ['doctor']).stdout;
  assert.match(doctor, /Workspace healthy\./);
  assert.match(doctor, /WARN AGENT\.md agent contract: outdated \(v2 → v3\)/);
  assert.doesNotMatch(doctor, /FAIL/);
  cli(root, ['context', 'render']);
  assert.deepEqual(await snapshotWorkspace(root), before, 'reads and a re-render change nothing');
  assert.match(cli(root, ['context', 'history', 'CTX-0003']).stdout, /Lineage \(oldest → newest\): CTX-0001 \[superseded\] → CTX-0003 \[current\]/);
  assert.match(cli(root, ['context', 'reconcile', 'start'], false).stderr, /Nothing to reconcile/);
});

test('57. the v0.3.6 ledger keeps evolving through ordinary v0.3.7 work', async () => {
  const root = await v036Workspace();
  cli(root, ['agent', 'refresh']);
  cli(root, ['start', 'Check replica again']);
  cli(root, ['route', 'PF-0003', '--type', 'investigation', '--scope', 'bounded', '--confidence', 'high', '--reason', 'Read-only.']);
  for (let i = 0; i < 6; i++) cli(root, ['advance', 'PF-0003']);
  cli(root, ['knowledge', 'propose', 'PF-0003', '--kind', 'database', '--source', 'implementation-runtime', '--summary', 'Read replica is active for reporting.', '--evidence', 'db.yml', '--reconfirms', 'CTX-0003']);
  cli(root, ['knowledge', 'promote', 'PF-0003', '--candidate', 'K-001']);
  const { ledger } = await loadContextLedger(root);
  assert.deepEqual(ledger.facts.map((fact) => fact.id), ['CTX-0001', 'CTX-0002', 'CTX-0003']);
  assert.equal(ledger.facts[2].history.at(-1).action, 'reconfirmed');
  assert.match(cli(root, ['doctor']).stdout, /Workspace healthy\./);
});

test('59–60. durable sources and the verification ledger are unaffected', async () => {
  const root = await v036Workspace();
  const base = workspacePath(root);
  const pinned = ['sources/SRC-0001/request.txt', 'sources/SRC-0001/source.json', 'work/PF-0002/evidence/verification.json', 'work/PF-0002/evidence/V-001-verification.log'];
  const before = await Promise.all(pinned.map((file) => readFile(path.join(base, file), 'utf8')));
  assert.match(cli(root, ['source', 'show', 'SRC-0001', '--content']).stdout, /Calendar export requirement\./);
  assert.match(cli(root, ['verify', 'list', 'PF-0002']).stdout, /V-001 — PASSED \[argv\] \(exit 0\) — node --version/);
  cli(root, ['upgrade', 'status']);
  cli(root, ['brief']);
  assert.match(cli(root, ['brief']).stdout, /Sources: 1 \(latest SRC-0001\)/);
  assert.deepEqual(await Promise.all(pinned.map((file) => readFile(path.join(base, file), 'utf8'))), before);
});

test('61. pinned registry-v3 Behavior Contracts keep working; direct commands still require --scope', async () => {
  const root = await v036Workspace();
  const meta = JSON.parse(await readFile(path.join(workspacePath(root), 'work', 'PF-0002', 'meta.yaml'), 'utf8'));
  assert.equal(meta.behaviorContract.registryVersion, 3);
  assert.match(cli(root, ['guide', 'PF-0002']).stdout, /registry v3 \(pinned\)/);
  const refused = cli(root, ['feature', 'Export calendar'], false);
  assert.equal(refused.status, 1);
  cli(root, ['feature', 'Export calendar', '--scope', 'bounded']);
  const created = JSON.parse(await readFile(path.join(workspacePath(root), 'work', 'PF-0003', 'meta.yaml'), 'utf8'));
  assert.equal(created.behaviorContract.registryVersion, 4);
  assert.ok(!created.behaviorContract.skills.includes('context-reconciliation'));
});

test('62–63. reconciliation keeps the sparse workspace layout and leaves baseline rules intact', async () => {
  const { root, baselineId } = await legacyWorkspace();
  const rid = await reconcile(root, ['RC-0001', 'RC-0002', 'RC-0003'].map((candidate) => ({ candidate, action: 'new' })));
  const entries = (await readdir(path.join(workspacePath(root), 'work', rid))).sort();
  assert.deepEqual(entries, ['legacy-context.md', 'meta.yaml', 'progress.md', 'progress.yaml', 'reconciliation.yaml', 'reviews.yaml', 'work.md']);
  for (const optional of ['evidence', 'attachments', 'execution']) assert.equal(await exists(path.join(workspacePath(root), 'work', rid, optional)), false);
  const again = cli(root, ['baseline', 'start'], false);
  assert.equal(again.status, 1);
  assert.match(again.stderr, /An approved Brownfield Baseline already exists/);
  assert.match(cli(root, ['baseline', 'show', baselineId]).stdout, /BF-001 \[database\] confirmed \(repository\)/);
  const v036 = await v036Workspace();
  assert.match(cli(v036, ['baseline', 'start'], false).stderr, /An approved Brownfield Baseline already exists/);
});

test('58. v0.3.5 work history stays readable after its knowledge is reconciled', async () => {
  const { root, baselineId, workId } = await legacyWorkspace();
  await reconcile(root, ['RC-0001', 'RC-0002', 'RC-0003'].map((candidate) => ({ candidate, action: 'new' })));
  for (const args of [['resume', workId], ['handoff', workId], ['guide', workId], ['knowledge', 'list', workId], ['baseline', 'status', baselineId]]) cli(root, args);
  assert.match(cli(root, ['knowledge', 'list', workId]).stdout, /K-001 \[promoted\] architecture/);
});
