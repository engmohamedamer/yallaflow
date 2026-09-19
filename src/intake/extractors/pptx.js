import { DOMParser } from '@xmldom/xmldom';
import { readZipEntries, sortByTrailingNumber } from './zip.js';

const SLIDE_FILE = /^ppt\/slides\/slide\d+\.xml$/;

// One "# Slide N" section per slide, with that slide's text runs joined by paragraph.
// Slide order follows the part filename's numeric suffix, which matches presentation
// order for the overwhelming majority of real files; true order (via
// ppt/presentation.xml's slide ID list) is not resolved — documented as a known
// simplification rather than silently assumed perfect.
export async function extractPptxStructured(buffer) {
  const entries = await readZipEntries(buffer, (name) => SLIDE_FILE.test(name));
  const slideFiles = sortByTrailingNumber([...entries.keys()]);
  if (!slideFiles.length) throw new Error('No slide parts found in PPTX archive.');

  const parser = new DOMParser({ errorHandler: () => {} });
  const sections = slideFiles.map((file, index) => {
    const doc = parser.parseFromString(entries.get(file).toString('utf8'), 'text/xml');
    const paragraphs = Array.from(doc.getElementsByTagName('a:p'))
      .map((p) => Array.from(p.getElementsByTagName('a:t')).map((t) => t.textContent ?? '').join(''))
      .filter((line) => line.trim().length > 0);
    const body = paragraphs.length ? paragraphs.join('\n') : '(no text on this slide)';
    return `# Slide ${index + 1}\n\n${body}`;
  });

  return sections.join('\n\n');
}
