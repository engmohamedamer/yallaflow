// v0.3.6 crash recovery: the ledger write is atomic, but ledger + Markdown projection
// are not one filesystem transaction. Failure injection: a managed-block begin marker
// with no end marker makes rendering fail *after* the ledger has been written.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { initWorkspace, workspacePath } from '../src/core/workspace.js';
import { createPendingIntake, routeWorkItem } from '../src/behavior/routing.js';
import { advanceActiveWork } from '../src/core/transitions.js';
import { checkpointWork } from '../src/core/progress.js';
import { loadWorkKnowledge, proposeKnowledge } from '../src/knowledge/store.js';
import { promoteKnowledge } from '../src/knowledge/promotion.js';
import { approveBaseline, draftBaseline, loadBaseline, startBaseline } from '../src/baseline/store.js';
import { loadContextLedger, validateContextLedger } from '../src/context/ledger.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const BROKEN = '<!-- yallaflow-context:begin -->\n';

function run(root, args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8' });
}

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-recover-'));
  await writeFile(path.join(root, 'db.yml'), 'replica: false\n');
  await initWorkspace(root, 'demo', 'brownfield');
  const pending = await createPendingIntake(root, 'Investigate');
  await routeWorkItem(root, pending.id, { work_type: 'investigation', scope: 'bounded', confidence: 'high', reason: 'Read-only.' });
  for (let i = 0; i < 6; i++) await advanceActiveWork(root, pending.id);
  return { root, workId: pending.id, doc: path.join(workspacePath(root), 'context', 'database.md') };
}

async function propose(root, workId, input) {
  return (await proposeKnowledge(root, workId, { kind: 'database', source: 'implementation-runtime', evidence: ['db.yml'], ...input })).candidate.id;
}

// A begin marker with no matching end marker: append one when the document has no
// managed block yet, otherwise strip the existing block's end marker.
async function injectFailure(doc) {
  const before = await readFile(doc, 'utf8');
  const END = '<!-- yallaflow-context:end -->';
  await writeFile(doc, before.includes(END) ? before.replace(END, '') : `${before}${BROKEN}`);
  return async () => writeFile(doc, before);
}

function fingerprint(ledger) {
  return ledger.facts.map((fact) => ({ id: fact.id, state: fact.state, supersedes: fact.supersedes, supersededBy: fact.supersededBy, history: fact.history.map((event) => event.action) }));
}

test('ledger commits although projection fails; doctor detects drift; render repairs; retry adds nothing', async () => {
  const { root, workId, doc } = await setup();
  const candidateId = await propose(root, workId, { summary: 'Read replica is configured but inactive.' });
  const restore = await injectFailure(doc);

  await assert.rejects(() => promoteKnowledge(root, workId, candidateId),
    /Project context ledger updated, but rendering the Markdown projection failed[\s\S]*Canonical knowledge .* is intact[\s\S]*yallaflow context render/);

  const { ledger } = await loadContextLedger(root);
  assert.deepEqual(validateContextLedger(ledger), []); // canonical knowledge valid
  assert.deepEqual(ledger.facts.map((fact) => [fact.id, fact.summary]), [['CTX-0001', 'Read replica is configured but inactive.']]);
  assert.equal((await loadWorkKnowledge(root, { id: workId, knowledgePolicy: { version: 1, reviewRequired: true } })).ledger.candidates[0].status, 'proposed');
  assert.deepEqual((await readdir(path.join(workspacePath(root), 'context'))).filter((name) => name.includes('.tmp')), []);

  const broken = run(root, ['doctor']);
  assert.equal(broken.status, 1);
  assert.match(broken.stdout, /context\/database\.md has a managed-block start marker without its end marker/);

  await restore(); // operator fixes the cause
  const drift = run(root, ['doctor']);
  assert.equal(drift.status, 1);
  assert.match(drift.stdout, /context\/database\.md is missing its managed project-context block \(1 ledger fact\(s\) not projected\)/);

  const render = run(root, ['context', 'render']);
  assert.equal(render.status, 0, render.stderr);
  assert.match(await readFile(doc, 'utf8'), /CTX-0001 — Read replica is configured but inactive\./);
  const repaired = await readFile(doc, 'utf8');
  assert.equal(run(root, ['context', 'render']).status, 0);
  assert.equal(await readFile(doc, 'utf8'), repaired); // deterministic, idempotent
  assert.equal(run(root, ['doctor']).status, 0);

  // Retrying the original command completes the candidate without a duplicate fact.
  const before = fingerprint((await loadContextLedger(root)).ledger);
  const retried = await promoteKnowledge(root, workId, candidateId);
  assert.equal(retried.candidate.factId, 'CTX-0001');
  assert.equal(retried.candidate.status, 'promoted');
  assert.deepEqual(fingerprint((await loadContextLedger(root)).ledger), before);
  assert.equal(run(root, ['doctor']).status, 0);
});

test('a failed supersede keeps full lineage; retry after repair creates no extra fact or history', async () => {
  const { root, workId, doc } = await setup();
  await promoteKnowledge(root, workId, await propose(root, workId, { summary: 'Read replica is configured but inactive.' }));
  const candidateId = await propose(root, workId, { summary: 'Read replica is active for reporting.', supersedes: 'CTX-0001' });
  const restore = await injectFailure(doc);
  await assert.rejects(() => promoteKnowledge(root, workId, candidateId), /rendering the Markdown projection failed/);

  const after = (await loadContextLedger(root)).ledger;
  assert.deepEqual(fingerprint(after), [
    { id: 'CTX-0001', state: 'superseded', supersedes: [], supersededBy: 'CTX-0002', history: ['introduced', 'superseded'] },
    { id: 'CTX-0002', state: 'current', supersedes: ['CTX-0001'], supersededBy: null, history: ['introduced'] }
  ]);

  await restore();
  // Retry directly (no manual render): it re-renders and finishes the candidate.
  const retried = await promoteKnowledge(root, workId, candidateId);
  assert.equal(retried.candidate.factId, 'CTX-0002');
  assert.deepEqual(fingerprint((await loadContextLedger(root)).ledger), fingerprint(after));
  const content = await readFile(doc, 'utf8');
  assert.doesNotMatch(content, /configured but inactive/);
  assert.match(content, /CTX-0002 — Read replica is active for reporting\./);
  assert.equal(run(root, ['doctor']).status, 0);
});

test('a failed reconfirm is not applied twice on retry', async () => {
  const { root, workId, doc } = await setup();
  await promoteKnowledge(root, workId, await propose(root, workId, { summary: 'Replica configured.' }));
  const candidateId = await propose(root, workId, { summary: 'Still configured.', reconfirms: 'CTX-0001' });
  const restore = await injectFailure(doc);
  await assert.rejects(() => promoteKnowledge(root, workId, candidateId), /rendering the Markdown projection failed/);
  await restore();
  await promoteKnowledge(root, workId, candidateId);
  const [fact] = (await loadContextLedger(root)).ledger.facts;
  assert.deepEqual(fact.history.map((event) => event.action), ['introduced', 'reconfirmed']);
});

test('a failed baseline approval keeps its facts; retry approves without duplicating them', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-recover-baseline-'));
  await writeFile(path.join(root, 'db.yml'), 'replica: false\n');
  await initWorkspace(root, 'demo', 'brownfield');
  const { meta } = await startBaseline(root);
  await checkpointWork(root, meta.id, { skillId: 'repository-baseline', status: 'completed', summary: 'Discovered.', evidence: [] });
  await draftBaseline(root, meta.id, { facts: [
    { area: 'database', status: 'confirmed', summary: 'Replica configured but inactive.', evidence: ['db.yml'], source: 'repository' },
    { area: 'architecture', status: 'inferred', summary: 'Monolith.', evidence: ['db.yml'], source: 'repository' }
  ] });
  const restore = await injectFailure(path.join(workspacePath(root), 'context', 'database.md'));
  await assert.rejects(() => approveBaseline(root, meta.id), /rendering the Markdown projection failed/);
  assert.equal((await loadBaseline(root, meta.id)).ledger.status, 'draft');
  assert.equal((await loadContextLedger(root)).ledger.facts.length, 2);

  await restore();
  await approveBaseline(root, meta.id);
  const { ledger } = await loadContextLedger(root);
  assert.deepEqual(ledger.facts.map((fact) => [fact.id, fact.origin.baselineFactId]), [['CTX-0001', 'BF-001'], ['CTX-0002', 'BF-002']]);
  assert.equal((await loadBaseline(root, meta.id)).ledger.status, 'approved');
  assert.match(await readFile(path.join(workspacePath(root), 'context', 'database.md'), 'utf8'), /CTX-0001/);
  assert.equal(run(root, ['doctor']).status, 0);
});
