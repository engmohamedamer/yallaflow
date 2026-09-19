import path from 'node:path';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { CONTENT_TYPES_BY_EXTENSION, SUPPORTED_FILE_EXTENSIONS } from './constants.js';
import { assertSafeSourceName } from './validation.js';
import { buildNormalizedIntake } from './normalize.js';

// The File Intake Adapter: Source (a path on disk) -> Normalized Intake Contract.
// Pure with respect to the YallaFlow workspace — it only reads the given path and never
// knows about .yallaflow/sources; workspace storage is a separate, later step.
export async function prepareFileIntake(filePath) {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    throw new Error('Usage: yallaflow intake <file> [--title TITLE]');
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

  const sourceName = assertSafeSourceName(path.basename(filePath));
  const extension = path.extname(sourceName).toLowerCase();
  if (!SUPPORTED_FILE_EXTENSIONS.includes(extension)) {
    throw new Error(
      `Unsupported file type: ${extension || '(none)'}\n\n` +
      `Supported in this release:\n${SUPPORTED_FILE_EXTENSIONS.join(', ')}`
    );
  }

  let buffer;
  try {
    buffer = await readFile(filePath);
  } catch (error) {
    throw new Error(`Could not read source file ${filePath}: ${error.message}`);
  }
  if (buffer.length === 0) throw new Error(`Source file is empty: ${filePath}`);

  const rawText = buffer.toString('utf8');
  const sha256 = createHash('sha256').update(buffer).digest('hex');

  return buildNormalizedIntake({
    sourceType: 'file',
    sourceName,
    contentType: CONTENT_TYPES_BY_EXTENSION[extension],
    rawText,
    metadata: { sizeBytes: buffer.length, sha256, extension },
    buffer
  });
}
