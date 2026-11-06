// One agent console per checkout (v1.3.0). An agent-enabled console holds
// .yallaflow/local/agent-console.lock for as long as it runs, so the one-session-per-
// checkout rule also holds across separate console processes: a second console on the
// same checkout cannot start, resume, or connect an agent session, and never overwrites
// the first console's Claude bridge file.
//
// The lock records the holder's process identity the same way as the workspace write lock
// (src/utils/lock.js): pid, host, start time, boot id. A holder that is gone (crash,
// reboot, reused pid) is stale and the lock is reclaimed atomically.
import { readFile, rm, stat } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { createLockFile, liveness, lockRecord, removeStaleLock } from '../utils/lock.js';
import { inLocalDir, safeLocalDir } from './local-files.js';

export const CHECKOUT_LOCK = 'agent-console.lock';
const UNREADABLE_STALE_MS = 30_000;

export function checkoutLockFile(root) {
  return path.join(root, '.yallaflow', 'local', CHECKOUT_LOCK);
}

export async function readCheckoutLock(root) {
  const file = checkoutLockFile(root);
  let raw;
  let info;
  try {
    [raw, info] = await Promise.all([readFile(file, 'utf8'), stat(file)]);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  try {
    const holder = JSON.parse(raw);
    return { ...holder, ...liveness(holder) };
  } catch {
    return { unreadable: true, stale: Date.now() - info.mtimeMs > UNREADABLE_STALE_MS };
  }
}

// → { acquired: true, release } or { acquired: false, holder }
export async function acquireCheckoutLock(root, { port } = {}) {
  const dir = await safeLocalDir(root, '.yallaflow', 'local');
  for (let attempt = 0; attempt < 5; attempt++) {
    const nonce = randomBytes(8).toString('hex');
    try {
      await inLocalDir(dir, (base) => createLockFile(path.join(base, CHECKOUT_LOCK), lockRecord('yallaflow console --agents', nonce, { port: port ?? null })));
      return { acquired: true, nonce, release: () => releaseCheckoutLock(root, nonce) };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    const holder = await readCheckoutLock(root);
    if (!holder) continue; // released meanwhile
    if (!holder.stale) return { acquired: false, holder };
    await removeStaleLock(checkoutLockFile(root), holder);
  }
  return { acquired: false, holder: await readCheckoutLock(root) };
}

async function releaseCheckoutLock(root, nonce) {
  try {
    const current = JSON.parse(await readFile(checkoutLockFile(root), 'utf8'));
    if (current.nonce === nonce) await rm(checkoutLockFile(root), { force: true });
  } catch {
    // gone already, or not ours
  }
}

export function lockedError(holder) {
  const who = holder && !holder.unreadable
    ? `another YallaFlow console (pid ${holder.pid}${holder.port ? `, port ${holder.port}` : ''}, since ${holder.startedAt})`
    : 'another YallaFlow console';
  return Object.assign(new Error(`Agent sessions in this checkout belong to ${who}. Use that console, or stop it first. If no such console is running (for example after a crash on another machine name), delete .yallaflow/local/${CHECKOUT_LOCK}.`), { status: 409, code: 'CHECKOUT_LOCKED' });
}
