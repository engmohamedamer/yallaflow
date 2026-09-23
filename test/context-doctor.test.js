// v0.3.6 doctor / context integrity: structural corruption fails; freshness warns.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { initWorkspace, workspacePath } from '../src/core/workspace.js';
import { readYaml, writeYaml } from '../src/core/yaml.js';
import { createPendingIntake, routeWorkItem } from '../src/behavior/routing.js';
import { advanceActiveWork } from '../src/core/transitions.js';
import { proposeKnowledge } from '../src/knowledge/store.js';
import { promoteKnowledge } from '../src/knowledge/promotion.js';
import { contextLedgerPath, validateContextLedger } from '../src/context/ledger.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));

function doctor(root) {
  return spawnSync(process.execPath, [cli, 'doctor'], { cwd: root, encoding: 'utf8' });
}

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-ctx-doctor-'));
  await writeFile(path.join(root, 'db.yml'), 'replica: false\n');
  await initWorkspace(root, 'demo', 'brownfield');
  const pending = await createPendingIntake(root, 'Investigate');
  await routeWorkItem(root, pending.id, { work_type: 'investigation', scope: 'bounded', confidence: 'high', reason: 'Read-only.' });
  for (let i = 0; i < 6; i++) await advanceActiveWork(root, pending.id);
  for (const [summary, extra] of [['Replica configured but inactive.', {}], ['Replica active for reporting.', { supersedes: 'CTX-0001' }]]) {
    const { candidate } = await proposeKnowledge(root, pending.id, { kind: 'database', source: 'implementation-runtime', summary, evidence: ['db.yml'], ...extra });
    await promoteKnowledge(root, pending.id, candidate.id);
  }
  return { root, workId: pending.id };
}

async function editLedger(root, mutate) {
  const file = contextLedgerPath(root);
  const ledger = await readYaml(file);
  mutate(ledger);
  await writeYaml(file, ledger);
}

test('a healthy ledger passes doctor', async () => {
  const { root } = await setup();
  const result = doctor(root);
  assert.equal(result.status, 0, result.stdout);
  assert.match(result.stdout, /PASS project context ledger \(2 fact\(s\)\)/);
});

test('supersedes pointing at an unknown fact is an ERROR', async () => {
  const { root } = await setup();
  await editLedger(root, (ledger) => { ledger.facts[1].supersedes = ['CTX-9999']; });
  const result = doctor(root);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /FAIL context ledger: CTX-0002 supersedes unknown fact CTX-9999\./);
  assert.match(result.stdout, /CTX-0001 is marked superseded by CTX-0002, but CTX-0002 does not supersede it\./);
});

test('duplicate IDs, impossible states, and a superseded-yet-current fact are detected', async () => {
  const { root } = await setup();
  await editLedger(root, (ledger) => {
    ledger.facts[0].state = 'current'; // still has supersededBy
    ledger.facts.push({ ...ledger.facts[1] });
  });
  const result = doctor(root);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /duplicate context fact ID CTX-0002/);
  assert.match(result.stdout, /CTX-0001 is current but is marked superseded by CTX-0002/);
  assert.match(result.stdout, /CTX-0001 is superseded by CTX-0002 but its state is current/);
});

test('malformed evidence metadata and provenance are detected', async () => {
  const { root } = await setup();
  await editLedger(root, (ledger) => {
    ledger.facts[1].evidence = [{ type: 'repository', contentHash: 'md5:abc' }];
    ledger.facts[1].provenance = 'chat-memory';
  });
  const result = doctor(root);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /CTX-0002: repository evidence requires a path/);
  assert.match(result.stdout, /CTX-0002 has malformed provenance "chat-memory"/);
});

test('a disputed fact without a dispute record, and a missing origin work item, are detected', async () => {
  const { root } = await setup();
  await editLedger(root, (ledger) => {
    ledger.facts[1].state = 'disputed';
    ledger.facts[1].origin.workId = 'PF-0099';
  });
  const result = doctor(root);
  assert.match(result.stdout, /CTX-0002 is disputed but has no dispute record/);
  assert.match(result.stdout, /CTX-0002 originates from work item PF-0099, which does not exist/);
});

test('a superseded fact still rendered as current is projection drift', async () => {
  const { root } = await setup();
  const file = path.join(workspacePath(root), 'context', 'database.md');
  const content = await readFile(file, 'utf8');
  await writeFile(file, content.replace('<!-- yallaflow-context:end -->', '<!-- yallaflow-fact:CTX-0001 -->\n### CTX-0001 — Replica configured but inactive.\n<!-- yallaflow-context:end -->'));
  const result = doctor(root);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /still projects superseded fact CTX-0001 as current knowledge/);
  assert.match(result.stdout, /projection drift/);

  const render = spawnSync(process.execPath, [cli, 'context', 'render'], { cwd: root, encoding: 'utf8' });
  assert.equal(render.status, 0, render.stderr);
  assert.equal(doctor(root).status, 0);
});

test('human edits outside the managed block are not drift', async () => {
  const { root } = await setup();
  const file = path.join(workspacePath(root), 'context', 'database.md');
  await writeFile(file, `${await readFile(file, 'utf8')}\n## Team notes\n\nAsk the DBA before touching replicas.\n`);
  assert.equal(doctor(root).status, 0);
});

test('a discovery limitation promoted as a fact is detected', async () => {
  const { root, workId } = await setup();
  await writeYaml(path.join(workspacePath(root), 'work', workId, 'discovery.yaml'), {
    schemaVersion: 1,
    limitations: [{ id: 'DL-001', type: 'runtime-unavailable', area: 'database', summary: 'Replica active for reporting.', reason: 'x', recordedAt: '2026-09-01T00:00:00.000Z' }],
    updatedAt: '2026-09-01T00:00:00.000Z'
  });
  const result = doctor(root);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /CTX-0002 repeats discovery limitation PF-0001 DL-001/);
});

test('stale context is a warning, never structural corruption', async () => {
  const { root } = await setup();
  await writeFile(path.join(root, 'db.yml'), 'replica: true\n');
  const result = doctor(root);
  assert.equal(result.status, 0, result.stdout);
  assert.match(result.stdout, /WARN CTX-0002 may be stale because db\.yml changed since it was verified\./);
  assert.match(result.stdout, /Workspace healthy\./);
});

test('validateContextLedger detects supersession cycles', () => {
  const fact = (id, supersedes, supersededBy) => ({
    id, area: 'database', state: 'superseded', confidence: 'confirmed', summary: id, provenance: 'repository',
    origin: { workId: 'PF-0001' }, evidence: [{ type: 'reference', ref: 'x' }], verifiedAt: 'now', verifiedAtCommit: null,
    supersedes, supersededBy, history: [{ action: 'introduced', at: 'now' }], createdAt: 'now', updatedAt: 'now'
  });
  const errors = validateContextLedger({ schemaVersion: 1, facts: [fact('CTX-0001', ['CTX-0002'], 'CTX-0002'), fact('CTX-0002', ['CTX-0001'], 'CTX-0001')], updatedAt: 'now' });
  assert.ok(errors.some((entry) => /supersession cycle/.test(entry)));
});

test('mutations refuse to build on a corrupt ledger', async () => {
  const { root, workId } = await setup();
  await editLedger(root, (ledger) => { ledger.facts[1].supersedes = ['CTX-9999']; });
  const { candidate } = await proposeKnowledge(root, workId, { kind: 'database', source: 'implementation-runtime', summary: 'Another fact.', evidence: ['db.yml'] });
  await assert.rejects(() => promoteKnowledge(root, workId, candidate.id), /context ledger is invalid; refusing to modify it/);
});
