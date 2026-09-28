// v0.3.7 realistic pilot (the YaSchools v0.3.5 → v0.3.6 → v0.3.7 upgrade class):
// v0.3.5-style legacy context + a v0.3.6 CTX ledger → reconciliation start →
// Agent-authored plan → preview → review → approve → apply → doctor healthy, with an
// ambiguous pair held back as a question and reconciled in a second round.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { workspacePath } from '../src/core/workspace.js';
import { loadContextLedger, factOrigins } from '../src/context/ledger.js';
import { normalizeStatement } from '../src/reconciliation/plan.js';
import { cli, snapshotWorkspace, writeDecisions, yaschoolsWorkspace } from '../test-support/legacy-context.js';

const PLAN = fileURLToPath(new URL('./fixtures/reconciliation/yaschools-decisions.json', import.meta.url));

test('pilot: upgraded YaSchools-style workspace reconciles into one clean, traceable current truth', async () => {
  const { root, baselineId, workId, currentWorkId } = await yaschoolsWorkspace();
  const base = workspacePath(root);

  // A human once edited one legacy section by hand.
  const architecture = path.join(base, 'context', 'architecture.md');
  await writeFile(architecture, (await readFile(architecture, 'utf8')).replace('- **Status:** confirmed', '- **Status:** confirmed — verified with the lead developer'));

  const history = async () => Object.fromEntries(Object.entries(await snapshotWorkspace(root)).filter(([file]) => [baselineId, workId, currentWorkId].some((id) => file.startsWith(`work/${id}/`))));
  const historyBefore = await history();

  assert.match(cli(root, ['upgrade', 'status']).stdout, /1 canonical current fact\(s\)[\s\S]*10 legacy fact\(s\) pending reconciliation[\s\S]*Recommended next action:\n  yallaflow context reconcile start/);
  assert.equal(cli(root, ['context', 'adopt'], false).status, 1, 'blind adoption is refused');

  const start = cli(root, ['context', 'reconcile', 'start']).stdout;
  const rid = /^(PF-\d+) — Legacy Context Reconciliation started/m.exec(start)[1];
  assert.match(cli(root, ['context', 'reconcile', 'show', rid, '--candidate', 'RC-0006']).stdout, /RC-0006 \[convention\] confirmed — PENDING\n  Root codeception\.yml enables only tests\/api and tests\/apps; common\/console\/backend\/frontend are commented out\./);

  // Agent: decisions from the plan fixture; the ambiguous tenant pair becomes a question.
  cli(root, ['context', 'reconcile', 'plan', rid, '--file', PLAN]);
  cli(root, ['question', 'add', rid, '--category', 'architecture', '--text', 'RC-0009 vs RC-0010: is the school resolved by subdomain, by the X-School header, or both?']);
  cli(root, ['checkpoint', rid, '--skill', 'context-reconciliation', '--complete', '--summary', '8 of 10 related; tenant resolution pair escalated as Q-001.']);

  const preview = cli(root, ['context', 'reconcile', 'preview', rid]).stdout;
  assert.match(preview, /10 legacy candidate\(s\) · 0 already applied · 8 to apply · 2 pending/);
  assert.match(preview, /4 canonical current fact\(s\) \(1 before\)/);
  assert.match(preview, /RC-0002 \+ RC-0005 \(reconfirms\) → CTX-0002 \[environment\] The Azure production pipeline has never executed Codeception tests/);
  assert.match(preview, /RC-0001 reconfirms CTX-0001 \(PF-0001 BF-001\)/);
  assert.match(preview, /RC-0006 merge-with RC-0001 → CTX-0001 \(PF-0002 K-002\)/);
  assert.match(preview, /RC-0008 → CTX-0005 \(supersedes RC-0007\)/);
  assert.match(preview, /kept: context\/architecture\.md <!-- yallaflow-baseline:PF-0001:BF-004 --> \(RC-0004\)/);

  // Human review: first a change request, then approval of the unchanged plan.
  cli(root, ['context', 'reconcile', 'feedback', rid, '--changes-requested', '--note', 'Explain the MySQL supersession.']);
  assert.equal(cli(root, ['context', 'reconcile', 'apply', rid], false).status, 1);
  cli(root, ['context', 'reconcile', 'approve', rid, '--note', 'Reviewed with the team.']);
  const apply = cli(root, ['context', 'reconcile', 'apply', rid]).stdout;
  assert.match(apply, /reconciliation applied: 8 candidate\(s\)/);
  assert.match(apply, /2 candidate\(s\) still pending/);

  // Round two: the human answers; the Agent records the relationship; re-review; apply.
  cli(root, ['question', 'answer', rid, '--id', 'Q-001', '--answer', 'Both: web apps use the subdomain, the API uses the X-School header. Separate facts.']);
  cli(root, ['question', 'resolve', rid, '--id', 'Q-001']);
  cli(root, ['context', 'reconcile', 'plan', rid, '--file', await writeDecisions(root, [
    { candidate: 'RC-0009', action: 'new', summary: 'Web apps resolve the current school from the request subdomain.' },
    { candidate: 'RC-0010', action: 'new', summary: 'The API resolves the current school from the X-School request header.' }
  ], 'round-two.json')]);
  cli(root, ['context', 'reconcile', 'approve', rid]);
  assert.match(cli(root, ['context', 'reconcile', 'apply', rid]).stdout, new RegExp(`All candidates reconciled; ${rid} is DONE`));

  // No work history rewritten.
  assert.deepEqual(await history(), historyBefore);

  // One clean current truth: no duplicate statements, every legacy origin on exactly one fact.
  const { ledger } = await loadContextLedger(root);
  const current = ledger.facts.filter((fact) => fact.state !== 'superseded');
  assert.equal(current.length, 6);
  assert.equal(new Set(current.map((fact) => normalizeStatement(fact.summary))).size, current.length);
  const codeception = current.filter((fact) => /codeception\.yml/i.test(fact.summary));
  assert.deepEqual(codeception.map((fact) => fact.id), ['CTX-0001'], 'the Codeception truth exists once');
  assert.deepEqual(factOrigins(codeception[0]).map((origin) => `${origin.workId} ${origin.candidateId ?? origin.baselineFactId}`), [`${currentWorkId} K-001`, `${baselineId} BF-001`, `${workId} K-002`]);
  assert.deepEqual(codeception[0].history.map((event) => event.action), ['introduced', 'reconfirmed', 'merged'], 'history keeps the chosen relationship');
  assert.equal(ledger.schemaVersion, 2);

  // Every origin traceable.
  const { plan } = JSON.parse(JSON.stringify({ plan: JSON.parse(await readFile(path.join(base, 'work', rid, 'reconciliation.yaml'), 'utf8')) }));
  for (const candidate of plan.candidates) {
    assert.ok(candidate.applied, `${candidate.id} applied`);
    if (['skip', 'limitation'].includes(candidate.decision.action)) continue;
    const fact = ledger.facts.find((entry) => entry.id === candidate.applied.factId);
    assert.ok(factOrigins(fact).some((origin) => origin.reconciliation?.candidate === candidate.id), `${candidate.id} traceable on ${fact.id}`);
  }
  assert.match(cli(root, ['context', 'history', 'CTX-0005']).stdout, /CTX-0004 \[superseded\] → CTX-0005 \[current\]/);
  assert.match(cli(root, ['limitation', 'list', rid]).stdout, /Composer lockfile versions were not inspected/);

  // Legacy history inspectable; manual content preserved; nothing presented twice.
  const archive = await readFile(path.join(base, 'work', rid, 'legacy-context.md'), 'utf8');
  for (const id of ['RC-0001', 'RC-0002', 'RC-0003', 'RC-0005', 'RC-0006', 'RC-0007', 'RC-0008', 'RC-0009', 'RC-0010']) assert.match(archive, new RegExp(`## ${id} — from`));
  assert.doesNotMatch(archive, /## RC-0004 — from/);
  assert.match(await readFile(architecture, 'utf8'), /verified with the lead developer/);
  for (const doc of ['conventions.md', 'environments.md', 'database.md', 'business-rules.md', 'tech-stack.md']) {
    assert.doesNotMatch(await readFile(path.join(base, 'context', doc), 'utf8'), /yallaflow-(baseline|knowledge):/, `${doc} shows only managed current facts`);
  }

  // Doctor healthy; the kept hand-edited section is the one thing a human must review.
  const doctor = cli(root, ['doctor']).stdout;
  assert.match(doctor, /Workspace healthy\./);
  assert.match(doctor, /WARN context\/architecture\.md: legacy section PF-0001 BF-004 was reconciled .* hand-edited/);
  assert.doesNotMatch(doctor, /not yet governed/);

  // A fresh Agent reads one clean current truth.
  const brief = cli(root, ['brief']).stdout;
  assert.doesNotMatch(brief, /Legacy context:/);
  assert.match(brief, /Project memory: 6 current/);
  assert.match(cli(root, ['upgrade', 'plan']).stdout, /Review hand-edited legacy sections kept after reconciliation/);
});
