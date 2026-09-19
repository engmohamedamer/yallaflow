// Tier 1 — Native Text. The file already is text; decoding is the only step. Source
// code / config files are treated as plain text: YallaFlow never interprets their
// language semantics.
export async function extractText(buffer) {
  return { contentAvailability: 'native-text', text: buffer.toString('utf8') };
}
