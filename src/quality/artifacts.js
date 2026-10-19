import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { constants as fsConstants, createReadStream } from 'node:fs';
import { copyFile, mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { ensureDir, exists } from '../utils/fs.js';
import { workspacePath } from '../core/workspace.js';
import { assertSafeSourceName, assertWithinDirectory } from '../intake/validation.js';
import { ARTIFACT_KINDS, MAX_ARTIFACT_BYTES, MAX_ARTIFACTS_PER_RECORD, QUALITY_GITIGNORE_HEADER, qualityGitignore } from './constants.js';

// Local quality artifacts (v1.1.0): screenshots, videos, traces, logs the Agent
// produced with Playwright. Each is copied byte-for-byte into
// work/<id>/quality/media/<record-id>-<random>/ and recorded with its size and SHA-256, so a
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

// One record's media folder (v1.1.0, after acceptance found evidence overwritten across
// branches). Media is git-ignored, so a folder written on one branch survives a checkout,
// and record IDs can repeat on another branch or after a ledger is restored. A record
// therefore never writes into an existing folder: each gets media/<record-id>-<random>/,
// created exclusively, and a failed record removes only the folder it created. Within a
// record, the same file attached twice (e.g. one screenshot for two scenarios) is stored
// once and referenced from both.
export async function createRecordMedia(root, workId, recordId, { commitMedia = false } = {}) {
  const media = mediaDirPath(root, workId);
  let dir = null;
  let name = null;
  const byHash = new Map();
  const used = new Set();

  async function ensureFolder() {
    if (dir) return;
    await ensureQualityGitignore(root, workId, { commitMedia });
    await ensureDir(media);
    for (let attempt = 0; attempt < 5 && !dir; attempt += 1) {
      const candidate = `${recordId}-${randomBytes(3).toString('hex')}`;
      try {
        await mkdir(path.join(media, candidate));
        dir = path.join(media, candidate);
        name = candidate;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
    }
    if (!dir) throw new Error(`Could not allocate a new media folder for ${recordId}.`);
  }

  return {
    // Copies inspected artifacts and returns their manifest entries.
    async add(inspected = []) {
      const manifest = [];
      for (const item of inspected) {
        const sha256 = await hashFile(item.absolute);
        if (byHash.has(sha256)) {
          manifest.push({ ...byHash.get(sha256) });
          continue;
        }
        await ensureFolder();
        const fileName = uniqueName(assertSafeSourceName(path.basename(item.absolute).replace(/[\\/]/g, '_')), used);
        const target = path.join(dir, fileName);
        assertWithinDirectory(target, dir);
        await copyFile(item.absolute, target, fsConstants.COPYFILE_EXCL);
        if (await hashFile(target) !== sha256) throw new Error(`${fileName} changed while it was being copied.`);
        const entry = {
          name: fileName,
          path: path.posix.join('media', name, fileName),
          kind: ARTIFACT_KINDS[path.extname(fileName).toLowerCase()] ?? 'other',
          sizeBytes: item.sizeBytes,
          sha256
        };
        byHash.set(sha256, entry);
        manifest.push({ ...entry });
      }
      return manifest;
    },
    async remove() {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  };
}

// Checked before every media or report write. While the file starts with YallaFlow's
// header it is YallaFlow-managed and follows quality.media.commit (an opt-in made later
// takes effect, and opting back out re-ignores media); a file without the header is the
// project's own and is never touched. Never untracks or deletes anything already in Git.
export async function ensureQualityGitignore(root, workId, { commitMedia = false } = {}) {
  const dir = qualityDirPath(root, workId);
  const file = path.join(dir, '.gitignore');
  const wanted = qualityGitignore({ commitMedia });
  if (await exists(file)) {
    // CRLF checkouts (core.autocrlf) are the same rule, not a reason to rewrite it.
    const current = (await readFile(file, 'utf8')).replace(/\r\n/g, '\n');
    if (!current.startsWith(QUALITY_GITIGNORE_HEADER) || current === wanted) return false;
  }
  await ensureDir(dir);
  await writeFile(file, wanted, 'utf8');
  return true;
}

// present | missing | changed | unreadable | unsafe — size first, hash only when the size
// matches; unsafe = a link whose real location is outside the media folder (never read).
export async function artifactState(root, workId, artifact) {
  // A ledger can arrive by merge: never read outside this work item's media folder.
  const media = mediaDirPath(root, workId);
  const file = path.resolve(qualityDirPath(root, workId), artifact.path);
  if (!file.startsWith(media + path.sep)) return 'missing';
  // …including through symbolic links: the real location must be inside the real media
  // folder, or the file is reported as unsafe and never stat'ed or read.
  const realMedia = await realpath(media).catch(() => null);
  const realFile = await realpath(file).catch(() => null);
  if (!realMedia || !realFile) return 'missing';
  if (!realFile.startsWith(realMedia + path.sep)) return 'unsafe';
  const info = await stat(realFile).catch(() => null);
  if (!info?.isFile()) return 'missing';
  if (info.size !== artifact.sizeBytes) return 'changed';
  try {
    return (await hashFile(realFile)) === artifact.sha256 ? 'present' : 'changed';
  } catch {
    return 'unreadable';
  }
}

// Streamed, so a large video is never held in memory to be hashed.
async function hashFile(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
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
  if (typeof entry.path !== 'string' || !/^media\/[A-Z]+-[A-Za-z0-9-]+\/[^/\\]+$/.test(entry.path) || entry.path.split('/').includes('..')) problems.push(`${label} has an invalid path`);
  if (!Number.isInteger(entry.sizeBytes) || entry.sizeBytes < 0) problems.push(`${label} has an invalid sizeBytes`);
  if (typeof entry.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(entry.sha256)) problems.push(`${label} has an invalid sha256`);
  return problems;
}
