// v1.1.0 compatibility: a workspace that used every new optional capability (ticket
// sources, QC, Smart Demo, qc: citations, registry-v9 work) stays readable by the real,
// frozen v1.0.1 CLI; a workspace that used none of them is unchanged in shape.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { frozenCli } from '../test-support/shared.js';
import { createdWork, freshProject, run, ticketFixture, writeJsonFile } from '../test-support/optional.js';

async function workspaceUsingEverything() {
  const root = await freshProject('yallaflow-v110-');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-v110-input-'));
  await writeFile(path.join(dir, 'shot.png'), Buffer.from('\u0089PNG-bytes'));
  const id = createdWork(run(root, ['intake', 'ticket', ticketFixture('github-gh.json'), '--provider', 'github']).stdout);
  run(root, ['route', id, '--type', 'feature', '--scope', 'bounded', '--confidence', 'high', '--reason', 'Ticket feature.']);
  run(root, ['checkpoint', id, '--skill', 'context-discovery', '--complete', '--summary', 'ok']);
  run(root, ['requirement', 'record', id, '--file', await writeJsonFile(dir, 'req.json', {
    requirements: [{ id: 'REQ-001', statement: 'Staff export the calendar.', provenance: [{ type: 'source', source: 'SRC-0001', locator: 'description' }] }],
    acceptanceCriteria: [{ id: 'AC-001', requirement: 'REQ-001', statement: 'The export downloads an ICS file.', provenance: [{ type: 'source', source: 'SRC-0001', locator: 'ac:1' }] }]
  })]);
  run(root, ['checkpoint', id, '--skill', 'requirement-clarification', '--complete', '--summary', 'ok']);
  for (let i = 0; i < 5; i++) run(root, ['advance', id], { ok: false });
  run(root, ['checkpoint', id, '--skill', 'implementation', '--complete', '--summary', 'done']);
  run(root, ['advance', id]);
  run(root, ['verify', id, '--', process.execPath, '-e', 'process.exit(0)']);
  run(root, ['checkpoint', id, '--skill', 'verification', '--complete', '--summary', 'ok']);
  run(root, ['qc', 'plan', id, '--file', await writeJsonFile(dir, 'plan.json', { scenarios: [{ id: 'S-01', kind: 'functional', title: 'Export', criteria: ['AC-001'] }] })]);
  run(root, ['qc', 'record', id, '--file', await writeJsonFile(dir, 'qc.json', { tool: 'playwright-cli', origin: 'agent-driven', scenarios: [{ id: 'S-01', status: 'passed', steps: ['Export'], artifacts: [path.join(dir, 'shot.png')] }] })]);
  run(root, ['demo', 'propose', id, '--file', await writeJsonFile(dir, 'scope.json', { scenarios: [{ id: 'D-01', title: 'Export', audience: 'business', priority: 1, rationale: 'Main flow.', steps: ['Export'] }] })]);
  run(root, ['demo', 'approve', id, '--note', 'Approved by the developer: "yes"']);
  run(root, ['demo', 'record', id, '--file', await writeJsonFile(dir, 'demo.json', { tool: 'playwright-cli', scenarios: [{ id: 'D-01', status: 'shown' }] })]);
  run(root, ['convergence', 'record', id, '--file', await writeJsonFile(dir, 'conv.json', {
    findings: [{ criterion: 'AC-001', status: 'satisfied', reason: 'Observed.', evidence: ['qc:QC-001#S-01', 'verification:V-001'] }]
  })]);
  run(root, ['checkpoint', id, '--skill', 'delivery-convergence', '--complete', '--summary', 'ok']);
  run(root, ['knowledge', 'review', id, '--none']);
  assert.match(run(root, ['advance', id]).stdout, /→ DONE/);
  return { root, id };
}

test('the frozen v1.0.1 CLI still reads a workspace that used tickets, QC, demos and qc: citations', async (t) => {
  const v101 = await frozenCli('v1.0.1');
  if (!v101) {
    if (process.env.CI) assert.fail('the v1.0.1 tag is required in CI (fetch tags)');
    return t.skip('v1.0.1 tag not available in this checkout');
  }
  const { root, id } = await workspaceUsingEverything();
  assert.equal(run(root, ['doctor']).status, 0, 'the 1.1.0 CLI reports the workspace healthy');
  for (const args of [['status'], ['brief'], ['guide', id], ['source', 'list'], ['source', 'show', 'SRC-0001'], ['convergence', 'status', id], ['requirement', 'list', id], ['handoff', id]]) {
    const result = v101(root, args);
    assert.equal(result.status, 0, `v1.0.1 ${args.join(' ')}:\n${result.stderr}`);
  }
  const doctor = v101(root, ['doctor']);
  assert.equal(doctor.status, 0, `v1.0.1 doctor:\n${doctor.stdout}`);
  assert.match(v101(root, ['convergence', 'show', id, 'AC-001']).stdout, /QC QC-001 S-01 passed/);
  // An older CLI simply does not know the optional commands; it never corrupts their state.
  assert.notEqual(v101(root, ['qc', 'status', id]).status, 0);
  assert.equal(run(root, ['doctor']).status, 0);
});

test('a workspace that never used the optional capabilities keeps the 1.0.x shape', async () => {
  const root = await freshProject('yallaflow-v110-plain-');
  const config = JSON.parse(await readFile(path.join(root, '.yallaflow', 'config.yaml'), 'utf8'));
  assert.equal(config.schemaVersion, 1);
  assert.deepEqual(Object.keys(config).sort(), ['interaction', 'project', 'quality', 'schemaVersion', 'workflow']);
  assert.deepEqual(Object.keys(config.quality), ['testingStrategy'], 'init writes no QC/demo/provider settings');
  const id = createdWork(run(root, ['start', 'Plain change']).stdout);
  run(root, ['route', id, '--type', 'change', '--scope', 'bounded', '--confidence', 'high', '--reason', 'Small.']);
  assert.ok(!(await readdir(path.join(root, '.yallaflow', 'work', id))).includes('quality'));
  assert.doesNotMatch(run(root, ['guide', id]).stdout, /qc|demo|ticket/i);
});
