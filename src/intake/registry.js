import { extractText } from './adapters/text.js';
import { extractOffice } from './adapters/office.js';
import { extractRtf } from './adapters/rtf.js';
import { extractPdf } from './adapters/pdf.js';
import { extractImageMetadata } from './adapters/image.js';
import { extractBinary } from './adapters/binary.js';

// The extensible adapter registry: detect.js decides *what* a source is; this
// decides *which adapter* handles it. Adding a new format family means adding one
// entry here and one adapter module — never a switch statement scattered through
// CLI or command code.
const ADAPTERS = Object.freeze({
  text: extractText,
  office: extractOffice,
  rtf: extractRtf,
  pdf: extractPdf,
  image: extractImageMetadata,
  binary: extractBinary
});

export function resolveAdapter(adapterName) {
  const adapter = ADAPTERS[adapterName];
  if (!adapter) throw new Error(`No intake adapter registered for ${JSON.stringify(adapterName)}.`);
  return adapter;
}

export function registeredAdapterNames() {
  return Object.keys(ADAPTERS);
}
