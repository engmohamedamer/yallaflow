// Read-only runtime observation (PF-0072): which containers run and which ports are held,
// right now. Fixed argv only (never a discovered command), a short timeout, bounded output,
// no shell. What it sees is transient state for the Review and the start pre-flight; it is
// never stored as project knowledge. A missing tool is reported, not treated as "nothing".
import { execFile } from 'node:child_process';

const TIMEOUT_MS = 4000;
const MAX_BUFFER = 2 * 1024 * 1024;

function probe(file, args) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER, shell: false, windowsHide: true, env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', LANG: 'C' } }, (error, stdout) => {
      if (error) resolve({ ok: false, reason: error.code === 'ENOENT' ? `${file} is not installed` : error.killed ? `${file} did not answer in time` : `${file} failed` });
      else resolve({ ok: true, stdout: String(stdout) });
    });
  });
}

// "0.0.0.0:80->80/tcp, :::80->80/tcp, 0.0.0.0:4991->443/tcp" → [80, 4991]
export function publishedPorts(text) {
  const ports = new Set();
  for (const match of String(text ?? '').matchAll(/:(\d+)->\d+\/tcp/g)) ports.add(Number(match[1]));
  return [...ports].sort((a, b) => a - b);
}

function labelsOf(text) {
  const labels = {};
  for (const part of String(text ?? '').split(',')) {
    const at = part.indexOf('=');
    if (at > 0) labels[part.slice(0, at)] = part.slice(at + 1);
  }
  return labels;
}

export async function observeContainers() {
  const result = await probe('docker', ['ps', '--no-trunc', '--format', '{{json .}}']);
  if (!result.ok) return { available: false, reason: result.reason, containers: [] };
  const containers = [];
  for (const line of result.stdout.split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      const labels = labelsOf(entry.Labels);
      containers.push({
        name: String(entry.Names ?? '').split(',')[0],
        image: String(entry.Image ?? ''),
        project: labels['com.docker.compose.project'] ?? null,
        service: labels['com.docker.compose.service'] ?? null,
        workingDir: labels['com.docker.compose.project.working_dir'] ?? null,
        ports: publishedPorts(entry.Ports),
        state: String(entry.State ?? 'running')
      });
    } catch { /* a line that is not JSON is skipped */ }
  }
  return { available: true, containers };
}

// Listening TCP ports with their owner where the system tells us (own processes only).
export async function observeListeners() {
  if (process.platform === 'linux') {
    const result = await probe('ss', ['-ltnpH']);
    if (!result.ok) return { available: false, reason: result.reason, listeners: [] };
    const listeners = [];
    for (const line of result.stdout.split('\n')) {
      const cols = line.trim().split(/\s+/);
      if (cols.length < 4) continue;
      const port = Number(cols[3].split(':').at(-1));
      if (!Number.isInteger(port)) continue;
      const owner = /users:\(\("([^"]+)",pid=(\d+)/.exec(line);
      listeners.push({ port, process: owner ? owner[1] : null, pid: owner ? Number(owner[2]) : null });
    }
    return { available: true, listeners };
  }
  if (process.platform === 'darwin') {
    const result = await probe('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-F', 'pcn']);
    if (!result.ok) return { available: false, reason: result.reason, listeners: [] };
    const listeners = [];
    let pid = null;
    let name = null;
    for (const line of result.stdout.split('\n')) {
      if (line.startsWith('p')) pid = Number(line.slice(1));
      else if (line.startsWith('c')) name = line.slice(1);
      else if (line.startsWith('n')) { const port = Number(line.split(':').at(-1)); if (Number.isInteger(port)) listeners.push({ port, process: name, pid }); }
    }
    return { available: true, listeners };
  }
  return { available: false, reason: `${process.platform} is not supported`, listeners: [] };
}

export async function observeRuntime() {
  const [docker, ports] = await Promise.all([observeContainers(), observeListeners()]);
  return { observedAt: new Date().toISOString(), docker, ports };
}

// Who holds a port: a container (by name) or a process, as far as the observation tells.
export function portOwner(observation, port, { exceptProject = null } = {}) {
  const container = observation.docker.containers.find((entry) => entry.ports.includes(port) && (!exceptProject || entry.project !== exceptProject));
  if (container) return `container ${container.name}${container.project ? ` (Compose project ${container.project})` : ''}`;
  const listener = observation.ports.listeners.find((entry) => entry.port === port);
  if (listener?.process) return `process ${listener.process}${listener.pid ? ` (pid ${listener.pid})` : ''}`;
  return listener ? 'a process of another user' : null;
}

// Running containers that belong to a Compose project or carry one of its container names.
export function runningContainersOf(observation, { project, containerNames = [], workingDir = null }) {
  return observation.docker.containers.filter((entry) => (project && entry.project === project) || containerNames.includes(entry.name) || (workingDir && entry.workingDir === workingDir));
}
