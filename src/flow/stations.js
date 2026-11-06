// The five Flow stations (v1.2.0): a display grouping of every workflow's real stages,
// computed here — never in a UI — so the Console, scripts, and agents read one
// deterministic answer. The real stage names stay visible as each station's steps.
//
//   Understand → Decide → Change → Verify → Remember
//
// Completion is honest arithmetic, not an estimate: each station is 20%; a finished or
// non-applicable station counts in full; the current station counts its finished steps
// plus half of the step in progress, divided by its steps.

export const STATION_KEYS = Object.freeze(['understand', 'decide', 'change', 'verify', 'remember']);

const STAGE_STATION = Object.freeze({
  DISCOVERY: 'understand',
  CLARIFICATION: 'understand',
  QUESTION: 'understand',
  REPRODUCE: 'understand',
  EVIDENCE: 'understand',
  TRACE: 'understand',
  CURRENT_BEHAVIOR: 'understand',
  REQUESTED_DELTA: 'understand',
  BEHAVIOR_BASELINE: 'understand',
  PRECHECK: 'understand',
  DESIGN: 'decide',
  SPEC: 'decide',
  SPECIFICATION: 'decide',
  PLAN: 'decide',
  HYPOTHESIS: 'decide',
  ROOT_CAUSE: 'decide',
  FIX_PLAN: 'decide',
  IMPACT_ANALYSIS: 'decide',
  ACCEPTANCE_CRITERIA: 'decide',
  FINDINGS: 'decide',
  IMPLEMENTATION: 'change',
  EXECUTION: 'change',
  VERIFICATION: 'verify',
  CONCLUSION: 'verify'
});

// Checkpoints that live inside the Verify station after its stage (when pinned).
const VERIFY_CHECKPOINTS = Object.freeze(['delivery-convergence', 'code-review']);

export function stationForStage(stage) {
  return STAGE_STATION[stage] ?? null;
}

// The station a checkpoint (skill) belongs to — used to say what each station handed
// off (its checkpoint summaries) in `work show`.
const SKILL_STATION = Object.freeze({
  'context-discovery': 'understand',
  'requirement-clarification': 'understand',
  'repository-baseline': 'understand',
  'design-exploration': 'decide',
  specification: 'decide',
  'implementation-planning': 'decide',
  'systematic-debugging': 'decide',
  implementation: 'change',
  verification: 'verify',
  'delivery-convergence': 'verify',
  'code-review': 'verify'
});

export function stationForSkill(skillId) {
  return SKILL_STATION[skillId] ?? null;
}

// Item state, in the Flow vocabulary:
//   new     — not yet routed, or still at INTAKE (the "New" gate)
//   done    — DONE
//   you     — waiting on a person (a human review gate or an open material question)
//   fail    — at a verify stage and the latest verification run failed
//   active  — the workspace's active work item (this checkout)
//   paused  — routed and in progress, but not the active item and not waiting on a person
export function itemState({ meta, stage, waitingForHuman, latestRunFailed, active }) {
  if (meta.routingStatus === 'pending' || stage === 'INTAKE' || !stage) return 'new';
  if (stage === 'DONE') return 'done';
  if (waitingForHuman) return 'you';
  if (latestRunFailed && stationForStage(stage) === 'verify') return 'fail';
  if (active) return 'active';
  return 'paused';
}

// stages: the item's full workflow stage list (workflowStagesFor(meta)), including
// INTAKE and DONE. ledgerSkills: progress.yaml `skills` map. knowledgeReviewed: the
// knowledge ledger's reviewStatus === 'reviewed'. state: itemState(...).
// evidence: { freshRun, converged } — Verify (and so Remember) is finished only with a
//   fresh successful verification run (not predating a reopen/revision) and, where
//   convergence is required, a currently converged assessment. A checkpoint flag alone
//   never proves work.
// children: a decomposed parent's children ([{ id, status: done|now|todo }]); its
//   Change station is their progress (implementation = every required child DONE).
// Nothing short of DONE reaches 100%: DONE is Core's verdict, not this arithmetic.
export function buildStations({ workflow, stages, stage, ledgerSkills = {}, contractSkills = [], knowledgeReviewed = false, state, evidence = { freshRun: true, converged: true }, children = null }) {
  const done = stage === 'DONE';
  const currentIndex = stages.indexOf(stage);
  const steps = new Map(STATION_KEYS.map((key) => [key, []]));

  // The final stage before DONE (VERIFICATION, CONCLUSION) does not move until DONE, so
  // it counts as finished once its verification checkpoint is complete.
  const finalStage = stages[stages.length - 2];
  const verified = !contractSkills.includes('verification') || ledgerSkills.verification?.status === 'completed';
  const proven = verified && evidence.freshRun !== false && evidence.converged !== false;
  stages.forEach((name, index) => {
    const key = stationForStage(name);
    if (!key) return; // INTAKE (the New gate) and DONE (the Done line) are not stations
    const finishedFinal = name === finalStage && index === currentIndex && contractSkills.includes('verification') && proven;
    const status = done || finishedFinal || (currentIndex >= 0 && index < currentIndex) ? 'done' : index === currentIndex ? 'now' : 'todo';
    steps.get(key).push({ id: name, kind: 'stage', status });
  });

  if (Array.isArray(children) && children.length) {
    steps.set('change', children.map((child) => ({ id: child.id, kind: 'child', status: done ? 'done' : child.status })));
  }

  // A checkpoint that is not complete although its station's stages are behind the work
  // (revised, reopened, or reopened by an impact assessment) brings that station back.
  for (const skill of contractSkills) {
    const key = stationForSkill(skill);
    if (done || !key || key === 'verify' || (key === 'change' && children?.length)) continue;
    if (ledgerSkills[skill]?.status === 'completed') continue;
    const list = steps.get(key);
    if (list.length && list.every((step) => step.status === 'done')) list.push({ id: skill, kind: 'checkpoint', status: 'now' });
  }

  const verifyNow = !done && stationForStage(stage) === 'verify';
  for (const skill of VERIFY_CHECKPOINTS) {
    if (!contractSkills.includes(skill)) continue;
    const recorded = ledgerSkills[skill]?.status;
    const settled = recorded === 'completed' && (skill !== 'delivery-convergence' || evidence.converged !== false);
    const status = done || settled ? 'done' : verifyNow && (['in_progress', 'blocked'].includes(recorded) || recorded === 'completed') ? 'now' : 'todo';
    steps.get('verify').push({ id: skill, kind: 'checkpoint', status, ...(ledgerSkills[skill]?.completedAt ? { at: ledgerSkills[skill].completedAt } : {}) });
  }

  // Remember: the knowledge review. It is "now" once the work reaches its final stage
  // with the verification checkpoint (or the stage itself) behind it.
  const atFinal = !done && stage === finalStage;
  steps.get('remember').push({
    id: 'KNOWLEDGE',
    kind: 'knowledge',
    status: done || (knowledgeReviewed && proven) ? 'done' : atFinal && proven ? 'now' : 'todo'
  });

  const stations = STATION_KEYS.map((key) => {
    const list = steps.get(key);
    if (!list.length) return { key, status: 'na', steps: [] };
    return { key, status: stationStatus(list, state), steps: list };
  });
  // A step can only be "now" in one station: the earliest station that still has work.
  const current = stations.findIndex((entry) => entry.status !== 'done' && entry.status !== 'na');
  stations.forEach((entry, index) => {
    if (index > current && current >= 0 && entry.status !== 'na') {
      entry.status = 'todo';
      entry.steps = entry.steps.map((step) => (step.status === 'now' ? { ...step, status: 'todo' } : step));
    }
  });
  if (state === 'new') stations.forEach((entry) => { if (entry.status !== 'na') entry.status = 'todo'; });
  // Every station finished but the work is not DONE yet (it still has to be advanced or
  // finished): it stands at the last station, never back at the New gate.
  const currentStation = state === 'new' || state === 'done' ? null : current < 0 ? 'remember' : STATION_KEYS[current];
  return { workflow, stations, currentStation, completion: completionOf(stations, state) };
}

function stationStatus(list, state) {
  if (list.every((step) => step.status === 'done')) return 'done';
  if (list.some((step) => step.status === 'now' || step.status === 'done')) return state === 'new' ? 'todo' : state;
  return 'todo';
}

// Each station is 20%. done/na = 1; todo = 0; the current station = (done + 0.5·now) / steps.
export function completionOf(stations, state) {
  if (state === 'done') return 100;
  if (state === 'new') return 0;
  return Math.min(99, rawCompletion(stations));
}

function rawCompletion(stations) {
  const total = stations.reduce((sum, entry) => {
    if (entry.status === 'done' || entry.status === 'na') return sum + 1;
    if (entry.status === 'todo') return sum;
    const doneSteps = entry.steps.filter((step) => step.status === 'done').length;
    const nowSteps = entry.steps.filter((step) => step.status === 'now').length;
    return sum + (doneSteps + 0.5 * nowSteps) / Math.max(1, entry.steps.length);
  }, 0);
  return Math.round((total / STATION_KEYS.length) * 100);
}
