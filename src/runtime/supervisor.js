// Runtime supervisor (1.4.0): start, stop, restart, status and logs of reviewed, trusted
// local development services.
//
// - A service runs as a detached process group (argv only, never a shell, a filtered
//   environment) whose stdout/stderr go straight to a log file, so it keeps running and
//   logging after the CLI or the Console exits (owner decision 2).
// - Trust, run records and per-service locks live in the user's runtime state folder,
//   outside the repository (src/runtime/state.js), so a process that can only write the
//   checkout cannot forge trust or make `stop` signal a process YallaFlow did not start.
// - State is recomputed from the live process on every read. A process is ours only while
//   its pid, start time and own process group still match the run record; anything else
//   is reported as unmanaged and never signalled. Nothing is found or killed by port or name.
// - Logs live in the git-ignored .yallaflow/local/runtime/logs/, opened only through
//   symlink-safe anchored folders and refused when hard-linked. Reading logs never writes;
//   rotation happens only at start, under the service lock, through the verified handle.
// - Nothing starts unless asked: opening a project or the Console never starts a service.
import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { open, rm } from 'node:fs/promises';
import path from 'node:path';
import { redactSecrets } from '../security/redact.js';
import { inLocalDir, safeLocalDir, safeWriteFile } from '../agents/local-files.js';
import { loadRuntimeProfiles, definitionHash, resolveServiceCwd } from './profile.js';
import { trustState } from './trust.js';
import { portListening } from './probe.js';
import { SUPPORTED, descendantsOf, groupAlive, identify, processGroupOf, processStartTime, serviceEnvironment, signalGroup, signalIfSame } from './process.js';
import { localRuntimeDir } from './local.js';
import { readState, stateDir, writeState } from './state.js';

export const LOG_CAP_BYTES = 5 * 1024 * 1024;
const LOCK_WAIT_MS = 60_000;
const POLL_MS = 100;
const SETTLE_MS = 1000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class RuntimeError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.code = code;
    Object.assign(this, details);
  }
}

function assertSupported() {
  if (!SUPPORTED) throw new RuntimeError('RUNTIME_UNSUPPORTED_PLATFORM', `The runtime manager supports Linux and macOS; ${process.platform} is not supported yet. Start services with your own tools.`);
}

const readRun = (root, id) => readState(root, `runs/${id}.json`);
const writeRun = (root, run) => writeState(root, `runs/${run.id}.json`, run);

// ---------------------------------------------------------------- per-service lock
async function withServiceLock(root, id, fn) {
  const file = path.join(await stateDir(root, 'locks'), `${id}.lock`);
  const me = { pid: process.pid, start: processStartTime(process.pid) };
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      const handle = await open(file, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), 0o600);
      await handle.writeFile(JSON.stringify(me));
      await handle.close();
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let holder = null;
      try {
        const handle = await open(file, constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0));
        try { holder = JSON.parse(await handle.readFile('utf8')); } finally { await handle.close(); }
      } catch { /* being written */ }
      if (holder && identify(holder.pid, holder.start) !== 'ours') {
        await rm(file, { force: true }); // its holder is gone: stale
        continue;
      }
      if (Date.now() > deadline) throw new RuntimeError('RUNTIME_BUSY', `Another start/stop of ${id} is still running (pid ${holder?.pid ?? '?'}). Try again shortly.`);
      await sleep(POLL_MS);
    }
  }
  try {
    return await fn();
  } finally {
    await rm(file, { force: true });
  }
}

// ---------------------------------------------------------------- logs (symlink-safe)
const logsDir = (root) => localRuntimeDir(root, 'runtime', 'logs');

function refuseLinked(info, label) {
  if (!info.isFile() || info.nlink !== 1) throw new RuntimeError('RUNTIME_LOG_UNSAFE', `Refusing to use ${label}: it is not a regular file of its own (a link or hard link).`);
}

// Opens the service log for the child (read/write, append), rotating it under the lock
// when it is over the cap. Returns the verified handle.
async function openServiceLog(root, id) {
  const dir = await logsDir(root);
  return inLocalDir(dir, async (base) => {
    const handle = await open(path.join(base, `${id}.log`), constants.O_RDWR | constants.O_APPEND | constants.O_CREAT | (constants.O_NOFOLLOW ?? 0), 0o600);
    try {
      const info = await handle.stat();
      refuseLinked(info, `${id}.log`);
      if (info.size > LOG_CAP_BYTES) {
        const keep = Math.min(info.size, LOG_CAP_BYTES);
        const buffer = Buffer.alloc(keep);
        await handle.read(buffer, 0, keep, info.size - keep);
        await safeWriteFile(dir, `${id}.log.1`, buffer, 0o600); // temp + rename: never through a link
        await handle.truncate(0);
      }
      return handle;
    } catch (error) {
      await handle.close();
      throw error;
    }
  });
}

// Read-only: never creates, rotates or truncates anything.
async function readLog(root, name, { from = null, maxBytes }) {
  let dir;
  try {
    dir = await safeLocalDir(root, '.yallaflow', 'local', 'runtime', 'logs');
  } catch {
    return '';
  }
  return inLocalDir(dir, async (base) => {
    let handle;
    try {
      handle = await open(path.join(base, name), constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0));
      const info = await handle.stat();
      if (!info.isFile() || info.nlink !== 1) return '';
      const startAt = from === null ? Math.max(0, info.size - maxBytes) : (from <= info.size ? from : 0);
      const length = Math.min(info.size - startAt, maxBytes);
      if (length <= 0) return '';
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, startAt);
      return buffer.toString('utf8');
    } catch {
      return '';
    } finally {
      await handle?.close();
    }
  }).catch(() => '');
}

export async function serviceLogs(root, id, { lines = 200 } = {}) {
  const count = Math.max(1, Math.min(1000, Number.isInteger(lines) ? lines : 200));
  const text = (await readLog(root, `${id}.log.1`, { maxBytes: 256 * 1024 })) + (await readLog(root, `${id}.log`, { maxBytes: 512 * 1024 }));
  const all = text.split(/\r?\n/);
  if (all.at(-1) === '') all.pop();
  // Best effort: arbitrary programs can print secrets in forms no pattern recognizes.
  return all.slice(-count).map((line) => redactSecrets(line));
}

// ---------------------------------------------------------------- identity and status
// Ours = same pid, same start time, and still the leader of its own process group.
function ownership(run) {
  const who = identify(run.pid, run.startTime);
  if (who !== 'ours') return who;
  if (run.pgid !== run.pid) return 'other';
  const group = processGroupOf(run.pid);
  return group === null || group === run.pid ? 'ours' : 'other';
}

async function computeState(root, service, run) {
  if (!run) return { state: 'stopped' };
  if (run.stoppedAt) return { state: 'stopped', stoppedAt: run.stoppedAt, exitCode: run.exitCode ?? null };
  const who = ownership(run);
  if (who === 'gone') {
    return { state: 'failed', reason: run.exitCode !== undefined && run.exitCode !== null ? `exited with code ${run.exitCode}` : run.signal ? `ended by ${run.signal}` : 'the process ended without a stop from YallaFlow', exitCode: run.exitCode ?? null };
  }
  if (who === 'other') return { state: 'unknown', reason: `pid ${run.pid} is no longer the process YallaFlow started (its identity or process group changed); it is unmanaged and is never signalled.` };
  const state = await readiness(root, service, run);
  return run.definitionHash !== definitionHash(service) ? { state, stale: true } : { state };
}

async function readiness(root, service, run) {
  if (!service.ready || run.readyAt) return 'running';
  if (service.ready.port) return (await portListening(service.ready.port)) ? 'running' : 'starting';
  const log = await readLog(root, `${service.id}.log`, { from: run.logOffset ?? 0, maxBytes: 512 * 1024 });
  return log.includes(service.ready.log) ? 'running' : 'starting';
}

export async function runtimeStatus(root) {
  const profiles = await loadRuntimeProfiles(root);
  const services = [];
  for (const service of profiles.services) {
    const run = await readRun(root, service.id);
    const state = await computeState(root, service, run);
    const trust = await trustState(root, service);
    const ports = [];
    for (const port of service.ports) ports.push({ port, listening: await portListening(port) });
    const ours = ['running', 'starting'].includes(state.state);
    services.push({
      id: service.id, name: service.name, kind: service.kind, source: service.source, overridden: service.overridden,
      command: service.command, cwd: service.cwd, env: service.env, ports, ready: service.ready, dependsOn: service.dependsOn,
      stopSignal: service.stopSignal, stopTimeoutSeconds: service.stopTimeoutSeconds, readyTimeoutSeconds: service.readyTimeoutSeconds,
      definitionHash: definitionHash(service),
      trust,
      ...state,
      pid: ours ? run.pid : null,
      startedAt: run && !run.stoppedAt ? run.startedAt : null,
      startedBy: run?.startedBy ?? null,
      // A configured port that answers while the service is not ours: someone else holds it.
      unmanagedPorts: ours ? [] : ports.filter((entry) => entry.listening).map((entry) => entry.port)
    });
  }
  return { supported: SUPPORTED, profile: { exists: profiles.exists }, services };
}

// ---------------------------------------------------------------- start / stop
function serviceById(profiles, id) {
  const service = profiles.services.find((entry) => entry.id === id);
  if (!service) throw new RuntimeError('RUNTIME_UNKNOWN_SERVICE', `No service ${id} in the runtime profile. See \`yallaflow runtime list\`.`);
  return service;
}

function reviewText(service) {
  return `command: ${JSON.stringify(service.command)} · cwd: ${service.cwd} · env names: ${service.env.length ? service.env.join(', ') : '(none)'} · ports: ${service.ports.length ? service.ports.join(', ') : '(none)'}`;
}

// The service and every dependency, dependencies first; refuses cycles.
function startOrder(profiles, id, seen = new Set(), stack = new Set(), order = []) {
  if (seen.has(id)) return order;
  if (stack.has(id)) throw new RuntimeError('RUNTIME_PROFILE_INVALID', `Service dependencies form a cycle at ${id}.`);
  stack.add(id);
  const service = serviceById(profiles, id);
  for (const dep of service.dependsOn) startOrder(profiles, dep, seen, stack, order);
  stack.delete(id);
  seen.add(id);
  order.push(service);
  return order;
}

export async function startService(root, id, { startedBy = 'cli' } = {}) {
  assertSupported();
  const profiles = await loadRuntimeProfiles(root);
  const order = startOrder(profiles, id);
  // Trust is checked for the service AND all its dependencies before anything starts.
  for (const service of order) {
    const trust = await trustState(root, service);
    if (!trust.trusted) {
      const why = trust.reason === 'changed' ? 'its definition changed since you trusted it' : 'it has not been trusted in this checkout';
      throw new RuntimeError('RUNTIME_UNTRUSTED', `Service ${service.id}${service.id === id ? '' : ` (a dependency of ${id})`} is not started: ${why}. Nothing was started. Review it, then run \`yallaflow runtime trust ${service.id}\`. ${reviewText(service)}`, { review: { id: service.id, definitionHash: definitionHash(service), command: service.command, cwd: service.cwd, env: service.env, ports: service.ports } });
    }
  }
  let result;
  for (const service of order) result = await startOne(root, service, startedBy);
  return result;
}

async function startOne(root, service, startedBy) {
  const id = service.id;
  return withServiceLock(root, id, async () => {
    const run = await readRun(root, id);
    const current = await computeState(root, service, run);
    if (['running', 'starting'].includes(current.state)) return { id, state: current.state, already: true, pid: run.pid };
    if (current.state === 'unknown') throw new RuntimeError('RUNTIME_UNMANAGED', `Service ${id} has an unmanaged process record: ${current.reason} Stop that process yourself if it is yours, then run \`yallaflow runtime stop ${id}\` to clear the record.`);
    for (const port of service.ports) {
      if (await portListening(port)) throw new RuntimeError('PORT_IN_USE', `Port ${port} on 127.0.0.1 is already in use by a process YallaFlow did not start; ${id} was not started and that process was not touched.`);
    }
    const cwd = await resolveServiceCwd(root, service);
    const log = await openServiceLog(root, id);
    const offset = (await log.stat()).size;
    const startedAt = new Date().toISOString();
    await log.write(`\n--- yallaflow runtime: starting ${id} at ${startedAt} (${startedBy}) ---\n`);
    let child;
    try {
      child = spawn(service.command[0], service.command.slice(1), { cwd, env: serviceEnvironment(service.env), detached: true, shell: false, stdio: ['ignore', log.fd, log.fd] });
      await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    } catch (error) {
      await log.close();
      throw new RuntimeError('RUNTIME_START_FAILED', `Service ${id} could not be started: ${error.code === 'ENOENT' ? `executable ${service.command[0]} was not found on PATH` : error.message}.`);
    }
    await log.close();
    const record = { schemaVersion: 1, id, pid: child.pid, pgid: child.pid, startTime: processStartTime(child.pid), definitionHash: definitionHash(service), startedAt, startedBy, logOffset: offset };
    let exited = null;
    child.once('exit', (code, signal) => { exited = { code, signal }; });
    child.unref();
    await writeRun(root, record);

    // Always watch a short settle window for an immediate crash (a service without a
    // readiness check would otherwise read "running" before it fails), then readiness.
    const settle = Date.now() + SETTLE_MS;
    const until = Date.now() + (service.ready ? service.readyTimeoutSeconds * 1000 : SETTLE_MS);
    let state = 'starting';
    while (Date.now() < until) {
      if (exited) break;
      state = await readiness(root, service, record);
      if (state === 'running' && Date.now() >= settle) break;
      await sleep(100);
    }
    if (exited) {
      record.exitCode = exited.code; record.signal = exited.signal;
      await writeRun(root, record);
      const tail = (await serviceLogs(root, id, { lines: 20 })).join('\n');
      throw new RuntimeError('RUNTIME_START_FAILED', `Service ${id} exited during start (${exited.code !== null ? `code ${exited.code}` : exited.signal}). Last log lines:\n${tail}`);
    }
    if (state === 'running' && service.ready) { record.readyAt = new Date().toISOString(); await writeRun(root, record); }
    return { id, state, pid: child.pid };
  });
}

export async function stopService(root, id, { reason = 'stop' } = {}) {
  assertSupported();
  const profiles = await loadRuntimeProfiles(root);
  const service = serviceById(profiles, id);
  return withServiceLock(root, id, async () => {
    const run = await readRun(root, id);
    const current = await computeState(root, service, run);
    if (current.state === 'stopped') return { id, state: 'stopped', already: true };
    if (current.state === 'failed') {
      // Nothing to signal; acknowledge the failure so the service reads as stopped.
      Object.assign(run, { stoppedAt: new Date().toISOString(), stopReason: 'acknowledged-failure' });
      await writeRun(root, run);
      return { id, state: 'stopped', acknowledged: true };
    }
    if (current.state === 'unknown') {
      // Clear our record only; the process itself is not provably ours and is not touched.
      Object.assign(run, { stoppedAt: new Date().toISOString(), stopReason: 'record-cleared-unmanaged' });
      await writeRun(root, run);
      throw new RuntimeError('RUNTIME_UNMANAGED', `Service ${id}: ${current.reason} Its record was cleared; no process was signalled.`);
    }
    // Ours: graceful signal to its own group, wait, then SIGKILL the group. Descendants
    // that left the group are tracked from the verified leader and killed only while
    // their own start time still matches.
    const tracked = descendantsOf(run.pid);
    run.stopRequestedAt = new Date().toISOString();
    await writeRun(root, run);
    signalGroup(run.pgid, service.stopSignal);
    const deadline = Date.now() + service.stopTimeoutSeconds * 1000;
    while (Date.now() < deadline && (ownership(run) === 'ours' || groupAlive(run.pgid))) await sleep(POLL_MS);
    let forced = false;
    // The group id cannot be reused while any member of the group is alive, so a group
    // that still exists is the one this service started.
    if (ownership(run) === 'ours' || groupAlive(run.pgid)) {
      signalGroup(run.pgid, 'SIGKILL');
      forced = true;
      await sleep(300);
    }
    for (const entry of tracked) signalIfSame(entry, 'SIGKILL');
    await sleep(100);
    const survivors = [
      ...(ownership(run) === 'ours' || groupAlive(run.pgid) ? [run.pid] : []),
      ...tracked.filter((entry) => entry.start !== null && processStartTime(entry.pid) === entry.start).map((entry) => entry.pid)
    ];
    Object.assign(run, { stoppedAt: new Date().toISOString(), stopReason: reason, forced, survivors });
    await writeRun(root, run);
    return { id, state: survivors.length ? 'unknown' : 'stopped', forced, survivors };
  });
}

export async function restartService(root, id, { startedBy = 'cli' } = {}) {
  const stopped = await stopService(root, id, { reason: 'restart' });
  if (stopped.survivors?.length) throw new RuntimeError('RUNTIME_STOP_INCOMPLETE', `Service ${id} did not stop cleanly (still running: ${stopped.survivors.join(', ')}); not restarted.`);
  return startService(root, id, { startedBy });
}

export async function stopAllServices(root) {
  const profiles = await loadRuntimeProfiles(root);
  const results = [];
  // Reverse dependency order: dependents first.
  for (const service of [...profiles.services].reverse()) {
    const run = await readRun(root, service.id);
    if (!run || run.stoppedAt) continue;
    try {
      results.push(await stopService(root, service.id));
    } catch (error) {
      results.push({ id: service.id, error: error.message, code: error.code });
    }
  }
  return results;
}
