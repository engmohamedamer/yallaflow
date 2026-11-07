// Per-user runtime state (1.4.0): command trust, run records and per-service locks live
// OUTSIDE the repository, in the user's config folder, one directory per checkout:
//
//   $XDG_CONFIG_HOME/yallaflow/runtime/<checkout fingerprint>/{trust.json, runs/, locks/}
//
// Why: anything inside the checkout (including git-ignored .yallaflow/local/) can be
// written by a process that can write the repository — a sandboxed agent or a crafted
// repository. Trust and process ownership must not be forgeable from there (security
// review of PF-0047). Directories are created 0700 and must be owned by this user and
// not be symbolic links; files are replaced atomically and never written through links.
import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, realpath, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { registryPath } from '../console/registry.js';

export async function checkoutFingerprint(root) {
  return createHash('sha256').update(await realpath(root)).digest('hex').slice(0, 32);
}

export function runtimeStateBase(env = process.env) {
  return path.join(path.dirname(registryPath(env)), 'runtime');
}

async function privateDir(dir) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const info = await lstat(dir);
  if (info.isSymbolicLink() || !info.isDirectory()) throw Object.assign(new Error(`Runtime state folder ${dir} is not a real folder; refusing to use it.`), { code: 'RUNTIME_STATE_UNSAFE' });
  if (typeof process.getuid === 'function' && info.uid !== process.getuid()) throw Object.assign(new Error(`Runtime state folder ${dir} belongs to another user; refusing to use it.`), { code: 'RUNTIME_STATE_UNSAFE' });
  if ((info.mode & 0o077) !== 0) await chmod(dir, 0o700);
  return dir;
}

export async function stateDir(root, ...segments) {
  const base = await privateDir(runtimeStateBase());
  let dir = await privateDir(path.join(base, await checkoutFingerprint(root)));
  for (const segment of segments) dir = await privateDir(path.join(dir, segment));
  return dir;
}

export async function readState(root, relative) {
  const file = path.join(runtimeStateBase(), await checkoutFingerprint(root), relative);
  let handle;
  try {
    handle = await open(file, constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0));
    if (!(await handle.stat()).isFile()) return null;
    return JSON.parse(await handle.readFile('utf8'));
  } catch {
    return null;
  } finally {
    await handle?.close();
  }
}

export async function writeState(root, relative, value) {
  const dir = await stateDir(root, ...path.dirname(relative).split('/').filter((part) => part && part !== '.'));
  const file = path.join(dir, path.basename(relative));
  const temp = path.join(dir, `.${path.basename(relative)}.${randomBytes(4).toString('hex')}.tmp`);
  try {
    await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    await rename(temp, file); // replaces a planted link instead of following it
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

export async function removeState(root, relative) {
  await rm(path.join(runtimeStateBase(), await checkoutFingerprint(root), relative), { force: true });
}
