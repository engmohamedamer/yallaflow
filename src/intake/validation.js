import path from 'node:path';
import { SOURCE_SCHEMA_VERSION, SOURCE_TYPES } from './constants.js';

const RECORD_FIELDS = new Set([
  'schemaVersion', 'id', 'sourceType', 'sourceName', 'sourceRef',
  'contentType', 'rawText', 'capturedAt', 'metadata', 'linkedWork'
]);
const METADATA_FIELDS = new Set(['sizeBytes', 'sha256', 'extension']);

// A stored/copied file name must be a plain file name: no directory components, and
// never "." or "..". Combined with assertWithinDirectory below, this is the path-traversal
// guard for source storage — the derived name can never escape the source's own directory.
export function assertSafeSourceName(name) {
  if (!isNonEmptyString(name)) throw new Error('Source name must be a non-empty string.');
  if (name === '.' || name === '..') throw new Error(`Unsafe source name: ${JSON.stringify(name)}.`);
  if (name.includes('/') || name.includes('\\')) throw new Error(`Unsafe source name: ${JSON.stringify(name)}.`);
  return name;
}

export function assertWithinDirectory(targetPath, directoryPath) {
  const resolvedDir = path.resolve(directoryPath);
  const resolvedTarget = path.resolve(targetPath);
  if (resolvedTarget !== resolvedDir && !resolvedTarget.startsWith(resolvedDir + path.sep)) {
    throw new Error(`Refusing to write outside the source directory: ${targetPath}`);
  }
}

export function validateSourceRecord(record, label = '<unknown>') {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new Error(`Source record ${label} must be an object.`);
  }
  rejectUnknownFields(record, RECORD_FIELDS, `source record ${label}`);
  if (record.schemaVersion !== SOURCE_SCHEMA_VERSION) {
    throw new Error(`Source record ${label} must use schemaVersion ${SOURCE_SCHEMA_VERSION}.`);
  }
  if (!/^SRC-\d{4,}$/.test(record.id)) throw new Error(`Invalid source ID ${JSON.stringify(record.id)}.`);
  if (!SOURCE_TYPES.includes(record.sourceType)) {
    throw new Error(`Source record ${label} has unsupported sourceType ${JSON.stringify(record.sourceType)}.`);
  }
  for (const field of ['sourceName', 'sourceRef', 'contentType', 'capturedAt']) {
    if (!isNonEmptyString(record[field])) throw new Error(`Source record ${label} requires non-empty ${field}.`);
  }
  if (typeof record.rawText !== 'string' || !record.rawText.length) {
    throw new Error(`Source record ${label} requires non-empty rawText.`);
  }
  validateMetadata(record.metadata, label);
  if (!Array.isArray(record.linkedWork) || record.linkedWork.some((id) => !/^PF-\d{4,}$/.test(id))) {
    throw new Error(`Source record ${label} linkedWork must be an array of work IDs.`);
  }
  return true;
}

function validateMetadata(metadata, label) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new Error(`Source record ${label} requires a metadata object.`);
  }
  rejectUnknownFields(metadata, METADATA_FIELDS, `source metadata for ${label}`);
  if (!Number.isInteger(metadata.sizeBytes) || metadata.sizeBytes < 0) {
    throw new Error(`Source record ${label} has invalid metadata.sizeBytes.`);
  }
  if (typeof metadata.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(metadata.sha256)) {
    throw new Error(`Source record ${label} has invalid metadata.sha256.`);
  }
  if (!isNonEmptyString(metadata.extension)) throw new Error(`Source record ${label} requires metadata.extension.`);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function rejectUnknownFields(value, allowed, label) {
  const unknown = Object.keys(value).filter((field) => !allowed.has(field));
  if (unknown.length) throw new Error(`Unknown field(s) in ${label}: ${unknown.join(', ')}.`);
}
