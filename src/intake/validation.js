import path from 'node:path';
import { CONTENT_AVAILABILITY, LEGACY_SOURCE_SCHEMA_VERSION, SOURCE_SCHEMA_VERSION, SOURCE_TYPES } from './constants.js';

const V1_RECORD_FIELDS = new Set([
  'schemaVersion', 'id', 'sourceType', 'sourceName', 'sourceRef',
  'contentType', 'rawText', 'capturedAt', 'metadata', 'linkedWork'
]);
const V1_METADATA_FIELDS = new Set(['sizeBytes', 'sha256', 'extension']);

const V2_RECORD_FIELDS = new Set([
  'schemaVersion', 'id', 'sourceType', 'sourceName', 'detectedFormat', 'contentType',
  'contentAvailability', 'capturedAt', 'original', 'representation', 'rawText', 'metadata', 'linkedWork'
]);
const ORIGINAL_FIELDS = new Set(['path', 'sha256', 'sizeBytes']);
const REPRESENTATION_FIELDS = new Set(['type', 'path', 'sizeBytes']);

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

// Validates a persisted source.json record. Dispatches on schemaVersion so v1
// records created before universal file intake (v0.3.2) remain readable forever —
// no migration is performed or required. New records are always written as v2.
export function validateSourceRecord(record, label = '<unknown>') {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new Error(`Source record ${label} must be an object.`);
  }
  if (record.schemaVersion === LEGACY_SOURCE_SCHEMA_VERSION) return validateV1Record(record, label);
  if (record.schemaVersion === SOURCE_SCHEMA_VERSION) return validateV2Record(record, label);
  throw new Error(`Source record ${label} has unsupported schemaVersion ${JSON.stringify(record.schemaVersion)}.`);
}

function validateV1Record(record, label) {
  rejectUnknownFields(record, V1_RECORD_FIELDS, `source record ${label}`);
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
  if (!record.metadata || typeof record.metadata !== 'object' || Array.isArray(record.metadata)) {
    throw new Error(`Source record ${label} requires a metadata object.`);
  }
  rejectUnknownFields(record.metadata, V1_METADATA_FIELDS, `source metadata for ${label}`);
  if (!Number.isInteger(record.metadata.sizeBytes) || record.metadata.sizeBytes < 0) {
    throw new Error(`Source record ${label} has invalid metadata.sizeBytes.`);
  }
  assertSha256(record.metadata.sha256, label);
  if (!isNonEmptyString(record.metadata.extension)) throw new Error(`Source record ${label} requires metadata.extension.`);
  assertLinkedWork(record.linkedWork, label);
  return true;
}

function validateV2Record(record, label) {
  rejectUnknownFields(record, V2_RECORD_FIELDS, `source record ${label}`);
  if (!/^SRC-\d{4,}$/.test(record.id)) throw new Error(`Invalid source ID ${JSON.stringify(record.id)}.`);
  if (!SOURCE_TYPES.includes(record.sourceType)) {
    throw new Error(`Source record ${label} has unsupported sourceType ${JSON.stringify(record.sourceType)}.`);
  }
  for (const field of ['sourceName', 'detectedFormat', 'contentType', 'capturedAt']) {
    if (!isNonEmptyString(record[field])) throw new Error(`Source record ${label} requires non-empty ${field}.`);
  }
  if (!CONTENT_AVAILABILITY.includes(record.contentAvailability)) {
    throw new Error(`Source record ${label} has unsupported contentAvailability ${JSON.stringify(record.contentAvailability)}.`);
  }

  if (!record.original || typeof record.original !== 'object' || Array.isArray(record.original)) {
    throw new Error(`Source record ${label} requires an original object.`);
  }
  rejectUnknownFields(record.original, ORIGINAL_FIELDS, `source original for ${label}`);
  if (!isNonEmptyString(record.original.path)) throw new Error(`Source record ${label} requires original.path.`);
  assertSha256(record.original.sha256, label);
  if (!Number.isInteger(record.original.sizeBytes) || record.original.sizeBytes < 0) {
    throw new Error(`Source record ${label} has invalid original.sizeBytes.`);
  }

  if (record.contentAvailability === 'native-text') {
    if (typeof record.rawText !== 'string' || !record.rawText.length) {
      throw new Error(`Source record ${label} with native-text content requires non-empty rawText.`);
    }
    if (record.representation !== undefined && record.representation !== null) {
      throw new Error(`Source record ${label} with native-text content must not have a representation.`);
    }
  } else if (record.contentAvailability === 'extracted') {
    if (record.rawText !== undefined) throw new Error(`Source record ${label} with extracted content must not inline rawText.`);
    if (!record.representation || typeof record.representation !== 'object' || Array.isArray(record.representation)) {
      throw new Error(`Source record ${label} with extracted content requires a representation object.`);
    }
    rejectUnknownFields(record.representation, REPRESENTATION_FIELDS, `source representation for ${label}`);
    if (record.representation.type !== 'text') throw new Error(`Source record ${label} representation.type must be "text".`);
    if (!isNonEmptyString(record.representation.path)) throw new Error(`Source record ${label} requires representation.path.`);
    if (!Number.isInteger(record.representation.sizeBytes) || record.representation.sizeBytes < 0) {
      throw new Error(`Source record ${label} has invalid representation.sizeBytes.`);
    }
  } else {
    if (record.rawText !== undefined) throw new Error(`Source record ${label} with original-only content must not have rawText.`);
    if (record.representation !== undefined && record.representation !== null) {
      throw new Error(`Source record ${label} with original-only content must not have a representation.`);
    }
  }

  if (!record.metadata || typeof record.metadata !== 'object' || Array.isArray(record.metadata)) {
    throw new Error(`Source record ${label} requires a metadata object.`);
  }
  assertLinkedWork(record.linkedWork, label);
  return true;
}

function assertSha256(value, label) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`Source record ${label} has an invalid sha256 checksum.`);
  }
}

function assertLinkedWork(linkedWork, label) {
  if (!Array.isArray(linkedWork) || linkedWork.some((id) => !/^PF-\d{4,}$/.test(id))) {
    throw new Error(`Source record ${label} linkedWork must be an array of work IDs.`);
  }
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function rejectUnknownFields(value, allowed, label) {
  const unknown = Object.keys(value).filter((field) => !allowed.has(field));
  if (unknown.length) throw new Error(`Unknown field(s) in ${label}: ${unknown.join(', ')}.`);
}
