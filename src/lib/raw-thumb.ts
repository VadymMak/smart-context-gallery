/**
 * Pure-JS CR2/RAW thumbnail extractor.
 * No WASM, no native deps. Safe for Vercel serverless.
 * Canon CR2 embeds multiple JPEGs: smallest=thumbnail, largest=preview image.
 */

export async function extractRawThumbnail(buffer: Buffer): Promise<Buffer | null> {
  try {
    const jpeg = extractLargestJpeg(buffer);
    if (!jpeg) {
      console.warn('[raw-thumb] No JPEG found, buffer size:', buffer.length);
    }
    return jpeg;
  } catch (err) {
    console.error('[raw-thumb] extractRawThumbnail error:', err);
    return null;
  }
}

function extractLargestJpeg(buffer: Buffer): Buffer | null {
  const SOI = Buffer.from([0xff, 0xd8]);
  const EOI = Buffer.from([0xff, 0xd9]);
  let best: Buffer | null = null;
  let pos = 0;

  while (pos < buffer.length - 1) {
    const start = buffer.indexOf(SOI, pos);
    if (start === -1) break;

    // Find ALL EOI markers after this SOI — take the furthest (= largest JPEG segment)
    let scanPos = start + 2;
    let lastEOI = -1;
    while (scanPos < buffer.length - 1) {
      const eoi = buffer.indexOf(EOI, scanPos);
      if (eoi === -1) break;
      lastEOI = eoi;
      scanPos = eoi + 2;
    }

    if (lastEOI !== -1) {
      const candidate = buffer.subarray(start, lastEOI + 2);
      // >50 KB = real preview (not tiny EXIF thumbnail)
      if (candidate.length > 50_000 && (!best || candidate.length > best.length)) {
        best = Buffer.from(candidate);
        console.log('[raw-thumb] Found JPEG candidate:', candidate.length, 'bytes at offset', start);
      }
    }

    pos = start + 2;
  }

  return best;
}
