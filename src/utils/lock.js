// Workspace write lock (v1.2.0): several agents can run YallaFlow in one checkout, so
// every mutating command holds `.yallaflow/local/lock` while it writes. The lock is an
// exclusive-create file ({pid, host, startedAt, command}); there is no daemon.
//
// - Re-entrant inside one process (a command that calls another writer keeps one lock).
// - Waits with backoff up to `timeoutMs`, then fails naming the holder.
// - A lock whose holder process is gone on this host is stale and is removed by an
//   atomic rename-claim, so a contender never deletes a lock another process has just
//   taken. A lock from another host is never removed automatically.
// - It leaves no trace: the local/ directory is removed again when it is empty, so a
//   single-user workspace keeps having no local/ directory between commands.
// - The lock file is never empty: its content is written to a private temp file first
//   and then linked into place (atomic create-if-absent). A crash can therefore leave a
//   complete lock (stale once its process is gone) but never an unreadable one; an
//   unreadable file (older layouts, foreign writes) counts as stale after 30 s.
// - Liveness is the holder's identity, not just its pid: on Linux the lock records the
//   boot id and the process start time, so a reboot or a pid reused by an unrelated
//   process is recognized as stale.
import { link, open, readFile, readdir, rename, rm, rmdir, mkdir, stat, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

const LOCK_RELATIVE_PATH = path.join('local', 'lock');
const DEFAULT_TIMEOUT_MS = 60_000; // long enough for a document extraction or media hashing by another writer
const UNREADABLE_STALE_MS = 30_000; // a writer finishes writing its lock in milliseconds
const UNVERIFIABLE_CLEAR_MS = 60 * 60 * 1000; // doctor --clear-lock: holder liveness unprovable

let held = null; // { file, depth, nonce }

export function lockFilePath(root) {
  return path.join(root, '.yallaflow', LOCK_RELATIVE_PATH);
}

// Linux process identity: the boot id and the process start time (clock ticks since
// boot, field 22 of /proc/<pid>/stat). null elsewhere.
function bootId() {
  try {
    return readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
  } catch {
    return null;
  }
}

function procStat(pid) {
  try {
    const statLine = readFileSync(`/proc/${pid}/stat`, 'utf8');
    return statLine.slice(statLine.lastIndexOf(')') + 2).split(' ');
  } catch {
    return null;
  }
}

function processStart(pid) {
  return procStat(pid)?.[19] ?? null;
}

// A zombie (exited, not yet reaped by its parent) still answers kill(pid, 0); it holds
// nothing and will never release, so it counts as gone.
function isZombie(pid) {
  return procStat(pid)?.[0] === 'Z';
}

export async function readLock(root) {
  const file = lockFilePath(root);
  let raw;
  let info;
  try {
    [raw, info] = await Promise.all([readFile(file, 'utf8'), stat(file)]);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  const ageMs = Date.now() - info.mtimeMs;
  let holder;
  try {
    holder = JSON.parse(raw);
  } catch {
    return { unreadable: true, ageMs, stale: ageMs > UNREADABLE_STALE_MS };
  }
  return { ...holder, ageMs, ...liveness(holder) };
}

// { stale, verified }: verified = the holder was positively identified as alive (same
// pid AND same process start time) — false when only the pid could be checked.
export function liveness(holder) {
  if (!holder || holder.host !== os.hostname() || !Number.isInteger(holder.pid)) return { stale: false, verified: false };
  if (holder.pid === process.pid) return { stale: false, verified: true };
  const currentBoot = bootId();
  if (holder.boot && currentBoot && holder.boot !== currentBoot) return { stale: true, verified: true };
  // Taken before this machine last booted: its process is certainly gone (any process
  // now using that pid is a different one). Works on every platform via os.uptime().
  const taken = Date.parse(holder.startedAt);
  if (Number.isFinite(taken) && taken < Date.now() - os.uptime() * 1000 - 60_000) return { stale: true, verified: true };
  try {
    process.kill(holder.pid, 0);
  } catch (error) {
    if (error.code === 'ESRCH') return { stale: true, verified: true };
    // EPERM: a live process of another user — fall through to the identity check
  }
  if (isZombie(holder.pid)) return { stale: true, verified: true };
  const start = holder.start ? processStart(holder.pid) : null;
  if (holder.start && start !== null) return start === holder.start ? { stale: false, verified: true } : { stale: true, verified: true };
  return { stale: false, verified: false };
}

// YALLAFLOW_LOCK_TIMEOUT_MS overrides the wait (tests and slow shared disks).
function defaultTimeout() {
  const value = Number(process.env.YALLAFLOW_LOCK_TIMEOUT_MS);
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_TIMEOUT_MS;
}

export async function acquireWorkspaceLock(root, { command = 'yallaflow', timeoutMs = defaultTimeout() } = {}) {
  const file = lockFilePath(root);
  if (held && held.file === file) {
    held.depth += 1;
    return () => release(file);
  }
  const deadline = Date.now() + timeoutMs;
  let delay = 25;
  for (;;) {
    try {
      const created = await mkdir(path.dirname(file), { recursive: true });
      // A local/ directory created just for the lock carries a '*' .gitignore, so a lock a
      // crash leaves behind never shows up in `git status`; it goes away with the lock.
      if (created) await writeFile(path.join(path.dirname(file), '.gitignore'), '# YallaFlow: transient workspace lock (removed with the lock)\n*\n', { flag: 'wx' }).catch(() => {});
      await sweepLeftovers(path.dirname(file));
      const nonce = randomBytes(8).toString('hex');
      await createLockFile(file, lockRecord(command, nonce));
      held = { file, depth: 1, nonce };
      return () => release(file);
    } catch (error) {
      // ENOENT: another process removed the empty local/ directory between our mkdir
      // and the create — simply try again.
      if (error.code === 'ENOENT') continue;
      if (error.code !== 'EEXIST') throw error;
    }
    const holder = await readLock(root);
    if (!holder) continue; // released between our attempt and the read
    if (holder?.stale) {
      await removeStaleLock(file, holder);
      continue;
    }
    if (Date.now() >= deadline) throw busyError(holder);
    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(delay * 2, 250);
  }
}

// nonce: this acquisition's identity — release and stale removal act only on the exact
// lock they judged, never on one another process has taken meanwhile.
export function lockRecord(command, nonce, extra = {}) {
  const boot = bootId();
  const start = processStart(process.pid);
  return `${JSON.stringify({ pid: process.pid, host: os.hostname(), startedAt: new Date().toISOString(), command, nonce, ...(boot ? { boot } : {}), ...(start ? { start } : {}), ...extra })}\n`;
}

// Atomic create-if-absent of a complete file: write a private temp file, then link it
// to the lock path (EEXIST when held). Where hard links are unsupported, fall back to an
// exclusive create (the 30 s unreadable rule covers its tiny crash window).
export async function createLockFile(file, content) {
  const temp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.new`;
  await writeFile(temp, content, { flag: 'wx' });
  try {
    await link(temp, file);
  } catch (error) {
    if (!['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EXDEV', 'EMLINK'].includes(error.code)) throw error;
    const handle = await open(file, 'wx');
    try {
      await handle.writeFile(content);
    } finally {
      await handle.close();
    }
  } finally {
    await rm(temp, { force: true });
  }
}

// Temp (.new) and claim (.stale.*) files a crashed process may have left in local/.
async function sweepLeftovers(dir) {
  let names;
  try {
    names = await readdir(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (!/^lock\.(\d+\.[0-9a-f]+\.new|stale\..+)$/.test(name)) continue;
    try {
      const info = await stat(path.join(dir, name));
      if (Date.now() - info.mtimeMs > UNREADABLE_STALE_MS) await rm(path.join(dir, name), { force: true });
    } catch {
      // already gone
    }
  }
}

async function release(file) {
  if (!held || held.file !== file) return;
  held.depth -= 1;
  if (held.depth > 0) return;
  const { nonce } = held;
  held = null;
  let current = null;
  try {
    current = JSON.parse(await readFile(file, 'utf8'));
  } catch {
    current = null;
  }
  // Only our own lock is removed: if it was (wrongly) taken over, the new holder's stays.
  if (current?.nonce === nonce) await rm(file, { force: true });
  await removeEmptyLocalDir(file);
}

// local/ holds a Shared Project's identity and focus; in a single-user workspace (or a
// fresh clone) it would hold only the lock. Removing it when empty keeps "no local/
// outside Shared Projects" true between commands. A non-empty directory is kept.
async function removeEmptyLocalDir(file) {
  const dir = path.dirname(file);
  try {
    const names = await readdir(dir);
    // Only the lock's own .gitignore left: the directory existed for the lock alone.
    if (names.length === 1 && names[0] === '.gitignore') {
      const content = await readFile(path.join(dir, '.gitignore'), 'utf8');
      if (content.startsWith('# YallaFlow: transient workspace lock')) await rm(path.join(dir, '.gitignore'), { force: true });
    }
    await rmdir(dir);
  } catch {
    // not empty (another holder's lock, shared identity/state) or already gone
  }
}

// Claim the stale lock by renaming it to a name only this process knows (atomic: one
// contender wins), then delete it only if it is still the stale holder we judged. If a
// live process took the lock in between, give that lock back.
export async function removeStaleLock(file, holder) {
  const claim = `${file}.stale.${process.pid}.${randomBytes(4).toString('hex')}`;
  try {
    await rename(file, claim);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  let claimed = null;
  try {
    claimed = JSON.parse(await readFile(claim, 'utf8'));
  } catch {
    claimed = null;
  }
  const same = holder.unreadable
    ? claimed === null
    : Boolean(claimed && (holder.nonce ? claimed.nonce === holder.nonce : claimed.pid === holder.pid && claimed.startedAt === holder.startedAt));
  if (!same) {
    // Not the lock we judged: put it back (a new holder created meanwhile stands).
    try {
      await link(claim, file);
    } catch (error) {
      if (error.code !== 'EEXIST') {
        try {
          await stat(file);
        } catch {
          await rename(claim, file).catch(() => {});
        }
      }
    }
  }
  await rm(claim, { force: true });
}

export async function withWorkspaceLock(root, command, fn, { timeoutMs } = {}) {
  const releaseLock = await acquireWorkspaceLock(root, { command, ...(timeoutMs !== undefined ? { timeoutMs } : {}) });
  try {
    return await fn();
  } finally {
    await releaseLock();
  }
}

// doctor --clear-lock. Removes a stale lock, an unreadable one, or one whose holder
// cannot be positively identified (no process start time recorded or readable) after an
// hour. A positively identified live holder, or another host's lock, is never removed.
export async function clearStaleLock(root) {
  const holder = await readLock(root);
  if (!holder) return { cleared: false, reason: 'no lock is held' };
  if (holder.unreadable) {
    if (!holder.stale) return { cleared: false, reason: 'the lock file is being written right now; try again in 30 seconds' };
    await removeStaleLock(lockFilePath(root), holder);
    await removeEmptyLocalDir(lockFilePath(root));
    return { cleared: true, reason: 'removed an unreadable lock file' };
  }
  if (holder.host !== os.hostname()) return { cleared: false, reason: `the lock belongs to another host (${holder.host}); remove it there` };
  const unprovable = !holder.stale && !holder.verified && holder.ageMs > UNVERIFIABLE_CLEAR_MS;
  if (!holder.stale && !unprovable) {
    return { cleared: false, reason: `the lock is held by a running process (pid ${holder.pid}, ${holder.command})${holder.verified ? '' : '; if that process is not YallaFlow, the lock can be cleared once it is an hour old'}` };
  }
  await removeStaleLock(lockFilePath(root), { ...holder, stale: true });
  await removeEmptyLocalDir(lockFilePath(root));
  if (unprovable) return { cleared: true, reason: `removed a lock older than an hour whose holder (pid ${holder.pid}) could not be confirmed as the YallaFlow process that took it` };
  return { cleared: true, reason: `removed a stale lock left by pid ${holder.pid} (${holder.command})` };
}

function busyError(holder) {
  const who = holder && !holder.unreadable
    ? `\`${holder.command}\` (pid ${holder.pid} on ${holder.host}, since ${holder.startedAt})`
    : 'another YallaFlow command';
  const error = new Error(
    `The workspace is busy: ${who} is writing to .yallaflow.\n\n` +
    'Nothing was changed. Run the command again when it finishes.\n' +
    'If no YallaFlow command is running, check with `yallaflow doctor` and clear a stale lock with `yallaflow doctor --clear-lock`.'
  );
  error.code = 'WORKSPACE_BUSY';
  return error;
}
