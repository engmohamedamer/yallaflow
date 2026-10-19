import path from 'node:path';
import { createHash } from 'node:crypto';
import { copyFile, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { ensureDir, exists } from '../utils/fs.js';
import { workspacePath } from '../core/workspace.js';
import { assertSafeSourceName, assertWithinDirectory } from '../intake/validation.js';
import { ARTIFACT_KINDS, MAX_ARTIFACT_BYTES, MAX_ARTIFACTS_PER_RECORD, MEDIA_GITIGNORE } from './constants.js';

// Local quality artifacts (v1.1.0): screenshots, videos, traces, logs the Agent
// produced with Playwright. Each is copied byte-for-byte into
// work/<id>/quality/media/<record-id>/ and recorded with its size and SHA-256, so a
// report can tell a present file from a missing or altered one. Media is excluded from
// Git by a YallaFlow-written media/.gitignore unless quality.media.commit is true;
// the ledgers, hashes, and reports stay tracked. Nothing is ever uploaded.
export function qualityDirPath(root, workId) {
  return path.join(workspacePath(root), 'work', workId, 'quality');
}

export function mediaDirPath(root, workId) {
  return path.join(qualityDirPath(root, workId), 'media');
}

// Validates and stats every artifact before anything is copied (no partial writes on
// a bad path). Paths are the Agent's local files, resolved against `cwd`.
export async function inspectArtifacts(paths, { cwd = process.cwd(), label = 'artifact' } = {}) {
  if (paths === undefined) return [];
  if (!Array.isArray(paths) || paths.some((value) => typeof value !== 'string' || !value.trim())) throw new Error(`${label}s must be an array of file paths.`);
  if (paths.length > MAX_ARTIFACTS_PER_RECORD) throw new Error(`At most ${MAX_ARTIFACTS_PER_RECORD} ${label}s per record.`);
  const inspected = [];
  for (const raw of paths) {
    const absolute = path.resolve(cwd, raw);
    const info = await stat(absolute).catch(() => null);
    if (!info?.isFile()) throw new Error(`${label} not found or not a regular file: ${raw}`);
    if (info.size > MAX_ARTIFACT_BYTES) throw new Error(`${label} ${raw} exceeds the ${MAX_ARTIFACT_BYTES}-byte limit.`);
    inspected.push({ raw, absolute, sizeBytes: info.size });
  }
  return inspected;
}

// Copies inspected artifacts into media/<recordId>/ and returns their manifest entries.
// The caller removes media/<recordId>/ if the ledger write that follows fails.
// `used` is shared across one record's calls so file names never collide within media/<recordId>/.
export async function storeArtifacts(root, workId, recordId, inspected, { commitMedia = false, used = new Set() } = {}) {
  if (!inspected.length) return [];
  const media = mediaDirPath(root, workId);
  await ensureDir(media);
  const ignoreFile = path.join(media, '.gitignore');
  if (!commitMedia && !await exists(ignoreFile)) await writeFile(ignoreFile, MEDIA_GITIGNORE, 'utf8');
  const dir = path.join(media, recordId);
  await ensureDir(dir);
  const manifest = [];
  for (const item of inspected) {
    const name = uniqueName(assertSafeSourceName(path.basename(item.absolute).replace(/[\\/]/g, '_')), used);
    const target = path.join(dir, name);
    assertWithinDirectory(target, dir);
    await copyFile(item.absolute, target);
    const extension = path.extname(name).toLowerCase();
    manifest.push({
      name,
      path: path.posix.join('media', recordId, name),
      kind: ARTIFACT_KINDS[extension] ?? 'other',
      sizeBytes: item.sizeBytes,
      sha256: await hashFile(target)
    });
  }
  return manifest;
}

export async function removeRecordMedia(root, workId, recordId) {
  await rm(path.join(mediaDirPath(root, workId), recordId), { recursive: true, force: true });
}

// present | missing | changed — size first, hash only when the size matches.
export async function artifactState(root, workId, artifact) {
  const file = path.join(qualityDirPath(root, workId), artifact.path);
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) return 'missing';
  if (info.size !== artifact.sizeBytes) return 'changed';
  return (await hashFile(file)) === artifact.sha256 ? 'present' : 'changed';
}

async function hashFile(file) {
  return createHash('sha256').update(await readFile(file)).digest('hex');
}

function uniqueName(name, used) {
  let candidate = name;
  const dot = name.lastIndexOf('.');
  for (let n = 2; used.has(candidate); n += 1) candidate = dot > 0 ? `${name.slice(0, dot)}-${n}${name.slice(dot)}` : `${name}-${n}`;
  used.add(candidate);
  return candidate;
}

export function validateArtifactEntry(entry, label) {
  const problems = [];
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [`${label} must be an object`];
  if (typeof entry.path !== 'string' || !/^media\/[A-Z]+-\d{3,}\/[^/]+$/.test(entry.path)) problems.push(`${label} has an invalid path`);
  if (!Number.isInteger(entry.sizeBytes) || entry.sizeBytes < 0) problems.push(`${label} has an invalid sizeBytes`);
  if (typeof entry.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(entry.sha256)) problems.push(`${label} has an invalid sha256`);
  return problems;
}
