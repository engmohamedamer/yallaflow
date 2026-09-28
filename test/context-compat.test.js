// v0.3.6/v0.3.7 compatibility with v0.3.5 workspaces: no migration on read,
// coexistence of legacy sections with the managed block, and — since v0.3.7 — legacy
// knowledge becomes canonical only through reviewed reconciliation (blind multi-item
// `context adopt` is refused; provably trivial adoption still works).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { workspacePath } from '../src/core/workspace.js';
import { createPendingIntake, routeWorkItem } from '../src/behavior/routing.js';
import { advanceActiveWork } from '../src/core/transitions.js';
import { knowledgeFilePath, proposeKnowledge } from '../src/knowledge/store.js';
import { promoteKnowledge } from '../src/knowledge/promotion.js';
import { contextLedgerPath, loadContextLedger } from '../src/context/ledger.js';
import { factFreshness } from '../src/context/freshness.js';
import { exists } from '../src/utils/fs.js';
import { cli, legacyWorkspace, reconcile, snapshotWorkspace } from '../test-support/legacy-context.js';

function run(root, args) {
  return cli(root, args);
}

async function snapshot(root) {
  const base = workspacePath(root);
  const files = ['PROJECT.md', 'context/database.md', 'context/tech-stack.md', 'context/architecture.md'];
  const work = [];
  for (const id of await readdir(path.join(base, 'work'))) {
    for (const name of await readdir(path.join(base, 'work', id))) {
      if (name.endsWith('.yaml') || name.endsWith('.md')) work.push(`work/${id}/${name}`);
    }
  }
  const all = [...files, ...work.sort()];
  return Object.fromEntries(await Promise.all(all.map(async (relative) => [relative, await readFile(path.join(base, relative), 'utf8')])));
}

test('a v0.3.5 workspace is fully readable and never migrated on read', async () => {
  const { root, baselineId, workId } = await legacyWorkspace();
  const before = await snapshot(root);
  for (const args of [['status'], ['resume', workId], ['handoff', workId], ['guide', workId], ['baseline', 'status', baselineId],
    ['baseline', 'show', baselineId], ['knowledge', 'list', workId], ['context', 'status'], ['context', 'list'], ['context', 'adopt', '--dry-run']]) {
    run(root, args);
  }
  const doctor = run(root, ['doctor']);
  assert.match(doctor.stdout, /Workspace healthy\./);
  assert.match(doctor.stdout, /WARN 3 v0\.3\.5 append-only context section\(s\) are not yet governed/);
  assert.equal(await exists(contextLedgerPath(root)), false);
  assert.deepEqual(await snapshot(root), before);
});

test('context status explains unadopted legacy context without creating anything', async () => {
  const { root } = await legacyWorkspace();
  const status = run(root, ['context', 'status']);
  assert.match(status.stdout, /No canonical project-context ledger yet/);
  assert.match(status.stdout, /3 v0\.3\.5 context section\(s\) are not yet governed by the ledger/);
  const dryRun = run(root, ['context', 'adopt', '--dry-run']);
  assert.match(dryRun.stdout, /Would adopt 3 legacy fact\(s\)/);
  assert.match(dryRun.stdout, /PF-0001 BF-001 \[database\] Read replica is configured but inactive\./);
  assert.match(dryRun.stdout, /PF-0002 K-001 \[architecture\]/);
});

test('a new promotion in an unadopted v0.3.5 workspace creates the ledger lazily and leaves legacy sections intact', async () => {
  const { root } = await legacyWorkspace();
  const legacyDatabase = await readFile(path.join(workspacePath(root), 'context', 'database.md'), 'utf8');
  const pending = await createPendingIntake(root, 'Second investigation');
  await routeWorkItem(root, pending.id, { work_type: 'investigation', scope: 'bounded', confidence: 'high', reason: 'Read-only.' });
  for (let i = 0; i < 6; i++) await advanceActiveWork(root, pending.id);
  const { candidate } = await proposeKnowledge(root, pending.id, { kind: 'database', source: 'implementation-runtime', summary: 'Nightly backups run at 02:00.', evidence: ['db.yml'] });
  await promoteKnowledge(root, pending.id, candidate.id);
  const database = await readFile(path.join(workspacePath(root), 'context', 'database.md'), 'utf8');
  assert.ok(database.startsWith(legacyDatabase));
  assert.match(database, /CTX-0001 — Nightly backups run at 02:00\./);
  const doctor = run(root, ['doctor']);
  assert.match(doctor.stdout, /Workspace healthy\./);
});

test('blind multi-item context adopt is refused with zero mutation and points to reconciliation', async () => {
  const { root } = await legacyWorkspace();
  const before = await snapshotWorkspace(root);
  const adopt = cli(root, ['context', 'adopt'], false);
  assert.equal(adopt.status, 1);
  assert.match(adopt.stderr, /Refusing to adopt legacy context: 3 legacy item\(s\) may describe overlapping truths/);
  assert.match(adopt.stderr, /yallaflow context reconcile start/);
  assert.match(adopt.stderr, /No files were changed\./);
  assert.deepEqual(await snapshotWorkspace(root), before);
  const dryRun = run(root, ['context', 'adopt', '--dry-run']);
  assert.match(dryRun.stdout, /Would adopt 3 legacy fact\(s\)/);
  assert.match(dryRun.stdout, /Direct adoption is not available: .*context reconcile start/);
  assert.deepEqual(await snapshotWorkspace(root), before);
});

test('provably trivial adoption (one legacy item, no current facts) still works as in v0.3.6', async () => {
  const { root, baselineId } = await legacyWorkspace({ baseline: [{ area: 'database', status: 'confirmed', summary: 'Read replica is configured but inactive.', evidence: ['db.yml'], source: 'repository' }], knowledge: [] });
  assert.match(run(root, ['context', 'adopt', '--dry-run']).stdout, /provably duplicate-free/);
  const adopt = run(root, ['context', 'adopt']);
  assert.match(adopt.stdout, /Adopted 1 legacy fact\(s\): CTX-0001/);
  assert.match(adopt.stdout, /Legacy Markdown sections replaced by the managed projection: 1/);
  const { ledger } = await loadContextLedger(root);
  assert.equal(ledger.schemaVersion, 1, 'trivial adoption needs no v2 feature, so the ledger stays v0.3.6-readable');
  assert.deepEqual(ledger.facts.map((fact) => [fact.id, fact.origin.workId, fact.origin.baselineFactId, fact.origin.adopted]), [['CTX-0001', baselineId, 'BF-001', true]]);
  assert.equal(ledger.facts[0].history[0].action, 'adopted');
  assert.match(run(root, ['doctor']).stdout, /Workspace healthy\./);
  assert.match(run(root, ['context', 'adopt']).stdout, /Nothing to adopt \(1 legacy item\(s\) already adopted\)/);
});

test('reconciliation imports legacy facts as distinct NEW facts, retires legacy sections, and never touches work records', async () => {
  const { root, baselineId, workId } = await legacyWorkspace();
  const base = workspacePath(root);
  const workFiles = ['baseline.yaml', 'meta.yaml', 'work.md'].map((name) => path.join(base, 'work', baselineId, name)).concat(knowledgeFilePath(root, workId));
  const workBefore = await Promise.all(workFiles.map((file) => readFile(file, 'utf8')));

  const reconciliationId = await reconcile(root, ['RC-0001', 'RC-0002', 'RC-0003'].map((candidate) => ({ candidate, action: 'new' })));

  const { ledger } = await loadContextLedger(root);
  assert.equal(ledger.schemaVersion, 2);
  assert.deepEqual(ledger.facts.map((fact) => [fact.id, fact.origins[0].workId, fact.origins[0].baselineFactId ?? fact.origins[0].candidateId, fact.origins[0].adopted, fact.origins[0].reconciliation.candidate]), [
    ['CTX-0001', baselineId, 'BF-001', true, 'RC-0001'],
    ['CTX-0002', baselineId, 'BF-002', true, 'RC-0002'],
    ['CTX-0003', workId, 'K-001', true, 'RC-0003']
  ]);
  assert.equal(ledger.facts[0].history[0].action, 'adopted');
  assert.equal(ledger.facts[0].verifiedAtCommit, null);
  assert.equal(ledger.facts[0].verifiedAt, '2026-09-01T10:00:00.000Z');
  assert.equal((await factFreshness(root, ledger.facts[0])).status, 'unknown');

  const database = await readFile(path.join(base, 'context', 'database.md'), 'utf8');
  assert.doesNotMatch(database, /yallaflow-baseline:/);
  assert.match(database, /CTX-0001 — Read replica is configured but inactive\./);
  assert.match(database, new RegExp(`Adopted from:\\*\\* v0\\.3\\.5 context \\(verification point unknown; reconciled in ${reconciliationId} RC-0001\\)`));
  const archive = await readFile(path.join(base, 'work', reconciliationId, 'legacy-context.md'), 'utf8');
  assert.match(archive, /<!-- yallaflow-baseline:PF-0001:BF-001 -->\n## BF-001 — Read replica is configured but inactive\./);

  assert.deepEqual(await Promise.all(workFiles.map((file) => readFile(file, 'utf8'))), workBefore);
  assert.match(run(root, ['doctor']).stdout, /Workspace healthy\./);
  assert.match(run(root, ['context', 'adopt']).stdout, /Nothing to adopt \(3 legacy item\(s\) already adopted\)/);
});

test('reconciliation leaves a hand-edited legacy section in place, reports it, and doctor asks for review', async () => {
  const { root } = await legacyWorkspace();
  const file = path.join(workspacePath(root), 'context', 'database.md');
  const content = await readFile(file, 'utf8');
  await writeFile(file, content.replace('- **Source:** repository', '- **Source:** repository (checked by hand)\nExtra human paragraph.'));
  const workId = await reconcile(root, ['RC-0001', 'RC-0002', 'RC-0003'].map((candidate) => ({ candidate, action: 'new' })));
  assert.match(await readFile(file, 'utf8'), /Extra human paragraph\./);
  assert.match(run(root, ['context', 'reconcile', 'status', workId]).stdout, /Hand-edited legacy sections kept for manual review: RC-0001 \(context\/database\.md\)/);
  const doctor = run(root, ['doctor']);
  assert.match(doctor.stdout, /Workspace healthy\./);
  assert.match(doctor.stdout, new RegExp(`WARN context/database\\.md: legacy section PF-0001 BF-001 was reconciled \\(${workId} RC-0001\\) but has been hand-edited`));
});

test('a reconciled legacy fact can then be superseded through normal work', async () => {
  const { root } = await legacyWorkspace();
  await reconcile(root, ['RC-0001', 'RC-0002', 'RC-0003'].map((candidate) => ({ candidate, action: 'new' })));
  await writeFile(path.join(root, 'db.yml'), 'replica: true\n');
  const pending = await createPendingIntake(root, 'Replica check');
  await routeWorkItem(root, pending.id, { work_type: 'investigation', scope: 'bounded', confidence: 'high', reason: 'Read-only.' });
  for (let i = 0; i < 6; i++) await advanceActiveWork(root, pending.id);
  const { candidate } = await proposeKnowledge(root, pending.id, { kind: 'database', source: 'implementation-runtime', summary: 'Read replica is active for reporting.', evidence: ['db.yml'], supersedes: 'CTX-0001' });
  await promoteKnowledge(root, pending.id, candidate.id);
  const database = await readFile(path.join(workspacePath(root), 'context', 'database.md'), 'utf8');
  assert.doesNotMatch(database, /configured but inactive/);
  assert.match(database, /Read replica is active for reporting\./);
  assert.match(run(root, ['doctor']).stdout, /Workspace healthy\./);
});

test('v0.3.5 knowledge candidates without v0.3.6 fields still validate and list', async () => {
  const { root, workId } = await legacyWorkspace();
  const list = run(root, ['knowledge', 'list', workId]);
  assert.match(list.stdout, /K-001 \[promoted\] architecture/);
});
