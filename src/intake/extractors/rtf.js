// Minimal, self-contained RTF-to-text extraction. RTF is a plain-text control-word
// format (not a binary container), so a small hand-written stripper is a deliberate,
// justified choice here — unlike OOXML/ODF, there is no zip/XML structure to parse,
// just a control-word grammar. This is a best-effort textual extraction, not a
// faithful RTF renderer: formatting, embedded objects, and pictures are discarded.
const SKIPPED_DESTINATIONS = new Set([
  'fonttbl', 'colortbl', 'stylesheet', 'info', 'generator', 'pict', 'object',
  'footer', 'header', 'themedata', 'colorschememapping', 'latentstyles',
  'rsidtbl', 'xmlnstbl', 'listtable', 'listoverridetable', 'revtbl'
]);

export function extractRtfText(buffer) {
  const source = buffer.toString('latin1');
  if (!source.startsWith('{\\rtf')) throw new Error('Not a readable RTF document (missing \\rtf header).');

  let output = '';
  let depth = 0;
  const skipDepths = [];
  let index = 0;

  while (index < source.length) {
    const char = source[index];

    if (char === '{') {
      depth += 1;
      index += 1;
      continue;
    }
    if (char === '}') {
      if (skipDepths.length && skipDepths[skipDepths.length - 1] === depth) skipDepths.pop();
      depth -= 1;
      index += 1;
      continue;
    }
    if (char === '\\') {
      const controlMatch = /^\\([a-zA-Z]+)(-?\d+)?[ ]?/.exec(source.slice(index));
      if (controlMatch) {
        const [full, word, param] = controlMatch;
        if (word === 'u') {
          const codePoint = Number(param);
          output += String.fromCharCode(codePoint < 0 ? codePoint + 65536 : codePoint);
        } else if (word === 'par' || word === 'line' || word === 'row') {
          output += '\n';
        } else if (word === 'tab' || word === 'cell') {
          output += '\t';
        } else if (SKIPPED_DESTINATIONS.has(word)) {
          skipDepths.push(depth);
        }
        index += full.length;
        continue;
      }
      const hexMatch = /^\\'([0-9a-fA-F]{2})/.exec(source.slice(index));
      if (hexMatch) {
        if (!skipDepths.length) output += Buffer.from([parseInt(hexMatch[1], 16)]).toString('latin1');
        index += hexMatch[0].length;
        continue;
      }
      if (source[index + 1] === '\\' || source[index + 1] === '{' || source[index + 1] === '}') {
        if (!skipDepths.length) output += source[index + 1];
        index += 2;
        continue;
      }
      // Unrecognized control symbol (e.g. \*, \~, \-): skip just the backslash and symbol.
      index += 2;
      continue;
    }
    if (!skipDepths.length && char !== '\r' && char !== '\n') output += char;
    index += 1;
  }

  const text = output.replace(/\n{3,}/g, '\n\n').trim();
  if (!text) throw new Error('RTF document contained no extractable text.');
  return text;
}
