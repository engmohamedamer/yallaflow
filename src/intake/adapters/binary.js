// Tier 5 — Generic Binary Attachment (also used for recognized-but-preserve-only
// formats like .odg/.epub, and for detected dangerous containers like .zip/.tar).
// No text representation is ever claimed; the original bytes are preserved and
// checksummed by the caller. This adapter never opens/unpacks the file's contents.
export async function extractBinary() {
  return { contentAvailability: 'original-only' };
}
