export async function extractRawThumbnail(buffer: Buffer): Promise<Buffer | null> {
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
