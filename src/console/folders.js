// Console folder chooser (1.4.0, PF-0057; owner decision Q-003): lists the subfolders of a
// folder inside the user's home folder so the developer never has to type an absolute path.
//
// - Directories only: no file is listed, opened or read; a folder's contents are only
//   probed for three markers (.git, .yallaflow, empty) with lstat/readdir.
// - Home-bounded: the requested folder and every listed entry are resolved with realpath
//   and must stay inside the real home folder. A symbolic link is listed only when its
//   target is a directory inside home; anything else is left out.
// - Hidden folders (a leading dot) are not listed.
// - Read-only: nothing here writes, creates or changes anything.
import { lstat, readdir, realpath, stat } from 'node:fs/promises';
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

async function markers(dir) {
  const [git, yallaflow] = await Promise.all([present(path.join(dir, '.git')), present(path.join(dir, '.yallaflow'))]);
  let empty = false;
  let readable = true;
  try {
    const handle = await readdir(dir);
    empty = handle.length === 0;
  } catch {
    readable = false;
  }
  return { git, yallaflow, empty, readable };
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
