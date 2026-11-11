// Console folder chooser (1.4.0, PF-0057; owner decision Q-003): lists the subfolders of a
// folder inside the user's home folder so the developer never has to type an absolute path.
//
// - Directories only: no file is listed, opened or read; a folder's contents are only
//   probed for three markers (.git, .yallaflow, empty) with lstat/readdir.
// - Home-bounded: the requested folder and every listed entry are resolved with realpath
//   and must stay inside the real home folder. A symbolic link is listed only when its
//   target is a directory inside home; anything else is left out.
// - Hidden folders (a leading dot) are not listed.
// - Read-only, except createFolder (PF-0123): one new, empty folder, only when asked for.
import { lstat, mkdir, readdir, realpath, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const MAX_ENTRIES = 500;

export class FolderError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const inside = (base, target) => target === base || target.startsWith(base.endsWith(path.sep) ? base : `${base}${path.sep}`);

export async function homeRoot(home = os.homedir()) {
  try {
    return await realpath(home);
  } catch {
    throw new FolderError(500, 'HOME_UNAVAILABLE', 'Your home folder could not be read.');
  }
}

// Resolves a requested folder (absolute, or empty for home) to a real folder inside home.
export async function resolveInsideHome(requested, home) {
  const base = await homeRoot(home);
  if (requested === undefined || requested === null || requested === '') return base;
  if (typeof requested !== 'string' || requested.length > 4096 || requested.includes('\0') || !path.isAbsolute(requested)) {
    throw new FolderError(400, 'BAD_PATH', 'Send an absolute folder path.');
  }
  let real;
  try {
    real = await realpath(path.resolve(requested));
  } catch {
    throw new FolderError(404, 'NOT_FOUND', 'That folder does not exist.');
  }
  if (!inside(base, real)) throw new FolderError(403, 'OUTSIDE_HOME', 'Only folders inside your home folder can be browsed.');
  // Hidden folders are never browsed, even when asked for by path (security review, PF-0057).
  if (path.relative(base, real).split(path.sep).some((segment) => segment.startsWith('.'))) throw new FolderError(403, 'HIDDEN_FOLDER', 'Hidden folders are not browsed.');
  let info;
  try {
    info = await stat(real);
  } catch {
    throw new FolderError(404, 'NOT_FOUND', 'That folder does not exist.');
  }
  if (!info.isDirectory()) throw new FolderError(400, 'NOT_A_FOLDER', 'That path is not a folder.');
  return real;
}

const present = async (file) => { try { await lstat(file); return true; } catch { return false; } };

// PF-0123: what kind of codebase a folder holds, from file NAMES only (the same directory read
// that tells whether it is empty; no file is opened). The first match wins.
const STACK_MARKERS = Object.freeze([
  ['laravel', (names) => names.has('artisan') && names.has('composer.json')],
  ['php', (names) => names.has('composer.json')],
  ['node', (names) => names.has('package.json')],
  ['python', (names) => names.has('pyproject.toml') || names.has('requirements.txt') || names.has('setup.py')],
  ['go', (names) => names.has('go.mod')],
  ['ruby', (names) => names.has('Gemfile')],
  ['java', (names) => names.has('pom.xml') || names.has('build.gradle') || names.has('build.gradle.kts')],
  ['rust', (names) => names.has('Cargo.toml')],
  ['dotnet', (names) => [...names].some((name) => /\.(sln|csproj|fsproj)$/.test(name))]
]);

async function markers(dir) {
  const [git, yallaflow] = await Promise.all([present(path.join(dir, '.git')), present(path.join(dir, '.yallaflow'))]);
  let empty = false;
  let readable = true;
  let stack = null;
  try {
    const handle = await readdir(dir);
    empty = handle.length === 0;
    const names = new Set(handle);
    stack = STACK_MARKERS.find(([, test]) => test(names))?.[0] ?? null;
  } catch {
    readable = false;
  }
  // yallaflow: a YallaFlow project · code: an existing codebase (a known manifest, or a Git
  // repository with files) · empty · folder: anything else.
  const kind = yallaflow ? 'yallaflow' : stack || (git && !empty) ? 'code' : empty ? 'empty' : 'folder';
  return { git, yallaflow, empty, readable, stack, kind };
}

// PF-0123: a new folder for the new-project location. One plain name (no separators, not
// hidden, no control characters), created with a non-recursive mkdir inside a real folder that
// passes the same home-bounded checks as browsing. An existing name is never reused.
const FOLDER_NAME = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,79}$/u;
export async function createFolder(parentRequested, name, { home = os.homedir() } = {}) {
  const base = await homeRoot(home);
  const parent = await resolveInsideHome(parentRequested, base);
  if (typeof name !== 'string' || !FOLDER_NAME.test(name) || name.trim() !== name || name.endsWith('.')) {
    throw new FolderError(400, 'BAD_NAME', 'Use letters, numbers, spaces, dots, dashes or underscores; it cannot start with a dot.');
  }
  const target = path.join(parent, name);
  try {
    await mkdir(target);
  } catch (error) {
    if (error.code === 'EEXIST') throw new FolderError(409, 'EXISTS', 'A folder with that name already exists here.');
    if (error.code === 'EACCES' || error.code === 'EPERM') throw new FolderError(403, 'UNWRITABLE', 'You cannot create a folder here.');
    throw new FolderError(500, 'MKDIR_FAILED', 'The folder could not be created.');
  }
  return listFolders(target, { home: base });
}

// { path, parent (null at home), home, folders: [{ name, path, git, yallaflow, empty, readable }], truncated }
export async function listFolders(requested, { home = os.homedir() } = {}) {
  const base = await homeRoot(home);
  const dir = await resolveInsideHome(requested, base);
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    throw new FolderError(403, 'UNREADABLE', 'That folder cannot be read.');
  }
  const candidates = entries
    .filter((entry) => !entry.name.startsWith('.') && (entry.isDirectory() || entry.isSymbolicLink()))
    .sort((a, b) => a.name.localeCompare(b.name));
  const folders = [];
  for (const entry of candidates) {
    if (folders.length >= MAX_ENTRIES) break;
    const full = path.join(dir, entry.name);
    let real = full;
    if (entry.isSymbolicLink()) {
      try {
        real = await realpath(full);
        if (!inside(base, real) || !(await stat(real)).isDirectory()) continue;
      } catch {
        continue;
      }
    }
    folders.push({ name: entry.name, path: full, link: entry.isSymbolicLink(), ...(await markers(real)) });
  }
  return {
    path: dir,
    parent: dir === base ? null : path.dirname(dir),
    home: base,
    here: await markers(dir),
    folders,
    truncated: candidates.length > folders.length && folders.length >= MAX_ENTRIES
  };
}
