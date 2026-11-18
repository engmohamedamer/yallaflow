// Which YallaFlow consoles run on this machine, for the start message only (PF-0173).
// A console that finds its usual port taken says whether an earlier console holds it (that
// one keeps the PATH it was started with) instead of moving to the next port silently.
//
// The record is a small user-level file beside the console's project list, never in a
// repository: { pid, port, startedAt } per running console. No network is used: an entry
// counts only while its process is alive; dead entries are dropped on the next write.
import { randomBytes } from 'node:crypto';
import { lstat, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { registryPath } from './registry.js';

export function instancesPath(env = process.env) {
  return path.join(path.dirname(registryPath(env)), 'console-instances.json');
}

const alive = (pid) => {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
};

async function readEntries(file) {
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.size > 64 * 1024) return [];
    const raw = JSON.parse(await readFile(file, 'utf8'));
    return (Array.isArray(raw?.consoles) ? raw.consoles : []).filter((entry) => Number.isInteger(entry?.pid) && entry.pid > 0 && Number.isInteger(entry?.port));
  } catch {
    return [];
  }
}

async function writeEntries(file, entries) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(temp, `${JSON.stringify({ consoles: entries }, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  await rename(temp, file);
}

// The running console (another process) that recorded this port, or null.
export async function consoleOnPort(port, { file = instancesPath(), isAlive = alive } = {}) {
  return (await readEntries(file)).find((entry) => entry.port === port && entry.pid !== process.pid && isAlive(entry.pid)) ?? null;
}

// Best effort: a console that cannot write the record still runs.
export async function recordConsole(port, { file = instancesPath(), isAlive = alive } = {}) {
  try {
    const entries = (await readEntries(file)).filter((entry) => entry.pid !== process.pid && isAlive(entry.pid));
    await writeEntries(file, [...entries, { pid: process.pid, port, startedAt: new Date().toISOString() }]);
  } catch { /* the message is a courtesy */ }
}

export async function forgetConsole({ file = instancesPath(), isAlive = alive } = {}) {
  try {
    const entries = await readEntries(file);
    if (!entries.some((entry) => entry.pid === process.pid)) return;
    await writeEntries(file, entries.filter((entry) => entry.pid !== process.pid && isAlive(entry.pid)));
  } catch { /* best effort */ }
}
