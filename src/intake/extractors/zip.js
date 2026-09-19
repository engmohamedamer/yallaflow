import yauzl from 'yauzl';

const MAX_ENTRIES_SCANNED = 5000;
const MAX_DECOMPRESSED_BYTES = 100 * 1024 * 1024; // 100 MB across all entries we actually read

// Reads only the zip entries whose path satisfies `wantPath`, guarding against
// decompression bombs: scanning stops once either the entry-count or cumulative
// decompressed-byte limit is exceeded, and that is reported as an explicit error —
// never a silent partial read.
export async function readZipEntries(buffer, wantPath) {
  const zipfile = await openZip(buffer);
  const out = new Map();
  let scanned = 0;
  let decompressed = 0;

  try {
    await new Promise((resolve, reject) => {
      const finish = (error) => {
        zipfile.removeAllListeners();
        try { zipfile.close(); } catch { /* already closed */ }
        error ? reject(error) : resolve();
      };

      zipfile.on('error', finish);
      zipfile.on('end', () => finish());
      zipfile.on('entry', (entry) => {
        scanned += 1;
        if (scanned > MAX_ENTRIES_SCANNED) return finish(new Error('Archive has too many entries to safely scan.'));
        if (!wantPath(entry.fileName)) return zipfile.readEntry();

        zipfile.openReadStream(entry, (error, stream) => {
          if (error) return finish(error);
          const chunks = [];
          stream.on('data', (chunk) => {
            decompressed += chunk.length;
            if (decompressed > MAX_DECOMPRESSED_BYTES) {
              stream.destroy();
              return finish(new Error('Archive exceeded the safe decompression limit; refusing to continue (possible decompression bomb).'));
            }
            chunks.push(chunk);
          });
          stream.on('end', () => {
            out.set(entry.fileName, Buffer.concat(chunks));
            zipfile.readEntry();
          });
          stream.on('error', finish);
        });
      });
      zipfile.readEntry();
    });
  } finally {
    try { zipfile.close(); } catch { /* already closed */ }
  }

  return out;
}

function openZip(buffer) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (error, zipfile) => {
      if (error) return reject(new Error(`Not a readable zip-based document: ${error.message}`));
      resolve(zipfile);
    });
  });
}

// Natural numeric sort for OOXML part names like slide2.xml vs slide10.xml, where
// plain lexicographic sort would put slide10 before slide2.
export function sortByTrailingNumber(names) {
  return [...names].sort((a, b) => {
    const na = Number(/(\d+)(?=\.[^./]*$)/.exec(a)?.[1] ?? 0);
    const nb = Number(/(\d+)(?=\.[^./]*$)/.exec(b)?.[1] ?? 0);
    return na - nb || a.localeCompare(b);
  });
}
