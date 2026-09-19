import { extractPdfStructured } from '../extractors/pdf.js';

export async function extractPdf(buffer) {
  const result = await extractPdfStructured(buffer);
  return {
    contentAvailability: 'extracted',
    text: result.text,
    representationKind: 'page-sections',
    metadata: {
      pageCount: result.pageCount,
      ...(result.title ? { title: result.title } : {}),
      ...(result.producer ? { producer: result.producer } : {})
    }
  };
}
