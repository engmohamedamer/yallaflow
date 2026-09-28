// v0.3.7 legacy knowledge reconciliation: legacy facts → RC candidates → explicit
// Agent relationships → hash-bound human review → deterministic, atomic apply.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { workspacePath } from '../src/core/workspace.js';
import { readYaml, writeYaml } from '../src/core/yaml.js';
import { checkpointWork } from '../src/core/progress.js';
import { knowledgeFilePath } from '../src/knowledge/store.js';
import { contextLedgerPath, loadContextLedger, validateContextLedger } from '../src/context/ledger.js';
import { factFreshness } from '../src/context/freshness.js';
import {
  applyReconciliation,
  approveReconciliation,
  feedbackReconciliation,
  loadReconciliation,
  previewReconciliation,
  reconciliationFilePath,
  recordDecisions,
  startReconciliation
} from '../src/reconciliation/store.js';
import { planHash, resolvePlan } from '../src/reconciliation/plan.js';
import { cli, legacyWorkspace, snapshotWorkspace, writeDecisions, yaschoolsWorkspace } from '../test-support/legacy-context.js';

const d = (candidate, action, extra = {}) => ({ candidate, action, ...extra });

async function started(options) {
  const workspace = await yaschoolsWorkspace(options);
  const { meta } = await startReconciliation(workspace.root);
  await checkpointWork(workspace.root, meta.id, { skillId: 'context-reconciliation', status: 'completed', summary: 'Reasoned.', evidence: [] });
  return { ...workspace, rid: meta.id };
}

async function decideApproveApply(root, rid, decisions) {
  await recordDecisions(root, rid, { decisions });
  await approveReconciliation(root, rid, 'Reviewed.');
  return applyReconciliation(root, rid);
}

const ledgerOf = async (root) => (await loadContextLedger(root)).ledger;
const factByOrigin = (ledger, workId, id) => ledger.facts.find((fact) => (fact.origins ?? [fact.origin]).some((origin) => origin.workId === workId && (origin.baselineFactId ?? origin.candidateId) === id));

// ---------------------------------------------------------------------------
// Reconciliation discovery

test('1–4. start detects every legacy item as a candidate and preserves its full origin', async () => {
  const { root, rid, baselineId, workId } = await started();
  const { plan } = await loadReconciliation(root, rid);
  assert.deepEqual(plan.candidates.map((candidate) => [candidate.id, candidate.origin.workId, candidate.origin.baselineFactId ?? candidate.origin.candidateId, candidate.area]), [
    ['RC-0001', baselineId, 'BF-001', 'convention'],
    ['RC-0002', baselineId, 'BF-002', 'environment'],
    ['RC-0003', baselineId, 'BF-003', 'tech-stack'],
    ['RC-0004', baselineId, 'BF-004', 'architecture'],
    ['RC-0005', workId, 'K-001', 'environment'],
    ['RC-0006', workId, 'K-002', 'convention'],
    ['RC-0007', workId, 'K-003', 'database'],
    ['RC-0008', workId, 'K-004', 'database'],
    ['RC-0009', workId, 'K-005', 'business-rule'],
    ['RC-0010', workId, 'K-006', 'business-rule']
  ]);
  const bf = plan.candidates[0];
  assert.equal(bf.kind, 'baseline');
  assert.equal(bf.summary, 'Root Codeception configuration enables only tests/api and tests/apps; other suites are commented out.');
  assert.equal(bf.confidence, 'confirmed');
  assert.equal(bf.provenance, 'repository');
  assert.deepEqual(bf.evidence, ['codeception.yml']);
  assert.equal(bf.recordedAt, '2026-09-01T10:00:00.000Z');
  assert.equal(bf.workTitle, 'Repository Baseline');
  assert.deepEqual(bf.legacySection, { file: 'context/conventions.md', marker: `<!-- yallaflow-baseline:${baselineId}:BF-001 -->` });
  assert.equal(plan.candidates[2].confidence, 'unresolved');
  const k = plan.candidates[5];
  assert.equal(k.kind, 'knowledge');
  assert.deepEqual(k.legacySection, { file: 'context/conventions.md', marker: `<!-- yallaflow-knowledge:${workId}:K-002 -->` });
  assert.equal(k.recordedAt, '2026-09-01T10:00:00.000Z');
  assert.equal(plan.status, 'open');
  const meta = await readYaml(path.join(workspacePath(root), 'work', rid, 'meta.yaml'));
  assert.equal(meta.reconciliation, true);
  assert.equal(meta.readOnly, true);
  assert.deepEqual(meta.behaviorContract.skills, ['context-reconciliation']);
});

test('2. RC IDs are stable: identical workspaces produce identical candidates, and start is idempotent', async () => {
  const a = await started();
  const b = await started();
  const strip = (plan) => plan.candidates.map(({ id, origin, area, summary }) => ({ id, origin, area, summary }));
  assert.deepEqual(strip((await loadReconciliation(a.root, a.rid)).plan), strip((await loadReconciliation(b.root, b.rid)).plan));
  const before = await snapshotWorkspace(a.root);
  const again = cli(a.root, ['context', 'reconcile', 'start']);
  assert.match(again.stdout, new RegExp(`${a.rid} — existing legacy-context reconciliation \\(in progress\\)`));
  assert.deepEqual(await snapshotWorkspace(a.root), before);
});

test('5–6. an existing v0.3.6 ledger is supported; start and preview never touch memory, legacy docs, or history', async () => {
  const { root } = await yaschoolsWorkspace();
  const before = await snapshotWorkspace(root);
  assert.equal((await ledgerOf(root)).facts.length, 1);
  const { meta, plan } = await startReconciliation(root);
  assert.equal(plan.candidates.length, 10, 'the native CTX-0001 is not a legacy candidate');
  assert.equal(plan.history[0].existingFacts, 1);
  const after = await snapshotWorkspace(root);
  for (const [file, content] of Object.entries(before)) {
    if (file === 'state/current.yaml') continue;
    assert.equal(after[file], content, `${file} unchanged by start`);
  }
  assert.deepEqual(Object.keys(after).filter((file) => !(file in before)).sort(), [`work/${meta.id}/meta.yaml`, `work/${meta.id}/progress.md`, `work/${meta.id}/reconciliation.yaml`, `work/${meta.id}/work.md`].sort());
  await recordDecisions(root, meta.id, { decisions: [d('RC-0004', 'new')] });
  const planned = await snapshotWorkspace(root);
  cli(root, ['context', 'reconcile', 'preview', meta.id]);
  cli(root, ['context', 'reconcile', 'status', meta.id]);
  cli(root, ['context', 'reconcile', 'show', meta.id]);
  assert.deepEqual(await snapshotWorkspace(root), planned);
});

test('start is refused, with no mutation, when nothing legacy is pending', async () => {
  const { root } = await legacyWorkspace({ baseline: [], knowledge: [] });
  const before = await snapshotWorkspace(root);
  const result = cli(root, ['context', 'reconcile', 'start'], false);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Nothing to reconcile/);
  assert.deepEqual(await snapshotWorkspace(root), before);
});

test('17 (exact duplicates). identical area + normalized text + evidence is flagged, never discarded', async () => {
  const same = { kind: 'environment', summary: 'Staging deploys from the release branch.', evidence: ['db.yml'] };
  const { root } = await legacyWorkspace({ baseline: [], knowledge: [[same], [{ ...same, summary: '  staging deploys from the RELEASE branch ' }], [{ ...same, summary: 'Staging deploys from the release branch, nightly.' }]] });
  const { plan } = await startReconciliation(root);
  assert.equal(plan.candidates.length, 3);
  assert.equal(plan.candidates[0].exactDuplicateOf, undefined);
  assert.equal(plan.candidates[1].exactDuplicateOf, 'RC-0001');
  assert.equal(plan.candidates[2].exactDuplicateOf, undefined, 'different wording is never matched');
  assert.equal(plan.candidates[1].decision, undefined, 'still requires an explicit decision');
});

// ---------------------------------------------------------------------------
// Actions

test('7 + 11 + 14. NEW creates one fact; MERGE_WITH yields one semantic fact carrying both origins', async () => {
  const { root, rid, baselineId, workId } = await started({ currentFact: false });
  await decideApproveApply(root, rid, [
    d('RC-0001', 'new', { summary: 'Root codeception.yml enables only the api and apps suites; the other checked-in suites are commented out.' }),
    d('RC-0006', 'merge-with', { target: 'RC-0001', reason: 'Both describe the enabled root Codeception suites.' }),
    d('RC-0004', 'new')
  ]);
  const ledger = await ledgerOf(root);
  assert.equal(ledger.facts.length, 2);
  const [merged, unique] = ledger.facts;
  assert.equal(merged.summary, 'Root codeception.yml enables only the api and apps suites; the other checked-in suites are commented out.');
  assert.deepEqual(merged.origins.map((origin) => [origin.workId, origin.baselineFactId ?? origin.candidateId, origin.reconciliation.candidate]), [[baselineId, 'BF-001', 'RC-0001'], [workId, 'K-002', 'RC-0006']]);
  assert.deepEqual(merged.history.map((event) => event.action), ['adopted', 'merged']);
  assert.equal(ledger.schemaVersion, 2, 'reconciliation writes schema v2');
  assert.equal(merged.origin, undefined, 'schema v2 records provenance only in origins');
  assert.deepEqual(unique.origins.map((origin) => origin.reconciliation.candidate), ['RC-0004'], 'a single-origin fact has exactly one origin');
  const show = cli(root, ['context', 'show', merged.id]).stdout;
  assert.match(show, new RegExp(`Introduced by: ${baselineId} \\(baseline BF-001\\) — adopted from v0\\.3\\.5 context, reconciled in ${rid} RC-0001`));
  assert.match(show, new RegExp(`Also established by:\\n  - ${workId} \\(K-002\\) — adopted from v0\\.3\\.5 context, reconciled in ${rid} RC-0006`));
  assert.deepEqual(validateContextLedger(ledger), []);
});

test('15. a three-way merge (chained merge-with / reconfirms) preserves every origin on one fact', async () => {
  const { root, rid } = await started({ currentFact: false });
  await decideApproveApply(root, rid, [
    d('RC-0002', 'new'),
    d('RC-0005', 'reconfirms', { target: 'RC-0002', reason: 'Independent later confirmation.' }),
    d('RC-0007', 'merge-with', { target: 'RC-0005', reason: 'Chained through RC-0005 (contrived for the test).' })
  ]);
  const ledger = await ledgerOf(root);
  assert.equal(ledger.facts.length, 1);
  assert.deepEqual(ledger.facts[0].origins.map((origin) => origin.reconciliation.candidate), ['RC-0002', 'RC-0005', 'RC-0007']);
  assert.deepEqual(ledger.facts[0].history.map((event) => event.action), ['adopted', 'reconfirmed', 'merged']);
  assert.deepEqual(ledger.facts[0].evidence.map((entry) => entry.path).sort(), ['azure-pipelines.yml', 'docker-compose.yml']);
});

test('8 + 38 + 39 + 41. RECONFIRMS / MERGE_WITH into an existing CTX add provenance only; its evidence, freshness, and history stay valid', async () => {
  const { root, rid, baselineId, workId, currentWorkId } = await started();
  const before = (await ledgerOf(root)).facts[0];
  assert.equal((await factFreshness(root, before)).status, 'fresh');
  await decideApproveApply(root, rid, [
    d('RC-0001', 'reconfirms', { target: 'CTX-0001', reason: 'Baseline independently established it.' }),
    d('RC-0006', 'merge-with', { target: 'RC-0001', reason: 'Same fact as RC-0001, different wording.' })
  ]);
  const [fact] = (await ledgerOf(root)).facts;
  assert.equal(fact.id, 'CTX-0001');
  assert.equal(fact.summary, before.summary);
  assert.deepEqual(fact.evidence, before.evidence);
  assert.equal(fact.verifiedAt, before.verifiedAt);
  assert.equal(fact.verifiedAtCommit, before.verifiedAtCommit);
  assert.deepEqual(fact.origins[0], before.origin, 'the v1 origin becomes the first v2 origin, unchanged');
  assert.deepEqual(fact.origins.map((origin) => [origin.workId, origin.candidateId ?? origin.baselineFactId]), [[currentWorkId, 'K-001'], [baselineId, 'BF-001'], [workId, 'K-002']]);
  assert.deepEqual(fact.history.map((event) => [event.action, event.historical ?? false]), [['introduced', false], ['reconfirmed', true], ['merged', true]]);
  assert.equal((await factFreshness(root, fact)).status, 'fresh');
  assert.match(cli(root, ['context', 'history', 'CTX-0001']).stdout, new RegExp(`reconfirmed — ${baselineId} BF-001 via ${rid} RC-0001`));
});

test('9 + 40. SUPERSEDES an existing CTX: the legacy candidate becomes current, CTX-0001 becomes lineage', async () => {
  const { root, rid } = await started();
  await decideApproveApply(root, rid, [d('RC-0006', 'supersedes', { target: 'CTX-0001', reason: 'The legacy statement is more complete.' })]);
  const ledger = await ledgerOf(root);
  const [old, successor] = ledger.facts;
  assert.equal(old.state, 'superseded');
  assert.equal(old.supersededBy, successor.id);
  assert.deepEqual(successor.supersedes, ['CTX-0001']);
  assert.equal(successor.origins[0].reconciliation.candidate, 'RC-0006');
  assert.match(cli(root, ['context', 'history', successor.id]).stdout, /Lineage \(oldest → newest\): CTX-0001 \[superseded\] → CTX-0002 \[current\]/);
});

test('SUPERSEDES between candidates keeps both as lineage (refinement recorded as supersession)', async () => {
  const { root, rid, workId } = await started({ currentFact: false });
  await decideApproveApply(root, rid, [d('RC-0007', 'new'), d('RC-0008', 'supersedes', { target: 'RC-0007', reason: 'Upgraded to MySQL 8.0.' })]);
  const ledger = await ledgerOf(root);
  const old = factByOrigin(ledger, workId, 'K-003');
  const current = factByOrigin(ledger, workId, 'K-004');
  assert.equal(old.state, 'superseded');
  assert.equal(old.supersededBy, current.id);
  assert.equal(current.state, 'current');
});

test('10. DISPUTES an existing CTX marks it disputed with the conflicting evidence; the candidate is not a fact', async () => {
  const { root, rid } = await started();
  await decideApproveApply(root, rid, [d('RC-0001', 'disputes', { target: 'CTX-0001', reason: 'Baseline wording conflicts on the commented-out suites.' })]);
  const ledger = await ledgerOf(root);
  assert.equal(ledger.facts.length, 1);
  assert.equal(ledger.facts[0].state, 'disputed');
  assert.equal(ledger.facts[0].dispute.raisedBy.reconciliation.candidate, 'RC-0001');
  assert.match(await readFile(path.join(workspacePath(root), 'context', 'conventions.md'), 'utf8'), /DISPUTED: Root codeception\.yml enables only the api and apps Codeception suites\./);
  assert.match(cli(root, ['doctor']).stdout, /Workspace healthy\./);
});

test('12. SKIP requires a reason and never enters project memory', async () => {
  const { root, rid } = await started({ currentFact: false });
  await assert.rejects(() => recordDecisions(root, rid, { decisions: [d('RC-0004', 'skip')] }), /RC-0004 \(skip\) requires a reason/);
  await decideApproveApply(root, rid, [d('RC-0004', 'skip', { reason: 'Transient observation.' })]);
  assert.equal((await loadContextLedger(root)).exists, false);
  const { plan } = await loadReconciliation(root, rid);
  assert.equal(plan.candidates[3].applied.markdown, 'removed');
  assert.doesNotMatch(await readFile(path.join(workspacePath(root), 'context', 'architecture.md'), 'utf8'), /yallaflow-baseline:/);
});

test('13. LIMITATION requires a type, is recorded as a work-scoped limitation, and never enters project memory', async () => {
  const { root, rid } = await started({ currentFact: false });
  await assert.rejects(() => recordDecisions(root, rid, { decisions: [d('RC-0003', 'limitation', { reason: 'Session gap.' })] }), /requires limitationType/);
  await decideApproveApply(root, rid, [d('RC-0003', 'limitation', { limitationType: 'not-inspected', reason: 'Describes the discovery session, not the project.' })]);
  assert.equal((await loadContextLedger(root)).exists, false);
  const list = cli(root, ['limitation', 'list', rid]).stdout;
  assert.match(list, /DL-001 \[not-inspected\] tech-stack — Composer lockfile versions were not inspected\./);
  assert.match(cli(root, ['doctor']).stdout, /Workspace healthy\./);
});

// ---------------------------------------------------------------------------
// Multi-origin compatibility

test('16–17. single-origin v1 facts stay valid; duplicate origins are rejected within and across facts', async () => {
  const { root } = await yaschoolsWorkspace();
  const ledger = await ledgerOf(root);
  assert.equal(ledger.schemaVersion, 1);
  assert.deepEqual(validateContextLedger(ledger), []);
  assert.equal(ledger.facts[0].origins, undefined);
  const v2 = structuredClone(ledger);
  v2.schemaVersion = 2;
  v2.facts[0].origins = [v2.facts[0].origin, { ...v2.facts[0].origin }];
  delete v2.facts[0].origin;
  assert.match(validateContextLedger(v2).join('\n'), /lists origin .* more than once/);
  const across = structuredClone(v2);
  across.facts[0].origins = [ledger.facts[0].origin];
  across.facts.push({ ...structuredClone(across.facts[0]), id: 'CTX-0002' });
  assert.match(validateContextLedger(across).join('\n'), /is claimed by both CTX-0001 and CTX-0002 \(applied twice\)/);
});

// ---------------------------------------------------------------------------
// Validation (every rejection leaves the workspace untouched)

async function rejects(root, rid, decisions, pattern) {
  const before = await snapshotWorkspace(root);
  const result = cli(root, ['context', 'reconcile', 'plan', rid, '--file', await writeDecisions(root, decisions)], false);
  assert.equal(result.status, 1, `expected rejection: ${JSON.stringify(decisions)}`);
  assert.match(result.stderr, pattern);
  assert.match(result.stderr, /No files were changed\./);
  const after = await snapshotWorkspace(root);
  assert.deepEqual(after, before);
}

test('18–23. unknown RC/CTX, cycles, self-merge, conflicting and dangling relations are rejected with zero mutation', async () => {
  const { root, rid } = await started();
  await rejects(root, rid, [d('RC-0099', 'new')], /Unknown reconciliation candidate RC-0099/);
  await rejects(root, rid, [d('RC-0001', 'merge-with', { target: 'RC-0099', reason: 'x' })], /targets unknown reconciliation candidate RC-0099/);
  await rejects(root, rid, [d('RC-0001', 'reconfirms', { target: 'CTX-0042', reason: 'x' })], /targets unknown project context fact CTX-0042/);
  await rejects(root, rid, [d('RC-0001', 'merge-with', { target: 'CTX-0001', reason: 'x' })], /merge-with collapses reconciliation candidates into one canonical fact\. To relate a candidate to an existing fact use reconfirms/);
  await rejects(root, rid, [d('RC-0002', 'reconfirms', { target: 'CTX-0001', reason: 'x' })], /RC-0002 \(reconfirms\) is environment knowledge but CTX-0001 is convention; a reconfirmation must confirm the same kind of knowledge — use merge-with/);
  await rejects(root, rid, [d('RC-0004', 'new'), d('RC-0002', 'reconfirms', { target: 'RC-0004', reason: 'x' })], /RC-0002 \(reconfirms\) is environment knowledge but RC-0004 is architecture/);
  await rejects(root, rid, [d('RC-0001', 'merge-with', { target: 'RC-0006', reason: 'x' }), d('RC-0006', 'merge-with', { target: 'RC-0001', reason: 'x' })], /forms a relation cycle/);
  await rejects(root, rid, [d('RC-0001', 'merge-with', { target: 'RC-0001', reason: 'x' })], /cannot target itself/);
  await rejects(root, rid, [d('RC-0001', 'supersedes', { target: 'CTX-0001', reason: 'x' }), d('RC-0006', 'supersedes', { target: 'CTX-0001', reason: 'y' })], /both supersede CTX-0001/);
  await rejects(root, rid, [d('RC-0001', 'supersedes', { target: 'CTX-0001', reason: 'x' }), d('RC-0006', 'disputes', { target: 'CTX-0001', reason: 'y' })], /which RC-0001 supersedes in the same plan/);
  await rejects(root, rid, [d('RC-0007', 'new'), d('RC-0008', 'supersedes', { target: 'RC-0009', reason: 'x' }), d('RC-0009', 'supersedes', { target: 'RC-0008', reason: 'y' })], /supersession cycle/);
  await rejects(root, rid, [d('RC-0006', 'merge-with', { target: 'RC-0001', reason: 'x' })], /targets RC-0001, which has no decision yet/);
  await rejects(root, rid, [d('RC-0001', 'skip', { reason: 'x' }), d('RC-0006', 'merge-with', { target: 'RC-0001', reason: 'y' })], /does not become a project fact \(RC-0001 is skip\)/);
  await rejects(root, rid, [d('RC-0001', 'destroy')], /invalid action "destroy"/);
  await rejects(root, rid, [d('RC-0001', 'skip', { reason: 'x', summary: 'rewritten' })], /may not set summary\/area/);
  await rejects(root, rid, [d('RC-0001', 'new'), d('RC-0001', 'skip', { reason: 'x' })], /decided more than once/);
});

test('23. a hand-corrupted plan cannot be applied and nothing is mutated', async () => {
  const { root, rid } = await started();
  await recordDecisions(root, rid, { decisions: [d('RC-0004', 'new')] });
  await approveReconciliation(root, rid);
  const file = reconciliationFilePath(root, rid);
  const plan = await readYaml(file);
  plan.candidates[3].decision.action = 'annihilate';
  await writeYaml(file, plan);
  const before = await snapshotWorkspace(root);
  const result = cli(root, ['context', 'reconcile', 'apply', rid], false);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /invalid action "annihilate"/);
  assert.deepEqual(await snapshotWorkspace(root), before);
  assert.match(cli(root, ['doctor'], false).stdout, /FAIL .*RC-0004 has invalid action "annihilate"/);
});

// ---------------------------------------------------------------------------
// Review

test('24–26. only an approved plan applies; changes-requested blocks; approval needs the checkpoint', async () => {
  const workspace = await yaschoolsWorkspace();
  const { root } = workspace;
  const { meta } = await startReconciliation(root);
  const rid = meta.id;
  await recordDecisions(root, rid, { decisions: [d('RC-0004', 'new')] });
  await assert.rejects(() => approveReconciliation(root, rid), /Complete the context-reconciliation checkpoint before review/);
  await assert.rejects(() => applyReconciliation(root, rid), /it has not been approved/);
  await checkpointWork(root, rid, { skillId: 'context-reconciliation', status: 'completed', summary: 'Reasoned.', evidence: [] });
  await approveReconciliation(root, rid);
  await feedbackReconciliation(root, rid, 'Split RC-0004 first.');
  await assert.rejects(() => applyReconciliation(root, rid), /changes were requested/);
  const reviews = await readYaml(path.join(workspacePath(root), 'work', rid, 'reviews.yaml'));
  assert.deepEqual(reviews.gates.reconciliation.history.map((entry) => entry.status), ['awaiting_review', 'approved', 'changes_requested']);
  await approveReconciliation(root, rid);
  const result = await applyReconciliation(root, rid);
  assert.equal(result.newlyApplied.length, 1);
  const generic = cli(root, ['approve', rid, '--stage', 'reconciliation'], false);
  assert.equal(generic.status, 1);
  assert.match(generic.stderr, /managed by `yallaflow context reconcile approve\|feedback`/);
});

test('27. an approved plan changed afterward requires re-review (via plan, or tampered by hand)', async () => {
  const { root, rid } = await started();
  await recordDecisions(root, rid, { decisions: [d('RC-0004', 'new')] });
  await approveReconciliation(root, rid);
  const revised = await recordDecisions(root, rid, { decisions: [d('RC-0004', 'new', { summary: 'Yii2 advanced template.' })] });
  assert.equal(revised.invalidatedApproval, true);
  await assert.rejects(() => applyReconciliation(root, rid), /it has not been approved/);
  const unchanged = await recordDecisions(root, rid, { decisions: [d('RC-0004', 'new', { summary: 'Yii2 advanced template.' })] });
  assert.equal(unchanged.changed, false, 'resubmitting identical decisions changes nothing');

  await approveReconciliation(root, rid);
  const file = reconciliationFilePath(root, rid);
  const plan = await readYaml(file);
  plan.candidates[3].decision.summary = 'Quietly edited after approval.';
  await writeYaml(file, plan);
  const before = await snapshotWorkspace(root);
  await assert.rejects(() => applyReconciliation(root, rid), /it changed after it was approved \(re-review required\)/);
  assert.deepEqual(await snapshotWorkspace(root), before);
  assert.match(cli(root, ['doctor'], false).stdout, /FAIL .*plan is marked approved but was changed afterward/);
});

// ---------------------------------------------------------------------------
// Preview

test('28–31. preview is read-only and shows counts, resulting facts, merges, skips, limitations, and pending items', async () => {
  const { root, rid } = await started();
  await recordDecisions(root, rid, { decisions: [
    d('RC-0001', 'reconfirms', { target: 'CTX-0001', reason: 'Same fact, independently established by the baseline.' }),
    d('RC-0006', 'merge-with', { target: 'RC-0001', reason: 'Same fact as RC-0001.' }),
    d('RC-0002', 'new', { summary: 'The Azure production pipeline runs no automated tests.' }),
    d('RC-0005', 'reconfirms', { target: 'RC-0002', reason: 'Refinement with more evidence.' }),
    d('RC-0003', 'limitation', { limitationType: 'not-inspected', reason: 'Session gap.' }),
    d('RC-0004', 'new'),
    d('RC-0007', 'new'),
    d('RC-0008', 'supersedes', { target: 'RC-0007', reason: 'Upgrade.' }),
    d('RC-0009', 'skip', { reason: 'Superseded by the tenant middleware rewrite.' })
  ] });
  const before = await snapshotWorkspace(root);
  const preview = cli(root, ['context', 'reconcile', 'preview', rid]).stdout;
  assert.deepEqual(await snapshotWorkspace(root), before);
  assert.match(preview, /10 legacy candidate\(s\) · 0 already applied · 9 to apply · 1 pending/);
  assert.match(preview, /4 canonical current fact\(s\) \(1 before\)/);
  assert.match(preview, /4 new fact\(s\) · 1 merged \(candidates collapsed into one fact\) · 2 reconfirmation\(s\) \(2 candidate\(s\) joining existing facts\)/);
  assert.match(preview, /1 supersession\(s\) · 0 dispute\(s\) · 1 limitation\(s\) · 1 skipped · 1 pending/);
  assert.match(preview, /Environments\s+1/);
  assert.match(preview, /Conventions\s+1/);
  assert.match(preview, /Database\s+1/);
  assert.match(preview, /RC-0002 \+ RC-0005 \(reconfirms\) → CTX-0002 \[environment\] The Azure production pipeline runs no automated tests\./);
  assert.match(preview, /RC-0008 → CTX-0005 \(supersedes RC-0007\) \[database\] Production database was upgraded to MySQL 8\.0\./);
  assert.match(preview, /RC-0001 reconfirms CTX-0001 \(PF-0001 BF-001\)/);
  assert.match(preview, /RC-0006 merge-with RC-0001 → CTX-0001 \(PF-0002 K-002\)/);
  assert.match(preview, /RC-0003 \[not-inspected\] Composer lockfile versions were not inspected\./);
  assert.match(preview, /RC-0009 — Superseded by the tenant middleware rewrite\./);
  assert.match(preview, /Pending \(unchanged by this apply; their legacy sections stay\):\n  RC-0010/);
  assert.match(preview, /Legacy Markdown: 9 section\(s\) retired/);

  const { plan } = await loadReconciliation(root, rid);
  const simulated = await previewReconciliation(root, rid);
  await approveReconciliation(root, rid);
  await applyReconciliation(root, rid);
  const ledger = await ledgerOf(root);
  assert.equal(ledger.facts.filter((fact) => fact.state !== 'superseded').length, simulated.simulated.after, 'preview predicted the applied result');
  assert.deepEqual(simulated.simulated.groups.map((group) => group.factId), ['CTX-0002', 'CTX-0003', 'CTX-0004', 'CTX-0005']);
  assert.equal(planHash(plan), (await loadReconciliation(root, rid)).plan.approval.hash, 'applying never invalidates its own approval');
});

// ---------------------------------------------------------------------------
// Apply

test('32–34. repeated apply is idempotent: no duplicate facts, origins, or history', async () => {
  const { root, rid } = await started();
  await decideApproveApply(root, rid, [d('RC-0001', 'reconfirms', { target: 'CTX-0001', reason: 'Same.' }), d('RC-0004', 'new')]);
  const once = await snapshotWorkspace(root);
  const again = cli(root, ['context', 'reconcile', 'apply', rid]);
  assert.match(again.stdout, /nothing new to apply/);
  assert.deepEqual(await snapshotWorkspace(root), once);
  const ledger = await ledgerOf(root);
  assert.equal(ledger.facts.length, 2);
  assert.equal(ledger.facts[0].origins.length, 2);
});

test('35–36. a projection failure leaves canonical memory intact; render repairs; retry finishes without duplicates', async () => {
  const { root, rid } = await started();
  await recordDecisions(root, rid, { decisions: [d('RC-0001', 'reconfirms', { target: 'CTX-0001', reason: 'Same.' }), d('RC-0006', 'merge-with', { target: 'RC-0001', reason: 'Same.' }), d('RC-0004', 'new')] });
  await approveReconciliation(root, rid);
  const doc = path.join(workspacePath(root), 'context', 'architecture.md');
  const original = await readFile(doc, 'utf8');
  await writeFile(doc, `${original}<!-- yallaflow-context:begin -->\n`);

  await assert.rejects(() => applyReconciliation(root, rid), /Project context ledger updated, but rendering the Markdown projection failed[\s\S]*retrying the original command is also safe/);
  const ledger = await ledgerOf(root);
  assert.deepEqual(validateContextLedger(ledger), []);
  assert.equal(ledger.facts.length, 2);
  assert.equal(ledger.facts[0].origins.length, 3);
  assert.equal((await loadReconciliation(root, rid)).plan.candidates.some((candidate) => candidate.applied), false);
  const doctor = cli(root, ['doctor'], false);
  assert.equal(doctor.status, 1);
  assert.match(doctor.stdout, /WARN .*RC-0004 is in the ledger \(CTX-0002\) but its apply did not finish/);

  await writeFile(doc, original);
  cli(root, ['context', 'render']);
  cli(root, ['context', 'reconcile', 'apply', rid]);
  const after = await ledgerOf(root);
  assert.deepEqual(after.facts.map((fact) => [fact.id, (fact.origins ?? [fact.origin]).length]), [['CTX-0001', 3], ['CTX-0002', 1]]);
  const { plan } = await loadReconciliation(root, rid);
  assert.deepEqual(plan.candidates.filter((candidate) => candidate.applied).map((candidate) => [candidate.id, candidate.applied.factId]), [['RC-0001', 'CTX-0001'], ['RC-0004', 'CTX-0002'], ['RC-0006', 'CTX-0001']]);
  assert.match(cli(root, ['doctor']).stdout, /Workspace healthy\./);
});

test('37. no half-applied merge group: a failed ledger write applies nothing; the retry applies the whole group', { skip: process.getuid?.() === 0 }, async () => {
  const { root, rid } = await started({ currentFact: false });
  await recordDecisions(root, rid, { decisions: [d('RC-0001', 'new'), d('RC-0006', 'merge-with', { target: 'RC-0001', reason: 'Same.' })] });
  await approveReconciliation(root, rid);
  const contextDir = path.join(workspacePath(root), 'context');
  await chmod(contextDir, 0o555);
  try {
    await assert.rejects(() => applyReconciliation(root, rid));
  } finally {
    await chmod(contextDir, 0o755);
  }
  assert.equal((await loadContextLedger(root)).exists, false, 'nothing from the group reached the ledger');
  await applyReconciliation(root, rid);
  const ledger = await ledgerOf(root);
  assert.equal(ledger.facts.length, 1);
  assert.deepEqual(ledger.facts[0].origins.map((origin) => origin.reconciliation.candidate), ['RC-0001', 'RC-0006']);
});

// ---------------------------------------------------------------------------
// Unresolved ambiguity: questions + partial apply

test('16 (questions). an ambiguous pair stays pending with a question while the approved subset applies', async () => {
  const { root, rid } = await started();
  cli(root, ['question', 'add', rid, '--category', 'architecture', '--text', 'RC-0009 vs RC-0010: is the school resolved by subdomain or by header?']);
  await decideApproveApply(root, rid, [d('RC-0004', 'new'), d('RC-0001', 'reconfirms', { target: 'CTX-0001', reason: 'Same.' })]);
  const status = cli(root, ['context', 'reconcile', 'status', rid]).stdout;
  assert.match(status, /Candidates: 10 · decided 2 · applied 2 · pending 8/);
  assert.match(status, /Q-001 \[open\] RC-0009 vs RC-0010/);
  assert.match(status, /Blockers: 8 candidate\(s\) without a decision; 1 open reconciliation question\(s\)/);
  const meta = await readYaml(path.join(workspacePath(root), 'work', rid, 'meta.yaml'));
  assert.notEqual(meta.status, 'DONE');
  const businessRules = await readFile(path.join(workspacePath(root), 'context', 'business-rules.md'), 'utf8');
  assert.match(businessRules, /yallaflow-knowledge:PF-0002:K-005/, 'pending legacy sections stay until reconciled');
  assert.match(cli(root, ['doctor']).stdout, /Workspace healthy\./);

  cli(root, ['question', 'answer', rid, '--id', 'Q-001', '--answer', 'Header in the API, subdomain in the web apps — both hold; keep separate.']);
  cli(root, ['question', 'resolve', rid, '--id', 'Q-001']);
  await recordDecisions(root, rid, { decisions: [
    d('RC-0009', 'new'), d('RC-0010', 'new'), d('RC-0002', 'new'), d('RC-0005', 'merge-with', { target: 'RC-0002', reason: 'Same.' }),
    d('RC-0003', 'limitation', { limitationType: 'not-inspected', reason: 'Session gap.' }), d('RC-0006', 'merge-with', { target: 'RC-0001', reason: 'Resolves to CTX-0001 through the applied RC-0001.' }),
    d('RC-0007', 'new'), d('RC-0008', 'supersedes', { target: 'RC-0007', reason: 'Upgrade.' })
  ] });
  await assert.rejects(() => applyReconciliation(root, rid), /it has not been approved/);
  await approveReconciliation(root, rid);
  const final = await applyReconciliation(root, rid);
  assert.equal(final.completed, true);
  assert.equal((await readYaml(path.join(workspacePath(root), 'work', rid, 'meta.yaml'))).status, 'DONE');
  assert.equal((await ledgerOf(root)).facts[0].origins.length, 3, 'a later round joins the fact an earlier round produced');
  assert.match(cli(root, ['doctor']).stdout, /Workspace healthy\./);
});

test('applied decisions are history: they cannot be changed afterward', async () => {
  const { root, rid } = await started();
  await decideApproveApply(root, rid, [d('RC-0004', 'new')]);
  await assert.rejects(() => recordDecisions(root, rid, { decisions: [d('RC-0004', 'skip', { reason: 'x' })] }), /RC-0004 is already applied \(new\)/);
});

// ---------------------------------------------------------------------------
// Legacy Markdown

test('42–45. reconciled sections stop being parallel truth, are archived verbatim, and hand-edited ones are kept for review', async () => {
  const { root, rid, baselineId, workId } = await started();
  const base = workspacePath(root);
  const architecture = path.join(base, 'context', 'architecture.md');
  const edited = (await readFile(architecture, 'utf8')).replace('- **Status:** confirmed', '- **Status:** confirmed (double-checked by the team lead)');
  await writeFile(architecture, edited);
  const records = [path.join(base, 'work', baselineId, 'baseline.yaml'), knowledgeFilePath(root, workId), path.join(base, 'work', workId, 'work.md')];
  const recordsBefore = await Promise.all(records.map((file) => readFile(file, 'utf8')));

  await decideApproveApply(root, rid, [d('RC-0001', 'reconfirms', { target: 'CTX-0001', reason: 'Same.' }), d('RC-0006', 'merge-with', { target: 'RC-0001', reason: 'Same.' }), d('RC-0004', 'new')]);
  const conventions = await readFile(path.join(base, 'context', 'conventions.md'), 'utf8');
  assert.doesNotMatch(conventions, /yallaflow-baseline:|yallaflow-knowledge:/, 'no duplicate legacy sections presented as current truth');
  assert.equal((conventions.match(/<!-- yallaflow-fact:/g) ?? []).length, 1);
  const archive = await readFile(path.join(base, 'work', rid, 'legacy-context.md'), 'utf8');
  assert.match(archive, /## RC-0001 — from context\/conventions\.md\n\n<!-- yallaflow-baseline:PF-0001:BF-001 -->\n## BF-001 — Root Codeception configuration enables only tests\/api and tests\/apps; other suites are commented out\./);
  assert.match(archive, /## RC-0006 — from context\/conventions\.md/);
  assert.deepEqual(await Promise.all(records.map((file) => readFile(file, 'utf8'))), recordsBefore, 'historical work is never rewritten');

  assert.match(await readFile(architecture, 'utf8'), /double-checked by the team lead/);
  const doctor = cli(root, ['doctor']).stdout;
  assert.match(doctor, /WARN context\/architecture\.md: legacy section PF-0001 BF-004 was reconciled .* hand-edited, so it was kept verbatim/);

  // A reconciled section re-added verbatim is presented as parallel current truth: an error.
  const retired = archive.slice(archive.indexOf('<!-- yallaflow-baseline:PF-0001:BF-001 -->'), archive.indexOf('## RC-0006'));
  await writeFile(path.join(base, 'context', 'conventions.md'), `${conventions}\n${retired}`);
  const broken = cli(root, ['doctor'], false);
  assert.equal(broken.status, 1);
  assert.match(broken.stdout, /FAIL context\/conventions\.md: legacy section PF-0001 BF-001 is still presented as current project truth after reconciliation/);
});

// ---------------------------------------------------------------------------
// Doctor integrity

test('doctor: missing origins, orphaned plans, broken lineage, and a second open reconciliation are errors', async () => {
  const { root, rid } = await started();
  await decideApproveApply(root, rid, [d('RC-0004', 'new')]);
  const base = workspacePath(root);
  const file = reconciliationFilePath(root, rid);
  const pristine = await readFile(file, 'utf8');

  const missing = JSON.parse(pristine);
  missing.candidates[9].origin.candidateId = 'K-099';
  await writeYaml(file, missing);
  assert.match(cli(root, ['doctor'], false).stdout, /FAIL .*RC-0010 originates from PF-0002 knowledge candidate K-099, which is not recorded \(missing candidate origin\)/);

  const lineage = JSON.parse(pristine);
  lineage.candidates[3].applied.factId = 'CTX-0001';
  await writeYaml(file, lineage);
  assert.match(cli(root, ['doctor'], false).stdout, /FAIL .*RC-0004 records CTX-0001, but its origin lineage is on CTX-0002/);
  await writeFile(file, pristine);

  await writeFile(path.join(base, 'work', 'PF-0003', 'reconciliation.yaml'), pristine);
  assert.match(cli(root, ['doctor'], false).stdout, /FAIL PF-0003 reconciliation: orphaned reconciliation\.yaml in a work item that is not a reconciliation/);
  const { rm } = await import('node:fs/promises');
  await rm(path.join(base, 'work', 'PF-0003', 'reconciliation.yaml'));

  const ledgerFile = contextLedgerPath(root);
  const ledger = await readYaml(ledgerFile);
  ledger.facts[1].origins[0].reconciliation.candidate = 'RC-0042';
  await writeYaml(ledgerFile, ledger);
  assert.match(cli(root, ['doctor'], false).stdout, /FAIL context ledger: CTX-0002 names reconciliation .* RC-0042, which does not record origin/);
});

test('resolvePlan reports relations the ledger has moved past as state issues, not structural errors', async () => {
  const { root, rid } = await started();
  const { plan } = await loadReconciliation(root, rid);
  plan.candidates[0].decision = { action: 'reconfirms', target: 'CTX-0001', reason: 'x', decidedAt: 'now' };
  const ledger = await ledgerOf(root);
  ledger.facts[0].state = 'superseded';
  ledger.facts[0].supersededBy = 'CTX-0002';
  const resolved = resolvePlan(plan, ledger);
  assert.deepEqual(resolved.errors, []);
  assert.match(resolved.stateIssues.join('\n'), /targets CTX-0001, which is superseded \(superseded by CTX-0002; target the current fact instead\)/);
});

// ---------------------------------------------------------------------------
// CLI safety

test('help for every reconcile action never mutates, even on an approved plan', async () => {
  const { root, rid } = await started();
  await recordDecisions(root, rid, { decisions: [d('RC-0004', 'new')] });
  await approveReconciliation(root, rid);
  const before = await snapshotWorkspace(root);
  for (const action of ['start', 'status', 'show', 'plan', 'preview', 'approve', 'feedback', 'apply']) {
    const result = cli(root, ['context', 'reconcile', action, rid, '--help']);
    assert.match(result.stdout, /yallaflow context reconcile apply \[work-id\]/);
  }
  cli(root, ['context', 'reconcile', '--help']);
  assert.deepEqual(await snapshotWorkspace(root), before);
});

test('a reconciliation work item cannot be advanced to DONE around its plan', async () => {
  const { root, rid } = await started();
  const result = cli(root, ['advance', rid], false);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /completes only through `yallaflow context reconcile apply`/);
  assert.match(cli(root, ['guide', rid]).stdout, new RegExp(`NEXT VALID ACTION:\\nyallaflow context reconcile status ${rid}`));
});
