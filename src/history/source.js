// Read-only sources of YallaFlow records for work-history reconciliation (1.4.0, PF-0052).
//
//   gitSource(root, commit)   files under .yallaflow/ in a commit, via read-only Git plumbing
//   dirSource(dir)            files under <dir>/.yallaflow/ in a checkout, including
//                             uncommitted and untracked ones
//
// Nothing is ever written. Symbolic links are never followed (a link is reported, not
// read); only regular files are read, without following a link at the final component.
// Personal state (.yallaflow/local/) and lineages are not records and are skipped.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';

const SKIP = (relative) => relative.startsWith('.yallaflow/local/') || relative.startsWith('.yallaflow/lineages/');
const MAX_BUFFER = 256 * 1024 * 1024;
export const sha256 = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

export function git(cwd, args, { binary = false } = {}) {
  const result = spawnSync('git', args, { cwd, encoding: binary ? null : 'utf8', maxBuffer: MAX_BUFFER, shell: false });
  if (result.status !== 0) {
    const message = binary ? String(result.stderr) : result.stderr;
    throw Object.assign(new Error(`git ${args[0]} failed: ${message.trim().split('\n')[0] || 'unknown error'}`), { code: 'HISTORY_GIT' });
  }
  return result.stdout;
}

export function resolveCommit(root, ref) {
  if (typeof ref !== 'string' || !ref || ref.startsWith('-')) throw Object.assign(new Error('A Git ref is required.'), { code: 'HISTORY_USAGE' });
  return git(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).trim();
}

export function mergeBase(root, a, b) {
  return git(root, ['merge-base', a, b]).trim();
}

// { files: Map(relative -> { size, sha256, read() }), skipped: [{ path, reason }], kind, ref }
export function gitSource(root, commit) {
  const files = new Map();
  const skipped = [];
  const out = git(root, ['ls-tree', '-r', '-z', '--full-tree', '-l', commit, '--', '.yallaflow']);
  for (const entry of out.split('\0').filter(Boolean)) {
    const tab = entry.indexOf('\t');
    const [mode, type, oid, size] = entry.slice(0, tab).split(/\s+/);
    const relative = entry.slice(tab + 1);
    if (SKIP(relative)) continue;
    if (type !== 'blob' || mode === '120000') {
      skipped.push({ path: relative, reason: mode === '120000' ? 'symbolic link (not followed)' : `not a file (${type})` });
      continue;
    }
    let cached = null;
    files.set(relative, {
      size: Number(size),
      read() {
        cached ??= git(root, ['cat-file', 'blob', oid], { binary: true });
        return cached;
      },
      get sha256() { return sha256(this.read()); }
    });
  }
  return { kind: 'git', commit, files, skipped };
}

async function readRegular(file) {
  const handle = await open(file, constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw Object.assign(new Error('not a regular file'), { code: 'NOT_REGULAR' });
    // A hard link could bring a file from outside the checkout into a committed lineage.
    if (info.nlink !== 1) throw Object.assign(new Error('hard-linked file (not read)'), { code: 'HARD_LINK' });
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

// Reads every regular file under <dir>/.yallaflow eagerly (records are small), so the
// classification and the later import see the same bytes, and returns their hashes.
export async function dirSource(dir) {
  const real = await realpath(dir);
  const base = path.join(real, '.yallaflow');
  const files = new Map();
  const skipped = [];
  const baseInfo = await lstat(base).catch(() => null);
  if (!baseInfo || baseInfo.isSymbolicLink() || !baseInfo.isDirectory()) throw Object.assign(new Error(`${dir} has no real .yallaflow folder.`), { code: 'HISTORY_SOURCE' });
  async function walk(absolute, relative) {
    for (const entry of (await readdir(absolute, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const childAbs = path.join(absolute, entry.name);
      const childRel = `${relative}/${entry.name}`;
      if (SKIP(`${childRel}/`) || SKIP(childRel)) continue;
      const info = await lstat(childAbs);
      if (info.isSymbolicLink()) { skipped.push({ path: childRel, reason: 'symbolic link (not followed)' }); continue; }
      if (info.isDirectory()) { await walk(childAbs, childRel); continue; }
      if (!info.isFile()) { skipped.push({ path: childRel, reason: 'not a regular file' }); continue; }
      try {
        const bytes = await readRegular(childAbs);
        const digest = sha256(bytes);
        files.set(childRel, { size: bytes.length, read: () => bytes, sha256: digest });
      } catch (error) {
        skipped.push({ path: childRel, reason: error.code === 'HARD_LINK' ? 'hard-linked file (not read)' : `unreadable (${error.code ?? error.message})` });
      }
    }
  }
  await walk(base, '.yallaflow');
  return { kind: 'checkout', dir: real, files, skipped };
}

// The checkout's files layered over a commit: what is in the folder now (committed,
// modified, uncommitted, untracked), each file labelled with where its bytes came from.
export function overlay(gitSide, dirSide) {
  const files = new Map();
  for (const [relative, file] of dirSide.files) {
    const committed = gitSide.files.get(relative);
    const origin = committed && committed.sha256 === file.sha256 ? `git:${gitSide.commit}` : 'checkout:uncommitted';
    files.set(relative, { ...file, origin });
  }
  return { kind: 'checkout+git', commit: gitSide.commit, dir: dirSide.dir, files, skipped: [...gitSide.skipped, ...dirSide.skipped] };
}

export function labelOrigins(side) {
  for (const file of side.files.values()) file.origin ??= side.kind === 'git' ? `git:${side.commit}` : 'checkout';
  return side;
}
