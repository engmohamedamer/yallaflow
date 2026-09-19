import path from 'node:path';
import { readdir, rm, writeFile } from 'node:fs/promises';
import { ensureDir, exists } from '../utils/fs.js';
import { readYaml, writeYaml } from './yaml.js';
import { workspacePath } from './workspace.js';
import { SOURCE_SCHEMA_VERSION } from '../intake/constants.js';
import { assertWithinDirectory, validateSourceRecord } from '../intake/validation.js';

export function sourcesDirPath(root) {
  return path.join(workspacePath(root), 'sources');
}

export function sourceDirPath(root, sourceId) {
  return path.join(sourcesDirPath(root), sourceId);
}

export function sourceRecordPath(root, sourceId) {
  return path.join(sourceDirPath(root, sourceId), 'source.json');
}

// Scans the sources/ directory the same way nextWorkId scans work/. Never creates
// sources/ merely by computing the next ID — an absent directory just means SRC-0001.
export async function nextSourceId(root) {
  const dir = sourcesDirPath(root);
  if (!await exists(dir)) return 'SRC-0001';
  const entries = await readdir(dir, { withFileTypes: true });
  const ids = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => /^SRC-(\d+)$/.exec(entry.name)?.[1])
    .filter(Boolean)
    .map(Number);
  const next = (ids.length ? Math.max(...ids) : 0) + 1;
  return `SRC-${String(next).padStart(4, '0')}`;
}

export async function findSourceByChecksum(root, sha256) {
  const sources = await listSources(root);
  return sources.find((record) => record.metadata.sha256 === sha256) ?? null;
}

// Persists a Normalized Intake Contract into workspace storage: a fresh SRC-#### is
// always allocated (never overwrites an existing source), the original bytes are copied
// byte-for-byte, and a validated source.json record is written alongside it.
export async function persistSource(root, normalizedIntake, now = new Date().toISOString()) {
  const id = await nextSourceId(root);
  const dir = sourceDirPath(root, id);
  const sourceFile = path.join(dir, normalizedIntake.sourceName);
  assertWithinDirectory(sourceFile, dir);

  const record = {
    schemaVersion: SOURCE_SCHEMA_VERSION,
    id,
    sourceType: normalizedIntake.sourceType,
    sourceName: normalizedIntake.sourceName,
    sourceRef: path.posix.join('sources', id, normalizedIntake.sourceName),
    contentType: normalizedIntake.contentType,
    rawText: normalizedIntake.rawText,
    capturedAt: normalizedIntake.capturedAt ?? now,
    metadata: { ...normalizedIntake.metadata },
    linkedWork: []
  };
  validateSourceRecord(record, id);

  await ensureDir(dir);
  await writeFile(sourceFile, normalizedIntake.buffer ?? Buffer.from(normalizedIntake.rawText, 'utf8'));
  await writeYaml(sourceRecordPath(root, id), record);
  return record;
}

export async function loadSource(root, sourceId) {
  const file = sourceRecordPath(root, sourceId);
  if (!await exists(file)) throw new Error(`Source ${sourceId} was not found.`);
  const record = await readYaml(file);
  validateSourceRecord(record, sourceId);
  return record;
}

// Never creates sources/ by reading it; an absent directory simply yields no sources.
export async function listSources(root) {
  const dir = sourcesDirPath(root);
  if (!await exists(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const records = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('SRC-')) continue;
    const file = path.join(dir, entry.name, 'source.json');
    if (await exists(file)) {
      const record = await readYaml(file);
      validateSourceRecord(record, entry.name);
      records.push(record);
    }
  }
  return records.sort((a, b) => a.id.localeCompare(b.id));
}

export async function linkSourceToWork(root, sourceId, workId) {
  const record = await loadSource(root, sourceId);
  if (!record.linkedWork.includes(workId)) record.linkedWork.push(workId);
  validateSourceRecord(record, sourceId);
  await writeYaml(sourceRecordPath(root, sourceId), record);
  return record;
}

// Best-effort rollback used when a source was persisted but the associated work item
// failed to be created; keeps intake "atomic-ish" without a real transaction system.
export async function removeSourceDir(root, sourceId) {
  await rm(sourceDirPath(root, sourceId), { recursive: true, force: true });
}
