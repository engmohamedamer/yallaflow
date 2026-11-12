// PF-0135: a Repository Baseline stays at stage INTAKE for its whole life. The console must
// follow the baseline's own steps: never a "new" request with a Start button, and a drafted
// baseline waits for the developer's approval (not for "advance" / "Continue").
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { initWorkspace } from '../src/core/workspace.js';
import { collectSnapshot } from '../src/flow/snapshot.js';
import { startBaseline, draftBaseline, feedbackBaseline, approveBaseline } from '../src/baseline/store.js';
import { BASELINE_FACTS, cli, writeTeamApp } from '../test-support/shared.js';

async function baselineProject() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yf-baseline-item-'));
  await writeTeamApp(root);
  await initWorkspace(root, 'Shop', 'brownfield', 'adaptive');
  const { meta } = await startBaseline(root);
  return { root, id: meta.id };
}
const itemOf = async (root, id) => (await collectSnapshot(root)).items.find((item) => item.id === id);
const understand = (item) => item.stations.find((station) => station.key === 'understand');

test('a baseline in discovery is in progress at Understand, not a new request at the gate', async () => {
  const { root, id } = await baselineProject();
  const item = await itemOf(root, id);
  assert.equal(item.stage, 'INTAKE');
  assert.equal(item.state, 'active');
  assert.equal(item.baselineStep, 'discovery');
  assert.equal(item.currentStation, 'understand');
  assert.equal(item.waitingFor, null);
  assert.doesNotMatch(item.nextAction, /yallaflow advance/);
  assert.deepEqual(understand(item).steps.map((step) => step.status), ['now', 'todo', 'todo']);
  assert.ok(item.stations.filter((station) => station.key !== 'understand').every((station) => station.status === 'na'));
});

test('a drafted baseline waits for the developer; approval finishes it', async () => {
  const { root, id } = await baselineProject();
  cli(root, ['checkpoint', id, '--skill', 'repository-baseline', '--complete', '--summary', 'Repository discovery complete.']);
  let item = await itemOf(root, id);
  assert.equal(item.baselineStep, 'draft');
  assert.match(item.nextAction, /baseline draft/);

  await draftBaseline(root, id, { facts: BASELINE_FACTS });
  item = await itemOf(root, id);
  assert.equal(item.state, 'you');
  assert.equal(item.baselineStep, 'awaiting-review');
  assert.deepEqual(item.waitingFor, { kind: 'baseline', action: `yallaflow baseline show ${id}` });
  assert.doesNotMatch(item.nextAction, /yallaflow advance/);
  assert.equal(item.blocker, null);
  assert.ok(item.completion > 50 && item.completion < 100);
  assert.deepEqual(understand(item).steps.map((step) => step.status), ['done', 'done', 'now']);
  assert.equal((await collectSnapshot(root)).counts.you, 1);

  await feedbackBaseline(root, id, 'Name the payment provider.');
  item = await itemOf(root, id);
  assert.equal(item.baselineStep, 'changes-requested');
  assert.equal(item.waitingFor, null);
  assert.notEqual(item.state, 'you');

  await draftBaseline(root, id, { facts: BASELINE_FACTS });
  await approveBaseline(root, id, 'Approved by the maintainer.');
  item = await itemOf(root, id);
  assert.equal(item.state, 'done');
  assert.equal(item.baselineStep, undefined);
  assert.equal(item.completion, 100);
});

test('the console offers an explicit approval for a drafted baseline and never "advance"', async () => {
  const app = await readFile(new URL('../resources/console/app.js', import.meta.url), 'utf8');
  assert.match(app, /waitingFor\?\.kind === 'baseline'\) return `<div class="aaction">[^\n]*data-agent-say="\$\{esc\(baselineApproveText\(it\)\)\}"/);
  assert.match(app, /if \(it\.waitingFor\?\.kind === 'baseline'\) return '';/, 'no whole-job draft while the draft awaits approval');
  assert.match(app, /it\.routing !== 'pending' && !it\.baselineStep\) list\.push\('advance'\)/);
  assert.match(app, /if \(it\.baselineStep\) return \{ ok: false, why:/, 'dragging a baseline between stations is refused');
});
