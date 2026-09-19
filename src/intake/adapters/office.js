import officeParser from 'officeparser';
import { extractPptxStructured } from '../extractors/pptx.js';
import { extractXlsxStructured } from '../extractors/xlsx.js';

// Office/OpenDocument documents (.docx, .pptx, .xlsx, .odt, .ods, .odp). PDF is
// handled by its own adapter, not here — see adapters/pdf.js and
// docs/architecture.md "Parser decisions" for why.
//
// .xlsx/.pptx get a structured pass first (real sheet names + grid tables; real
// slide sections) because that structure is cheap to recover and materially more
// useful than flattened text. If that structured pass fails for any reason, we fall
// back to officeparser's flattened extraction rather than failing the whole intake.
export async function extractOffice(buffer, context) {
  if (context.extension === '.xlsx') {
    try {
      return { contentAvailability: 'extracted', text: await extractXlsxStructured(buffer), representationKind: 'sheet-tables' };
    } catch {
      // fall through to flattened extraction below
    }
  }
  if (context.extension === '.pptx') {
    try {
      return { contentAvailability: 'extracted', text: await extractPptxStructured(buffer), representationKind: 'slide-sections' };
    } catch {
      // fall through to flattened extraction below
    }
  }

  const text = await officeParser.parseOfficeAsync(buffer, { outputErrorToConsole: false });
  if (!text || !text.trim()) throw new Error('No extractable text was found in this document.');
  return { contentAvailability: 'extracted', text, representationKind: 'flattened' };
}
