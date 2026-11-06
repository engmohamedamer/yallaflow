// Minimal Agent Client Protocol client (v1.3.0): JSON-RPC 2.0 over a child process's
// stdio, newline-delimited. No dependency. The child is started with argv only (never a
// shell) and the caller decides its environment.
//
// Process lifecycle: on POSIX the agent runs in its own process group, so ending it
// signals everything it started (the adapter, `codex app-server`, commands of a turn).
// After the signals, close() checks what is still alive and reports it; a caller never
// claims a full stop it could not verify. The real adapter also exits when its stdin
// closes, so a console that dies abruptly does not leave it behind.
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';

const MAX_LINE = 8 * 1024 * 1024; // a runaway line is a protocol error, not unbounded memory
const GROUPS = process.platform !== 'win32';
const SETTLE_MS = 1500; // how long survivors get to exit after SIGKILL before they are reported

const SAMPLE_MS = 1000;

// Live connections, so a forced exit can still signal every agent group synchronously.
const LIVE = new Set();

// Synchronous last resort (second Ctrl-C, SIGHUP, process exit): SIGKILL every agent
// process group and tracked descendant this process started. Never awaits.
export function killAllAgentsNow() {
  for (const conn of LIVE) conn.signalAll('SIGKILL');
}

// Linux /proc/<pid>/stat fields after the command name: [0] state, [19] start time.
function procFields(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 2).split(' ');
  } catch {
    return null;
  }
}

// A remembered descendant is the same process only while its start time matches, so a
// pid the system has since reused for something else is never signalled.
const sameProcess = (pid, start) => {
  const fields = procFields(pid);
  return Boolean(fields) && fields[0] !== 'Z' && fields[19] === start;
};

// Linux only: every descendant of pid, including ones that left the process group.
export function descendants(pid) {
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
        if (!found.includes(child)) { found.push(child); queue.push(child); }
      }
    }
  }
  return found;
}

const groupAlive = (pgid) => {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
};

export class AcpConnection {
  constructor(command, args, { cwd, env, onRequest, onNotification, onStderr } = {}) {
    this.child = spawn(command, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], shell: false, detached: GROUPS });
    this.pgid = GROUPS ? this.child.pid ?? null : null;
    this.known = new Map(); // pid → start time: descendants seen while running (Linux)
    // What the cleanup check can see: 'tracked' (Linux: the group plus every descendant
    // seen while running), 'group' (other POSIX: the process group only), 'none' (Windows).
    this.coverage = !GROUPS ? 'none' : process.platform === 'linux' ? 'tracked' : 'group';
    if (this.child.pid) LIVE.add(this);
    if (this.child.pid && process.platform === 'linux') {
      this.sampler = setInterval(() => this.remember(), SAMPLE_MS);
      this.sampler.unref();
    }
    this.nextId = 1;
    this.pending = new Map();
    this.onRequest = onRequest ?? (() => Promise.reject(Object.assign(new Error('not supported'), { code: -32601 })));
    this.onNotification = onNotification ?? (() => {});
    this.closed = false;
    // A process that fails to spawn (ENOENT, EACCES) emits 'error' and 'close' but never
    // 'exit'; settle on whichever comes first so nothing waits forever.
    this.exited = new Promise((resolve) => {
      let settled = false;
      const settle = (code, signal, error) => {
        this.closed = true;
        clearInterval(this.sampler);
        // Kept in LIVE until cleanup ran: a forced exit still signals what is left.
        this.fail(error ?? Object.assign(new Error('agent process exited'), { code: 'AGENT_EXITED' }));
        if (!settled) { settled = true; resolve({ code, signal }); }
      };
      this.child.on('error', (error) => { if (this.child.pid === undefined) settle(null, null, error); else this.fail(error); });
      this.child.on('exit', (code, signal) => settle(code, signal));
      this.child.on('close', (code, signal) => settle(code, signal));
    });
    let buffer = '';
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk) => {
      buffer += chunk;
      if (buffer.length > MAX_LINE) { this.kill(); return; }
      let cut;
      while ((cut = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, cut).trim();
        buffer = buffer.slice(cut + 1);
        if (!line) continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue; // non-JSON noise on stdout is ignored
        }
        this.dispatch(message);
      }
    });
    // A closed or crashed agent must never take the console down with it.
    this.child.stdin.on('error', () => {});
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (chunk) => onStderr?.(chunk));
  }

  fail(error) {
    for (const entry of this.pending.values()) entry.reject(error);
    this.pending.clear();
  }

  dispatch(message) {
    if (message.id !== undefined && (Object.hasOwn(message, 'result') || Object.hasOwn(message, 'error'))) {
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id);
      if (message.error) entry.reject(Object.assign(new Error(message.error.message ?? 'agent error'), { code: message.error.code, data: message.error.data }));
      else entry.resolve(message.result);
      return;
    }
    if (typeof message.method !== 'string') return;
    if (message.id !== undefined) {
      Promise.resolve()
        .then(() => this.onRequest(message.method, message.params ?? {}))
        .then((result) => this.write({ jsonrpc: '2.0', id: message.id, result: result ?? null }))
        .catch((error) => this.write({ jsonrpc: '2.0', id: message.id, error: { code: Number.isInteger(error.code) ? error.code : -32603, message: String(error.message ?? error) } }));
      return;
    }
    this.onNotification(message.method, message.params ?? {});
  }

  write(message) {
    if (this.closed || this.ending || this.child.stdin.destroyed || this.child.stdin.writableEnded) return false;
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
    return true;
  }

  request(method, params, timeoutMs = 120_000) {
    if (this.closed) return Promise.reject(Object.assign(new Error('agent process is not running'), { code: 'AGENT_EXITED' }));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = timeoutMs ? setTimeout(() => { this.pending.delete(id); reject(Object.assign(new Error(`${method} timed out`), { code: 'AGENT_TIMEOUT' })); }, timeoutMs) : null;
      this.pending.set(id, {
        resolve: (value) => { if (timer) clearTimeout(timer); resolve(value); },
        reject: (error) => { if (timer) clearTimeout(timer); reject(error); }
      });
      this.write({ jsonrpc: '2.0', id, method, params });
    });
  }

  notify(method, params) {
    return this.write({ jsonrpc: '2.0', method, params });
  }

  kill(signal = 'SIGTERM') {
    if (!this.closed) this.child.kill(signal);
  }

  // Signals the agent's whole process group (POSIX) and every descendant seen; never
  // anything outside what this connection started.
  signalAll(signal) {
    if (this.pgid) {
      try {
        process.kill(-this.pgid, signal);
      } catch {
        // the group is already empty
      }
    } else {
      this.kill(signal);
    }
    for (const [pid, start] of this.known) {
      if (!sameProcess(pid, start)) continue;
      try {
        process.kill(pid, signal);
      } catch {
        // gone
      }
    }
  }

  remember() {
    if (!this.child.pid || this.closed) return;
    for (const pid of descendants(this.child.pid)) {
      const start = procFields(pid)?.[19];
      if (start && !this.known.has(pid)) this.known.set(pid, start);
    }
  }

  survivors() {
    const left = [...this.known].filter(([pid, start]) => sameProcess(pid, start)).map(([pid]) => pid);
    if (this.pgid && groupAlive(this.pgid) && !left.length) left.push(`group ${this.pgid}`);
    return left;
  }

  // Ends the agent and everything it started. Returns { complete, survivors, verified }:
  // complete=false means something could not be terminated and is still running.
  async close(graceMs = 2000) {
    if (!this.closed) {
      this.remember();
      this.ending = true;
      this.child.stdin.end();
      this.signalAll('SIGTERM');
      const timer = setTimeout(() => { this.remember(); this.signalAll('SIGKILL'); }, graceMs);
      await this.exited;
      clearTimeout(timer);
    }
    return this.cleanup(graceMs);
  }

  // After the agent process is gone (ended or crashed): make sure nothing it started is
  // left, and say so honestly when something is. `complete` covers only what `coverage`
  // can see: a process that detached itself before it was sampled is not visible.
  async cleanup(graceMs = 2000) {
    if (this.cleanupResult) return this.cleanupResult;
    if (!GROUPS) {
      LIVE.delete(this);
      return (this.cleanupResult = { complete: false, verified: false, coverage: 'none', survivors: [] });
    }
    let left = this.survivors();
    if (left.length) {
      this.signalAll('SIGTERM');
      const end = Date.now() + graceMs;
      while (Date.now() < end && (left = this.survivors()).length) await new Promise((resolve) => setTimeout(resolve, 50));
      if (left.length) {
        this.signalAll('SIGKILL');
        const settle = Date.now() + SETTLE_MS;
        while (Date.now() < settle && (left = this.survivors()).length) await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    LIVE.delete(this);
    this.cleanupResult = { complete: left.length === 0, verified: true, coverage: this.coverage, survivors: left.map(String) };
    return this.cleanupResult;
  }
}
