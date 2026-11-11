// Files YallaFlow manages inside a project but that may already exist (PF-0125, security): the
// agent bootstrap files at the project root (CLAUDE.md, AGENTS.md) and the agent contract
// .yallaflow/AGENT.md. A repository controls these paths, so they are never followed blindly:
//
// - every folder between the project root and the file must be a real folder, never a link
//   (so a .yallaflow link cannot send the contract elsewhere);
// - the file itself may be absent, a regular file, or a link to an existing regular file in the
//   SAME folder (the supported CLAUDE.md -> AGENTS.md). A link leaving the folder or the project,
//   a dangling link (creating its target would follow it), or anything that is not a regular file
//   is unsafe and never read for writing or written. Limiting links to the same folder also means
//   a process inside the project cannot redirect a write by swapping a subfolder for a link.
// - Writes re-check right before writing, create an exclusive temporary file (never opened through
//   a link) with the final permissions, and rename it over the real path: a link swapped in after
//   the check is replaced, not followed. A read-only file stays read-only (the write fails).
import { constants as fsConstants } from 'node:fs';
import { access, chmod, lstat, open, realpath, rename, rm, stat } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

const unsafe = (file, reason, extra = {}) => ({ path: file, realPath: null, exists: true, link: false, safe: false, reason, ...extra });

export async function resolveManagedFile(root, file) {
  const realRoot = await realpath(root);
  const inside = (target) => target === realRoot || target.startsWith(`${realRoot}${path.sep}`);
  const segments = path.relative(root, file).split(path.sep);
  let dir = realRoot;
  for (const segment of segments.slice(0, -1)) {
    dir = path.join(dir, segment);
    const info = await lstat(dir).catch(() => null);
    if (info?.isSymbolicLink()) return unsafe(file, `inside a linked folder (${segment})`);
    if (info && !info.isDirectory()) return unsafe(file, `inside something that is not a folder (${segment})`);
  }
  const own = path.join(dir, segments.at(-1));
  let info;
  try {
    info = await lstat(own);
  } catch (error) {
    if (error.code === 'ENOENT') return { path: file, realPath: own, exists: false, link: false, safe: true };
    throw error;
  }
  if (!info.isSymbolicLink()) return info.isFile() ? { path: file, realPath: own, exists: true, link: false, safe: true } : unsafe(file, 'not a regular file');
  let target;
  try {
    target = await realpath(own);
  } catch {
    return unsafe(file, 'a link to a file that does not exist', { link: true });
  }
  if (!inside(target)) return unsafe(file, 'a link to a file outside this project', { link: true });
  if (path.dirname(target) !== dir) return unsafe(file, 'a link to a file in another folder', { link: true });
  if (!(await stat(target)).isFile()) return unsafe(file, 'a link to something that is not a regular file', { link: true });
  return { path: file, realPath: target, exists: true, link: true, safe: true };
}

async function renameWithRetry(from, to) {
  // Windows briefly refuses a rename while another process reads the file (same as writeTextAtomic).
  for (let attempt = 0; ; attempt++) {
    try {
      return await rename(from, to);
    } catch (error) {
      if (attempt >= 4 || !['EPERM', 'EBUSY', 'EACCES'].includes(error.code) || process.platform !== 'win32') throw error;
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
    }
  }
}

export async function writeManaged(root, file, content) {
  const managed = await resolveManagedFile(root, file);
  if (!managed.safe) throw Object.assign(new Error(`${path.relative(root, file)} is ${managed.reason}; YallaFlow never writes through it. No files were changed.`), { code: 'MANAGED_FILE_UNSAFE' });
  const target = managed.realPath;
  let mode = 0o666; // a new file gets the usual permissions (the umask applies)
  if (managed.exists) {
    await access(target, fsConstants.W_OK); // a read-only file stays read-only
    mode = (await stat(target)).mode & 0o7777;
  }
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
  try {
    // Created with the final permissions, so a private file is never briefly readable by others.
    const handle = await open(temporary, 'wx', mode);
    try {
      await handle.writeFile(content, 'utf8');
    } finally {
      await handle.close();
    }
    if (managed.exists) await chmod(temporary, mode); // the exact mode, independent of the umask
    await renameWithRetry(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}
