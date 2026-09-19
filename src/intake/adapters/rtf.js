import { extractRtfText } from '../extractors/rtf.js';

export async function extractRtf(buffer) {
  const text = extractRtfText(buffer);
  return { contentAvailability: 'extracted', text, representationKind: 'stripped-control-words' };
}
