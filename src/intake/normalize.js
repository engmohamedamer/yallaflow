import path from 'node:path';

// "SRS.md" -> "SRS". Purely mechanical (extension stripped); never a semantic guess at
// what the document is about.
export function defaultTitleFromFilename(sourceName) {
  const extension = path.extname(sourceName);
  const base = path.basename(sourceName, extension).trim();
  return base || sourceName;
}

// Renders a work item's `sources` array as a short, human-readable line (or lines).
// Used identically by `guide`, `resume`, and `status` so the display stays consistent
// however many sources a work item ends up referencing.
export function formatSourceList(sources = []) {
  return sources.map((source) => `${source.id} — ${source.name}`).join('\n');
}

// The provider/source-neutral Normalized Intake Contract an adapter produces. `buffer`
// (when present) is the exact original bytes, kept only long enough to be copied
// byte-for-byte into workspace storage; it is never persisted into source.json.
export function buildNormalizedIntake({ sourceType, sourceName, contentType, rawText, metadata, buffer }, now = new Date()) {
  return {
    sourceType,
    sourceName,
    contentType,
    rawText,
    capturedAt: now.toISOString(),
    metadata: { ...metadata },
    ...(buffer !== undefined ? { buffer } : {})
  };
}
