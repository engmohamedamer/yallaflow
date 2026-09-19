import path from 'node:path';
import { ARCHIVE_EXTENSIONS, EXTENSION_FORMATS, SIGNATURES, SUPPORT_TIERS } from './constants.js';

const ZIP_BASED_EXTENSIONS = new Set(['.docx', '.pptx', '.xlsx', '.odt', '.ods', '.odp', '.odg', '.epub']);

// Format detection never trusts the extension alone for binary container formats: a
// fake .docx (not actually a zip) or a fake .pdf (not actually a PDF) is detected as a
// mismatch and routed to the generic binary adapter instead of being parsed as if it
// were valid. Plain text formats have no fixed signature, so they are trusted by
// extension — there is no meaningful "fake .txt".
export function detectFormat(fileName, buffer) {
  const extension = path.extname(fileName).toLowerCase();
  const signature = sniffSignature(buffer);

  if (ARCHIVE_EXTENSIONS.includes(extension) || (signature && isArchiveSignature(signature) && !ZIP_BASED_EXTENSIONS.has(extension))) {
    return result({ extension, detectedFormat: 'archive', tier: SUPPORT_TIERS.BINARY, adapter: 'binary', contentType: 'application/octet-stream', signature, note: 'dangerous-container' });
  }

  const declared = EXTENSION_FORMATS[extension];
  if (!declared) {
    return result({ extension, detectedFormat: signature ?? 'unknown', tier: SUPPORT_TIERS.BINARY, adapter: 'binary', contentType: 'application/octet-stream', signature });
  }

  if (ZIP_BASED_EXTENSIONS.has(extension) && signature !== 'zip') {
    return result({
      extension, detectedFormat: 'binary', tier: SUPPORT_TIERS.BINARY, adapter: 'binary', contentType: 'application/octet-stream',
      signature, mismatch: true, declaredExtension: extension
    });
  }
  if (extension === '.pdf' && signature !== 'pdf') {
    return result({
      extension, detectedFormat: 'binary', tier: SUPPORT_TIERS.BINARY, adapter: 'binary', contentType: 'application/octet-stream',
      signature, mismatch: true, declaredExtension: extension
    });
  }
  if (extension === '.rtf' && signature !== 'rtf') {
    return result({
      extension, detectedFormat: 'binary', tier: SUPPORT_TIERS.BINARY, adapter: 'binary', contentType: 'application/octet-stream',
      signature, mismatch: true, declaredExtension: extension
    });
  }

  return result({
    extension, detectedFormat: extension.slice(1), tier: declared.tier, adapter: declared.adapter,
    contentType: declared.contentType, signature, note: declared.note
  });
}

function result(fields) {
  return { mismatch: false, signature: null, note: undefined, ...fields };
}

function isArchiveSignature(signature) {
  return ['zip', 'gzip', 'rar', 'sevenZip'].includes(signature);
}

// Returns a short signature name (see constants.js SIGNATURES) or null if nothing
// recognized. Only inspects the first bytes already in memory — never reads more of
// the file than the caller already loaded.
export function sniffSignature(buffer) {
  if (!buffer || buffer.length < 2) return null;
  for (const [name, magics] of Object.entries(SIGNATURES)) {
    if (name === 'webp') continue; // special-cased below (RIFF header + WEBP at offset 8)
    if (magics.some((magic) => buffer.length >= magic.length && buffer.subarray(0, magic.length).equals(magic))) {
      return name;
    }
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).equals(Buffer.from('RIFF', 'ascii')) && buffer.subarray(8, 12).equals(Buffer.from('WEBP', 'ascii'))) {
    return 'webp';
  }
  return null;
}
