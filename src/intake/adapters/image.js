// Tier 4 — Images / Visual Sources. YallaFlow does not perform OCR or vision
// understanding; the original image is preserved as the source, and only cheaply,
// safely discoverable metadata (format, dimensions where trivial to read from the
// file header, checksum — checksum is added by the caller) is recorded. A future
// OCR/vision adapter can be added without changing this contract.
export async function extractImageMetadata(buffer, context) {
  const dimensions = readDimensions(buffer, context.extension);
  return {
    contentAvailability: 'original-only',
    metadata: {
      format: context.extension.slice(1),
      ...(dimensions ? { width: dimensions.width, height: dimensions.height } : {})
    }
  };
}

function readDimensions(buffer, extension) {
  try {
    if (extension === '.png' && buffer.length >= 24) {
      return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    }
    if (extension === '.gif' && buffer.length >= 10) {
      return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
    }
    if (extension === '.bmp' && buffer.length >= 26) {
      return { width: Math.abs(buffer.readInt32LE(18)), height: Math.abs(buffer.readInt32LE(22)) };
    }
    if ((extension === '.jpg' || extension === '.jpeg') && buffer.length >= 4) {
      return readJpegDimensions(buffer);
    }
    if (extension === '.svg') {
      return readSvgDimensions(buffer);
    }
  } catch {
    return null; // Malformed header: report no dimensions rather than a wrong guess.
  }
  return null;
}

function readJpegDimensions(buffer) {
  let offset = 2; // skip SOI marker (0xFFD8)
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) { offset += 1; continue; }
    const marker = buffer[offset + 1];
    const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    const segmentLength = buffer.readUInt16BE(offset + 2);
    if (isStartOfFrame) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    offset += 2 + segmentLength;
  }
  return null;
}

function readSvgDimensions(buffer) {
  const head = buffer.subarray(0, 4096).toString('utf8');
  const svgTag = /<svg\b[^>]*>/i.exec(head)?.[0];
  if (!svgTag) return null;
  const width = /[\s:]width="?(\d+(?:\.\d+)?)/i.exec(svgTag)?.[1];
  const height = /[\s:]height="?(\d+(?:\.\d+)?)/i.exec(svgTag)?.[1];
  if (width && height) return { width: Math.round(Number(width)), height: Math.round(Number(height)) };
  return null;
}
