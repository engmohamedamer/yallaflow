// v0.3.6 GAP-WORKFLOW-001: guide/advance report CURRENT OBJECTIVE, BLOCKER, and the
// exact NEXT VALID ACTION from the same resolver advance enforces — read-only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { initWorkspace, workspacePath } from '../src/core/workspace.js';
import { exists } from '../src/utils/fs.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));

function run(root, args, expectOk = true) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8' });
  if (expectOk) assert.equal(result.status, 0, `${args.join(' ')}: ${result.stderr || result.stdout}`);
  return result;
}

async function boundedFeature(mode = 'adaptive') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-next-'));
  await initWorkspace(root, 'demo', 'greenfield', mode);
  const start = run(root, ['start', 'Add CSV export']);
  const id = /Created (PF-\d+)/.exec(start.stdout)[1];
  run(root, ['route', id, '--type', 'feature', '--scope', 'bounded', '--confidence', 'high', '--reason', 'Small.']);
  return { root, id };
}

test('guide reports an unblocked stage with advance as the next valid action', async () => {
  const { root, id } = await boundedFeature();
  const guide = run(root, ['guide', id]);
  assert.match(guide.stdout, /CURRENT OBJECTIVE:\n/);
  assert.match(guide.stdout, /BLOCKER:\nnone/);
  assert.match(guide.stdout, new RegExp(`NEXT VALID ACTION:\\nyallaflow advance ${id}`));
  assert.match(guide.stdout, /Advance to DISCOVERY allowed now: yes/);
});

test('guide names the exact checkpoint command when a checkpoint blocks the stage', async () => {
  const { root, id } = await boundedFeature();
  for (let i = 0; i < 4; i++) run(root, ['advance', id]);
  const plan = run(root, ['guide', id]);
  assert.match(plan.stdout, /Stage: PLAN/);
  assert.match(plan.stdout, /BLOCKER:\nrequired checkpoint\(s\) incomplete: context-discovery, requirement-clarification/);
  assert.match(plan.stdout, new RegExp(`NEXT VALID ACTION:\\nyallaflow checkpoint ${id} --skill context-discovery --complete --summary "\\.\\.\\."`));
  assert.match(plan.stdout, /allowed now: no/);

  for (const skill of ['context-discovery', 'requirement-clarification']) run(root, ['checkpoint', id, '--skill', skill, '--complete', '--summary', 'ok']);
  run(root, ['advance', id]);
  const implementation = run(root, ['guide', id]);
  assert.match(implementation.stdout, /Stage: IMPLEMENTATION/);
  assert.match(implementation.stdout, /BLOCKER:\nimplementation checkpoint is pending/);
  assert.match(implementation.stdout, new RegExp(`NEXT VALID ACTION:\\nyallaflow checkpoint ${id} --skill implementation --complete --summary`));
});

test('at the final boundary guide prefers argv verification and advance agrees', async () => {
  const { root, id } = await boundedFeature();
  for (const skill of ['context-discovery', 'requirement-clarification']) run(root, ['checkpoint', id, '--skill', skill, '--complete', '--summary', 'ok']);
  for (let i = 0; i < 5; i++) run(root, ['advance', id], false);
  run(root, ['checkpoint', id, '--skill', 'implementation', '--complete', '--summary', 'done']);
  run(root, ['advance', id]);
  const guide = run(root, ['guide', id]);
  assert.match(guide.stdout, /Stage: VERIFICATION/);
  assert.match(guide.stdout, /BLOCKER:\nverification checkpoint is pending/);
  assert.match(guide.stdout, new RegExp(`NEXT VALID ACTION:\\nyallaflow verify ${id} -- <command>`));
  const advance = run(root, ['advance', id], false);
  assert.notEqual(advance.status, 0);
  assert.match(advance.stderr, /verification checkpoint is pending/);
  assert.doesNotMatch(guide.stdout, /--shell/);
});

test('advance prints the next boundary after a successful transition', async () => {
  const { root, id } = await boundedFeature();
  const advance = run(root, ['advance', id]);
  assert.match(advance.stdout, new RegExp(`${id}: INTAKE → DISCOVERY`));
  assert.match(advance.stdout, new RegExp(`Next valid action: yallaflow advance ${id}`));
});

test('guide never requests a review gate (read-only); advance still does', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-next-gated-'));
  await initWorkspace(root, 'demo', 'greenfield', 'gated');
  const start = run(root, ['start', 'Big feature']);
  const id = /Created (PF-\d+)/.exec(start.stdout)[1];
  run(root, ['route', id, '--type', 'feature', '--scope', 'architectural', '--confidence', 'high', '--reason', 'Large.']);
  run(root, ['checkpoint', id, '--skill', 'context-discovery', '--complete', '--summary', 'ok']);
  const entered = run(root, ['advance', id]);
  assert.match(entered.stdout, new RegExp(`Next valid action: yallaflow approve ${id} --stage discovery`));
  const reviews = path.join(workspacePath(root), 'work', id, 'reviews.yaml');
  assert.equal(await exists(reviews), false);

  const guide = run(root, ['guide', id]);
  assert.match(guide.stdout, /Stage: DISCOVERY/);
  assert.match(guide.stdout, /BLOCKER:\ndiscovery review is/);
  assert.match(guide.stdout, new RegExp(`NEXT VALID ACTION:\\nyallaflow approve ${id} --stage discovery`));
  assert.equal(await exists(reviews), false);

  assert.notEqual(run(root, ['advance', id], false).status, 0);
  assert.match(await readFile(reviews, 'utf8'), /awaiting_review/);
});

test('guide on DONE work reports no further action', async () => {
  const { root, id } = await boundedFeature();
  for (const skill of ['context-discovery', 'requirement-clarification']) run(root, ['checkpoint', id, '--skill', skill, '--complete', '--summary', 'ok']);
  for (let i = 0; i < 5; i++) run(root, ['advance', id], false);
  run(root, ['checkpoint', id, '--skill', 'implementation', '--complete', '--summary', 'done']);
  run(root, ['advance', id]);
  run(root, ['verify', id, '--', process.execPath, '-e', 'process.exit(0)']);
  run(root, ['checkpoint', id, '--skill', 'verification', '--complete', '--summary', 'ok']);
  run(root, ['knowledge', 'review', id, '--none']);
  run(root, ['advance', id]);
  const guide = run(root, ['guide', id]);
  assert.match(guide.stdout, new RegExp(`NEXT VALID ACTION:\\nnone — ${id} is DONE\\.`));
});
