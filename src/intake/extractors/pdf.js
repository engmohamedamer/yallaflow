// pdfjs-dist 6.x uses Promise.withResolvers, which landed natively only in Node 22.
// This is a standard, well-known shim (not a security-sensitive polyfill) applied
// only when the runtime lacks it, so pdfjs-dist works on our documented Node >=20
// baseline while staying on the patched pdfjs-dist version (see docs/architecture.md
// "Parser decisions" for why the version matters).
Promise.withResolvers ??= function withResolvers() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

const MAX_PAGES = 2000;

// Extracts per-page text from a text-based PDF, hardened against the classes of PDF
// risk this project explicitly refuses to run: no worker thread, no font loading, no
// auto-fetch of remote resources, and isEvalSupported disabled so embedded
// PDF/JavaScript is never evaluated. Page order is preserved; word order within a
// line follows the PDF content stream, which is not guaranteed to match visual
// reading order (most notably for RTL scripts) — see docs/architecture.md.
export async function extractPdfStructured(buffer) {
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    disableWorker: true,
    isEvalSupported: false,
    disableAutoFetch: true,
    disableStream: true,
    disableFontFace: true,
    useSystemFonts: false,
    stopAtErrors: false
  });

  const doc = await loadingTask.promise;
  try {
    if (doc.numPages > MAX_PAGES) {
      throw new Error(`PDF has ${doc.numPages} pages, exceeding the safe limit of ${MAX_PAGES}.`);
    }
    const metadata = await doc.getMetadata().catch(() => null);
    const sections = [];
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      sections.push(`# Page ${pageNumber}\n\n${renderPageText(content.items)}`);
    }
    return {
      text: sections.join('\n\n'),
      pageCount: doc.numPages,
      title: metadata?.info?.Title || undefined,
      producer: metadata?.info?.Producer || undefined
    };
  } finally {
    await loadingTask.destroy?.();
  }
}

// Groups text items into lines by Y-coordinate (a standard, well-precedented PDF
// text-extraction technique), then joins items within a line in content-stream
// order. This is a positional heuristic, not a semantic reading-order reconstruction.
function renderPageText(items) {
  const lines = [];
  let currentY;
  let currentLine = [];
  for (const item of items) {
    if (!('str' in item) || item.str === '') continue;
    const y = item.transform?.[5];
    if (currentLine.length && y !== currentY) {
      lines.push(currentLine.join(''));
      currentLine = [];
    }
    currentY = y;
    currentLine.push(item.str);
  }
  if (currentLine.length) lines.push(currentLine.join(''));
  return lines.length ? lines.join('\n') : '(no extractable text on this page)';
}
