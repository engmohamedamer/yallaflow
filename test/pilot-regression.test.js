// Regression fixture for the Nice Day pilot failure mode (v0.3.3 milestone):
// DONE -> production issue discovered -> reopen -> implementation revised ->
// fresh verification appended -> code review -> knowledge re-review -> DONE again.
// Every step below goes through a public `yallaflow` CLI command; none of
// state/current.yaml, meta.yaml, or progress.yaml is hand-edited.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { initWorkspace, workspacePath } from '../src/core/workspace.js';
import { readYaml } from '../src/core/yaml.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));

function run(root, args) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, `\`yallaflow ${args.join(' ')}\` failed:\n${result.stderr || result.stdout}`);
  return result;
}

test('pilot regression: DONE -> reopen -> revise -> re-verify -> re-review -> DONE again, CLI-only', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-pilot-regression-'));
  await initWorkspace(root, 'nice-day', 'greenfield');

  run(root, ['start', 'Nice Day contract hub payment recording is inconsistent']);
  const stateAfterStart = await readYaml(path.join(workspacePath(root), 'state', 'current.yaml'));
  const workId = stateAfterStart.activeWork;

  run(root, ['route', workId, '--type', 'bug', '--scope', 'architectural', '--confidence', 'high', '--reason', 'Reported production defect in payment recording.']);

  run(root, ['checkpoint', workId, '--skill', 'context-discovery', '--complete', '--summary', 'Reviewed payment recording module.']);
  run(root, ['checkpoint', workId, '--skill', 'systematic-debugging', '--complete', '--summary', 'Confirmed root cause.', '--evidence', 'evidence/root-cause.txt']);
  run(root, ['checkpoint', workId, '--skill', 'implementation-planning', '--complete', '--summary', 'Planned the recording fix.']);
  for (let index = 0; index < 6; index++) run(root, ['advance']); // REPRODUCE..FIX_PLAN
  run(root, ['advance']); // -> IMPLEMENTATION
  run(root, ['checkpoint', workId, '--skill', 'implementation', '--complete', '--summary', 'Fixed the recording bug.']);
  run(root, ['advance']); // -> VERIFICATION
  run(root, ['verify', '--', 'true']);
  run(root, ['checkpoint', workId, '--skill', 'verification', '--complete', '--summary', 'Fix verified.']);
  run(root, ['checkpoint', workId, '--skill', 'code-review', '--complete', '--summary', 'Reviewed the initial fix.']);
  run(root, ['knowledge', 'review', workId, '--none']);
  const firstDone = run(root, ['advance']);
  assert.match(firstDone.stdout, /-> DONE|→ DONE/);

  let meta = await readYaml(path.join(workspacePath(root), 'work', workId, 'meta.yaml'));
  assert.equal(meta.status, 'DONE');
  assert.equal(meta.completionHistory.length, 1);

  // Production issue discovered after completion.
  const reopen = run(root, ['reopen', workId, '--to', 'implementation', '--reason', 'Production issue discovered after completion.']);
  assert.match(reopen.stdout, /DONE → IMPLEMENTATION/);

  meta = await readYaml(path.join(workspacePath(root), 'work', workId, 'meta.yaml'));
  assert.equal(meta.status, 'IMPLEMENTATION');
  assert.equal(meta.lifecycleHistory.length, 1);
  assert.equal(meta.lifecycleHistory[0].action, 'reopen');

  const state = await readYaml(path.join(workspacePath(root), 'state', 'current.yaml'));
  assert.equal(state.activeWork, workId);
  assert.equal(state.stage, 'IMPLEMENTATION');

  // Implementation revised (kept as in_progress by the reopen; a normal checkpoint
  // completion closes the new pass) and a fresh verification is appended.
  run(root, ['checkpoint', workId, '--skill', 'implementation', '--complete', '--summary', 'Applied the production fix.']);
  run(root, ['advance']); // -> VERIFICATION

  const listBeforeSecondVerify = run(root, ['verify', 'list', workId]);
  assert.match(listBeforeSecondVerify.stdout, /V-001/);

  run(root, ['verify', '--', 'true']);
  const listAfterSecondVerify = run(root, ['verify', 'list', workId]);
  assert.match(listAfterSecondVerify.stdout, /V-001/);
  assert.match(listAfterSecondVerify.stdout, /V-002/);

  run(root, ['checkpoint', workId, '--skill', 'verification', '--complete', '--summary', 'Production fix verified.']);

  // Code review and knowledge re-review before DONE again.
  run(root, ['checkpoint', workId, '--skill', 'code-review', '--complete', '--summary', 'Reviewed the production fix.']);
  run(root, ['knowledge', 'review', workId, '--none']);

  const secondDone = run(root, ['advance']);
  assert.match(secondDone.stdout, /-> DONE|→ DONE/);

  meta = await readYaml(path.join(workspacePath(root), 'work', workId, 'meta.yaml'));
  assert.equal(meta.status, 'DONE');
  assert.equal(meta.completionHistory.length, 2);
  assert.equal(meta.lifecycleHistory.length, 1);

  const doctor = spawnSync(process.execPath, [cli, 'doctor'], { cwd: root, encoding: 'utf8' });
  assert.equal(doctor.status, 0, doctor.stdout);
  assert.match(doctor.stdout, /Workspace healthy\./);
});
