import { DOMParser } from '@xmldom/xmldom';
import { readZipEntries, sortByTrailingNumber } from './zip.js';

const SHEET_FILE = /^xl\/worksheets\/sheet\d+\.xml$/;

// Reconstructs a readable, sheet-by-sheet markdown representation of an XLSX
// workbook: real sheet names (from workbook.xml), one table per sheet, cells placed
// by their true column letter so gaps stay aligned. This is a structured
// enhancement over generic OOXML text extraction — worth the extra parsing because
// spreadsheet grid shape is part of the requirement, not incidental formatting.
export async function extractXlsxStructured(buffer) {
  const entries = await readZipEntries(buffer, (name) =>
    name === 'xl/workbook.xml' || name === 'xl/sharedStrings.xml' || SHEET_FILE.test(name)
  );
  const workbookXml = entries.get('xl/workbook.xml');
  if (!workbookXml) throw new Error('xl/workbook.xml is missing; not a readable XLSX workbook.');

  const parser = new DOMParser({ errorHandler: () => {} });
  const sheetNames = Array.from(parser.parseFromString(workbookXml.toString('utf8'), 'text/xml').getElementsByTagName('sheet'))
    .map((node) => node.getAttribute('name'));

  const sharedStrings = parseSharedStrings(entries.get('xl/sharedStrings.xml'), parser);
  const sheetFiles = sortByTrailingNumber([...entries.keys()].filter((name) => SHEET_FILE.test(name)));

  const sections = sheetFiles.map((file, index) => {
    const name = sheetNames[index] ?? `Sheet ${index + 1}`;
    const table = renderSheetTable(entries.get(file), parser, sharedStrings);
    return `# Sheet: ${name}\n\n${table}`;
  });

  if (!sections.length) throw new Error('No worksheet parts found in XLSX archive.');
  return sections.join('\n\n');
}

function parseSharedStrings(buffer, parser) {
  if (!buffer) return [];
  const doc = parser.parseFromString(buffer.toString('utf8'), 'text/xml');
  return Array.from(doc.getElementsByTagName('si')).map((si) =>
    Array.from(si.getElementsByTagName('t')).map((t) => t.textContent ?? '').join('')
  );
}

function renderSheetTable(sheetXml, parser, sharedStrings) {
  if (!sheetXml) return '(empty sheet)';
  const doc = parser.parseFromString(sheetXml.toString('utf8'), 'text/xml');
  const rows = Array.from(doc.getElementsByTagName('row'));
  if (!rows.length) return '(empty sheet)';

  const grid = rows.map((row) => {
    const cells = Array.from(row.getElementsByTagName('c'));
    const byColumn = new Map();
    let maxColumn = 0;
    for (const cell of cells) {
      const column = columnIndex(cell.getAttribute('r'));
      maxColumn = Math.max(maxColumn, column);
      byColumn.set(column, cellValue(cell, sharedStrings));
    }
    return { byColumn, maxColumn };
  });

  const columnCount = Math.max(1, ...grid.map((row) => row.maxColumn + 1));
  const lines = grid.map((row) =>
    `| ${Array.from({ length: columnCount }, (_, column) => escapeCell(row.byColumn.get(column) ?? '')).join(' | ')} |`
  );
  const divider = `| ${Array.from({ length: columnCount }, () => '---').join(' | ')} |`;
  return [lines[0], divider, ...lines.slice(1)].join('\n');
}

function cellValue(cellNode, sharedStrings) {
  const type = cellNode.getAttribute('t');
  if (type === 'inlineStr') {
    const isNode = cellNode.getElementsByTagName('is')[0];
    return isNode ? Array.from(isNode.getElementsByTagName('t')).map((t) => t.textContent ?? '').join('') : '';
  }
  const vNode = cellNode.getElementsByTagName('v')[0];
  const raw = vNode?.textContent ?? '';
  if (type === 's') return sharedStrings[Number(raw)] ?? '';
  if (type === 'b') return raw === '1' ? 'TRUE' : 'FALSE';
  return raw;
}

// "B12" -> 1 (zero-based column index). Ignores the row-number suffix entirely.
function columnIndex(cellRef) {
  const letters = /^[A-Z]+/.exec(cellRef ?? '')?.[0] ?? 'A';
  let index = 0;
  for (const char of letters) index = index * 26 + (char.charCodeAt(0) - 64);
  return index - 1;
}

function escapeCell(value) {
  return String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
}
