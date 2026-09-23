// v0.3.6 pre-freeze invariant: any state reachable through supported YallaFlow
// commands satisfies YallaFlow's own integrity rules (doctor). Previously an
// investigation could reach DONE — or complete its verification checkpoint — without
// the proof doctor requires.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { workspacePath } from '../src/core/workspace.js';
import { readYaml } from '../src/core/yaml.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));

function run(root, args, expectOk = true) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8' });
  if (expectOk) assert.equal(result.status, 0, `${args.join(' ')}: ${result.stderr || result.stdout}`);
  return result;
}

async function workspace() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-invest-'));
  run(root, ['init', '--type', 'greenfield']);
  return root;
}

// A routed investigation (the direct `investigate` command creates legacy,
// contract-less work that has no pinned verification checkpoint at all).
function create(root, [, question]) {
  const id = /Created (PF-\d+)/.exec(run(root, ['start', question]).stdout)[1];
  run(root, ['route', id, '--type', 'investigation', '--scope', 'bounded', '--confidence', 'high', '--reason', 'Read-only question.']);
  return id;
}

const PROOF = [process.execPath, '-e', 'process.exit(0)'];

test('investigation: DONE is consistently blocked until proof exists, then DONE and doctor is healthy', async () => {
  const root = await workspace();
  const id = create(root, ['investigate', 'Why does the nightly attendance export time out?']);
  run(root, ['checkpoint', id, '--skill', 'context-discovery', '--complete', '--summary', 'Located the export job.']);
  run(root, ['checkpoint', id, '--skill', 'systematic-debugging', '--complete', '--summary', 'Export does N+1 queries.', '--evidence', 'app/jobs/export.php']);
  for (let i = 0; i < 6; i++) run(root, ['advance', id]);
  run(root, ['knowledge', 'review', id, '--none']);

  // Attempt DONE while required proof is missing: advance, guide, and doctor agree.
  const blocked = run(root, ['advance', id], false);
  assert.notEqual(blocked.status, 0);
  assert.match(blocked.stderr, /Cannot transition to DONE until the verification checkpoint is completed\./);
  const guide = run(root, ['guide', id]);
  assert.match(guide.stdout, /BLOCKER:\nverification checkpoint is incomplete/);
  assert.match(guide.stdout, new RegExp(`NEXT VALID ACTION:\\nyallaflow verify ${id} -- <command>`));
  assert.match(run(root, ['doctor']).stdout, /Workspace healthy\./);

  // The checkpoint cannot be completed without evidence either, even though read-only.
  const noEvidence = run(root, ['checkpoint', id, '--skill', 'verification', '--complete', '--summary', 'Looks right.'], false);
  assert.notEqual(noEvidence.status, 0);
  assert.match(noEvidence.stderr, /Completing verification requires fresh successful evidence/);

  // Satisfy the required proof.
  run(root, ['verify', id, '--', ...PROOF]);
  run(root, ['checkpoint', id, '--skill', 'verification', '--complete', '--summary', 'Query log reproduces the N+1 pattern.']);
  assert.match(run(root, ['advance', id]).stdout, /CONCLUSION → DONE/);
  const meta = await readYaml(path.join(workspacePath(root), 'work', id, 'meta.yaml'));
  assert.equal(meta.status, 'DONE');
  const doctor = run(root, ['doctor']);
  assert.match(doctor.stdout, /Workspace healthy\./);
  assert.doesNotMatch(doctor.stdout, /FAIL/);
});

test('bug spike (read-only investigation workflow) follows the same DONE rule', async () => {
  const root = await workspace();
  const start = run(root, ['start', 'Diagnose intermittent queue latency']);
  const id = /Created (PF-\d+)/.exec(start.stdout)[1];
  run(root, ['route', id, '--type', 'bug', '--scope', 'spike', '--confidence', 'medium', '--reason', 'Diagnosis only.']);
  for (let i = 0; i < 6; i++) run(root, ['advance', id]);
  run(root, ['knowledge', 'review', id, '--none']);
  assert.notEqual(run(root, ['advance', id], false).status, 0);
  run(root, ['checkpoint', id, '--skill', 'context-discovery', '--complete', '--summary', 'ok']);
  run(root, ['checkpoint', id, '--skill', 'systematic-debugging', '--complete', '--summary', 'ok', '--evidence', 'logs/queue.log']);
  run(root, ['verify', id, '--', ...PROOF]);
  run(root, ['checkpoint', id, '--skill', 'verification', '--complete', '--summary', 'Reproduced.']);
  run(root, ['advance', id]);
  assert.match(run(root, ['doctor']).stdout, /Workspace healthy\./);
});

test('DONE feature work: verify is refused with the reopen path, and works after reopen', async () => {
  const root = await workspace();
  const id = /Created (PF-\d+)/.exec(run(root, ['start', 'Add CSV export']).stdout)[1];
  run(root, ['route', id, '--type', 'feature', '--scope', 'bounded', '--confidence', 'high', '--reason', 'Small.']);
  for (const skill of ['context-discovery', 'requirement-clarification']) run(root, ['checkpoint', id, '--skill', skill, '--complete', '--summary', 'ok']);
  for (let i = 0; i < 5; i++) run(root, ['advance', id]);
  run(root, ['checkpoint', id, '--skill', 'implementation', '--complete', '--summary', 'done']);
  run(root, ['advance', id]);
  run(root, ['verify', id, '--', ...PROOF]);
  run(root, ['checkpoint', id, '--skill', 'verification', '--complete', '--summary', 'ok']);
  run(root, ['knowledge', 'review', id, '--none']);
  run(root, ['advance', id]);
  const refused = run(root, ['verify', id, '--', ...PROOF], false);
  assert.match(refused.stderr, new RegExp(`yallaflow reopen ${id} --to verification`));
  run(root, ['reopen', id, '--to', 'verification', '--reason', 'Regression suspected.']);
  run(root, ['verify', id, '--', ...PROOF]);
  assert.match(run(root, ['doctor']).stdout, /Workspace healthy\./);
});

test('a failing verification after the checkpoint was completed reopens it instead of leaving an invalid state', async () => {
  const root = await workspace();
  const id = create(root, ['investigate', 'Confirm cache headers']);
  run(root, ['checkpoint', id, '--skill', 'context-discovery', '--complete', '--summary', 'ok']);
  run(root, ['checkpoint', id, '--skill', 'systematic-debugging', '--complete', '--summary', 'ok']);
  run(root, ['verify', id, '--', ...PROOF]);
  run(root, ['checkpoint', id, '--skill', 'verification', '--complete', '--summary', 'ok']);

  const failed = run(root, ['verify', id, '--', process.execPath, '-e', 'process.exit(3)'], false);
  assert.equal(failed.status, 1);
  assert.match(failed.stdout, /Verification checkpoint reopened \(in_progress\): Verification V-002 failed/);
  const progress = await readYaml(path.join(workspacePath(root), 'work', id, 'progress.yaml'));
  assert.equal(progress.skills.verification.status, 'in_progress');
  assert.equal(progress.history.at(-1).reason, 'Verification V-002 failed after the verification checkpoint was completed.');
  const runs = (await readYaml(path.join(workspacePath(root), 'work', id, 'evidence', 'verification.json'))).runs;
  assert.deepEqual(runs.map((entry) => entry.status), ['passed', 'failed']); // evidence stays append-only and honest
  assert.match(run(root, ['doctor']).stdout, /Workspace healthy\./);
});

test('verification on DONE work is refused and never appended to the closed history', async () => {
  const root = await workspace();
  const id = create(root, ['investigate', 'Check TLS config']);
  for (const skill of ['context-discovery', 'systematic-debugging']) run(root, ['checkpoint', id, '--skill', skill, '--complete', '--summary', 'ok']);
  run(root, ['verify', id, '--', ...PROOF]);
  run(root, ['checkpoint', id, '--skill', 'verification', '--complete', '--summary', 'ok']);
  for (let i = 0; i < 6; i++) run(root, ['advance', id]);
  run(root, ['knowledge', 'review', id, '--none']);
  run(root, ['advance', id]);

  const refused = run(root, ['verify', id, '--', process.execPath, '-e', 'process.exit(1)'], false);
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, new RegExp(`${id} is DONE and its investigation workflow cannot be reopened[\\s\\S]*new work item`));
  const runs = (await readYaml(path.join(workspacePath(root), 'work', id, 'evidence', 'verification.json'))).runs;
  assert.equal(runs.length, 1);
  assert.match(run(root, ['doctor']).stdout, /Workspace healthy\./);
});
