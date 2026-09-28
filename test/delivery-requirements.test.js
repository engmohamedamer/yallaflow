// v0.3.8 M2 — stable requirement and acceptance-criterion identity. The Agent
// proposes REQ-###/AC-### extracted from the approved intent; YallaFlow validates and
// records them in work/<id>/requirements.yaml, the single canonical record.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { cli } from '../test-support/legacy-context.js';
import { exists } from '../src/utils/fs.js';
import { workspacePath } from '../src/core/workspace.js';
import { recordRequirements, requirementsFilePath } from '../src/delivery/requirements.js';
import { convergenceRequired } from '../src/delivery/policy.js';
import { resolveWorkflowPolicy } from '../src/behavior/policy.js';
import { pinRegistryV4Contract } from '../test-support/delivery.js';
import { INTENT, complete, jsonFile, readJson, routed, workspace, workspaceHash } from '../test-support/delivery-fixtures.js';

test('policy: convergence is required exactly for feature (bounded, architectural) and change/architectural', () => {
  const requiring = [];
  for (const [type, scopes] of Object.entries({ feature: ['bounded', 'architectural'], bug: ['spike', 'bounded', 'architectural'], investigation: ['spike', 'bounded', 'architectural'], change: ['bounded', 'architectural'], refactor: ['bounded', 'architectural'], release: ['bounded', 'architectural'] })) {
    for (const scope of scopes) if (resolveWorkflowPolicy(type, scope).requiredCapabilities.includes('converge')) requiring.push(`${type}/${scope}`);
  }
  assert.deepEqual(requiring, ['feature/bounded', 'feature/architectural', 'change/architectural']);
});

test('AC-201: requirements are recorded with stable IDs, provenance, and history', async () => {
  const root = await workspace();
  const work = await routed(root, 'feature', 'bounded');
  const result = await recordRequirements(root, work.id, structuredClone(INTENT));
  assert.equal(result.ledger.revision, 1);
  assert.deepEqual(result.changes.map((change) => `${change.id} ${change.action}`), ['REQ-001 added', 'REQ-002 added', 'AC-001 added', 'AC-002 added', 'AC-003 added']);
  const stored = await readJson(root, work.id, 'requirements.yaml');
  assert.equal(stored.schemaVersion, 1);
  assert.deepEqual(stored.acceptanceCriteria.map((entry) => [entry.id, entry.requirement, entry.status]), [['AC-001', 'REQ-001', 'active'], ['AC-002', 'REQ-001', 'active'], ['AC-003', 'REQ-002', 'active']]);
  assert.ok(!('satisfied' in stored.acceptanceCriteria[0]) && !('convergence' in stored.acceptanceCriteria[0]), 'no implementation/convergence status is copied into requirements');
  const again = await recordRequirements(root, work.id, structuredClone(INTENT));
  assert.equal(again.unchanged, true, 'recording the same intent again is idempotent');
});

test('AC-201: duplicate IDs, bad formats, and unknown parents reject the whole file with zero mutation', async () => {
  const root = await workspace();
  const work = await routed(root, 'feature', 'bounded');
  const cases = [
    [{ requirements: [INTENT.requirements[0], INTENT.requirements[0]], acceptanceCriteria: [INTENT.acceptanceCriteria[0]] }, /REQ-001 appears more than once/],
    [{ requirements: [{ ...INTENT.requirements[0], id: 'R-1' }], acceptanceCriteria: [] }, /invalid id \(expected REQ-###\)/],
    [{ requirements: [INTENT.requirements[0]], acceptanceCriteria: [{ ...INTENT.acceptanceCriteria[0], requirement: 'REQ-999' }] }, /references unknown requirement "REQ-999"/],
    [{ requirements: [INTENT.requirements[0]] }, /active requirement REQ-001 has no active acceptance criterion/],
    [{ requirements: [{ ...INTENT.requirements[0], provenance: [] }], acceptanceCriteria: [INTENT.acceptanceCriteria[0]] }, /requires at least one provenance entry/],
    [{ requirements: [{ ...INTENT.requirements[0], provenance: [{ type: 'source', source: 'SRC-0009' }] }], acceptanceCriteria: [INTENT.acceptanceCriteria[0]] }, /source SRC-0009 is not linked to this work item/],
    [{ requirements: [{ ...INTENT.requirements[0], provenance: [{ type: 'question', question: 'Q-004' }] }], acceptanceCriteria: [INTENT.acceptanceCriteria[0]] }, /question Q-004 does not exist/],
    [{ requirements: [INTENT.requirements[0]], acceptanceCriteria: [INTENT.acceptanceCriteria[0]], extra: true }, /unknown field\(s\): extra/]
  ];
  for (const [input, pattern] of cases) {
    await assert.rejects(() => recordRequirements(root, work.id, structuredClone(input)), (error) => pattern.test(error.message) && /No files were changed/.test(error.message));
  }
  assert.equal(await exists(requirementsFilePath(root, work.id)), false);
});

test('AC-202: withdrawn/deferred need a reason, stay visible, and IDs are never removed', async () => {
  const root = await workspace();
  const work = await routed(root, 'feature', 'bounded');
  await recordRequirements(root, work.id, structuredClone(INTENT));
  await assert.rejects(() => recordRequirements(root, work.id, { acceptanceCriteria: [{ id: 'AC-002', status: 'withdrawn' }] }), /marking it withdrawn requires a reason/);
  await assert.rejects(
    () => recordRequirements(root, work.id, { requirements: [{ id: 'REQ-002', status: 'deferred', reason: 'Next release.' }] }),
    /active acceptance criterion AC-003 belongs to deferred requirement REQ-002/
  );
  await recordRequirements(root, work.id, { acceptanceCriteria: [{ id: 'AC-002', status: 'withdrawn', reason: 'Approval dropped by the product owner.' }] });
  // Omitting entries never deletes them.
  const result = await recordRequirements(root, work.id, { acceptanceCriteria: [{ id: 'AC-003', statement: 'The export is an ICS file for the current term.' }] });
  const ids = result.ledger.acceptanceCriteria.map((entry) => `${entry.id}:${entry.status}`);
  assert.deepEqual(ids, ['AC-001:active', 'AC-002:withdrawn', 'AC-003:active']);
  const revised = result.ledger.history.filter((entry) => entry.action === 'revised');
  assert.equal(revised.at(-1).previous.statement, 'The export is an ICS file.', 'the previous content stays in history');
  assert.equal(revised[0].reason, 'Approval dropped by the product owner.');
  const list = cli(root, ['requirement', 'list', work.id]).stdout;
  assert.match(list, /AC-002 \[withdrawn\] A refund requires manager approval\./);
  assert.match(list, /Acceptance criteria: 2 active \(1 withdrawn\)/);
});

test('AC-204: the intent checkpoint of a delivery-convergence contract requires acceptance criteria', async () => {
  const root = await workspace();
  const bounded = await routed(root, 'feature', 'bounded');
  await complete(root, bounded.id, 'context-discovery');
  await assert.rejects(() => complete(root, bounded.id, 'requirement-clarification'), /must carry structured acceptance criteria: no active acceptance criteria/);
  const architectural = await routed(root, 'feature', 'architectural');
  for (const skill of ['context-discovery', 'requirement-clarification', 'design-exploration']) await complete(root, architectural.id, skill);
  await assert.rejects(() => complete(root, architectural.id, 'specification'), /Cannot complete specification/);
  await recordRequirements(root, architectural.id, { requirements: [{ id: 'REQ-001', statement: 'Contracts can be signed.', provenance: [{ type: 'specification', section: 'Functional requirements' }] }], acceptanceCriteria: [{ id: 'AC-001', requirement: 'REQ-001', statement: 'A signature is stored.', provenance: [{ type: 'specification', section: 'Acceptance criteria' }] }] });
  await complete(root, architectural.id, 'specification');
  const changeArch = await routed(root, 'change', 'architectural');
  await complete(root, changeArch.id, 'context-discovery');
  await assert.rejects(() => complete(root, changeArch.id, 'requirement-clarification'), /structured acceptance criteria/);
});

test('AC-205: work without a delivery-convergence contract stays valid and cannot record requirements', async () => {
  const root = await workspace();
  for (const [type, scope] of [['bug', 'bounded'], ['change', 'bounded'], ['refactor', 'bounded'], ['release', 'bounded'], ['investigation', 'bounded']]) {
    const work = await routed(root, type, scope);
    assert.equal(convergenceRequired(work), false, `${type}/${scope}`);
    await assert.rejects(() => recordRequirements(root, work.id, structuredClone(INTENT)), /does not carry a delivery-convergence contract/);
    assert.match(cli(root, ['requirement', 'list', work.id]).stdout, /requirement identity and convergence do not apply/);
  }
  const bounded = await routed(root, 'change', 'bounded');
  await complete(root, bounded.id, 'context-discovery');
  await complete(root, bounded.id, 'requirement-clarification');
  const legacy = await routed(root, 'feature', 'bounded');
  await pinRegistryV4Contract(root, legacy.id);
  await complete(root, legacy.id, 'context-discovery');
  await complete(root, legacy.id, 'requirement-clarification');
  assert.match(cli(root, ['doctor']).stdout, /Workspace healthy\./);
});

test('AC-206: requirement/convergence/impact read commands never mutate', async () => {
  const root = await workspace();
  const work = await routed(root, 'feature', 'bounded');
  await recordRequirements(root, work.id, structuredClone(INTENT));
  const before = await workspaceHash(root);
  for (const args of [
    ['requirement', 'list', work.id], ['requirement', 'show', work.id, 'REQ-001'], ['requirement', 'show', work.id, 'AC-002'],
    ['convergence', 'status', work.id], ['convergence', 'show', work.id], ['impact', 'status', work.id],
    ['guide', work.id], ['resume', work.id], ['handoff', work.id], ['brief'], ['status'], ['doctor']
  ]) cli(root, args);
  assert.equal(await workspaceHash(root), before);
  const show = cli(root, ['requirement', 'show', work.id, 'REQ-001']).stdout;
  assert.match(show, /REQ-001 — Staff can refund a payment\./);
  assert.match(show, /Provenance:\n- the recorded raw request/);
  assert.match(show, /- AC-001 \[active\] A refund can be created\./);
  assert.match(cli(root, ['requirement', 'show', work.id, 'AC-099'], false).stderr, /AC-099 is not a requirement or acceptance criterion of PF-0001/);
});

test('record via CLI: invalid JSON and missing files are refused before anything is read into state', async () => {
  const root = await workspace();
  const work = await routed(root, 'feature', 'bounded');
  const bad = await jsonFile(root, 'bad.json', 'x');
  await (await import('node:fs/promises')).writeFile(bad, '{not json');
  assert.match(cli(root, ['requirement', 'record', work.id, '--file', 'bad.json'], false).stderr, /Requirements file is not valid JSON: bad\.json/);
  assert.match(cli(root, ['requirement', 'record', work.id, '--file', 'missing.json'], false).stderr, /Could not read requirements file: missing\.json/);
  assert.match(cli(root, ['requirement', 'record', work.id], false).stderr, /Usage: yallaflow requirement record <work-id> --file <requirements.json>/);
  await jsonFile(root, 'intent.json', INTENT);
  assert.match(cli(root, ['requirement', 'record', work.id, '--file', 'intent.json']).stdout, /requirements recorded \(revision 1\)/);
  assert.equal(await exists(path.join(workspacePath(root), 'work', work.id, 'requirements.yaml')), true);
});

test('recording requirements on DONE work is refused (history is immutable; controlled DONE fixture)', async () => {
  const root = await workspace();
  const work = await routed(root, 'feature', 'bounded');
  const file = path.join(workspacePath(root), 'work', work.id, 'meta.yaml');
  const fs = await import('node:fs/promises');
  const stored = JSON.parse(await fs.readFile(file, 'utf8'));
  await fs.writeFile(file, JSON.stringify({ ...stored, status: 'DONE' }));
  await assert.rejects(() => recordRequirements(root, work.id, structuredClone(INTENT)), /is DONE; its approved intent is history\. Reopen the work/);
});
