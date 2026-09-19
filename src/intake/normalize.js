import path from 'node:path';

// "SRS.md" -> "SRS". Purely mechanical (extension stripped); never a semantic guess at
// what the document is about.
export function defaultTitleFromFilename(sourceName) {
  const extension = path.extname(sourceName);
  const base = path.basename(sourceName, extension).trim();
  return base || sourceName;
}

// Renders a work item's `sources` array as short, human-readable lines. Used
// identically by `guide`, `resume`, and `status` so the display stays consistent
// however many sources a work item ends up referencing. A fresh agent must be able
// to tell, from this line alone, what it can actually inspect: extracted text,
// native text, or only the original file.
export function formatSourceList(sources = []) {
  return sources.map((source) => {
    const format = source.detectedFormat ? source.detectedFormat.toUpperCase() : null;
    const availability = source.contentAvailability ? describeContentAvailability(source.contentAvailability) : null;
    const detail = [format, availability].filter(Boolean).join(', ');
    return `${source.id} — ${source.name}${detail ? ` (${detail})` : ''}`;
  }).join('\n');
}

export function describeContentAvailability(value) {
  return {
    'native-text': 'native text',
    extracted: 'extracted text available',
    'original-only': 'original preserved, no text extracted'
  }[value] ?? 'unknown';
}

// The provider/source-neutral Normalized Intake Contract an adapter/orchestrator
// produces. `buffer` (when present) is the exact original bytes, kept only long
// enough to be copied byte-for-byte into workspace storage; it is never persisted
// into source.json. `rawText` is present only when contentAvailability is
// 'native-text' or 'extracted' — 'original-only' sources carry no text at all.
export function buildNormalizedIntake(
  { sourceType, sourceName, detectedFormat, contentType, contentAvailability, rawText, representationKind, metadata, buffer },
  now = new Date()
) {
  return {
    sourceType,
    sourceName,
    detectedFormat,
    contentType,
    contentAvailability,
    ...(rawText !== undefined ? { rawText } : {}),
    ...(representationKind !== undefined ? { representationKind } : {}),
    capturedAt: now.toISOString(),
    metadata: { ...metadata },
    ...(buffer !== undefined ? { buffer } : {})
  };
}
