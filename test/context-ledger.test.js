// v0.3.6 Living Project Memory: canonical context ledger, promotion, and knowledge
// evolution (supersede / reconfirm / dispute).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { initWorkspace, workspacePath } from '../src/core/workspace.js';
import { createPendingIntake, routeWorkItem } from '../src/behavior/routing.js';
import { advanceActiveWork } from '../src/core/transitions.js';
import { proposeKnowledge, rejectKnowledge } from '../src/knowledge/store.js';
import { promoteKnowledge } from '../src/knowledge/promotion.js';
import { contextLedgerPath, loadContextLedger, validateContextLedger } from '../src/context/ledger.js';
import { exists } from '../src/utils/fs.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

async function repoRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-ctx-'));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'Test']);
  await mkdir(path.join(root, 'config'), { recursive: true });
  await writeFile(path.join(root, 'config', 'db.yml'), 'replica: { enabled: false }\n');
  await writeFile(path.join(root, 'config', 'queue.php'), '<?php return ["driver" => "db"];\n');
  await writeFile(path.join(root, '.env'), 'DB_PASSWORD=super-secret-value\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'init']);
  await initWorkspace(root, 'demo', 'brownfield');
  return root;
}

// An investigation parked at CONCLUSION: knowledge review is allowed there without
// verification evidence, so each test exercises only project-memory behavior.
async function investigationAtConclusion(root, title = 'Investigate') {
  const pending = await createPendingIntake(root, title);
  await routeWorkItem(root, pending.id, { work_type: 'investigation', scope: 'bounded', confidence: 'high', reason: 'Read-only question.' });
  for (let i = 0; i < 6; i++) await advanceActiveWork(root, pending.id);
  return pending.id;
}

async function promote(root, workId, input) {
  const { candidate } = await proposeKnowledge(root, workId, { source: 'implementation-runtime', ...input });
  return promoteKnowledge(root, workId, candidate.id);
}

function run(root, args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8' });
}

async function doc(root, relative) {
  return readFile(path.join(workspacePath(root), relative), 'utf8');
}

test('the canonical context ledger is created by the first promotion and never by reads', async () => {
  const root = await repoRoot();
  const workId = await investigationAtConclusion(root);
  for (const args of [['context', 'status'], ['context', 'list'], ['handoff', workId], ['resume', workId], ['doctor']]) {
    assert.equal(run(root, args).status, 0);
  }
  assert.equal(await exists(contextLedgerPath(root)), false);
  await promote(root, workId, { kind: 'architecture', summary: 'The application uses a DB-backed queue.', evidence: ['config/queue.php'] });
  assert.equal(await exists(contextLedgerPath(root)), true);
  const { ledger } = await loadContextLedger(root);
  assert.equal(ledger.schemaVersion, 1);
  assert.deepEqual(validateContextLedger(ledger), []);
});

test('facts receive stable, sequential CTX IDs that never change on later promotions', async () => {
  const root = await repoRoot();
  const workId = await investigationAtConclusion(root);
  const first = await promote(root, workId, { kind: 'architecture', summary: 'DB-backed queue.', evidence: ['config/queue.php'] });
  const second = await promote(root, workId, { kind: 'database', summary: 'Replica configured.', evidence: ['config/db.yml'] });
  assert.equal(first.candidate.factId, 'CTX-0001');
  assert.equal(second.candidate.factId, 'CTX-0002');
  const { ledger } = await loadContextLedger(root);
  assert.deepEqual(ledger.facts.map((fact) => fact.id), ['CTX-0001', 'CTX-0002']);
  assert.equal(ledger.facts[0].summary, 'DB-backed queue.');
});

test('confidence (confirmed/inferred/unresolved) is separate from semantic state (current)', async () => {
  const root = await repoRoot();
  const workId = await investigationAtConclusion(root);
  for (const confidence of ['confirmed', 'inferred', 'unresolved']) {
    await promote(root, workId, { kind: 'database', summary: `Fact that is ${confidence}.`, evidence: ['config/db.yml'], confidence });
  }
  const { ledger } = await loadContextLedger(root);
  assert.deepEqual(ledger.facts.map((fact) => [fact.state, fact.confidence]), [['current', 'confirmed'], ['current', 'inferred'], ['current', 'unresolved']]);
  await assert.rejects(() => proposeKnowledge(root, workId, { kind: 'database', source: 'implementation-runtime', summary: 'x', evidence: ['config/db.yml'], confidence: 'certain' }), /confidence must be one of/);
});

test('provenance, originating work, and structured evidence are preserved', async () => {
  const root = await repoRoot();
  const workId = await investigationAtConclusion(root);
  await promote(root, workId, {
    kind: 'environment',
    summary: 'Staging uses Docker Compose.',
    evidence: ['config/db.yml#replica', 'runtime:docker compose ps showed 3 services', 'user:Ops lead confirmed staging topology'],
    provenance: 'runtime'
  });
  const [fact] = (await loadContextLedger(root)).ledger.facts;
  assert.equal(fact.provenance, 'runtime');
  assert.deepEqual(fact.origin, { workId, candidateId: 'K-001' });
  assert.equal(fact.evidence[0].type, 'repository');
  assert.equal(fact.evidence[0].path, 'config/db.yml');
  assert.equal(fact.evidence[0].symbol, 'replica');
  assert.match(fact.evidence[0].contentHash, /^sha256:[0-9a-f]{64}$/);
  assert.match(fact.evidence[0].gitCommit, /^[0-9a-f]{40}$/);
  assert.deepEqual(fact.evidence[1], { type: 'runtime', description: 'docker compose ps showed 3 services' });
  assert.deepEqual(fact.evidence[2], { type: 'user-confirmed', description: 'Ops lead confirmed staging topology' });
  assert.equal(fact.verifiedAtCommit, git(root, ['rev-parse', 'HEAD']).trim());
});

test('evidence records location and hash only — secret file contents are never copied into the ledger', async () => {
  const root = await repoRoot();
  const workId = await investigationAtConclusion(root);
  await promote(root, workId, { kind: 'environment', summary: 'Database credentials come from .env.', evidence: ['.env'] });
  const raw = await readFile(contextLedgerPath(root), 'utf8');
  assert.doesNotMatch(raw, /super-secret-value/);
  assert.doesNotMatch(await doc(root, 'context/environments.md'), /super-secret-value/);
});

test('verification:V-### evidence must reference a real verification run of the work item', async () => {
  const root = await repoRoot();
  const workId = await investigationAtConclusion(root);
  const { candidate } = await proposeKnowledge(root, workId, { kind: 'database', source: 'implementation-runtime', summary: 'x', evidence: ['verification:V-009'] });
  await assert.rejects(() => promoteKnowledge(root, workId, candidate.id), /verification run V-009 was not found/);
  assert.equal(await exists(contextLedgerPath(root)), false);
});

test('promotion updates the Markdown projection and leaves human content untouched', async () => {
  const root = await repoRoot();
  const file = path.join(workspacePath(root), 'context', 'database.md');
  await writeFile(file, '# Database\n\nHand-written note: the DBA is on call on Fridays.\n');
  const workId = await investigationAtConclusion(root);
  await promote(root, workId, { kind: 'database', summary: 'Read replica is configured but inactive.', evidence: ['config/db.yml'] });
  const content = await readFile(file, 'utf8');
  assert.match(content, /Hand-written note: the DBA is on call on Fridays\./);
  assert.match(content, /<!-- yallaflow-context:begin -->/);
  assert.match(content, /### CTX-0001 — Read replica is configured but inactive\./);
  assert.match(content, /Source work:\*\* PF-0001/);
});

test('the originating work item remains unchanged by later project-memory evolution', async () => {
  const root = await repoRoot();
  const first = await investigationAtConclusion(root, 'First');
  await promote(root, first, { kind: 'database', summary: 'Read replica is configured but inactive.', evidence: ['config/db.yml'] });
  const workDir = path.join(workspacePath(root), 'work', first);
  const before = await Promise.all(['meta.yaml', 'knowledge.yaml', 'progress.md', 'work.md'].map((name) => readFile(path.join(workDir, name), 'utf8')));

  const second = await investigationAtConclusion(root, 'Second');
  await writeFile(path.join(root, 'config', 'db.yml'), 'replica: { enabled: true }\n');
  await promote(root, second, { kind: 'database', summary: 'Read replica is active for reporting.', evidence: ['config/db.yml'], supersedes: 'CTX-0001' });

  const after = await Promise.all(['meta.yaml', 'knowledge.yaml', 'progress.md', 'work.md'].map((name) => readFile(path.join(workDir, name), 'utf8')));
  assert.deepEqual(after, before);
});

test('a second unrelated fact appends safely without disturbing the first', async () => {
  const root = await repoRoot();
  const workId = await investigationAtConclusion(root);
  await promote(root, workId, { kind: 'database', summary: 'Replica configured.', evidence: ['config/db.yml'] });
  await promote(root, workId, { kind: 'database', summary: 'Migrations live in config/.', evidence: ['config/queue.php'] });
  const content = await doc(root, 'context/database.md');
  assert.match(content, /CTX-0001 — Replica configured\./);
  assert.match(content, /CTX-0002 — Migrations live in config\/\./);
  assert.equal(content.match(/yallaflow-context:begin/g).length, 1);
});

test('supersede: old fact becomes historical, new fact current, lineage consistent both ways', async () => {
  const root = await repoRoot();
  const first = await investigationAtConclusion(root, 'First');
  await promote(root, first, { kind: 'database', summary: 'Read replica is configured but inactive.', evidence: ['config/db.yml'] });
  const second = await investigationAtConclusion(root, 'Second');
  const result = await promote(root, second, { kind: 'database', summary: 'Read replica is active for reporting.', evidence: ['config/db.yml'], supersedes: 'CTX-0001' });
  assert.equal(result.candidate.factId, 'CTX-0002');
  assert.deepEqual(result.candidate.relation, { type: 'supersedes', factId: 'CTX-0001' });

  const { ledger } = await loadContextLedger(root);
  const [old, current] = ledger.facts;
  assert.equal(old.state, 'superseded');
  assert.equal(old.supersededBy, 'CTX-0002');
  assert.equal(current.state, 'current');
  assert.deepEqual(current.supersedes, ['CTX-0001']);
  assert.equal(old.summary, 'Read replica is configured but inactive.'); // history preserved verbatim
  assert.ok(old.history.some((entry) => entry.action === 'superseded' && entry.workId === second));

  const content = await doc(root, 'context/database.md');
  assert.doesNotMatch(content, /configured but inactive/);
  assert.match(content, /CTX-0002 — Read replica is active for reporting\./);
  assert.match(content, /Supersedes:\*\* CTX-0001/);

  const show = run(root, ['context', 'show', 'CTX-0001']);
  assert.equal(show.status, 0, show.stderr);
  assert.match(show.stdout, /State: superseded/);
  assert.match(show.stdout, /Superseded by: CTX-0002/);
});

test('supersede rejects unknown, malformed, and already-superseded targets', async () => {
  const root = await repoRoot();
  const workId = await investigationAtConclusion(root);
  const base = { kind: 'database', source: 'implementation-runtime', summary: 'New truth.', evidence: ['config/db.yml'] };
  await assert.rejects(() => proposeKnowledge(root, workId, { ...base, supersedes: 'CTX-9999' }), /CTX-9999 was not found/);
  await promote(root, workId, { kind: 'database', summary: 'Old truth.', evidence: ['config/db.yml'] });
  await promote(root, workId, { kind: 'database', summary: 'Newer truth.', evidence: ['config/db.yml'], supersedes: 'CTX-0001' });
  await assert.rejects(() => proposeKnowledge(root, workId, { ...base, supersedes: 'CTX-0001' }), /CTX-0001 is superseded \(superseded by CTX-0002\)/);
  await assert.rejects(() => proposeKnowledge(root, workId, { ...base, supersedes: 'CTX-0002', reconfirms: 'CTX-0002' }), /Use only one of/);
});

test('two candidates cannot both supersede the same fact (no duplicate current identity)', async () => {
  const root = await repoRoot();
  const workId = await investigationAtConclusion(root);
  await promote(root, workId, { kind: 'database', summary: 'Old truth.', evidence: ['config/db.yml'] });
  const a = await proposeKnowledge(root, workId, { kind: 'database', source: 'implementation-runtime', summary: 'Truth A.', evidence: ['config/db.yml'], supersedes: 'CTX-0001' });
  const b = await proposeKnowledge(root, workId, { kind: 'database', source: 'implementation-runtime', summary: 'Truth B.', evidence: ['config/db.yml'], supersedes: 'CTX-0001' });
  await promoteKnowledge(root, workId, a.candidate.id);
  await assert.rejects(() => promoteKnowledge(root, workId, b.candidate.id), /Cannot supersede CTX-0001: it is superseded/);
  const { ledger } = await loadContextLedger(root);
  assert.equal(ledger.facts.filter((fact) => fact.state === 'current').length, 1);
  await rejectKnowledge(root, workId, b.candidate.id, 'Superseded concurrently by K-002.');
});

test('knowledge evolution requires resolvable evidence, not a bare free-text reference', async () => {
  const root = await repoRoot();
  const workId = await investigationAtConclusion(root);
  await promote(root, workId, { kind: 'database', summary: 'Old truth.', evidence: ['config/db.yml'] });
  const { candidate } = await proposeKnowledge(root, workId, { kind: 'database', source: 'implementation-runtime', summary: 'New truth.', evidence: ['I remember this from chat'], supersedes: 'CTX-0001' });
  await assert.rejects(() => promoteKnowledge(root, workId, candidate.id), /cites no resolvable evidence/);
  assert.equal((await loadContextLedger(root)).ledger.facts[0].state, 'current');
});

test('reconfirm keeps the same fact identity, refreshes evidence, and creates no duplicate', async () => {
  const root = await repoRoot();
  const workId = await investigationAtConclusion(root);
  await promote(root, workId, { kind: 'architecture', summary: 'The application uses a DB-backed queue.', evidence: ['config/queue.php'] });
  const before = (await loadContextLedger(root)).ledger.facts[0];
  await writeFile(path.join(root, 'config', 'queue.php'), '<?php return ["driver" => "db", "retry" => 3];\n');
  git(root, ['commit', '-qam', 'tune queue']);
  const result = await promote(root, workId, { kind: 'architecture', summary: 'Queue is still DB-backed.', evidence: ['config/queue.php'], reconfirms: 'CTX-0001' });
  assert.equal(result.candidate.factId, 'CTX-0001');
  const { ledger } = await loadContextLedger(root);
  assert.equal(ledger.facts.length, 1);
  const fact = ledger.facts[0];
  assert.equal(fact.summary, 'The application uses a DB-backed queue.');
  assert.notEqual(fact.evidence[0].contentHash, before.evidence[0].contentHash);
  assert.notEqual(fact.verifiedAtCommit, before.verifiedAtCommit);
  const entry = fact.history.find((item) => item.action === 'reconfirmed');
  assert.deepEqual(entry.previousEvidence, before.evidence);
});

test('reconfirm must use the fact\'s own kind', async () => {
  const root = await repoRoot();
  const workId = await investigationAtConclusion(root);
  await promote(root, workId, { kind: 'architecture', summary: 'DB-backed queue.', evidence: ['config/queue.php'] });
  await assert.rejects(
    () => proposeKnowledge(root, workId, { kind: 'database', source: 'implementation-runtime', summary: 'x', evidence: ['config/queue.php'], reconfirms: 'CTX-0001' }),
    /must use --kind architecture/
  );
});

test('dispute marks the fact disputed, retains conflicting evidence, and surfaces uncertainty in Markdown', async () => {
  const root = await repoRoot();
  const workId = await investigationAtConclusion(root);
  await promote(root, workId, { kind: 'database', summary: 'Reporting reads from the primary database.', evidence: ['config/db.yml'] });
  await promote(root, workId, { kind: 'database', summary: 'Runtime logs show reporting queries on the replica host.', evidence: ['runtime:pg_stat_activity on replica showed report_* queries'], disputes: 'CTX-0001' });
  const { ledger } = await loadContextLedger(root);
  const fact = ledger.facts[0];
  assert.equal(ledger.facts.length, 1);
  assert.equal(fact.state, 'disputed');
  assert.equal(fact.dispute.summary, 'Runtime logs show reporting queries on the replica host.');
  assert.equal(fact.dispute.evidence[0].type, 'runtime');
  assert.equal(fact.evidence[0].path, 'config/db.yml'); // original evidence retained alongside

  const content = await doc(root, 'context/database.md');
  assert.match(content, /## Disputed project knowledge/);
  assert.match(content, /CTX-0001 — DISPUTED: Reporting reads from the primary database\./);
  assert.doesNotMatch(content, /- \*\*State:\*\* current/);

  const status = run(root, ['context', 'status']);
  assert.match(status.stdout, /1 disputed/);
  assert.match(status.stdout, /CTX-0001 \[database\] DISPUTED/);
});

test('a disputed fact cannot be disputed again, and resolution preserves dispute history', async () => {
  const root = await repoRoot();
  const workId = await investigationAtConclusion(root);
  await promote(root, workId, { kind: 'database', summary: 'Reporting reads from the primary.', evidence: ['config/db.yml'] });
  await promote(root, workId, { kind: 'database', summary: 'Conflicting runtime observation.', evidence: ['runtime:replica host served reports'], disputes: 'CTX-0001' });
  await assert.rejects(() => proposeKnowledge(root, workId, { kind: 'database', source: 'implementation-runtime', summary: 'y', evidence: ['config/db.yml'], disputes: 'CTX-0001' }), /cannot be disputed/);

  await promote(root, workId, { kind: 'database', summary: 'Reporting reads from the replica.', evidence: ['config/db.yml'], supersedes: 'CTX-0001' });
  const { ledger } = await loadContextLedger(root);
  const old = ledger.facts[0];
  assert.equal(old.state, 'superseded');
  assert.equal(old.dispute, undefined);
  const resolved = old.history.find((entry) => entry.action === 'dispute-resolved');
  assert.equal(resolved.resolution, 'superseded');
  assert.equal(resolved.dispute.summary, 'Conflicting runtime observation.');
  assert.ok(old.history.some((entry) => entry.action === 'disputed'));
});

test('reconfirming a disputed fact settles it back to current', async () => {
  const root = await repoRoot();
  const workId = await investigationAtConclusion(root);
  await promote(root, workId, { kind: 'database', summary: 'Reporting reads from the primary.', evidence: ['config/db.yml'] });
  await promote(root, workId, { kind: 'database', summary: 'Conflicting observation.', evidence: ['runtime:ambiguous log line'], disputes: 'CTX-0001' });
  await promote(root, workId, { kind: 'database', summary: 'Primary confirmed.', evidence: ['config/db.yml', 'user:DBA confirmed reports hit primary'], reconfirms: 'CTX-0001' });
  const fact = (await loadContextLedger(root)).ledger.facts[0];
  assert.equal(fact.state, 'current');
  assert.equal(fact.history.find((entry) => entry.action === 'dispute-resolved').resolution, 'reconfirmed');
});

test('decision (ADR) candidates cannot carry context-fact relations', async () => {
  const root = await repoRoot();
  const workId = await investigationAtConclusion(root);
  await assert.rejects(() => proposeKnowledge(root, workId, {
    kind: 'decision', source: 'implementation-runtime', summary: 'Use replica', evidence: ['config/db.yml'],
    context: 'c', decision: 'd', reason: 'r', costIfWrong: 'x', supersedes: 'CTX-0001'
  }), /not decision \(ADR\) candidates/);
});

test('CLI: knowledge propose --supersedes, context show, list, and history expose lineage', async () => {
  const root = await repoRoot();
  const workId = await investigationAtConclusion(root);
  await promote(root, workId, { kind: 'database', summary: 'Read replica is configured but inactive.', evidence: ['config/db.yml'] });
  const propose = run(root, ['knowledge', 'propose', workId, '--kind', 'database', '--source', 'implementation-runtime',
    '--summary', 'Read replica is active for reporting.', '--evidence', 'config/db.yml', '--supersedes', 'CTX-0001']);
  assert.equal(propose.status, 0, propose.stderr);
  assert.equal(run(root, ['knowledge', 'promote', workId, '--candidate', 'K-002']).status, 0);

  const show = run(root, ['context', 'show', 'CTX-0002']);
  assert.match(show.stdout, /Introduced by: PF-0001 \(K-002\)/);
  assert.match(show.stdout, /Supersedes: CTX-0001/);
  assert.match(show.stdout, /Freshness: FRESH/);

  const history = run(root, ['context', 'history', 'CTX-0001']);
  assert.equal(history.status, 0, history.stderr);
  assert.match(history.stdout, /CTX-0001 \[superseded\] → CTX-0002 \[current\]/);

  const list = run(root, ['context', 'list']);
  assert.doesNotMatch(list.stdout, /CTX-0001/);
  assert.match(list.stdout, /CTX-0002 \[database\] current\/confirmed FRESH/);
  assert.match(run(root, ['context', 'list', '--all']).stdout, /CTX-0001 \[database\] superseded/);
  assert.notEqual(run(root, ['context', 'show', 'CTX-0404']).status, 0);
});

test('CLI: context status summarizes areas and is strictly read-only', async () => {
  const root = await repoRoot();
  const workId = await investigationAtConclusion(root);
  await promote(root, workId, { kind: 'architecture', summary: 'DB-backed queue.', evidence: ['config/queue.php'] });
  await promote(root, workId, { kind: 'database', summary: 'Engine unknown.', evidence: ['config/db.yml'], confidence: 'unresolved' });
  const snapshot = async () => Promise.all([contextLedgerPath(root), path.join(workspacePath(root), 'context', 'database.md')].map((file) => readFile(file, 'utf8')));
  const before = await snapshot();
  const status = run(root, ['context', 'status']);
  assert.equal(status.status, 0, status.stderr);
  assert.match(status.stdout, /Architecture\n {2}1 current/);
  assert.match(status.stdout, /Database\n {2}1 current\n {2}1 unresolved/);
  assert.match(status.stdout, /No facts currently need revalidation\./);
  assert.deepEqual(await snapshot(), before);
});

test('context help never mutates state', async () => {
  const root = await repoRoot();
  for (const args of [['context', '--help'], ['context', 'adopt', '--help'], ['limitation', 'add', '--help']]) {
    const result = run(root, args);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Usage:/);
  }
  assert.equal(await exists(contextLedgerPath(root)), false);
});
