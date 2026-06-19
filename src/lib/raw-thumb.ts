/**
 * Pure-JS CR2/RAW thumbnail extractor.
 * No native dependencies. Works in Vercel serverless.
 * Canon CR2 stores 3 JPEG previews: thumbnail, small, large (biggest = raw preview).
 */
export async function extractRawThumbnail(buffer: Buffer): Promise<Buffer | null> {
  return extractLargestJpeg(buffer);
}

function extractLargestJpeg(buffer: Buffer): Buffer | null {
  const SOI = Buffer.from([0xff, 0xd8]);
  const EOI = Buffer.from([0xff, 0xd9]);
  let best: Buffer | null = null;
  let pos = 0;

  while (pos < buffer.length - 1) {
    const start = buffer.indexOf(SOI, pos);
    if (start === -1) break;

    // Scan ALL EOI markers after this SOI — take the furthest (largest JPEG segment)
    let end = buffer.indexOf(EOI, start + 2);
    let bestEnd = -1;
    while (end !== -1 && end < buffer.length) {
      bestEnd = end;
      end = buffer.indexOf(EOI, end + 2);
    }

    if (bestEnd !== -1) {
      const candidate = buffer.subarray(start, bestEnd + 2);
      // Min 100 KB = real preview, skip tiny EXIF thumbnails
      if (candidate.length > 100_000 && (!best || candidate.length > best.length)) {
        best = Buffer.from(candidate);
      }
    }

    pos = start + 2;
  }

  return best;
}
