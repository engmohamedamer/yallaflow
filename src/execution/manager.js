// Execution Manager (PF-0112, v1.5.0): sits above the Agent Bridge and never talks to a
// provider itself. It observes the bridge's agent events and the workspace's YallaFlow
// state, keeps each checkout's runs, schedules queued tasks, and offers one view of every
// lane for the Agents tab and its approvals inbox.
//
// - Run Now keeps the v1.4.2 call path: the console still starts or links sessions through
//   the bridge exactly as before; the manager records what it observes, and never ends a
//   Run Now session itself.
// - Queue: one task at a time per checkout, each in a fresh session. A task is done only
//   when its item is DONE in YallaFlow AND its session ended with every process gone (D7);
//   only then does the next one start. Any approval, review, question, reply, failure or
//   usage limit blocks the queue until the developer acts.
// - It answers nothing: approvals, gates, questions and replies stay the developer's.
// - Provider-neutral (provider knowledge stays in src/agents, AC-108): a provider the console
//   can start runs queued tasks by itself; one it cannot (a user-started session) is assisted
//   — its queued task waits for the developer to start and link it (some logins also have
//   console messages turned off).
// - Every start is a write-ahead claim saved before any bridge call; after a restart nothing
//   starts by itself (live tasks become interrupted).
// - Runs are saved only by the console that owns the checkout (the agent-console lock).
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { afterRestart, applySignal, isFinal, isLive, newRun, newTask, nextTask, ownerOf, runState, updateTask } from './model.js';
import { appendEvent, loadRuns, saveRuns } from './store.js';
import { continueText, startText } from './messages.js';

const id = (prefix) => `${prefix}-${randomBytes(4).toString('hex')}`;
const RECENT = 30; // runs kept per checkout
const MAX_TASKS = 20;
const WORK_ID = /^PF-[A-Za-z0-9-]+$/;

const fail = (status, code, message) => Object.assign(new Error(message), { status, code });

export class ExecutionManager {
  // bridge: AgentBridge; runner: the console runner (snapshot reads); broadcast(projectId)
  constructor({ bridge, runner, projects, broadcast = () => {}, clock = () => new Date().toISOString() }) {
    this.bridge = bridge;
    this.runner = runner;
    this.broadcast = broadcast;
    this.clock = clock;
    this.lanes = new Map(); // projectId -> { root, name, store, error, runs, dirty }
    for (const project of projects) this.lanes.set(project.id, this.blankLane(project));
    this.unsubscribe = bridge.subscribe((projectId, event) => this.onAgentEvent(projectId, event).catch(() => {}));
    this.queue = Promise.resolve();
  }

  blankLane(project) {
    const location = project.kind === 'lane' && project.parentRoot && project.laneId ? { root: project.parentRoot, sub: ['lane-runs', project.laneId] } : project.root;
    return { root: project.root, location, name: project.name, kind: project.kind ?? 'main', parent: project.parent ?? null, laneId: project.laneId ?? null, store: 'empty', error: null, runs: [], dirty: false };
  }

  // Loads each checkout's runs; live tasks of a previous console become interrupted.
  async open() {
    for (const [, lane] of this.lanes) await this.load(lane);
  }

  async load(lane) {
    const loaded = await loadRuns(lane.location);
    lane.store = loaded.state;
    lane.error = loaded.error ?? null;
    if (loaded.state !== 'ok') return;
    const now = this.clock();
    lane.runs = loaded.runs.map((run) => afterRestart(run, now));
    lane.dirty = JSON.stringify(lane.runs) !== JSON.stringify(loaded.runs);
  }

  async addProject(project) {
    if (this.lanes.has(project.id)) return;
    const lane = this.blankLane(project);
    this.lanes.set(project.id, lane);
    await this.load(lane);
  }

  removeProject(projectId) {
    this.lanes.delete(projectId);
  }

  close() {
    this.unsubscribe?.();
  }

  // One change at a time per console: events, snapshots and actions never interleave.
  serial(fn) {
    const next = this.queue.then(fn);
    this.queue = next.catch(() => {});
    return next;
  }

  lane(projectId) {
    const lane = this.lanes.get(projectId);
    if (!lane) throw fail(404, 'NOT_FOUND', 'Unknown project.');
    return lane;
  }

  // The bridge's fingerprint of the checkout's project-level agent configuration ('none' if absent).
  async agentConfig(root) {
    return (await this.bridge.projectConfigFingerprint?.(root)) ?? 'none';
  }

  // ----- bookkeeping -----
  liveTask(lane) {
    for (const run of lane.runs) for (const runLane of run.lanes) for (const task of runLane.tasks) if (isLive(task)) return { run, task };
    return null;
  }

  findTask(lane, taskId) {
    for (const run of lane.runs) for (const runLane of run.lanes) for (const task of runLane.tasks) if (task.id === taskId) return { run, task };
    return null;
  }

  replaceRun(lane, run) {
    lane.runs = lane.runs.map((entry) => (entry.id === run.id ? { ...run, state: run.state === 'cancelled' ? 'cancelled' : runState(run) } : entry));
    lane.dirty = true;
  }

  apply(lane, run, task, signal, note) {
    const now = this.clock();
    const updated = updateTask(run, task.id, (current) => applySignal(current, signal, now), now);
    if (updated === run) return false;
    // "Pause after each task": a finished task holds the run until the developer's Next.
    const done = updated.lanes[0].tasks.find((entry) => entry.id === task.id)?.state === 'done';
    const waiting = done && run.mode !== 'now' && run.options?.pauseBetween && updated.lanes[0].tasks.some((entry) => entry.state === 'queued');
    this.replaceRun(lane, waiting ? { ...updated, awaitNext: true } : updated);
    appendEvent(lane.location, { run: run.id, task: task.id, workId: task.workId, signal: signal.type, note: note ?? null }).catch(() => {});
    return true;
  }

  // → true when the runs are on disk (or nothing needed saving).
  async persist(projectId, lane) {
    this.broadcast(projectId);
    if (!lane.dirty) return true;
    if (lane.store === 'unreadable') return false;
    // Single writer: only the console that owns this checkout saves its runs.
    if (!this.bridge.ownsCheckout(projectId)) return false;
    try {
      await saveRuns(lane.location, lane.runs);
      lane.store = 'ok';
      lane.dirty = false;
      lane.error = null;
      return true;
    } catch (error) {
      lane.error = `runs could not be saved: ${error.message}`;
      return false;
    }
  }

  // Review M6: a usage limit is derived from the tasks themselves (paused for usage-limit), in
  // every checkout of this console, so it survives a restart and ends when no such task is left.
  limits() {
    const found = new Map();
    for (const [, lane] of this.lanes) for (const run of lane.runs) for (const runLane of run.lanes) for (const task of runLane.tasks) {
      if (task.state === 'paused' && task.reason === 'usage-limit' && !found.has(task.provider)) found.set(task.provider, { at: task.updatedAt ?? null, retryAt: task.retryAt ?? null });
    }
    return found;
  }

  // ----- signals from the bridge and from YallaFlow state -----
  async onAgentEvent(projectId, event) {
    const lane = this.lanes.get(projectId);
    if (!lane) return;
    await this.serial(async () => {
      let changed = false;
      if (event.type === 'session.started' && event.workId) changed = this.recordStart(projectId, lane, event);
      const live = this.liveTask(lane);
      if (live) {
        const signal = this.signalFor(projectId, event);
        if (signal) changed = this.apply(lane, live.run, live.task, signal, event.type) || changed;
        if (event.type === 'turn.ended' || event.type === 'session.ended') changed = (await this.checkItem(projectId, lane)) || changed;
      }
      if (changed) await this.persist(projectId, lane);
      await this.advance(projectId, lane);
    });
  }

  // A session started for a work item: the start of the task that owns it (queue, or a
  // resumed task), or else a new one-task Run Now run.
  recordStart(projectId, lane, event) {
    const now = this.clock();
    const recordId = this.bridge.glance(projectId)?.session?.recordId ?? null;
    const owner = ownerOf(lane.runs, event.workId);
    if (owner) {
      const claimed = owner.task.state === 'starting' ? owner.task : applySignal(owner.task, { type: 'claim' }, now);
      const started = applySignal(claimed, { type: 'started', sessionRecord: recordId }, now);
      if (started === owner.task) return false;
      this.replaceRun(lane, updateTask(owner.run, owner.task.id, () => started, now));
      return true;
    }
    let task = newTask({ id: id('t'), workId: event.workId, provider: event.provider ?? this.bridge.defaultProvider(), now });
    task = applySignal(applySignal(task, { type: 'claim' }, now), { type: 'started', sessionRecord: recordId }, now);
    const run = newRun({ id: id('r'), mode: 'now', laneRoot: lane.root, tasks: [task], now });
    lane.runs = [run, ...lane.runs].slice(0, RECENT);
    lane.dirty = true;
    appendEvent(lane.location, { run: run.id, task: task.id, workId: task.workId, signal: 'run-now', note: event.provider ?? null }).catch(() => {});
    return true;
  }

  signalFor(projectId, event) {
    switch (event.type) {
      case 'permission.requested': return { type: 'permission' };
      case 'permission.resolved': return { type: 'permission-resolved', pending: this.bridge.glance(projectId)?.pending.length ?? 0 };
      case 'turn.started':
      case 'message.sent': return { type: 'turn-started' };
      case 'session.stopped':
        if (event.stop?.reason === 'usage_limit') return { type: 'usage-limit', retryAt: event.stop.retryAt ?? null };
        if (event.stop?.reason === 'crashed') return { type: 'crashed', reason: 'crashed' };
        return null;
      // A crashed adapter reports session.ended (reason crashed) before the bridge's session.stopped.
      case 'session.ended': return event.reason === 'crashed' ? { type: 'crashed', reason: 'crashed' } : { type: 'session-ended', cleanup: event.cleanup ?? null };
      default: return null;
    }
  }

  async snapshotItem(lane, workId) {
    try {
      const snapshot = await this.runner.get(lane.root, 'snapshot', ['snapshot', '--json']);
      return (snapshot?.items ?? []).find((entry) => entry.id === workId) ?? null;
    } catch {
      return null;
    }
  }

  // Reads the live task's work item from YallaFlow itself and applies what it says.
  async checkItem(projectId, lane) {
    const live = this.liveTask(lane);
    if (!live) return false;
    const item = await this.snapshotItem(lane, live.task.workId);
    if (!item) return false;
    let signal = null;
    if (item.stage === 'DONE') signal = { type: 'item-done' };
    else if (item.lifecycle?.state === 'closed' || item.lifecycle?.state === 'on_hold') signal = { type: 'lifecycle', state: item.lifecycle.state };
    else if (item.waitingFor?.kind === 'review') signal = { type: 'review' };
    else if (item.waitingFor?.kind === 'question') signal = { type: 'question' };
    else if (live.task.state === 'working' && this.bridge.glance(projectId)?.session?.status === 'idle') signal = { type: 'turn-ended' };
    return signal ? this.apply(lane, live.run, live.task, signal, `snapshot ${item.stage}`) : false;
  }

  // A workspace change (the console's watcher): re-read the live item's state.
  async onWorkspaceChange(projectId) {
    const lane = this.lanes.get(projectId);
    if (!lane || !this.liveTask(lane)) return;
    await this.serial(async () => {
      if (await this.checkItem(projectId, lane)) await this.persist(projectId, lane);
      await this.advance(projectId, lane);
    });
  }

  // ----- the queue -----
  // After any change: end the session of a queued task whose item is DONE; then start the
  // next task when the lane is free. Called inside serial().
  async advance(projectId, lane) {
    const live = this.liveTask(lane);
    if (live) {
      // A queued (not Run Now) task whose item is DONE, on a provider the console can end: end its session. The task becomes
      // done only when the session has ended with every process gone (the session-ended signal).
      // It waits until the agent is idle, so its last message is not cut off.
      if (live.run.mode !== 'now' && live.task.itemDone && !live.task.sessionEnded && this.bridge.providerCapabilities(live.task.provider)?.end && !live.task.ending && this.bridge.glance(projectId)?.session?.status === 'idle') {
        this.replaceRun(lane, updateTask(live.run, live.task.id, (task) => ({ ...task, ending: true }), this.clock()));
        await this.persist(projectId, lane);
        await this.bridge.end(projectId).catch((error) => this.apply(lane, live.run, { ...live.task }, { type: 'crashed', reason: `end-failed: ${error.message}`.slice(0, 120) }, 'end failed'));
      }
      return;
    }
    const run = lane.runs.filter((entry) => entry.mode !== 'now' && entry.state === 'running' && !entry.held).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))[0];
    if (!run) return;
    const runLane = run.lanes[0];
    if (run.cancelAfter) {
      const now = this.clock();
      let next = run;
      for (const task of runLane.tasks) if (task.state === 'queued') next = updateTask(next, task.id, (current) => applySignal(current, { type: 'cancel', reason: 'cancelled after the current task' }, now), now);
      this.replaceRun(lane, { ...next, state: 'cancelled' });
      await this.persist(projectId, lane);
      return;
    }
    const task = nextTask(runLane);
    if (!task) {
      if (runState(run) !== run.state) { this.replaceRun(lane, run); await this.persist(projectId, lane); }
      return;
    }
    if (run.awaitNext) return; // "pause after each task": waits for the developer's Next
    if (this.limits().has(task.provider)) return; // a usage limit pauses this provider everywhere
    if (!this.bridge.providerCapabilities(task.provider)?.start) return; // assisted: the developer starts it
    const glance = this.bridge.glance(projectId);
    if (glance?.session || glance?.lockedBy) return; // the checkout is busy: the queue waits
    if (!(await this.startTask(projectId, lane, run, task, { resume: false }))) {
      // A task settled without starting (its item is already DONE, closed or on hold): try the next one.
      const after = this.findTask(lane, task.id);
      if (after && after.task.state !== task.state && after.task.state !== 'queued') await this.advance(projectId, lane);
    }
  }

  // Write-ahead claim, saved before any bridge call; then activate, start and send the
  // start message. A failure fails the task (the developer can retry).
  // Review M3: the item is read fresh first; one that is DONE, closed or on hold is never
  // started again. Review M4: the claim must be on disk before any bridge call.
  async startTask(projectId, lane, run, task, { resume }) {
    this.runner.invalidate?.(lane.root);
    const item = await this.snapshotItem(lane, task.workId);
    if (!item) {
      lane.error = `${task.workId} was not started: its state could not be read from YallaFlow.`;
      this.broadcast(projectId);
      return false;
    }
    const settled = item.stage === 'DONE' ? 'already-done' : ['closed', 'on_hold'].includes(item.lifecycle?.state) ? item.lifecycle.state : null;
    if (settled) {
      this.apply(lane, run, task, { type: 'lifecycle', state: settled }, `not started: ${settled}`);
      await this.persist(projectId, lane);
      return false;
    }
    // An agent may load a project-level configuration (sandbox, tool servers, hooks) from the
    // checkout, and an earlier agent session may have written it: a queued session never starts
    // after it changed since the run began (owner release rule, 2026-11-10).
    if (run.mode !== 'now' && (await this.agentConfig(lane.root)) !== (run.options.agentConfig ?? 'none')) {
      this.apply(lane, run, task, { type: 'agent-config' }, 'project agent configuration changed');
      await this.persist(projectId, lane);
      lane.error = `${task.workId} was not started: the project's agent configuration changed since this queue began. Look at it, then start the task yourself.`;
      this.broadcast(projectId);
      return false;
    }
    const now = this.clock();
    await this.bridge.claimFor(projectId);
    const claimedRun = updateTask(run, task.id, (current) => applySignal(current, { type: 'claim' }, now), now);
    if (claimedRun === run) return false;
    this.replaceRun(lane, claimedRun);
    appendEvent(lane.location, { run: run.id, task: task.id, workId: task.workId, signal: 'claim', note: resume ? 'resume' : 'start' }).catch(() => {});
    if (!(await this.persist(projectId, lane))) {
      const current = this.findTask(lane, task.id);
      if (current) this.replaceRun(lane, updateTask(current.run, task.id, () => ({ ...task, updatedAt: this.clock() }), this.clock()));
      lane.error = `${task.workId} was not started: its claim could not be saved (${lane.error ?? 'runs file not writable'}).`;
      this.broadcast(projectId);
      return false;
    }
    try {
      await this.bridge.activate(projectId, task.workId);
      if (resume && task.sessionRecord) {
        try {
          await this.bridge.resumeManaged(projectId, task.provider, task.sessionRecord, { mode: run.options.mode });
        } catch {
          await this.bridge.startManaged(projectId, task.provider, { workId: task.workId, mode: run.options.mode });
        }
      } else {
        await this.bridge.startManaged(projectId, task.provider, { workId: task.workId, mode: run.options.mode });
      }
      await this.bridge.message(projectId, resume ? continueText(task.workId, run.options.lang) : run.options.message ?? startText(task.workId, run.options.lang, { queued: true }));
    } catch (error) {
      const current = this.findTask(lane, task.id);
      if (current && isLive(current.task)) this.apply(lane, current.run, current.task, { type: 'crashed', reason: `start-failed: ${error.code ?? error.message}`.slice(0, 120) }, 'start failed');
      await this.persist(projectId, lane);
    }    return true;
  }

  // ----- developer actions (the console's execution routes) -----
  // `message`: a start message chosen by the console for this run (FR25: a conflict sent back).
  async createRun(projectId, { workIds, provider = this.bridge.defaultProvider(), mode = 'workspace-write', pauseBetween = false, lang = 'en', message = null } = {}) {
    const lane = this.lane(projectId);
    return this.serial(async () => {
      if (lane.store === 'unreadable') throw fail(409, 'STORE_UNREADABLE', `This project's runs file is unreadable (${lane.error}); fix or remove .yallaflow/local/execution/runs.json first.`);
      if (!Array.isArray(workIds) || !workIds.length || workIds.length > MAX_TASKS) throw fail(400, 'BAD_TASKS', `Choose 1 to ${MAX_TASKS} work items.`);
      const ids = workIds.map(String);
      if (ids.some((entry) => !WORK_ID.test(entry)) || new Set(ids).size !== ids.length) throw fail(400, 'BAD_TASKS', 'Each work item may appear once, by its id.');
      if (!this.bridge.providers().includes(provider)) throw fail(400, 'BAD_PROVIDER', `Choose one of: ${this.bridge.providers().map((entry) => this.bridge.providerLabel(entry)).join(', ')}.`);
      this.bridge.checkMode(provider, mode);
      for (const workId of ids) {
        if (ownerOf(lane.runs, workId)) throw fail(409, 'ALREADY_QUEUED', `${workId} already belongs to an unfinished run.`);
        const item = await this.snapshotItem(lane, workId);
        if (!item) throw fail(404, 'NOT_FOUND', `${workId} is not a work item of this project.`);
        if (item.stage === 'DONE') throw fail(409, 'ALREADY_DONE', `${workId} is already DONE.`);
        if (item.lifecycle?.state === 'closed' || item.lifecycle?.state === 'on_hold') throw fail(409, 'NOT_ACTIVE', `${workId} is ${item.lifecycle.state === 'closed' ? 'closed' : 'on hold'}.`);
      }
      const session = this.bridge.glance(projectId)?.session;
      if (session?.workId && ids.includes(session.workId)) throw fail(409, 'ALREADY_RUNNING', `${session.workId} has a session running now. Let it finish or end it first.`);
      await this.bridge.claimFor(projectId); // only the owning console runs queues here
      const now = this.clock();
      const tasks = ids.map((workId) => newTask({ id: id('t'), workId, provider, now }));
      const run = newRun({ id: id('r'), mode: 'queue', laneRoot: lane.root, tasks, now, options: { agentConfig: await this.agentConfig(lane.root), pauseBetween: Boolean(pauseBetween), mode, lang: lang === 'ar' ? 'ar' : 'en', provider, ...(typeof message === 'string' && message.trim() ? { message: message.slice(0, 4000) } : {}) } });
      lane.runs = [run, ...lane.runs].slice(0, RECENT);
      lane.dirty = true;
      appendEvent(lane.location, { run: run.id, signal: 'run-created', note: ids.join(',') }).catch(() => {});
      await this.persist(projectId, lane);
      await this.advance(projectId, lane);
      return { run: lane.runs.find((entry) => entry.id === run.id) };
    });
  }

  async act(projectId, action, body = {}) {
    const lane = this.lane(projectId);
    return this.serial(async () => {
      const run = lane.runs.find((entry) => entry.id === String(body.runId ?? ''));
      if (!run) throw fail(404, 'NOT_FOUND', 'Unknown run.');
      const now = this.clock();
      const taskOf = () => {
        const found = run.lanes[0].tasks.find((task) => task.id === String(body.taskId ?? ''));
        if (!found) throw fail(404, 'NOT_FOUND', 'Unknown task.');
        return found;
      };
      switch (action) {
        case 'pause': // stop starting new tasks; the current one continues
          this.replaceRun(lane, { ...run, held: true });
          break;
        case 'next': // continue after "pause after each task", or after Pause
          this.replaceRun(lane, { ...run, held: false, awaitNext: false });
          break;
        case 'resume': { // an interrupted, paused or limited task continues (resume its session when possible)
          const task = taskOf();
          if (isLive(task)) break; // already running: a second Resume does nothing
          if (!['interrupted', 'paused'].includes(task.state)) throw fail(409, 'NOT_RESUMABLE', 'Only an interrupted or paused task can be resumed.');
          if (!this.bridge.providerCapabilities(task.provider)?.start) throw fail(409, 'ASSISTED', `Start this task in ${this.bridge.providerLabel(task.provider)} and link it; the console cannot start it.`);
          const glance = this.bridge.glance(projectId);
          if (glance?.session) throw fail(409, 'SESSION_ACTIVE', 'Another session is running in this checkout. End it first.');
          this.replaceRun(lane, { ...run, held: false });
          await this.startTask(projectId, lane, lane.runs.find((entry) => entry.id === run.id), task, { resume: true });
          return this.view();
        }
        case 'retry': {
          const task = taskOf();
          const next = updateTask(run, task.id, (current) => applySignal(current, { type: 'requeue' }, now), now);
          if (next === run) throw fail(409, 'NOT_RETRYABLE', 'Only a failed, paused or interrupted task can be retried.');
          this.replaceRun(lane, { ...next, held: false });
          break;
        }
        case 'skip': {
          const task = taskOf();
          if (isLive(task)) throw fail(409, 'TASK_LIVE', 'Stop the running task first.');
          const next = updateTask(run, task.id, (current) => applySignal(current, { type: 'skip' }, now), now);
          if (next === run) throw fail(409, 'NOT_SKIPPABLE', 'This task cannot be skipped.');
          this.replaceRun(lane, next);
          break;
        }
        case 'switch': { // remaining tasks continue with the other agent (FR7)
          if (!this.bridge.providers().includes(body.provider)) throw fail(400, 'BAD_PROVIDER', `Choose one of: ${this.bridge.providers().map((entry) => this.bridge.providerLabel(entry)).join(', ')}.`);
          let next = run;
          for (const task of run.lanes[0].tasks) next = updateTask(next, task.id, (current) => applySignal(current, { type: 'switch', provider: body.provider }, now), now);
          this.replaceRun(lane, { ...next, options: { ...run.options, provider: body.provider } });
          break;
        }
        case 'reorder': {
          const order = Array.isArray(body.taskIds) ? body.taskIds.map(String) : [];
          const queued = run.lanes[0].tasks.filter((task) => task.state === 'queued');
          if (order.length !== queued.length || !queued.every((task) => order.includes(task.id))) throw fail(400, 'BAD_ORDER', 'Send every queued task exactly once.');
          const others = run.lanes[0].tasks.filter((task) => task.state !== 'queued');
          const byId = new Map(queued.map((task) => [task.id, task]));
          this.replaceRun(lane, { ...run, lanes: [{ ...run.lanes[0], tasks: [...others, ...order.map((entry) => byId.get(entry))] }], updatedAt: now });
          break;
        }
        case 'cancel': {
          if (body.scope === 'after-current') {
            this.replaceRun(lane, { ...run, cancelAfter: true });
            break;
          }
          if (body.confirmed !== true) throw fail(400, 'CONFIRMATION_REQUIRED', 'Confirm stopping the run now.');
          const live = run.lanes[0].tasks.find(isLive);
          let next = run;
          for (const task of run.lanes[0].tasks) next = updateTask(next, task.id, (current) => applySignal(current, { type: 'cancel', reason: 'cancelled by you' }, now), now);
          this.replaceRun(lane, { ...next, state: 'cancelled' });
          await this.persist(projectId, lane);
          if (live && this.bridge.providerCapabilities(live.provider)?.end && this.bridge.glance(projectId)?.session?.workId === live.workId) {
            try { this.bridge.cancel(projectId); } catch { /* not working */ }
            await this.bridge.end(projectId).catch(() => {});
          }
          return this.view();
        }
        default:
          throw fail(404, 'NOT_FOUND', 'Unknown action.');
      }
      appendEvent(lane.location, { run: run.id, task: body.taskId ?? null, signal: `developer-${action}` }).catch(() => {});
      await this.persist(projectId, lane);
      await this.advance(projectId, lane);
      return this.view();
    });
  }

  // The work items a checkout's runs drove (a lane's Review & Merge covers these).
  workIdsOf(projectId) {
    const lane = this.lanes.get(projectId);
    if (!lane) return [];
    return [...new Set(lane.runs.flatMap((run) => run.lanes.flatMap((entry) => entry.tasks.filter((task) => task.state !== 'cancelled' && task.state !== 'skipped').map((task) => task.workId))))];
  }

  // ----- the Agents view -----
  // Every lane of every project in this console: session, open requests, recent runs.
  view() {
    const lanes = [];
    for (const [projectId, lane] of this.lanes) {
      const glance = this.bridge.glance(projectId);
      lanes.push({
        project: projectId,
        name: lane.name,
        kind: lane.kind,
        parent: lane.parent,
        laneId: lane.laneId,
        store: lane.store,
        storeError: lane.error,
        session: glance?.session ?? null,
        lockedBy: glance?.lockedBy ?? null,
        userSessions: Boolean(glance?.userSessions), // a user-started provider can be linked in this project
        pending: glance?.pending ?? [],
        lastStep: glance?.lastStep ?? null,
        workingSince: glance?.workingSince ?? null,
        runs: lane.runs.slice(0, 10)
      });
    }
    const inbox = lanes.flatMap((lane) => lane.pending.map((request) => ({ project: lane.project, name: lane.name, workId: lane.session?.workId ?? null, ...request })));
    inbox.sort((a, b) => String(a.expiresAt ?? '').localeCompare(String(b.expiresAt ?? '')));
    const limits = [...this.limits().entries()].map(([provider, entry]) => ({ provider, ...entry }));
    return { schema: 'yallaflow.execution-view/1', lanes, inbox, limits };
  }
}

export { isFinal };
