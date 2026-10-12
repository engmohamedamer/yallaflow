import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { exists, ensureDir } from '../utils/fs.js';
import { readYaml, writeYaml } from '../core/yaml.js';
import { CLONE_TAG_ALPHABET, CLONE_TAG_LENGTH, CLONE_TAG_PATTERN, parseScopedId } from '../core/ids.js';

// Personal, machine-local runtime state for Shared Project Mode (v0.3.10). Everything
// under .yallaflow/local/ is gitignored by .yallaflow/.gitignore (written by `shared
// enable`) and is never project truth:
//
//   local/identity.yaml       this checkout's clone tag and its last allocated
//                             sequence per prefix (branch-safe ID allocation)
//   local/state/current.yaml  this developer's active work focus
//
// Project truth is shared. Personal runtime state is local.
//
// Privacy: the identity file holds a random tag, a one-way fingerprint of this
// checkout's path (never the path itself), and a creation time. Actor metadata on
// shared work (name/email) is read from `git config` at the moment work is created —
// the same values the developer's Git commits already publish — and nothing else.
export const LOCAL_DIR = 'local';
export const IDENTITY_SCHEMA_VERSION = 1;

export function localDirPath(root) {
  return path.join(root, '.yallaflow', LOCAL_DIR);
}

export function identityFilePath(root) {
  return path.join(localDirPath(root), 'identity.yaml');
}

export function generateCloneTag(bytes = randomBytes(CLONE_TAG_LENGTH)) {
  return Array.from(bytes.subarray(0, CLONE_TAG_LENGTH), (byte) => CLONE_TAG_ALPHABET[byte % CLONE_TAG_ALPHABET.length]).join('');
}

async function checkoutFingerprint(root) {
  const resolved = await realpath(root).catch(() => path.resolve(root));
  return createHash('sha256').update(resolved).digest('hex').slice(0, 16);
}

// Read-only: the stored identity, whether it belongs to this checkout, or null.
export async function readLocalIdentity(root) {
  const file = identityFilePath(root);
  if (!await exists(file)) return null;
  try {
    const identity = await readYaml(file);
    if (!CLONE_TAG_PATTERN.test(identity?.cloneTag ?? '')) return { invalid: true };
    return { ...identity, belongsHere: identity.checkout === await checkoutFingerprint(root) };
  } catch {
    return { invalid: true };
  }
}

// The clone tag used for branch-safe IDs. Created on first allocation in a checkout.
// A copied checkout (cp -r, an archive restored elsewhere) carries the original's file
// but not its path fingerprint, so it gets a fresh tag instead of reusing the
// original's ID sequence.
export async function ensureLocalIdentity(root, now = new Date().toISOString()) {
  const current = await readLocalIdentity(root);
  if (current && !current.invalid && current.belongsHere) return current;
  const identity = {
    schemaVersion: IDENTITY_SCHEMA_VERSION,
    cloneTag: generateCloneTag(),
    checkout: await checkoutFingerprint(root),
    createdAt: now
  };
  await ensureDir(localDirPath(root));
  await writeYaml(identityFilePath(root), identity);
  return { ...identity, belongsHere: true };
}

// Allocates the next branch-safe ID for this checkout. The sequence is the larger of
// what this checkout already allocated (remembered in local/identity.yaml, which no
// branch switch touches) and what exists on disk — so switching to a branch that does
// not contain earlier work, or stashing it, never reuses a number.
export async function allocateCheckoutId(root, prefix, existingNames, nextScopedId, now = new Date().toISOString()) {
  const identity = await ensureLocalIdentity(root, now);
  const fromDisk = parseScopedId(prefix, nextScopedId(prefix, existingNames, identity.cloneTag)).number;
  const remembered = Number.isInteger(identity.sequences?.[prefix]) ? identity.sequences[prefix] : 0;
  const sequence = Math.max(fromDisk, remembered + 1);
  const { belongsHere, ...stored } = identity;
  await writeYaml(identityFilePath(root), { ...stored, sequences: { ...(stored.sequences ?? {}), [prefix]: sequence } });
  return `${prefix}-${identity.cloneTag}-${String(sequence).padStart(4, '0')}`;
}

// Test and recovery helper: pins this checkout's clone tag deterministically.
export async function writeLocalIdentity(root, cloneTag, now = new Date().toISOString()) {
  if (!CLONE_TAG_PATTERN.test(cloneTag)) throw new Error(`Invalid clone tag ${JSON.stringify(cloneTag)}.`);
  const identity = { schemaVersion: IDENTITY_SCHEMA_VERSION, cloneTag, checkout: await checkoutFingerprint(root), createdAt: now };
  await ensureDir(localDirPath(root));
  await writeYaml(identityFilePath(root), identity);
  return identity;
}

// Actor metadata derived mechanically from Git configuration — no accounts, no
// registration, no roles. null when Git or the values are unavailable.
export function gitActor(root) {
  const read = (key) => {
    const result = spawnSync('git', ['config', '--get', key], { cwd: root, encoding: 'utf8' });
    return result.status === 0 ? result.stdout.trim() : '';
  };
  const name = read('user.name');
  const email = read('user.email');
  if (!name && !email) return null;
  return { ...(name ? { name } : {}), ...(email ? { email } : {}) };
}

export function describeActor(actor) {
  if (!actor) return 'unknown (git config user.name/user.email not set)';
  return actor.email ? `${actor.name ?? actor.email} <${actor.email}>` : actor.name;
}

export function validateActor(actor, label) {
  if (actor === undefined || actor === null) return [];
  if (typeof actor !== 'object' || Array.isArray(actor)) return [`${label} actor must be an object.`];
  const errors = [];
  const unknown = Object.keys(actor).filter((key) => !['name', 'email'].includes(key));
  if (unknown.length) errors.push(`${label} actor has unknown field(s): ${unknown.join(', ')}.`);
  if (!actor.name && !actor.email) errors.push(`${label} actor has neither name nor email.`);
  for (const key of ['name', 'email']) {
    if (actor[key] !== undefined && (typeof actor[key] !== 'string' || !actor[key].trim() || /[\r\n]/.test(actor[key]))) {
      errors.push(`${label} actor ${key} is malformed.`);
    }
  }
  if (typeof actor.email === 'string' && actor.email.trim() && !/^[^\s@<>]+@[^\s@<>]+$/.test(actor.email)) errors.push(`${label} actor email is malformed.`);
  return errors;
}
