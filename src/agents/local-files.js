// Safe writes under .yallaflow/local/ (v1.3.0 Agent Workspace).
//
// Threat model: the realistic adversary is a process that can already write inside the
// checkout (for example the supervised agent in workspace-write mode) and plants or swaps
// a symbolic link so that a console write (bridge token, session records, decisions,
// launch files) lands outside the checkout. The console runs as the same user, so such a
// redirect could reach files the agent itself may not write. This module is not a sandbox
// and gives no isolation from a process running as the same user outside the agent's
// sandbox: such a process can change the files directly.
//
// - Every directory from the project root down, and the target, must be a real directory
//   or file, never a symbolic link.
// - Linux: each write resolves the directories through opened handles (O_DIRECTORY |
//   O_NOFOLLOW, one level at a time) and writes through /proc/self/fd/<handle>/<name>, so
//   a link swapped in after the check cannot redirect it.
// - Other platforms: the directories are checked with lstat just before the write; a swap
//   in the instant between check and write is not excluded (documented limitation).
// - Whole-file writes go through a temporary file (exclusive create, which never follows a
//   link) and a rename, which replaces a link instead of following it. Appends open the
//   file with O_NOFOLLOW.
import { constants, existsSync } from 'node:fs';
import { lstat, mkdir, open, rename, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

export const ANCHORED_WRITES = process.platform === 'linux' && existsSync('/proc/self/fd') && constants.O_DIRECTORY !== undefined && constants.O_NOFOLLOW !== undefined;

// dir path → { root, segments }: how safeLocalDir reached it, so writes can re-walk it.
const anchors = new Map();

function linkError(target) {
  return Object.assign(new Error(`Refusing to write through a symbolic link: ${target}`), { code: 'SYMLINK_REFUSED' });
}

async function assertNotLink(target) {
  try {
    if ((await lstat(target)).isSymbolicLink()) throw linkError(target);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

// Creates `root/<segments...>` one level at a time, refusing any symbolic link on the way.
export async function safeLocalDir(root, ...segments) {
  let dir = path.resolve(root);
  for (const segment of segments) {
    dir = path.join(dir, segment);
    await assertNotLink(dir);
    await mkdir(dir).catch((error) => { if (error.code !== 'EEXIST') throw error; });
    if (!(await lstat(dir)).isDirectory()) throw Object.assign(new Error(`Not a directory: ${dir}`), { code: 'NOT_A_DIRECTORY' });
  }
  anchors.set(dir, { root: path.resolve(root), segments });
  return dir;
}

// Runs fn(base) where base is a path that names `dir` race-free: on Linux a
// /proc/self/fd/<n> path of a handle opened level by level without following links.
async function withAnchoredDir(dir, fn) {
  const anchor = anchors.get(dir);
  if (!ANCHORED_WRITES || !anchor) {
    if (anchor) await safeLocalDir(anchor.root, ...anchor.segments); // re-check just before the write
    return fn(dir);
  }
  const flags = constants.O_RDONLY | constants.O_DIRECTORY;
  let handle = await open(anchor.root, flags);
  try {
    for (const segment of anchor.segments) {
      let next;
      try {
        next = await open(`/proc/self/fd/${handle.fd}/${segment}`, flags | constants.O_NOFOLLOW);
      } catch (error) {
        if (error.code === 'ELOOP' || error.code === 'ENOTDIR') throw linkError(path.join(dir));
        throw error;
      }
      await handle.close();
      handle = next;
    }
    return await fn(`/proc/self/fd/${handle.fd}`);
  } finally {
    await handle.close();
  }
}

export async function safeWriteFile(dir, name, data, mode = 0o600) {
  return withAnchoredDir(dir, async (base) => {
    const target = path.join(base, name);
    await assertNotLink(target);
    const temp = path.join(base, `.${name}.${randomBytes(4).toString('hex')}.tmp`);
    try {
      await writeFile(temp, data, { mode, flag: 'wx' });
      await rename(temp, target);
    } catch (error) {
      await rm(temp, { force: true });
      throw error;
    }
    return path.join(dir, name);
  });
}

export async function safeAppendFile(dir, name, data, mode = 0o600) {
  return withAnchoredDir(dir, async (base) => {
    const handle = await open(path.join(base, name), constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW, mode);
    try {
      // A hard link is not stopped by O_NOFOLLOW: refuse a file that also lives elsewhere.
      const info = await handle.stat();
      if (!info.isFile() || info.nlink !== 1) throw Object.assign(new Error(`Refusing to append to a file with other links: ${path.join(dir, name)}`), { code: 'HARDLINK_REFUSED' });
      await handle.appendFile(data);
    } finally {
      await handle.close();
    }
  });
}

// Runs fn(base) for writes that need their own primitives (the checkout lock).
export function inLocalDir(dir, fn) {
  return withAnchoredDir(dir, fn);
}

export async function safeRemove(dir, name) {
  // rm never follows a link at the final path component; it removes the link itself.
  await withAnchoredDir(dir, (base) => rm(path.join(base, name), { force: true })).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
}
