// eslint-disable-next-line @typescript-eslint/no-require-imports
const dcraw = require('dcraw');

export async function extractRawThumbnail(buffer: Buffer): Promise<Buffer | null> {
  // Strategy 1: dcraw WASM — reliable for all Canon CR2, Nikon NEF, etc.
  try {
    const result: Buffer | Uint8Array = dcraw(buffer, { extractThumbnail: true });
    if (result && result.length > 1000) {
      return Buffer.isBuffer(result) ? result : Buffer.from(result);
    }
  } catch (err) {
    console.warn('[raw-thumb] dcraw failed:', (err as Error).message);
  }

  // Strategy 2: Manual JPEG carving — scan for largest embedded JPEG segment
  return extractLargestJpeg(buffer);
}

function extractLargestJpeg(buffer: Buffer): Buffer | null {
  const SOI = Buffer.from([0xff, 0xd8, 0xff]);
  const EOI = Buffer.from([0xff, 0xd9]);
  let best: Buffer | null = null;
  let pos = 0;

  while (pos < buffer.length - 3) {
    const start = buffer.indexOf(SOI, pos);
    if (start === -1) break;

    const end = buffer.indexOf(EOI, start + 3);
    if (end === -1) { pos = start + 1; continue; }

    const candidate = buffer.subarray(start, end + 2);
    // Only consider segments > 50 KB (skip tiny EXIF thumbnails)
    if (candidate.length > 50_000 && (!best || candidate.length > best.length)) {
      best = Buffer.from(candidate);
    }
    pos = end + 2;
  }

  return best;
}
