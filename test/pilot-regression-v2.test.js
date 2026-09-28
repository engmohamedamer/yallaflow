// Regression fixture for the v0.3.4 milestone: the Nice Day pilot's "one giant
// architectural work item" failure mode. Exercises SPEC_READY -> review approval ->
// PLAN_READY -> review approval -> decomposition -> decomposition approval ->
// dependency-sequenced child execution -> agent handoff -> parent completion,
// entirely through public `yallaflow` CLI commands. No workspace YAML/JSON is
// hand-edited (the decomposition proposal file is an external input, exactly like an
// intake file — never workspace state).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { initWorkspace, workspacePath } from '../src/core/workspace.js';
import { readYaml } from '../src/core/yaml.js';
import { cliConvergeAll, cliRecordIntent } from '../test-support/delivery.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));

function run(root, args) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, `\`yallaflow ${args.join(' ')}\` failed:\n${result.stderr || result.stdout}`);
  return result;
}

async function completeBoundedFeatureChild(root, workId, assigned) {
  run(root, ['checkpoint', workId, '--skill', 'context-discovery', '--complete', '--summary', 'Discovered.']);
  run(root, ['checkpoint', workId, '--skill', 'requirement-clarification', '--complete', '--summary', 'Clarified.']);
  for (let index = 0; index < 5; index++) run(root, ['advance', workId]); // -> IMPLEMENTATION
  run(root, ['checkpoint', workId, '--skill', 'implementation', '--complete', '--summary', 'Implemented.']);
  run(root, ['advance', workId]); // -> VERIFICATION
  run(root, ['verify', workId, '--', 'true']);
  run(root, ['checkpoint', workId, '--skill', 'verification', '--complete', '--summary', 'Verified.']);
  // v0.3.8: the child answers for the parent's acceptance criteria assigned to it.
  await cliConvergeAll(root, workId, { criteria: assigned, run });
  run(root, ['knowledge', 'review', workId, '--none']);
  const result = run(root, ['advance', workId]); // -> DONE
  assert.match(result.stdout, /→ DONE/);
}

test('pilot regression v2: SPEC_READY -> review -> PLAN_READY -> review -> decomposition -> approval -> child execution -> handoff -> parent DONE', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-pilot-v2-'));
  await initWorkspace(root, 'nice-day', 'greenfield'); // default: adaptive mode

  const start = run(root, ['start', 'Nice Day Contract Hub — full Phase 1 project']);
  const workId = /^Created (PF-\d+)/.exec(start.stdout)[1];
  run(root, ['route', workId, '--type', 'feature', '--scope', 'architectural', '--confidence', 'high', '--reason', 'Large multi-feature project requiring decomposition.']);

  run(root, ['checkpoint', workId, '--skill', 'context-discovery', '--complete', '--summary', 'Discovered.']);
  run(root, ['advance', workId]); // -> DISCOVERY
  run(root, ['checkpoint', workId, '--skill', 'requirement-clarification', '--complete', '--summary', 'Clarified.']);
  run(root, ['advance', workId]); // -> CLARIFICATION
  run(root, ['checkpoint', workId, '--skill', 'design-exploration', '--complete', '--summary', 'Designed.']);
  run(root, ['advance', workId]); // -> DESIGN
  // v0.3.8: the specification's requirements and acceptance criteria get stable identity.
  const specification = (id, statement) => ({ id, statement, provenance: [{ type: 'specification', section: 'Functional requirements' }] });
  await cliRecordIntent(root, workId, {
    requirements: [specification('REQ-001', 'Staff authenticate.'), specification('REQ-002', 'Customers sign contracts.'), specification('REQ-003', 'Contracts are archived.')],
    acceptanceCriteria: [
      { ...specification('AC-001', 'Login succeeds with valid credentials.'), requirement: 'REQ-001' },
      { ...specification('AC-002', 'A signed contract is stored with its signature.'), requirement: 'REQ-002' },
      { ...specification('AC-003', 'An archived contract is read-only.'), requirement: 'REQ-003' }
    ]
  }, run);
  run(root, ['checkpoint', workId, '--skill', 'specification', '--complete', '--summary', 'Specified.']);
  run(root, ['advance', workId]); // -> SPECIFICATION (SPEC_READY)

  const blockedAtSpec = spawnSync(process.execPath, [cli, 'advance', workId], { cwd: root, encoding: 'utf8' });
  assert.equal(blockedAtSpec.status, 1);
  assert.match(blockedAtSpec.stderr, /specification review is awaiting_review/);
  run(root, ['approve', workId, '--stage', 'specification', '--note', 'Spec reviewed and approved.']);
  run(root, ['advance', workId]); // -> PLAN

  run(root, ['checkpoint', workId, '--skill', 'implementation-planning', '--complete', '--summary', 'Planned.']); // PLAN_READY
  const blockedAtPlan = spawnSync(process.execPath, [cli, 'advance', workId], { cwd: root, encoding: 'utf8' });
  assert.equal(blockedAtPlan.status, 1);
  assert.match(blockedAtPlan.stderr, /plan review is awaiting_review/);
  run(root, ['approve', workId, '--stage', 'plan', '--note', 'Plan reviewed and approved.']);

  const decompositionFile = path.join(root, 'decomposition.json');
  await writeFile(decompositionFile, JSON.stringify({
    children: [
      { key: 'foundation', title: 'Foundation & Authentication', type: 'feature', scope: 'bounded', required: true, requirements: ['REQ-001'], acceptanceCriteria: ['AC-001'] },
      { key: 'signing', title: 'Customer Signing', type: 'feature', scope: 'bounded', required: true, requirements: ['REQ-002'], acceptanceCriteria: ['PF-0001/AC-002'], dependsOn: ['foundation'] }
    ]
  }));
  run(root, ['decompose', 'propose', workId, '--file', 'decomposition.json']);
  run(root, ['decompose', 'validate', workId]);

  const blockedAtDecompose = spawnSync(process.execPath, [cli, 'decompose', 'execute', workId], { cwd: root, encoding: 'utf8' });
  assert.equal(blockedAtDecompose.status, 1);
  assert.match(blockedAtDecompose.stderr, /decomposition review is awaiting_review/);
  run(root, ['approve', workId, '--stage', 'decomposition', '--note', 'Decomposition approved.']);
  const execute = run(root, ['decompose', 'execute', workId]);
  assert.match(execute.stdout, /→ IMPLEMENTATION/);

  const { ledger: decomposition } = await import('../src/decomposition/store.js').then((m) => m.loadDecomposition(root, workId));
  const foundationId = decomposition.children.find((child) => child.key === 'foundation').workId;
  const signingId = decomposition.children.find((child) => child.key === 'signing').workId;

  const nextBefore = run(root, ['next', workId]);
  assert.match(nextBefore.stdout, new RegExp(foundationId));
  assert.doesNotMatch(nextBefore.stdout, new RegExp(signingId));

  const handoff = run(root, ['handoff', foundationId]);
  assert.match(handoff.stdout, new RegExp(`^${foundationId} —`));
  assert.match(handoff.stdout, new RegExp(`Parent: ${workId}`));

  await completeBoundedFeatureChild(root, foundationId, ['AC-001']);

  const nextAfter = run(root, ['next', workId]);
  assert.match(nextAfter.stdout, new RegExp(signingId));

  await completeBoundedFeatureChild(root, signingId, ['PF-0001/AC-002']);

  const progress = run(root, ['progress', workId]);
  assert.match(progress.stdout, /2 \/ 2 DONE/);

  run(root, ['advance', workId]); // IMPLEMENTATION -> VERIFICATION (all required children DONE)
  run(root, ['verify', workId, '--', 'true']);
  run(root, ['checkpoint', workId, '--skill', 'verification', '--complete', '--summary', 'Project-level verification passed.']);
  // Project-level convergence: the children's assessments prove what they were
  // assigned; the parent assesses the criterion no child owned (AC-003) itself.
  const convergenceFile = path.join(root, 'convergence.json');
  await writeFile(convergenceFile, JSON.stringify({ findings: [
    { criterion: 'AC-001', status: 'satisfied', reason: 'Delivered by the foundation child.', evidence: [`convergence:${foundationId}/CV-001`] },
    { criterion: 'AC-002', status: 'satisfied', reason: 'Delivered by the signing child.', evidence: [`convergence:${signingId}/CV-001`] },
    { criterion: 'AC-003', status: 'satisfied', reason: 'Archive is read-only.', evidence: ['runtime: archived contract edit refused'] }
  ] }));
  run(root, ['convergence', 'record', workId, '--file', 'convergence.json']);
  run(root, ['checkpoint', workId, '--skill', 'delivery-convergence', '--complete', '--summary', 'Project converged.']);
  run(root, ['checkpoint', workId, '--skill', 'code-review', '--complete', '--summary', 'Reviewed.']);
  run(root, ['knowledge', 'review', workId, '--none']);
  const finalDone = run(root, ['advance', workId]);
  assert.match(finalDone.stdout, /→ DONE/);

  const parentMeta = await readYaml(path.join(workspacePath(root), 'work', workId, 'meta.yaml'));
  assert.equal(parentMeta.status, 'DONE');

  const doctor = run(root, ['doctor']);
  assert.match(doctor.stdout, /Workspace healthy\./);
});
