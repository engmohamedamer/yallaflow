// The Console's list of projects (v1.2.0): a user-level file, never inside a repository.
// $XDG_CONFIG_HOME/yallaflow/console.json (or ~/.config/…, %APPDATA%\yallaflow\… on
// Windows), mode 0600. It holds only workspace paths; project state stays in each
// project's own .yallaflow (the single source of truth).
import { mkdir, readFile, writeFile, rename, chmod } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { findProjectRoot } from '../core/workspace.js';

export function registryPath(env = process.env) {
  if (env.YALLAFLOW_CONSOLE_CONFIG) return env.YALLAFLOW_CONSOLE_CONFIG;
  const base = process.platform === 'win32'
    ? (env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'))
    : (env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'));
  return path.join(base, 'yallaflow', 'console.json');
}

export async function loadRegistry(file = registryPath()) {
  try {
    const data = JSON.parse(await readFile(file, 'utf8'));
    return { version: 1, projects: Array.isArray(data.projects) ? data.projects.filter((entry) => typeof entry?.root === 'string') : [] };
  } catch (error) {
    if (error.code === 'ENOENT') return { version: 1, projects: [] };
    throw new Error(`The console project list ${file} is not readable JSON (${error.message}). Fix or remove it.`);
  }
}

async function saveRegistry(registry, file) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(temp, `${JSON.stringify(registry, null, 2)}\n`, { mode: 0o600 });
  await chmod(temp, 0o600).catch(() => {});
  await rename(temp, file);
}

export async function addProject(dir, file = registryPath()) {
  const root = await findProjectRoot(path.resolve(dir));
  if (!root) throw new Error(`No .yallaflow workspace found at ${dir}. Run \`yallaflow init\` there first.`);
  const registry = await loadRegistry(file);
  if (registry.projects.some((entry) => entry.root === root)) return { root, added: false };
  registry.projects.push({ root, addedAt: new Date().toISOString() });
  await saveRegistry(registry, file);
  return { root, added: true };
}

export async function removeProject(dir, file = registryPath()) {
  // Accept the folder as added (its workspace root) or exactly as saved (a gone folder).
  const target = (await findProjectRoot(path.resolve(dir))) ?? path.resolve(dir);
  const registry = await loadRegistry(file);
  const kept = registry.projects.filter((entry) => entry.root !== target && entry.root !== path.resolve(dir));
  if (kept.length === registry.projects.length) return { root: target, removed: false };
  await saveRegistry({ ...registry, projects: kept }, file);
  return { root: target, removed: true };
}
