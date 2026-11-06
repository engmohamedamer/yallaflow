// v1.2.0: the five Flow stations and the completion % are computed in Core (never in a
// UI), from the item's real workflow stages and checkpoints.
import test from 'node:test';
import assert from 'node:assert/strict';
import { WORKFLOWS } from '../src/core/workflows.js';
import { buildStations, completionOf, itemState, stationForStage, STATION_KEYS } from '../src/flow/stations.js';

const stagesOf = (workflow) => WORKFLOWS[workflow];
const statusOf = (flow) => Object.fromEntries(flow.stations.map((entry) => [entry.key, entry.status]));

test('every workflow stage except INTAKE and DONE maps to exactly one station', () => {
  for (const [workflow, stages] of Object.entries(WORKFLOWS)) {
    for (const stage of stages) {
      if (stage === 'INTAKE' || stage === 'DONE') assert.equal(stationForStage(stage), null, `${workflow}:${stage}`);
      else assert.ok(STATION_KEYS.includes(stationForStage(stage)), `${workflow}:${stage} has no station`);
    }
  }
});

test('a bug at ROOT_CAUSE: Understand done, Decide current with half of the step in progress', () => {
  const flow = buildStations({ workflow: 'bug', stages: stagesOf('bug'), stage: 'ROOT_CAUSE', state: 'active', contractSkills: ['verification'] });
  assert.deepEqual(statusOf(flow), { understand: 'done', decide: 'active', change: 'todo', verify: 'todo', remember: 'todo' });
  assert.equal(flow.currentStation, 'decide');
  // Understand 1 + Decide (HYPOTHESIS done + ROOT_CAUSE half) / 3 = 0.5 → 1.5 / 5 = 30%
  assert.equal(flow.completion, 30);
  const decide = flow.stations.find((entry) => entry.key === 'decide');
  assert.deepEqual(decide.steps.map((step) => `${step.id}:${step.status}`), ['HYPOTHESIS:done', 'ROOT_CAUSE:now', 'FIX_PLAN:todo']);
});

test('an investigation never changes code: Change is not applicable and counts in full', () => {
  const flow = buildStations({ workflow: 'investigation', stages: stagesOf('investigation'), stage: 'EVIDENCE', state: 'active' });
  assert.equal(statusOf(flow).change, 'na');
  // Understand (QUESTION, DISCOVERY done, EVIDENCE half) = 2.5/3; Change na = 1 → (0.8333 + 1) / 5 = 36.7%
  assert.equal(flow.completion, 37);
});

test('the final stage counts as finished once verification is complete; Remember becomes current', () => {
  const flow = buildStations({
    workflow: 'feature', stages: stagesOf('feature'), stage: 'VERIFICATION', state: 'active',
    contractSkills: ['verification'], ledgerSkills: { verification: { status: 'completed' } }
  });
  assert.equal(statusOf(flow).verify, 'done');
  assert.equal(flow.currentStation, 'remember');
  assert.equal(statusOf(flow).remember, 'active');
  assert.equal(flow.completion, 90);
});

test('pinned convergence and code-review are Verify steps', () => {
  const flow = buildStations({
    workflow: 'feature', stages: stagesOf('feature'), stage: 'VERIFICATION', state: 'active',
    contractSkills: ['verification', 'delivery-convergence', 'code-review'],
    ledgerSkills: { verification: { status: 'completed' }, 'delivery-convergence': { status: 'completed', completedAt: '2026-11-06T00:00:00.000Z' } }
  });
  const verify = flow.stations.find((entry) => entry.key === 'verify');
  assert.deepEqual(verify.steps.map((step) => `${step.id}:${step.status}`), ['VERIFICATION:done', 'delivery-convergence:done', 'code-review:todo']);
  assert.equal(flow.currentStation, 'verify');
  assert.equal(statusOf(flow).remember, 'todo');
});

test('DONE is 100% and every station is done; a new item is 0% with no current station', () => {
  const done = buildStations({ workflow: 'change', stages: stagesOf('change'), stage: 'DONE', state: 'done' });
  assert.equal(done.completion, 100);
  assert.ok(done.stations.every((entry) => entry.status === 'done'));
  const fresh = buildStations({ workflow: 'change', stages: stagesOf('change'), stage: 'INTAKE', state: 'new' });
  assert.equal(fresh.completion, 0);
  assert.equal(fresh.currentStation, null);
  assert.ok(fresh.stations.every((entry) => entry.status === 'todo'));
});

test('item state: a person is waited on before failure, activity, or pause', () => {
  const meta = { routingStatus: 'routed' };
  assert.equal(itemState({ meta: { routingStatus: 'pending' }, stage: null }), 'new');
  assert.equal(itemState({ meta, stage: 'INTAKE' }), 'new');
  assert.equal(itemState({ meta, stage: 'DONE' }), 'done');
  assert.equal(itemState({ meta, stage: 'SPEC', waitingForHuman: true, active: true }), 'you');
  assert.equal(itemState({ meta, stage: 'VERIFICATION', latestRunFailed: true, active: true }), 'fail');
  assert.equal(itemState({ meta, stage: 'IMPLEMENTATION', latestRunFailed: true, active: true }), 'active');
  assert.equal(itemState({ meta, stage: 'PLAN' }), 'paused');
});

test('completion formula is the documented arithmetic', () => {
  const stations = [
    { key: 'understand', status: 'done', steps: [] },
    { key: 'decide', status: 'active', steps: [{ status: 'done' }, { status: 'now' }, { status: 'todo' }, { status: 'todo' }] },
    { key: 'change', status: 'na', steps: [] },
    { key: 'verify', status: 'todo', steps: [{ status: 'todo' }] },
    { key: 'remember', status: 'todo', steps: [{ status: 'todo' }] }
  ];
  // 1 + (1 + 0.5)/4 + 1 = 2.375 / 5 = 47.5 → 48
  assert.equal(completionOf(stations, 'active'), 48);
});

test('refactor and release place their stages and compute completion', () => {
  const refactor = buildStations({ workflow: 'refactor', stages: stagesOf('refactor'), stage: 'PLAN', state: 'paused', contractSkills: ['verification'] });
  assert.deepEqual(statusOf(refactor), { understand: 'done', decide: 'paused', change: 'todo', verify: 'todo', remember: 'todo' });
  assert.equal(refactor.completion, 30); // 1 + 0.5 → 1.5 / 5
  const release = buildStations({ workflow: 'release', stages: stagesOf('release'), stage: 'EXECUTION', state: 'active', contractSkills: ['verification'] });
  assert.deepEqual(statusOf(release), { understand: 'done', decide: 'done', change: 'active', verify: 'todo', remember: 'todo' });
  assert.equal(release.completion, 50); // 2 + 0.5 → 2.5 / 5
  const change = buildStations({ workflow: 'change', stages: stagesOf('change'), stage: 'IMPACT_ANALYSIS', state: 'active', contractSkills: ['verification'] });
  assert.equal(change.currentStation, 'decide');
  assert.equal(change.completion, 23); // Understand 1 + Decide (IMPACT_ANALYSIS half of 3 steps) 0.1667 → 1.1667 / 5 = 23.3
});

test('evidence, not checkpoint flags, finishes Verify: stale runs or convergence keep it open', () => {
  const stages = WORKFLOWS.feature;
  const base = { workflow: 'feature', stages, stage: 'VERIFICATION', state: 'active', contractSkills: ['verification', 'delivery-convergence'], ledgerSkills: { verification: { status: 'completed' }, 'delivery-convergence': { status: 'completed' } }, knowledgeReviewed: true };
  for (const evidence of [{ freshRun: false, converged: true }, { freshRun: true, converged: false }]) {
    const flow = buildStations({ ...base, evidence });
    assert.equal(flow.currentStation, 'verify', JSON.stringify(evidence));
    assert.equal(statusOf(flow).remember, 'todo');
    assert.ok(flow.completion < 80);
  }
  const proven = buildStations({ ...base, evidence: { freshRun: true, converged: true } });
  assert.equal(proven.completion, 99, 'proven but not DONE never shows 100%');
  assert.equal(proven.currentStation, 'remember');
  assert.equal(buildStations({ ...base, evidence: { freshRun: false, converged: true }, state: 'fail' }).completion < 100, true);
});

test('a checkpoint reopened behind the current stage brings its station back', () => {
  const flow = buildStations({ workflow: 'feature', stages: WORKFLOWS.feature, stage: 'VERIFICATION', state: 'active', contractSkills: ['context-discovery', 'implementation', 'verification'], ledgerSkills: { 'context-discovery': { status: 'completed' }, implementation: { status: 'in_progress' } } });
  assert.equal(flow.currentStation, 'change');
  assert.ok(flow.stations.find((entry) => entry.key === 'change').steps.some((step) => step.id === 'implementation' && step.status === 'now'));
});

test('a decomposed parent shows its children as Change progress', () => {
  const flow = buildStations({ workflow: 'feature', stages: WORKFLOWS.feature, stage: 'IMPLEMENTATION', state: 'active', children: [{ id: 'PF-0002', status: 'done' }, { id: 'PF-0003', status: 'now' }, { id: 'PF-0004', status: 'todo' }] });
  const change = flow.stations.find((entry) => entry.key === 'change');
  assert.deepEqual(change.steps.map((step) => `${step.id}:${step.status}`), ['PF-0002:done', 'PF-0003:now', 'PF-0004:todo']);
  assert.equal(flow.completion, 50); // Understand + Decide + (1 + 0.5)/3 → 2.5 / 5
});
