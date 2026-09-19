export const SOURCE_SCHEMA_VERSION = 2;
// Oldest schema version still readable without migration (see docs/architecture.md
// "File intake compatibility"). Never bump this — v1 sources must stay readable forever.
export const LEGACY_SOURCE_SCHEMA_VERSION = 1;

export const SOURCE_TYPES = Object.freeze(['text', 'file']);

// What YallaFlow could actually do with a source's bytes.
//   native-text — the file already is text; no extraction step exists or is needed.
//   extracted   — a parser produced a separate readable text representation.
//   original-only — only the original bytes are preserved; no readable text exists.
export const CONTENT_AVAILABILITY = Object.freeze(['native-text', 'extracted', 'original-only']);

// Support tiers, purely descriptive (used in docs/CLI output, not in branching logic).
export const SUPPORT_TIERS = Object.freeze({
  NATIVE_TEXT: 'native-text',
  OFFICE: 'office',
  PDF: 'pdf',
  IMAGE: 'image',
  BINARY: 'binary'
});

// ---------------------------------------------------------------------------
// Tier 1 — Native Text
// ---------------------------------------------------------------------------
// Plain-text / structured-text formats read directly with Node's fs; no parsing
// beyond UTF-8 decoding. Programming/source files are included as plain text —
// YallaFlow never interprets their language semantics.
const NATIVE_TEXT_CONTENT_TYPES = {
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.rst': 'text/x-rst',
  '.csv': 'text/csv',
  '.tsv': 'text/tab-separated-values',
  '.json': 'application/json',
  '.jsonl': 'application/jsonl',
  '.yaml': 'application/x-yaml',
  '.yml': 'application/x-yaml',
  '.xml': 'application/xml',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.toml': 'application/toml',
  '.ini': 'text/plain',
  '.cfg': 'text/plain',
  '.conf': 'text/plain',
  '.properties': 'text/plain',
  '.log': 'text/plain',
  '.sql': 'application/sql',
  '.js': 'text/plain',
  '.ts': 'text/plain',
  '.tsx': 'text/plain',
  '.jsx': 'text/plain',
  '.php': 'text/plain',
  '.py': 'text/plain',
  '.java': 'text/plain',
  '.cs': 'text/plain',
  '.go': 'text/plain',
  '.rs': 'text/plain',
  '.rb': 'text/plain',
  '.sh': 'text/plain'
};

// ---------------------------------------------------------------------------
// Tier 2 — Office / Rich Documents
// ---------------------------------------------------------------------------
// Extracted via officeparser (docx/pptx/xlsx/odt/ods/odp) or our own minimal RTF
// stripper. .odg (drawings) and .epub are recognized but not extracted this
// release — see the "binary"/original-only fallback and docs/architecture.md.
const OFFICE_CONTENT_TYPES = {
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.rtf': 'application/rtf',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
  '.odp': 'application/vnd.oasis.opendocument.presentation'
};

// Recognized but preserve-only in this release (no extraction implemented/evaluated yet).
const OFFICE_PRESERVE_ONLY_CONTENT_TYPES = {
  '.odg': 'application/vnd.oasis.opendocument.graphics',
  '.epub': 'application/epub+zip'
};

// ---------------------------------------------------------------------------
// Tier 3 — PDF
// ---------------------------------------------------------------------------
const PDF_CONTENT_TYPES = {
  '.pdf': 'application/pdf'
};

// ---------------------------------------------------------------------------
// Tier 4 — Images / Visual Sources
// ---------------------------------------------------------------------------
// Original preserved and accepted as a source; no OCR/vision understanding is
// performed or claimed. SVG is XML text but treated as an image, not as markup
// to read as a requirement document.
const IMAGE_CONTENT_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.svg': 'image/svg+xml'
};

// ---------------------------------------------------------------------------
// Dangerous containers — never auto-unpacked (zip bombs, path traversal, nested
// archives, executable payloads). Preserved as original-only, same as any other
// unsupported binary.
// ---------------------------------------------------------------------------
export const ARCHIVE_EXTENSIONS = Object.freeze(['.zip', '.tar', '.gz', '.tgz', '.7z', '.rar']);

export const EXTENSION_FORMATS = Object.freeze(
  Object.fromEntries([
    ...Object.entries(NATIVE_TEXT_CONTENT_TYPES).map(([ext, contentType]) => [
      ext, Object.freeze({ tier: SUPPORT_TIERS.NATIVE_TEXT, adapter: 'text', contentType })
    ]),
    ...Object.entries(OFFICE_CONTENT_TYPES).map(([ext, contentType]) => [
      ext, Object.freeze({ tier: SUPPORT_TIERS.OFFICE, adapter: ext === '.rtf' ? 'rtf' : 'office', contentType })
    ]),
    ...Object.entries(OFFICE_PRESERVE_ONLY_CONTENT_TYPES).map(([ext, contentType]) => [
      ext, Object.freeze({ tier: SUPPORT_TIERS.OFFICE, adapter: 'binary', contentType, note: 'recognized-preserve-only' })
    ]),
    ...Object.entries(PDF_CONTENT_TYPES).map(([ext, contentType]) => [
      ext, Object.freeze({ tier: SUPPORT_TIERS.PDF, adapter: 'pdf', contentType })
    ]),
    ...Object.entries(IMAGE_CONTENT_TYPES).map(([ext, contentType]) => [
      ext, Object.freeze({ tier: SUPPORT_TIERS.IMAGE, adapter: 'image', contentType })
    ])
  ])
);

// File-signature ("magic bytes") checks used to confirm a detected format actually
// matches its extension, independent of what the filename claims. Never trusted alone.
export const SIGNATURES = Object.freeze({
  zip: [Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from([0x50, 0x4b, 0x05, 0x06]), Buffer.from([0x50, 0x4b, 0x07, 0x08])],
  pdf: [Buffer.from('%PDF-', 'ascii')],
  png: [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
  jpg: [Buffer.from([0xff, 0xd8, 0xff])],
  gif: [Buffer.from('GIF87a', 'ascii'), Buffer.from('GIF89a', 'ascii')],
  bmp: [Buffer.from('BM', 'ascii')],
  webp: [Buffer.from('RIFF', 'ascii')], // followed by size + "WEBP"; verified positionally in detect.js
  tiff: [Buffer.from([0x49, 0x49, 0x2a, 0x00]), Buffer.from([0x4d, 0x4d, 0x00, 0x2a])],
  rtf: [Buffer.from('{\\rtf', 'ascii')],
  gzip: [Buffer.from([0x1f, 0x8b])],
  rar: [Buffer.from('Rar!\x1a\x07', 'binary')],
  sevenZip: [Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])]
});

// ---------------------------------------------------------------------------
// Safety limits (Large File Safety). Deliberately generous but finite; exceeding
// one produces a clear error, never silent truncation.
// ---------------------------------------------------------------------------
export const MAX_SOURCE_BYTES = 200 * 1024 * 1024; // 200 MB — original file, any format
export const MAX_EXTRACTION_INPUT_BYTES = 50 * 1024 * 1024; // 50 MB — office/pdf parsing attempted
export const MAX_EXTRACTED_TEXT_CHARS = 5_000_000; // ~5M characters of extracted text
