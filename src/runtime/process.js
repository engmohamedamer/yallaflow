// Process identity and signalling for runtime services (1.4.0, owner decision 2).
// A process is "ours" only while its pid AND its start time match the run record; a pid
// the system reused for something else is never signalled. Nothing is ever found or
// killed by port or by name.
import { execFile, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { safeEnvironment, windowsSystemProgram } from '../utils/command.js';

// PF-0176: Windows joins Linux and macOS. Its process identity comes from the system's own
// process table (pid, parent pid, creation time), read below.
export const SUPPORTED = ['linux', 'darwin', 'win32'].includes(process.platform);
export const WINDOWS = process.platform === 'win32';

// ---------------------------------------------------------------- Windows process table (PF-0176)
// Windows has no /proc, no `ps -o lstart` and no process groups. One fixed, read-only query of
// Win32_Process gives every process's pid, parent pid, creation time and name. It is started as
// powershell.exe from System32 with argv only (the script is a constant, nothing is interpolated),
// without a profile and without a window.
// PF-0181 (code review): it is read asynchronously (one shared read at a time) by the runtime's
// async entry points, so the console never waits on it; synchronous identity checks use that
// result. A table that cannot be read gives no identity at all: such a process is
// 'unverifiable', never signalled, and its record is never cleared.
const TABLE_SCRIPT = "Get-CimInstance -ClassName Win32_Process | ForEach-Object { '{0}|{1}|{2}|{3}' -f $_.ProcessId, $_.ParentProcessId, $(if ($_.CreationDate) { $_.CreationDate.ToUniversalTime().ToString('o') } else { '' }), $_.Name }";
export const WINDOWS_TABLE_ARGV = Object.freeze(['-NoProfile', '-NonInteractive', '-Command', TABLE_SCRIPT]);
const TABLE_TTL_MS = 3000;
let tableCache = null; // { at, table }
let lastReadFailed = false;
let inFlight = null;

// "pid|ppid|creation (ISO, UTC)|name" lines → Map(pid → { pid, ppid, start, name }).
export function parseProcessTable(text) {
  const table = new Map();
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const [pid, ppid, start, ...name] = line.trim().split('|');
    const id = Number(pid);
    if (!Number.isInteger(id) || id <= 0 || !/^\d{4}-\d\d-\d\dT/.test(start ?? '')) continue;
    table.set(id, { pid: id, ppid: Number(ppid) || 0, start, name: name.join('|') || null });
  }
  return table;
}

export function windowsPowerShell(env = process.env) {
  return windowsSystemProgram('WindowsPowerShell\\v1.0\\powershell.exe', env);
}

const PS_OPTIONS = Object.freeze({ encoding: 'utf8', timeout: 20_000, windowsHide: true, shell: false, maxBuffer: 16 * 1024 * 1024 });
function keep(table) {
  const usable = table && table.size ? table : null;
  lastReadFailed = !usable;
  tableCache = usable ? { at: Date.now(), table: usable } : null;
  return usable;
}

// Async read (the normal path). `read` is for tests: () => Map | null (or a Promise of it).
export async function readWindowsTable({ fresh = false, read = null } = {}) {
  if (!fresh && tableCache && Date.now() - tableCache.at < TABLE_TTL_MS) return tableCache.table;
  if (read) return keep(await read());
  inFlight ??= new Promise((resolve) => {
    execFile(windowsPowerShell(), WINDOWS_TABLE_ARGV, PS_OPTIONS, (error, stdout) => resolve(error ? null : parseProcessTable(stdout)));
  }).then(keep).finally(() => { inFlight = null; });
  return inFlight;
}

// Reads the table ahead of the synchronous identity checks of one request (Windows only).
export async function primeProcessTable({ fresh = false } = {}) {
  if (WINDOWS) await readWindowsTable({ fresh });
}

// Synchronous view for identity checks: the kept table; read synchronously only as a fallback
// when nothing was read yet (a caller outside the primed entry points).
export function windowsProcessTable({ fresh = false, read = null } = {}) {
  if (!fresh && tableCache && Date.now() - tableCache.at < TABLE_TTL_MS) return tableCache.table;
  if (read) return keep(read());
  const result = spawnSync(windowsPowerShell(), WINDOWS_TABLE_ARGV, PS_OPTIONS);
  return keep(result.status === 0 && !result.error ? parseProcessTable(result.stdout) : null);
}

export function windowsTableUnreadable() {
  return lastReadFailed;
}

export function clearProcessTable() {
  tableCache = null;
  lastReadFailed = false;
}

function windowsStartTime(pid) {
  return windowsProcessTable()?.get(pid)?.start ?? null;
}

// The processes a leader started (directly or not), from one table. PF-0181: the leader must be
// the process with the expected creation time (a pid Windows gave to another program is never
// expanded), and a child counts only when it was created after its parent.
export function windowsDescendants(table, pid, expectedStart) {
  const leader = table?.get(pid);
  if (!leader || !expectedStart || leader.start !== expectedStart) return [];
  return expand(table, [{ pid: leader.pid, start: leader.start }]).slice(1);
}

// members (verified { pid, start }) plus every process created after one of them with it as
// parent. A member whose pid now belongs to another process (other creation time) is not expanded.
function expand(table, members) {
  const found = members.map((entry) => ({ pid: entry.pid, start: entry.start }));
  for (let index = 0; index < found.length && found.length < 500; index++) {
    const parent = found[index];
    const holder = table.get(parent.pid);
    if (holder && holder.start !== parent.start) continue; // the pid was reused: not this parent
    for (const entry of table.values()) {
      if (entry.ppid !== parent.pid || entry.pid === parent.pid || entry.start < parent.start || found.some((seen) => seen.pid === entry.pid)) continue;
      found.push({ pid: entry.pid, start: entry.start });
    }
  }
  return found;
}

// Ends a verified leader and the processes it started (PF-0176, PF-0181). Windows cannot ask a
// detached console program to stop gracefully, so this stop is forceful. Each process is ended
// on its own (never `taskkill /T`, which follows parent links without creation times), and only
// while its creation time still matches; the tree is re-read on every pass, so a child started
// during the stop is included. → { survivors: [pid…], verified, leaderMatched }
export async function windowsStopTree(run, { readTable = (fresh) => readWindowsTable({ fresh }), kill = (pid) => process.kill(pid), sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), waitMs = 5000 } = {}) {
  const same = (table, entry) => table?.get(entry.pid)?.start === entry.start;
  let table = await readTable(true);
  if (!table) return { survivors: [], verified: false, leaderMatched: false };
  const leader = { pid: run.pid, start: run.startTime };
  if (!run.startTime || !same(table, leader)) return { survivors: [], verified: true, leaderMatched: false };
  let members = expand(table, [leader]);
  const deadline = Date.now() + waitMs;
  for (;;) {
    for (const entry of members) if (same(table, entry)) { try { kill(entry.pid); } catch { /* gone */ } }
    await sleep(200);
    table = await readTable(true);
    if (!table) return { survivors: members.filter((entry) => isAliveQuick(entry.pid)).map((entry) => entry.pid), verified: false, leaderMatched: true };
    members = expand(table, members);
    if (!members.some((entry) => same(table, entry)) || Date.now() > deadline) break;
  }
  return { survivors: members.filter((entry) => same(table, entry)).map((entry) => entry.pid), verified: true, leaderMatched: true };
}

// A child this process still holds (an install, a setup job): its pid cannot be reused while the
// handle is open, so its creation time is read from the table and its tree is ended the same
// verified way as a service (never `taskkill /T`). Falls back to ending the child alone.
export async function windowsEndHeldTree(child, options = {}) {
  const table = await readWindowsTable({ fresh: true });
  const start = table?.get(child.pid)?.start ?? null;
  if (!start) { try { child.kill(); } catch { /* gone */ } return { survivors: [], verified: false }; }
  return windowsStopTree({ pid: child.pid, startTime: start }, { waitMs: 5000, ...options });
}

function isAliveQuick(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}

// Linux: /proc/<pid>/stat field 22 (start time in clock ticks since boot).
// macOS: `ps -o lstart=` (argv, no shell). null when unknown.
export function processStartTime(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  if (process.platform === 'linux') {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      if (fields[0] === 'Z') return null; // a zombie is not running
      return fields[19] ?? null;
    } catch {
      return null;
    }
  }
  if (process.platform === 'darwin') {
    const result = spawnSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8', timeout: 2000 });
    const text = result.status === 0 ? result.stdout.trim() : '';
    return text || null;
  }
  if (process.platform === 'win32') return windowsStartTime(pid);
  return null;
}

// The process group a pid currently leads or belongs to (null when unknown).
export function processGroupOf(pid) {
  if (process.platform === 'linux') {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      const value = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[2]);
      return Number.isInteger(value) ? value : null;
    } catch {
      return null;
    }
  }
  if (process.platform === 'darwin') {
    const result = spawnSync('ps', ['-o', 'pgid=', '-p', String(pid)], { encoding: 'utf8', timeout: 2000 });
    const value = Number(result.stdout?.trim());
    return result.status === 0 && Number.isInteger(value) ? value : null;
  }
  return null;
}

export function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

export function groupAlive(pgid) {
  if (WINDOWS) return false; // no process groups on Windows: members are tracked one by one
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

// 'ours' | 'gone' | 'other' | 'unverifiable' (Windows: its process table could not be read, so
// nothing is known; never signalled, and the record is kept).
export function identify(pid, startTime) {
  if (!pidAlive(pid)) return 'gone';
  const now = processStartTime(pid);
  if (now === null && WINDOWS && windowsTableUnreadable()) return 'unverifiable';
  if (now === null) return pidAlive(pid) ? 'other' : 'gone';
  return now === startTime ? 'ours' : 'other';
}

// Linux (/proc) and Windows (the process table): descendants of pid (including ones that left its process group), with
// their start times, so they can be signalled later only if they are still the same.
export function descendantsOf(pid, expectedStart = null) {
  if (WINDOWS) return windowsDescendants(windowsProcessTable(), pid, expectedStart);
  if (process.platform !== 'linux') return [];
  const found = [];
  const queue = [pid];
  while (queue.length && found.length < 500) {
    const current = queue.shift();
    let tasks = [];
    try {
      tasks = readdirSync(`/proc/${current}/task`);
    } catch {
      continue;
    }
    for (const task of tasks) {
      let children = '';
      try {
        children = readFileSync(`/proc/${current}/task/${task}/children`, 'utf8');
      } catch {
        continue;
      }
      for (const child of children.split(' ').map(Number).filter(Boolean)) {
        if (!found.some((entry) => entry.pid === child)) {
          found.push({ pid: child, start: processStartTime(child) });
          queue.push(child);
        }
      }
    }
  }
  return found;
}

export function signalGroup(pgid, signal) {
  if (WINDOWS) return false; // never a negative pid on Windows; see windowsStopTree
  try {
    process.kill(-pgid, signal);
    return true;
  } catch {
    return false;
  }
}

export function signalIfSame({ pid, start }, signal) {
  if (start === null || processStartTime(pid) !== start) return false;
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
}

// Owner decision 4: a fixed minimal base plus the variables the profile names. Nothing
// else from the developer's environment (credentials, tokens, API keys) is inherited.
export const BASE_ENV = Object.freeze(['PATH', 'HOME', 'LANG', 'LC_ALL', 'TERM', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'TZ']);

// PF-0176: through the shared allow-list, so a Windows service also gets the system variables
// programs need there (Path in any case, SystemRoot, APPDATA, TEMP, …); unchanged on Linux and macOS.
export function serviceEnvironment(names, source = process.env, platform = process.platform) {
  return safeEnvironment([...BASE_ENV, ...names], source, platform);
}
