// The PATH a newly opened terminal would get (PF-0173). On Windows a process's PATH is a copy
// taken from its parent when it starts; an installer (winget, Git for Windows, Composer-Setup,
// Node.js) writes the new folder into the registry and no running process sees it. The console
// therefore reads the current machine and user Path from the registry, the way Windows builds a
// new terminal's PATH, and adds every folder that is new to its own PATH. Nothing is written:
// the system PATH is never changed.
//
// - reg.exe is started by its full System32 path, argv only, never a shell.
// - Only folders with a drive letter or a UNC share are added; a folder whose %VARIABLE% cannot be expanded is skipped.
// - The console's own PATH stays first: a folder it already uses keeps its place.
// - Linux and macOS: the environment is returned unchanged (an install there lands in a folder
//   that is already on PATH, such as /usr/bin or /opt/homebrew/bin).
//
// Exercised on Linux with a simulated reg.exe; not yet verified on a real Windows machine.
import { execFile } from 'node:child_process';
import path from 'node:path';
import { envValue } from '../agents/detect.js';
import { windowsSystemProgram } from './command.js';

export const REGISTRY_PATH_KEYS = Object.freeze([
  Object.freeze({ scope: 'machine', key: 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment' }),
  Object.freeze({ scope: 'user', key: 'HKCU\\Environment' })
]);
const CACHE_MS = 1500;
let cache = null; // { at, value: { machine, user } }

// `reg query <key> /v Path` output → the value (REG_SZ or REG_EXPAND_SZ), or null.
export function parseRegQuery(text) {
  const match = /^\s*Path\s+(REG_SZ|REG_EXPAND_SZ)\s+(.*?)\s*$/im.exec(String(text ?? ''));
  return match ? { type: match[1], value: match[2] } : null;
}

// %NAME% → its value from env (any case); an unknown variable is left as it is.
export function expandWindowsVariables(value, env) {
  return String(value).replace(/%([^%\s;]+)%/g, (whole, name) => {
    const found = envValue(env, name, 'win32');
    return typeof found === 'string' ? found : whole;
  });
}

const normal = (entry) => entry.trim().replace(/^"(.*)"$/, '$1').replace(/[\\/]+$/, '').toLowerCase();

// current PATH text + candidate folders → { path, added }. Order: the current entries first.
export function mergeWindowsPath(current, candidates) {
  const entries = String(current ?? '').split(';').filter((entry) => entry.trim());
  const seen = new Set(entries.map(normal));
  const added = [];
  for (const raw of candidates) {
    const entry = String(raw ?? '').trim().replace(/^"(.*)"$/, '$1');
    // PF-0181: a drive letter or a UNC share; a root-relative \tools would follow the current drive.
    if (!entry || entry.includes('%') || !/^(?:[A-Za-z]:[\\/]|\\\\[^\\])/.test(entry) || /[\u0000-\u001f]/.test(entry)) continue;
    const key = normal(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    added.push(entry);
  }
  return { path: [...entries, ...added].join(';'), added };
}

function regQuery(key, env, run) {
  return new Promise((resolve) => {
    try {
      run(windowsSystemProgram('reg.exe', env), ['query', key, '/v', 'Path'], { windowsHide: true, timeout: 5000, shell: false, maxBuffer: 256 * 1024 }, (error, stdout) => {
        resolve(error ? null : parseRegQuery(stdout));
      });
    } catch {
      resolve(null);
    }
  });
}

// { machine, user }: each the expanded registry value, or null when it could not be read.
export async function readRegistryPath(env = process.env, { run = execFile, maxAgeMs = CACHE_MS } = {}) {
  if (cache && Date.now() - cache.at < maxAgeMs && run === execFile) return cache.value;
  const out = {};
  for (const { scope, key } of REGISTRY_PATH_KEYS) {
    const found = await regQuery(key, env, run);
    out[scope] = found ? (found.type === 'REG_EXPAND_SZ' ? expandWindowsVariables(found.value, env) : found.value) : null;
  }
  if (run === execFile) cache = { at: Date.now(), value: out };
  return out;
}

export function clearFreshPathCache() {
  cache = null;
}

// → { env, added, refreshed }. env is a copy whose PATH (under the name it already has; Path on
// Windows) also holds every registry folder that is new. Never throws: a registry that cannot be
// read leaves the environment as it was (refreshed: false).
export async function freshToolEnvironment(env = process.env, { platform = process.platform, readRegistry = readRegistryPath } = {}) {
  if (platform !== 'win32') return { env, added: [], refreshed: false };
  let registry;
  try { registry = await readRegistry(env); } catch { registry = null; }
  if (!registry || (registry.machine === null && registry.user === null)) return { env, added: [], refreshed: false };
  const name = Object.keys(env ?? {}).find((key) => key.toLowerCase() === 'path') ?? 'Path';
  const candidates = [registry.machine, registry.user].filter((value) => typeof value === 'string').flatMap((value) => value.split(';'));
  const merged = mergeWindowsPath(envValue(env, 'PATH', 'win32'), candidates);
  return { env: { ...env, [name]: merged.path }, added: merged.added, refreshed: true };
}

export async function toolEnvironment(env = process.env, options = {}) {
  return (await freshToolEnvironment(env, options)).env;
}

// Where a tool's own Windows installer puts it, for a diagnostic only ("installed, but not on
// the PATH YallaFlow can see"). Nothing is ever started from here.
const KNOWN_WINDOWS_LOCATIONS = Object.freeze({
  git: [['ProgramFiles', 'Git', 'cmd', 'git.exe'], ['ProgramW6432', 'Git', 'cmd', 'git.exe'], ['LOCALAPPDATA', 'Programs', 'Git', 'cmd', 'git.exe']],
  docker: [['ProgramFiles', 'Docker', 'Docker', 'resources', 'bin', 'docker.exe']],
  node: [['ProgramFiles', 'nodejs', 'node.exe']]
});
export function knownWindowsLocations(tool, env = process.env) {
  return (KNOWN_WINDOWS_LOCATIONS[tool] ?? []).map(([base, ...rest]) => {
    const root = envValue(env, base, 'win32');
    return typeof root === 'string' && path.win32.isAbsolute(root) ? path.win32.join(root, ...rest) : null;
  }).filter(Boolean);
}
