// Execution model (PF-0112, v1.5.0): runs, lanes and tasks as pure state transitions.
// A lane is one checkout with at most one agent session (the v1.4.2 rule, unchanged); a
// run is an ordered list of tasks in a lane; a task drives one work item to DONE. Run
// Now is a one-task run, Queue a many-task run, Parallel many lanes. Nothing here does
// I/O: the manager feeds signals in and persists what comes out.
//
// Completion is read from YallaFlow state, never from agent text: a task is done only
// when its item is DONE in a fresh snapshot AND its session ended with every process
// gone (owner decision D7). Every human decision (approval, review gate, question,
// reply) blocks; nothing here answers one.
export const EXECUTION_SCHEMA = 'yallaflow.execution/1';

export const TASK_STATES = Object.freeze(['queued', 'starting', 'working', 'needs-you', 'paused', 'interrupted', 'done', 'failed', 'skipped', 'cancelled']);
export const FINAL_TASK_STATES = Object.freeze(['done', 'failed', 'skipped', 'cancelled']);
export const LIVE_TASK_STATES = Object.freeze(['starting', 'working', 'needs-you']);
export const RUN_MODES = Object.freeze(['now', 'queue', 'parallel']);

const RUN_ID = /^r-[0-9a-f]{6,12}$/;
const TASK_ID = /^t-[0-9a-f]{6,12}$/;
const WORK_ID = /^PF-[A-Za-z0-9-]+$/;

export function isFinal(task) {
  return FINAL_TASK_STATES.includes(task.state);
}

export function isLive(task) {
  return LIVE_TASK_STATES.includes(task.state);
}

export function newTask({ id, workId, provider, now }) {
  if (typeof provider !== 'string' || !provider) throw new Error('A task needs a provider.');
  if (!TASK_ID.test(String(id))) throw new Error('Invalid task id.');
  if (!WORK_ID.test(String(workId))) throw new Error('Invalid work item.');
  return { id, workId, provider, state: 'queued', attempt: 0, reason: null, sessionRecord: null, startedAt: null, endedAt: null, updatedAt: now };
}

export function newRun({ id, mode, laneRoot, tasks, now, options = {} }) {
  if (!RUN_ID.test(String(id))) throw new Error('Invalid run id.');
  if (!RUN_MODES.includes(mode)) throw new Error(`Unknown run mode ${mode}.`);
  return { id, mode, state: 'running', createdAt: now, updatedAt: now, options: { pauseBetween: false, ...options }, lanes: [{ id: 'main', root: laneRoot, kind: 'main', tasks }] };
}

function set(task, state, reason, now, extra = {}) {
  return { ...task, ...extra, state, reason: reason ?? null, updatedAt: now };
}

// Applies one signal to one task. Returns the task unchanged when the signal does not
// apply in its current state (signals arrive from several sources and may repeat).
//
// signal.type:
//   claim                 write-ahead claim before any bridge call (attempt + 1)
//   started               the bridge reports the session started (sessionRecord)
//   permission            a permission request is open        → needs-you: approval
//   permission-resolved   none left open (pending = 0)        → working
//   review                the item waits for a review gate    → needs-you: review
//   question              the item has an open question       → needs-you: question
//   turn-ended            the agent's turn ended, item not DONE and nothing pending → needs-you: reply
//   turn-started          the agent works again              → working
//   item-done             the snapshot shows DONE (session may still be up)
//   session-ended         the session ended (cleanup: { complete })
//   usage-limit           the provider stopped for a usage limit → paused: limit
//   crashed               the session crashed or failed to start → failed
//   lifecycle             the item is held or closed           → skipped
//   restart               the console restarted while the task was live → interrupted
//   pause / cancel / skip developer actions
export function applySignal(task, signal, now) {
  const { type } = signal;
  // A developer's Retry is the one way back from failed: the task queues again (same attempt count).
  if (type === 'requeue') return ['failed', 'paused', 'interrupted'].includes(task.state) ? set(task, 'queued', null, now, { itemDone: false, sessionEnded: false }) : task;
  if (isFinal(task)) return task; // done, failed, skipped and cancelled never change again
  if (type === 'switch') return ['queued', 'paused', 'interrupted'].includes(task.state) ? set(task, 'queued', null, now, { provider: signal.provider, sessionRecord: null, sessionEnded: false }) : task;
  switch (type) {
    case 'claim':
      if (!['queued', 'interrupted', 'paused', 'failed'].includes(task.state)) return task;
      return set(task, 'starting', null, now, { attempt: task.attempt + 1, startedAt: task.startedAt ?? now, itemDone: false, sessionEnded: false, ending: false });
    case 'started':
      if (task.state !== 'starting' && task.state !== 'interrupted') return task;
      return set(task, 'working', null, now, { sessionRecord: signal.sessionRecord ?? task.sessionRecord });
    case 'permission':
      if (!['starting', 'working', 'needs-you'].includes(task.state)) return task;
      return set(task, 'needs-you', 'approval', now);
    case 'permission-resolved':
      if (task.state !== 'needs-you' || task.reason !== 'approval' || signal.pending > 0) return task;
      return set(task, 'working', null, now);
    case 'review':
      if (!isLive(task)) return task;
      return set(task, 'needs-you', 'review', now);
    case 'question':
      if (!isLive(task)) return task;
      return set(task, 'needs-you', 'question', now);
    case 'turn-ended':
      if (task.state !== 'working' || task.itemDone) return task;
      return set(task, 'needs-you', 'reply', now);
    case 'turn-started':
      if (task.state !== 'needs-you' || !['reply', 'review', 'question'].includes(task.reason)) return task;
      return set(task, 'working', null, now);
    case 'item-done':
      // DONE alone is not completion: the session must also end with every process gone.
      if (task.state === 'done') return task;
      return task.sessionEnded ? set(task, 'done', null, now, { itemDone: true, endedAt: now }) : { ...task, itemDone: true, updatedAt: now };
    case 'session-ended': {
      if (!isLive(task) && task.state !== 'interrupted') return task;
      if (signal.cleanup && signal.cleanup.complete === false) return set(task, 'failed', 'cleanup', now, { sessionEnded: true, endedAt: now });
      if (task.itemDone) return set(task, 'done', null, now, { sessionEnded: true, endedAt: now });
      // The session ended before the item is DONE: the developer decides what next.
      return set(task, 'paused', 'session-ended', now, { sessionEnded: true });
    }
    case 'usage-limit':
      if (!isLive(task)) return task;
      return set(task, 'paused', 'usage-limit', now, { retryAt: signal.retryAt ?? null });
    case 'crashed':
      if (!isLive(task)) return task;
      return set(task, 'failed', signal.reason ?? 'crashed', now, { sessionEnded: true });
    case 'lifecycle':
      if (isFinal(task)) return task;
      return set(task, 'skipped', signal.state ?? 'lifecycle', now);
    case 'restart':
      if (!isLive(task)) return task;
      return set(task, 'interrupted', 'console-restart', now);
    case 'pause':
      if (isFinal(task) || task.state === 'paused') return task;
      return set(task, 'paused', 'developer', now);
    case 'agent-config':
      // The checkout's project-level agent configuration changed since the run began.
      if (isFinal(task) || isLive(task)) return task;
      return set(task, 'paused', 'agent-config', now);
    case 'cancel':
      return set(task, 'cancelled', signal.reason ?? 'developer', now);
    case 'skip':
      if (isLive(task)) return task; // a live task is stopped first
      return set(task, 'skipped', 'developer', now);
    default:
      return task;
  }
}

// The lane's next task to start, or null. A lane never has two live tasks.
export function nextTask(lane) {
  if (lane.tasks.some(isLive)) return null;
  if (lane.tasks.some((task) => task.state === 'interrupted' || task.state === 'paused' || task.state === 'failed')) return null; // blocked until the developer acts
  return lane.tasks.find((task) => task.state === 'queued') ?? null;
}

export function runState(run) {
  const tasks = run.lanes.flatMap((lane) => lane.tasks);
  if (run.state === 'cancelled') return 'cancelled';
  if (tasks.length && tasks.every(isFinal)) return 'finished';
  if (tasks.some((task) => ['paused', 'interrupted', 'failed'].includes(task.state))) return 'paused';
  return 'running';
}

// After a console restart: every live task becomes interrupted; nothing starts by itself.
export function afterRestart(run, now) {
  const lanes = run.lanes.map((lane) => ({ ...lane, tasks: lane.tasks.map((task) => applySignal(task, { type: 'restart' }, now)) }));
  const next = { ...run, lanes, updatedAt: now };
  return { ...next, state: runState(next) };
}

// Updates one task inside a run immutably and recomputes the run state.
export function updateTask(run, taskId, fn, now) {
  let changed = false;
  const lanes = run.lanes.map((lane) => ({
    ...lane,
    tasks: lane.tasks.map((task) => {
      if (task.id !== taskId) return task;
      const next = fn(task);
      if (next !== task) changed = true;
      return next;
    })
  }));
  if (!changed) return run;
  const next = { ...run, lanes, updatedAt: now };
  return { ...next, state: runState(next) };
}

// The unfinished task that owns a work item anywhere in these runs, or null (FR4).
export function ownerOf(runs, workId) {
  for (const run of runs) {
    for (const lane of run.lanes) {
      for (const task of lane.tasks) if (task.workId === workId && !isFinal(task)) return { run, lane, task };
    }
  }
  return null;
}
