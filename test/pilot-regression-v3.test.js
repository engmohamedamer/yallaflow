// v0.3.5 human-pilot regression scenarios (PART 22). Every step goes through a public
// `yallaflow` CLI command; nothing under .yallaflow is hand-edited.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { workspacePath } from '../src/core/workspace.js';
import { MINIMAL_INTENT, cliConvergeAll, cliRecordIntent } from '../test-support/delivery.js';
import { readYaml } from '../src/core/yaml.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));

function run(root, args) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, `\`yallaflow ${args.join(' ')}\` failed:\n${result.stderr || result.stdout}`);
  return result;
}

test('Scenario A — Brownfield: undocumented repo -> baseline -> changes requested -> approved -> new bounded feature -> DONE', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-pilot-a-'));
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'nice-day', dependencies: { vue: '^3.0.0' } }), 'utf8');

  const init = run(root, ['init']);
  assert.match(init.stdout, /Project kind: brownfield/);
  const techStackBefore = await readFile(path.join(workspacePath(root), 'context', 'tech-stack.md'), 'utf8');
  assert.match(techStackBefore, /Node\.js \/ JavaScript or TypeScript/);

  const baselineStart = run(root, ['baseline', 'start']);
  const baselineId = /^(PF-\d+)/.exec(baselineStart.stdout)[1];
  run(root, ['checkpoint', baselineId, '--skill', 'repository-baseline', '--complete', '--summary', 'Repository discovered.']);

  await writeFile(path.join(root, 'baseline.json'), JSON.stringify({
    facts: [{ area: 'tech-stack', status: 'confirmed', summary: 'Vue 3 frontend.', evidence: ['package.json'], source: 'repository' }]
  }), 'utf8');
  run(root, ['baseline', 'draft', baselineId, '--file', 'baseline.json']);

  const changesRequested = run(root, ['baseline', 'feedback', baselineId, '--changes-requested', '--note', 'Add database evidence too.']);
  assert.match(changesRequested.stdout, /changes requested/);

  await writeFile(path.join(root, 'baseline.json'), JSON.stringify({
    facts: [
      { area: 'tech-stack', status: 'confirmed', summary: 'Vue 3 frontend.', evidence: ['package.json'], source: 'repository' },
      { area: 'database', status: 'unresolved', summary: 'Database engine cannot be established from this repository.', evidence: ['package.json'], source: 'repository' }
    ]
  }), 'utf8');
  run(root, ['baseline', 'draft', baselineId, '--file', 'baseline.json']);
  run(root, ['baseline', 'approve', baselineId, '--note', 'Looks complete now.']);

  const techStackAfter = await readFile(path.join(workspacePath(root), 'context', 'tech-stack.md'), 'utf8');
  assert.match(techStackAfter, /Node\.js \/ JavaScript or TypeScript/); // deterministic content preserved
  assert.match(techStackAfter, /Vue 3 frontend\./); // baseline fact promoted
  const database = await readFile(path.join(workspacePath(root), 'context', 'database.md'), 'utf8');
  assert.match(database, /Database engine cannot be established/);

  // A fresh work item now benefits from durable context instead of rediscovery.
  const start = run(root, ['start', 'Add dark mode toggle']);
  const featureId = /^Created (PF-\d+)/.exec(start.stdout)[1];
  run(root, ['route', featureId, '--type', 'feature', '--scope', 'bounded', '--confidence', 'high', '--reason', 'Small, bounded UI addition.']);
  run(root, ['checkpoint', featureId, '--skill', 'context-discovery', '--complete', '--summary', 'Reused durable tech-stack context.']);
  await cliRecordIntent(root, featureId, MINIMAL_INTENT, run);
  run(root, ['checkpoint', featureId, '--skill', 'requirement-clarification', '--complete', '--summary', 'No open questions.']);
  for (let i = 0; i < 5; i++) run(root, ['advance', featureId]);
  run(root, ['checkpoint', featureId, '--skill', 'implementation', '--complete', '--summary', 'Implemented toggle.']);
  run(root, ['advance', featureId]);
  run(root, ['verify', featureId, '--', 'true']);
  run(root, ['checkpoint', featureId, '--skill', 'verification', '--complete', '--summary', 'Verified.']);
  await cliConvergeAll(root, featureId, { run });
  run(root, ['knowledge', 'review', featureId, '--none']);
  const done = run(root, ['advance', featureId]);
  assert.match(done.stdout, /→ DONE/);

  const doctor = run(root, ['doctor']);
  assert.match(doctor.stdout, /Workspace healthy\./);
});

test('Scenario B — Intake accident: start --help creates nothing; pending request corrected, then routed normally', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-pilot-b-'));
  run(root, ['init']);

  const help = run(root, ['start', '--help']);
  assert.match(help.stdout, /Usage:/);
  const statusAfterHelp = run(root, ['status']);
  assert.match(statusAfterHelp.stdout, /Work items: 0/);

  const start = run(root, ['start', '--help']); // simulates the exact accidental literal request
  assert.match(start.stdout, /Usage:/);
  const statusStillZero = run(root, ['status']);
  assert.match(statusStillZero.stdout, /Work items: 0/);

  const accidental = run(root, ['start', 'oops this was meant as help text']);
  const workId = /^Created (PF-\d+)/.exec(accidental.stdout)[1];
  const revise = run(root, ['request', 'revise', workId, '--text', 'Add refund summary to revenue dashboard', '--reason', 'Original request text was wrong.']);
  assert.match(revise.stdout, /request revised/);

  const route = run(root, ['route', workId, '--type', 'feature', '--scope', 'bounded', '--confidence', 'high', '--reason', 'Clear bounded UI addition.']);
  assert.match(route.stdout, /^Routed PF-\d+/);
  const meta = await readYaml(path.join(workspacePath(root), 'work', workId, 'meta.yaml'));
  assert.equal(meta.rawRequest, 'Add refund summary to revenue dashboard');
  assert.equal(meta.routingStatus, 'routed');
});

test('Scenario C — Verify: argv, shell pipeline, script, failed, then successful, full history preserved', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-pilot-c-'));
  run(root, ['init']);
  const feature = run(root, ['feature', 'Verify scenario fixture', '--scope', 'bounded']);
  const workId = /^Created (PF-\d+)/.exec(feature.stdout)[1];

  run(root, ['verify', workId, '--', 'node', '--version']);
  run(root, ['verify', workId, '--shell', 'echo one two | grep two']);
  await writeFile(path.join(root, 'check.sh'), '#!/bin/sh\nexit 0\n', 'utf8');
  await (await import('node:fs/promises')).chmod(path.join(root, 'check.sh'), 0o755);
  run(root, ['verify', workId, '--script', 'check.sh']);
  const failing = spawnSync(process.execPath, [cli, 'verify', workId, '--', 'false'], { cwd: root, encoding: 'utf8' });
  assert.equal(failing.status, 1);
  run(root, ['verify', workId, '--', 'true']);

  const list = run(root, ['verify', 'list', workId]);
  for (const [id, mode, status] of [['V-001', 'argv', 'PASSED'], ['V-002', 'shell', 'PASSED'], ['V-003', 'script', 'PASSED'], ['V-004', 'argv', 'FAILED'], ['V-005', 'argv', 'PASSED']]) {
    assert.match(list.stdout, new RegExp(`${id} — ${status} \\[${mode}\\]`));
  }
});

test('Scenario D — Reopen/Handoff: DONE -> reopen for a specific defect -> handoff shows primary objective -> fix -> fresh verify -> DONE', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-pilot-d-'));
  run(root, ['init']);
  const start = run(root, ['start', 'Cancellation lifecycle defect']);
  const workId = /^Created (PF-\d+)/.exec(start.stdout)[1];
  run(root, ['route', workId, '--type', 'bug', '--scope', 'bounded', '--confidence', 'high', '--reason', 'Confirmed defect in cancellation lifecycle.']);
  run(root, ['checkpoint', workId, '--skill', 'context-discovery', '--complete', '--summary', 'Reviewed cancellation flow.']);
  run(root, ['checkpoint', workId, '--skill', 'systematic-debugging', '--complete', '--summary', 'Root cause confirmed.', '--evidence', 'evidence/root-cause.txt']);
  for (let i = 0; i < 7; i++) run(root, ['advance', workId]);
  run(root, ['checkpoint', workId, '--skill', 'implementation', '--complete', '--summary', 'Initial fix.']);
  run(root, ['advance', workId]);
  run(root, ['verify', workId, '--', 'true']);
  run(root, ['checkpoint', workId, '--skill', 'verification', '--complete', '--summary', 'Verified.']);
  run(root, ['knowledge', 'review', workId, '--none']);
  const firstDone = run(root, ['advance', workId]);
  assert.match(firstDone.stdout, /→ DONE/);

  const reopen = run(root, [
    'reopen', workId, '--to', 'implementation',
    '--reason', 'Cancellation lifecycle is unreachable and signed-version preservation must be verified.'
  ]);
  assert.match(reopen.stdout, /DONE → IMPLEMENTATION/);

  const handoff = run(root, ['handoff', workId]);
  assert.match(handoff.stdout, /PRIMARY UNRESOLVED OBJECTIVE:/);
  assert.match(handoff.stdout, /Cancellation lifecycle is unreachable and signed-version preservation must be verified\./);

  run(root, ['checkpoint', workId, '--skill', 'implementation', '--complete', '--summary', 'Cancellation lifecycle fixed; signed-version preservation covered.']);
  run(root, ['advance', workId]);
  run(root, ['verify', workId, '--', 'true']);
  run(root, ['checkpoint', workId, '--skill', 'verification', '--complete', '--summary', 'Fresh verification passed.']);
  run(root, ['knowledge', 'review', workId, '--none']);
  const secondDone = run(root, ['advance', workId]);
  assert.match(secondDone.stdout, /→ DONE/);

  const doctor = run(root, ['doctor']);
  assert.match(doctor.stdout, /Workspace healthy\./);
});
