/**
 * Pure-JS CR2/RAW thumbnail extractor.
 * Canon CR2 embeds multiple JPEGs sequentially (thumbnail, preview, large preview).
 * Strategy: find each SOI+nearest-EOI pair, take the largest valid one.
 */
export async function extractRawThumbnail(buffer: Buffer): Promise<Buffer | null> {
  try {
    console.log('[raw-thumb] buffer size:', buffer.length);
    const jpeg = extractLargestJpeg(buffer);
    if (!jpeg) {
      console.warn('[raw-thumb] No embedded JPEG found in', buffer.length, 'bytes');
      return null;
    }
    console.log('[raw-thumb] Found JPEG:', jpeg.length, 'bytes');
    return jpeg;
  } catch (err) {
    console.error('[raw-thumb] error:', err);
    return null;
  }
}

function extractLargestJpeg(buffer: Buffer): Buffer | null {
  const SOI_0 = 0xff;
  const SOI_1 = 0xd8;
  const EOI_0 = 0xff;
  const EOI_1 = 0xd9;

  let best: Buffer | null = null;
  let pos = 0;

  while (pos < buffer.length - 3) {
    // Find next SOI marker
    if (buffer[pos] !== SOI_0 || buffer[pos + 1] !== SOI_1) {
      pos++;
      continue;
    }

    const start = pos;

    // Find NEAREST EOI after this SOI — gives one complete JPEG segment
    let end = -1;
    for (let i = start + 2; i < buffer.length - 1; i++) {
      if (buffer[i] === EOI_0 && buffer[i + 1] === EOI_1) {
        end = i;
        break;
      }
    }

    if (end === -1) {
      pos = start + 2;
      continue;
    }

    const len = end - start + 2;
    // >50 KB = real preview (Canon CR2 smallest real preview ≈ 160 KB)
    if (len > 50_000) {
      if (!best || len > best.length) {
        best = Buffer.from(buffer.subarray(start, end + 2));
        console.log('[raw-thumb] candidate JPEG at offset', start, 'size:', len);
      }
    }

    // Move past this JPEG to search for the next one
    pos = end + 2;
  }

  return best;
}
