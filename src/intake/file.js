import path from 'node:path';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { MAX_EXTRACTION_INPUT_BYTES, MAX_SOURCE_BYTES } from './constants.js';
import { assertSafeSourceName } from './validation.js';
import { buildNormalizedIntake } from './normalize.js';
import { detectFormat } from './detect.js';
import { resolveAdapter } from './registry.js';

// Source (a path on disk) -> Format Detection -> Adapter Registry -> Normalized
// Intake Contract. Pure with respect to the YallaFlow workspace — it only reads the
// given path and never knows about .yallaflow/sources; workspace storage is a
// separate, later step (see core/sources.js).
export async function prepareFileIntake(filePath) {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    throw new Error('Usage: yallaflow intake <file> [<file> ...] [--title TITLE]');
  }

  let stats;
  try {
    stats = await stat(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`Source file not found: ${filePath}`);
    throw new Error(`Could not read source file ${filePath}: ${error.message}`);
  }
  if (stats.isDirectory()) throw new Error(`Source path is a directory, not a file: ${filePath}`);
  if (!stats.isFile()) throw new Error(`Source path is not a regular file: ${filePath}`);
  if (stats.size === 0) throw new Error(`Source file is empty: ${filePath}`);
  if (stats.size > MAX_SOURCE_BYTES) {
    throw new Error(`Source file exceeds the ${formatBytes(MAX_SOURCE_BYTES)} safe size limit: ${filePath} (${formatBytes(stats.size)}).`);
  }

  const sourceName = assertSafeSourceName(path.basename(filePath));

  let buffer;
  try {
    buffer = await readFile(filePath);
  } catch (error) {
    throw new Error(`Could not read source file ${filePath}: ${error.message}`);
  }

  const detected = detectFormat(sourceName, buffer);
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  const baseMetadata = {
    sizeBytes: buffer.length,
    sha256,
    extension: detected.extension || '(none)',
    detectedFormat: detected.detectedFormat,
    ...(detected.mismatch ? { extensionMismatch: true } : {}),
    ...(detected.note ? { note: detected.note } : {})
  };

  const extraction = await runAdapter(detected, buffer, sourceName, baseMetadata);

  return buildNormalizedIntake({
    sourceType: 'file',
    sourceName,
    detectedFormat: detected.detectedFormat,
    contentType: detected.contentType,
    contentAvailability: extraction.contentAvailability,
    rawText: extraction.text,
    representationKind: extraction.representationKind,
    metadata: { ...baseMetadata, ...extraction.metadata },
    buffer
  });
}

async function runAdapter(detected, buffer, sourceName, baseMetadata) {
  const adapter = resolveAdapter(detected.adapter);

  const extractionAttempted = detected.adapter !== 'binary' && detected.adapter !== 'image';
  if (extractionAttempted && buffer.length > MAX_EXTRACTION_INPUT_BYTES) {
    console.log(
      `Warning: ${sourceName} is larger than the ${formatBytes(MAX_EXTRACTION_INPUT_BYTES)} extraction limit; ` +
      'preserving the original file without attempting text extraction.'
    );
    return { contentAvailability: 'original-only', metadata: { extractionSkipped: 'exceeds-extraction-size-limit' } };
  }

  try {
    const result = await adapter(buffer, { extension: detected.extension, sourceName });
    return {
      contentAvailability: result.contentAvailability,
      text: result.text,
      representationKind: result.representationKind,
      metadata: result.metadata ?? {}
    };
  } catch (error) {
    if (!extractionAttempted) throw error; // text/image/binary adapters aren't expected to fail this way
    console.log(`Warning: could not extract text from ${sourceName} (${error.message}); preserving the original file only.`);
    return { contentAvailability: 'original-only', metadata: { extractionError: error.message.slice(0, 300) } };
  }
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}
