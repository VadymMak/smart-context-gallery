/**
 * CR2 thumbnail extractor + WebP converter.
 * Uses TIFF/IFD structure (official Canon CR2 spec).
 * sharp@0.34.5 confirmed working on Vercel.
 * Source: http://lclevy.free.fr/cr2/
 */

export function extractRawThumbnail(buffer: Buffer): Buffer | null {
  try {
    if (buffer.length < 8) return null;

    const isLE = buffer[0] === 0x49 && buffer[1] === 0x49;
    const readU16 = (o: number) => isLE ? buffer.readUInt16LE(o) : buffer.readUInt16BE(o);
    const readU32 = (o: number) => isLE ? buffer.readUInt32LE(o) : buffer.readUInt32BE(o);

    const magic = readU16(2);
    if (magic !== 0x002a && magic !== 0x5243) {
      console.warn('[raw-thumb] Not TIFF/CR2, falling back to carving');
      return byteCarve(buffer);
    }

    let ifdOffset = readU32(4);
    let bestJpeg: Buffer | null = null;
    let bestSize = 0;
    const visited = new Set<number>();

    while (ifdOffset > 0 && ifdOffset + 2 < buffer.length && !visited.has(ifdOffset)) {
      visited.add(ifdOffset);
      const count = readU16(ifdOffset);
      if (count === 0 || count > 1000) break;

      let jpegOffset = 0, jpegLength = 0;
      for (let i = 0; i < count; i++) {
        const base = ifdOffset + 2 + i * 12;
        if (base + 12 > buffer.length) break;
        const tag = readU16(base);
        const val = readU32(base + 8);
        if (tag === 0x0201) jpegOffset = val;
        if (tag === 0x0202) jpegLength = val;
      }

      if (
        jpegOffset > 0 && jpegLength > 10_000 &&
        jpegOffset + jpegLength <= buffer.length && jpegLength > bestSize
      ) {
        const slice = buffer.subarray(jpegOffset, jpegOffset + jpegLength);
        if (slice[0] === 0xff && slice[1] === 0xd8) {
          bestJpeg = Buffer.from(slice);
          bestSize = jpegLength;
          console.log('[raw-thumb] IFD JPEG at offset', jpegOffset, 'size:', jpegLength);
        }
      }

      const nextOff = ifdOffset + 2 + count * 12;
      ifdOffset = nextOff + 4 <= buffer.length ? readU32(nextOff) : 0;
    }

    if (bestJpeg) return bestJpeg;
    console.warn('[raw-thumb] IFD found nothing, trying byte carving');
    return byteCarve(buffer);
  } catch (err) {
    console.error('[raw-thumb] error:', err);
    return null;
  }
}

function byteCarve(buffer: Buffer): Buffer | null {
  let best: Buffer | null = null;
  let pos = 0;
  while (pos < buffer.length - 3) {
    if (buffer[pos] !== 0xff || buffer[pos + 1] !== 0xd8) { pos++; continue; }
    const start = pos;
    let end = -1;
    for (let i = start + 2; i < buffer.length - 1; i++) {
      if (buffer[i] === 0xff && buffer[i + 1] === 0xd9) { end = i; break; }
    }
    if (end !== -1) {
      const len = end - start + 2;
      if (len > 50_000 && (!best || len > best.length))
        best = Buffer.from(buffer.subarray(start, end + 2));
    }
    pos = end !== -1 ? end + 2 : start + 2;
  }
  return best;
}

/** Convert embedded JPEG → WebP thumbnail (400x300, grid quality) */
export async function toWebpThumb(jpegBuffer: Buffer): Promise<Buffer | null> {
  try {
    const sharpMod = await import('sharp');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sharp = (sharpMod as any).default ?? sharpMod;
    return await sharp(jpegBuffer)
      .resize(400, 300, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 75 })
      .toBuffer();
  } catch (err) {
    console.error('[raw-thumb] sharp WebP thumb failed:', err);
    return null;
  }
}

/** Convert embedded JPEG → WebP preview (1200px max, lightbox quality) */
export async function toWebpPreview(jpegBuffer: Buffer): Promise<Buffer | null> {
  try {
    const sharpMod = await import('sharp');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sharp = (sharpMod as any).default ?? sharpMod;
    return await sharp(jpegBuffer)
      .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer();
  } catch (err) {
    console.error('[raw-thumb] sharp WebP preview failed:', err);
    return null;
  }
}
