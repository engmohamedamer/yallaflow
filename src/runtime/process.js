// Process identity and signalling for runtime services (1.4.0, owner decision 2).
// A process is "ours" only while its pid AND its start time match the run record; a pid
// the system reused for something else is never signalled. Nothing is ever found or
// killed by port or by name.
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';

export const SUPPORTED = process.platform === 'linux' || process.platform === 'darwin';

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
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

// 'ours' | 'gone' | 'other' (pid alive with a different identity: never ours).
export function identify(pid, startTime) {
  if (!pidAlive(pid)) return 'gone';
  const now = processStartTime(pid);
  if (now === null) return pidAlive(pid) ? 'other' : 'gone';
  return now === startTime ? 'ours' : 'other';
}

// Linux only: descendants of pid (including ones that left its process group), with
// their start times, so they can be signalled later only if they are still the same.
export function descendantsOf(pid) {
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

export function serviceEnvironment(names, source = process.env) {
  const env = {};
  for (const name of [...BASE_ENV, ...names]) if (typeof source[name] === 'string') env[name] = source[name];
  return env;
}
