// v0.3.6 mechanical, evidence-aware context freshness and change impact.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { initWorkspace } from '../src/core/workspace.js';
import { createPendingIntake, routeWorkItem } from '../src/behavior/routing.js';
import { advanceActiveWork } from '../src/core/transitions.js';
import { proposeKnowledge } from '../src/knowledge/store.js';
import { promoteKnowledge } from '../src/knowledge/promotion.js';
import { contextLedgerPath, loadContextLedger, mutateContextLedger } from '../src/context/ledger.js';
import { factFreshness, factsAffectedByPaths } from '../src/context/freshness.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function run(root, args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8' });
}

async function setup({ useGit = true } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-fresh-'));
  await mkdir(path.join(root, 'common', 'config'), { recursive: true });
  await writeFile(path.join(root, 'common', 'config', 'main.php'), '<?php return ["queue" => "db"];\n');
  await writeFile(path.join(root, 'azure-pipelines.yml'), 'trigger: [main]\n');
  if (useGit) {
    git(root, ['init', '-q']);
    git(root, ['config', 'user.email', 'test@example.com']);
    git(root, ['config', 'user.name', 'Test']);
    git(root, ['add', '-A']);
    git(root, ['commit', '-qm', 'init']);
  }
  await initWorkspace(root, 'demo', 'brownfield');
  const pending = await createPendingIntake(root, 'Investigate');
  await routeWorkItem(root, pending.id, { work_type: 'investigation', scope: 'bounded', confidence: 'high', reason: 'Read-only.' });
  for (let i = 0; i < 6; i++) await advanceActiveWork(root, pending.id);
  return { root, workId: pending.id };
}

async function promote(root, workId, input) {
  const { candidate } = await proposeKnowledge(root, workId, { source: 'implementation-runtime', ...input });
  return promoteKnowledge(root, workId, candidate.id);
}

async function freshnessOf(root, factId = 'CTX-0001') {
  const { ledger } = await loadContextLedger(root);
  return factFreshness(root, ledger.facts.find((fact) => fact.id === factId));
}

test('unchanged evidence path remains fresh', async () => {
  const { root, workId } = await setup();
  await promote(root, workId, { kind: 'architecture', summary: 'DB-backed queue.', evidence: ['common/config/main.php'] });
  assert.equal((await freshnessOf(root)).status, 'fresh');
});

test('changed evidence path makes the fact may-be-stale — and never auto-supersedes or edits it', async () => {
  const { root, workId } = await setup();
  await promote(root, workId, { kind: 'architecture', summary: 'DB-backed queue.', evidence: ['common/config/main.php'] });
  const ledgerBefore = await readFile(contextLedgerPath(root), 'utf8');
  await writeFile(path.join(root, 'common', 'config', 'main.php'), '<?php return ["queue" => "redis"];\n');
  const result = await freshnessOf(root);
  assert.equal(result.status, 'may-be-stale');
  assert.deepEqual(result.changed, ['common/config/main.php']);

  for (const args of [['context', 'status'], ['context', 'show', 'CTX-0001'], ['doctor'], ['handoff', workId]]) run(root, args);
  assert.equal(await readFile(contextLedgerPath(root), 'utf8'), ledgerBefore);
  const fact = (await loadContextLedger(root)).ledger.facts[0];
  assert.equal(fact.state, 'current');
  assert.equal(fact.summary, 'DB-backed queue.');
});

test('committing the change still reports may-be-stale (evidence differs from the verified content)', async () => {
  const { root, workId } = await setup();
  await promote(root, workId, { kind: 'architecture', summary: 'DB-backed queue.', evidence: ['common/config/main.php'] });
  await writeFile(path.join(root, 'common', 'config', 'main.php'), '<?php return ["queue" => "redis"];\n');
  git(root, ['commit', '-qam', 'switch queue']);
  assert.equal((await freshnessOf(root)).status, 'may-be-stale');
});

test('deleted evidence path is reported as stale evidence', async () => {
  const { root, workId } = await setup();
  await promote(root, workId, { kind: 'environment', summary: 'CI runs on Azure Pipelines.', evidence: ['azure-pipelines.yml'] });
  await rm(path.join(root, 'azure-pipelines.yml'));
  const result = await freshnessOf(root);
  assert.equal(result.status, 'stale-evidence');
  assert.deepEqual(result.missing, ['azure-pipelines.yml']);
  const status = run(root, ['context', 'status']);
  assert.match(status.stdout, /1 stale evidence/);
  assert.match(status.stdout, /STALE_EVIDENCE \(azure-pipelines\.yml missing\)/);
});

test('a fact without any verification point reports unknown freshness', async () => {
  const { root, workId } = await setup();
  await promote(root, workId, { kind: 'business-rule', summary: 'Refunds need manager approval.', evidence: ['user:Finance lead confirmed the refund rule'] });
  assert.equal((await freshnessOf(root)).status, 'unknown');
  const show = run(root, ['context', 'show', 'CTX-0001']);
  assert.match(show.stdout, /Freshness: UNKNOWN/);
});

test('outside Git, content hashes still provide mechanical freshness; no commit is recorded', async () => {
  const { root, workId } = await setup({ useGit: false });
  await promote(root, workId, { kind: 'architecture', summary: 'DB-backed queue.', evidence: ['common/config/main.php'] });
  const fact = (await loadContextLedger(root)).ledger.facts[0];
  assert.equal(fact.verifiedAtCommit, null);
  assert.equal(fact.evidence[0].gitCommit, undefined);
  assert.equal((await freshnessOf(root)).status, 'fresh');
  await writeFile(path.join(root, 'common', 'config', 'main.php'), 'changed\n');
  assert.equal((await freshnessOf(root)).status, 'may-be-stale');
});

test('directory evidence uses Git diff against the recorded commit', async () => {
  const { root, workId } = await setup();
  await promote(root, workId, { kind: 'architecture', summary: 'Shared config lives under common/config.', evidence: ['common/config'] });
  const fact = (await loadContextLedger(root)).ledger.facts[0];
  assert.equal(fact.evidence[0].contentHash, undefined);
  assert.equal((await freshnessOf(root)).status, 'fresh');
  await writeFile(path.join(root, 'common', 'config', 'params.php'), '<?php return [];\n');
  assert.equal((await freshnessOf(root)).status, 'may-be-stale');
});

test('reconfirm after targeted revalidation makes a stale fact fresh again', async () => {
  const { root, workId } = await setup();
  await promote(root, workId, { kind: 'architecture', summary: 'DB-backed queue.', evidence: ['common/config/main.php'] });
  await writeFile(path.join(root, 'common', 'config', 'main.php'), '<?php return ["queue" => "db", "ttr" => 60];\n');
  assert.equal((await freshnessOf(root)).status, 'may-be-stale');
  await promote(root, workId, { kind: 'architecture', summary: 'Queue still DB-backed after TTR change.', evidence: ['common/config/main.php'], reconfirms: 'CTX-0001' });
  assert.equal((await freshnessOf(root)).status, 'fresh');
});

test('superseded facts are historical and excluded from freshness warnings', async () => {
  const { root, workId } = await setup();
  await promote(root, workId, { kind: 'architecture', summary: 'DB-backed queue.', evidence: ['common/config/main.php'] });
  await writeFile(path.join(root, 'common', 'config', 'main.php'), '<?php return ["queue" => "redis"];\n');
  await promote(root, workId, { kind: 'architecture', summary: 'Redis-backed queue.', evidence: ['common/config/main.php'], supersedes: 'CTX-0001' });
  assert.equal((await freshnessOf(root, 'CTX-0001')).status, 'historical');
  const doctor = run(root, ['doctor']);
  assert.doesNotMatch(doctor.stdout, /CTX-0001 may be stale/);
});

test('change impact maps changed paths to facts mechanically (context affected)', async () => {
  const { root, workId } = await setup();
  await promote(root, workId, { kind: 'architecture', summary: 'DB-backed queue.', evidence: ['common/config/main.php'] });
  await promote(root, workId, { kind: 'environment', summary: 'CI runs on Azure Pipelines.', evidence: ['azure-pipelines.yml'] });
  await promote(root, workId, { kind: 'business-rule', summary: 'Unrelated rule.', evidence: ['user:confirmed'] });
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'workspace']);

  const { ledger } = await loadContextLedger(root);
  assert.deepEqual(factsAffectedByPaths(ledger, ['common/config/main.php']).map((entry) => entry.fact.id), ['CTX-0001']);
  assert.deepEqual(factsAffectedByPaths(ledger, ['common']).map((entry) => entry.fact.id), ['CTX-0001']);

  await writeFile(path.join(root, 'common', 'config', 'main.php'), 'changed\n');
  await writeFile(path.join(root, 'azure-pipelines.yml'), 'trigger: [develop]\n');
  const affected = run(root, ['context', 'affected']);
  assert.equal(affected.status, 0, affected.stderr);
  assert.match(affected.stdout, /common\/config\/main\.php/);
  assert.match(affected.stdout, /CTX-0001 \[architecture\] MAY_BE_STALE/);
  assert.match(affected.stdout, /CTX-0002 \[environment\] MAY_BE_STALE/);
  assert.doesNotMatch(affected.stdout, /CTX-0003/);

  const explicit = run(root, ['context', 'affected', 'azure-pipelines.yml']);
  assert.match(explicit.stdout, /CTX-0002/);
  assert.doesNotMatch(explicit.stdout, /CTX-0001/);

  git(root, ['commit', '-qam', 'change both']);
  const since = run(root, ['context', 'affected', '--since', 'HEAD~1']);
  assert.match(since.stdout, /CTX-0001/);
  assert.match(since.stdout, /CTX-0002/);
});

test('handoff surfaces stale facts that this work relates to', async () => {
  const { root, workId } = await setup();
  await promote(root, workId, { kind: 'architecture', summary: 'DB-backed queue.', evidence: ['common/config/main.php'] });
  await proposeKnowledge(root, workId, { kind: 'architecture', source: 'implementation-runtime', summary: 'Queue retry is 3.', evidence: ['common/config/main.php'], reconfirms: 'CTX-0001' });
  await writeFile(path.join(root, 'common', 'config', 'main.php'), 'changed\n');
  const handoff = run(root, ['handoff', workId]);
  assert.equal(handoff.status, 0, handoff.stderr);
  assert.match(handoff.stdout, /Relevant project context:/);
  assert.match(handoff.stdout, /CTX-0001 \[architecture\] MAY_BE_STALE \(common\/config\/main\.php changed\)/);
  assert.match(handoff.stdout, /This work's K-002 reconfirms CTX-0001, which may be stale/);
  const resume = run(root, ['resume', workId]);
  assert.match(resume.stdout, /MAY_BE_STALE/);
});

test('ledger transitions are atomic: an invalid transition writes nothing', async () => {
  const { root, workId } = await setup();
  await promote(root, workId, { kind: 'architecture', summary: 'DB-backed queue.', evidence: ['common/config/main.php'] });
  const before = await readFile(contextLedgerPath(root), 'utf8');
  await assert.rejects(() => mutateContextLedger(root, (ops) => {
    ops.introduce({ area: 'architecture', summary: 'Partial.', evidence: [{ type: 'reference', ref: 'x' }], origin: { workId } });
    ops.reconfirm('CTX-0404', { evidence: [{ type: 'reference', ref: 'x' }], origin: { workId } });
  }), /CTX-0404 was not found/);
  assert.equal(await readFile(contextLedgerPath(root), 'utf8'), before);
});
