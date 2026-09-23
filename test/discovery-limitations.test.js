// v0.3.6 GAP-MEMORY-004: discovery limitations are work-scoped records of what an
// investigation could not inspect — never project facts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { initWorkspace, workspacePath } from '../src/core/workspace.js';
import { createPendingIntake, routeWorkItem } from '../src/behavior/routing.js';
import { advanceActiveWork } from '../src/core/transitions.js';
import { checkpointWork } from '../src/core/progress.js';
import { proposeKnowledge } from '../src/knowledge/store.js';
import { addLimitation, limitationsFilePath, loadWorkLimitations } from '../src/limitations/store.js';
import { approveBaseline, draftBaseline, loadBaseline, startBaseline } from '../src/baseline/store.js';
import { contextLedgerPath, loadContextLedger } from '../src/context/ledger.js';
import { exists } from '../src/utils/fs.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));

function run(root, args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8' });
}

async function investigation() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-limit-'));
  await writeFile(path.join(root, 'schema.sql'), 'create table users(id int);\n');
  await initWorkspace(root, 'demo', 'brownfield');
  const pending = await createPendingIntake(root, 'Investigate reporting data source');
  await routeWorkItem(root, pending.id, { work_type: 'investigation', scope: 'bounded', confidence: 'high', reason: 'Read-only.' });
  return { root, workId: pending.id };
}

const LIMITATION = {
  type: 'runtime-unavailable',
  area: 'database',
  summary: 'Production database schema was not inspected.',
  reason: 'No production DB access during this work.'
};

test('a limitation is recorded in the work item only (discovery.yaml)', async () => {
  const { root, workId } = await investigation();
  const entry = await addLimitation(root, workId, LIMITATION);
  assert.equal(entry.id, 'DL-001');
  const { ledger } = await loadWorkLimitations(root, workId);
  assert.equal(ledger.limitations[0].summary, LIMITATION.summary);
  assert.equal(await exists(limitationsFilePath(root, workId)), true);
  assert.equal(await exists(contextLedgerPath(root)), false);
});

test('no limitations file is created when unused, including by reads', async () => {
  const { root, workId } = await investigation();
  for (const args of [['limitation', 'list', workId], ['handoff', workId], ['resume', workId], ['guide', workId]]) {
    assert.equal(run(root, args).status, 0);
  }
  assert.equal(await exists(limitationsFilePath(root, workId)), false);
});

test('limitation types and areas are validated', async () => {
  const { root, workId } = await investigation();
  await assert.rejects(() => addLimitation(root, workId, { ...LIMITATION, type: 'forgot' }), /type must be one of/);
  await assert.rejects(() => addLimitation(root, workId, { ...LIMITATION, area: 'moon' }), /area must be one of/);
  await assert.rejects(() => addLimitation(root, workId, { ...LIMITATION, reason: ' ' }), /reason must be a non-empty string/);
});

test('a limitation cannot be proposed as project knowledge, so it never reaches database.md', async () => {
  const { root, workId } = await investigation();
  await addLimitation(root, workId, LIMITATION);
  for (let i = 0; i < 6; i++) await advanceActiveWork(root, workId);
  await assert.rejects(
    () => proposeKnowledge(root, workId, { kind: 'database', source: 'implementation-runtime', summary: 'Production database schema was not inspected', evidence: ['schema.sql'] }),
    /recorded as discovery limitation DL-001/
  );
  const database = await readFile(path.join(workspacePath(root), 'context', 'database.md'), 'utf8');
  assert.doesNotMatch(database, /not inspected/);
});

test('limitations appear in handoff as work-scoped, not as project facts', async () => {
  const { root, workId } = await investigation();
  const add = run(root, ['limitation', 'add', workId, '--type', LIMITATION.type, '--area', LIMITATION.area, '--summary', LIMITATION.summary, '--reason', LIMITATION.reason]);
  assert.equal(add.status, 0, add.stderr);
  const handoff = run(root, ['handoff', workId]);
  assert.match(handoff.stdout, /Discovery limitations \(PF-0001, work-scoped — not project facts\):/);
  assert.match(handoff.stdout, /DL-001 \[runtime-unavailable\] database — Production database schema was not inspected\./);
});

test('a baseline records runtime-unavailable limitations for review but never promotes them', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-limit-baseline-'));
  await writeFile(path.join(root, 'schema.sql'), 'create table users(id int);\n');
  await initWorkspace(root, 'demo', 'brownfield');
  const { meta } = await startBaseline(root);
  await checkpointWork(root, meta.id, { skillId: 'repository-baseline', status: 'completed', summary: 'Discovered.', evidence: [] });
  await draftBaseline(root, meta.id, {
    facts: [{ area: 'database', status: 'confirmed', summary: 'MySQL schema is versioned in schema.sql.', evidence: ['schema.sql'], source: 'repository' }],
    limitations: [
      LIMITATION,
      { type: 'not-inspected', area: 'convention', summary: 'JS indentation was not sampled.', reason: 'Out of time-box.' }
    ]
  });
  const show = run(root, ['baseline', 'show', meta.id]);
  assert.match(show.stdout, /Discovery limitations \(what this baseline could not inspect/);
  assert.match(show.stdout, /DL-002 \[not-inspected\] convention — JS indentation was not sampled\./);

  await approveBaseline(root, meta.id);
  const { ledger } = await loadContextLedger(root);
  assert.deepEqual(ledger.facts.map((fact) => fact.summary), ['MySQL schema is versioned in schema.sql.']);
  const baseline = await loadBaseline(root, meta.id);
  assert.equal(baseline.ledger.limitations.length, 2); // still on the work record
  for (const relative of ['context/database.md', 'context/conventions.md']) {
    const content = await readFile(path.join(workspacePath(root), relative), 'utf8');
    assert.doesNotMatch(content, /not inspected|not sampled/);
  }
  const doctor = run(root, ['doctor']);
  assert.equal(doctor.status, 0, doctor.stdout);
});

test('a baseline fact may not restate one of its own discovery limitations', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-limit-baseline-'));
  await initWorkspace(root, 'demo', 'brownfield');
  const { meta } = await startBaseline(root);
  await checkpointWork(root, meta.id, { skillId: 'repository-baseline', status: 'completed', summary: 'Discovered.', evidence: [] });
  await assert.rejects(() => draftBaseline(root, meta.id, {
    facts: [{ area: 'convention', status: 'unresolved', summary: 'JS indentation was not sampled.', evidence: ['package.json'], source: 'repository' }],
    limitations: [{ type: 'not-inspected', area: 'convention', summary: 'JS indentation was not sampled.', reason: 'Out of time-box.' }]
  }), /repeats discovery limitation DL-001/);
});
