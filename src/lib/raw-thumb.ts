/**
 * CR2 thumbnail extractor + WebP converter.
 * Uses TIFF/IFD structure (official Canon CR2 spec).
 * sharp@0.34.5 confirmed working on Vercel.
 * Source: http://lclevy.free.fr/cr2/
 */

/** Returns true only for standard 8-bit JPEGs (precision=8 in SOF marker).
 *  Canon RAW lossless data encodes as 14-bit — we reject those. */
function isStandardJpeg(buf: Buffer): boolean {
  for (let i = 2; i < Math.min(buf.length - 10, 512); i++) {
    if (buf[i] !== 0xff) continue;
    const marker = buf[i + 1];
    // SOF markers: C0-CF excluding C4 (DHT), C8 (JPEG2K ext), CC (arithmetic DAC)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const precision = buf[i + 4];
      console.log('[raw-thumb] JPEG precision:', precision, 'SOF marker: 0xff' + marker.toString(16));
      return precision === 8;
    }
  }
  return true; // no SOF found — optimistic, let sharp handle it
}

export interface ExtractResult {
  jpeg: Buffer;
  orientation: number; // EXIF tag 0x0112: 1=normal, 3=180°, 6=90°CW, 8=90°CCW
}

export function extractRawThumbnail(buffer: Buffer): ExtractResult | null {
  try {
    if (buffer.length < 8) return null;

    const isLE = buffer[0] === 0x49 && buffer[1] === 0x49;
    const readU16 = (o: number) => isLE ? buffer.readUInt16LE(o) : buffer.readUInt16BE(o);
    const readU32 = (o: number) => isLE ? buffer.readUInt32LE(o) : buffer.readUInt32BE(o);

    const magic = readU16(2);
    if (magic !== 0x002a && magic !== 0x5243) {
      console.warn('[raw-thumb] Not TIFF/CR2, falling back to carving');
      const carved = byteCarve(buffer);
      return carved ? { jpeg: carved, orientation: 1 } : null;
    }

    // ── IFD walk with pending queue (handles SubIFDs via tag 0x014A) ─────────
    const pending: number[] = [readU32(4)];
    const visited = new Set<number>();
    let bestJpeg: Buffer | null = null;
    let bestSize = 0;
    let orientation = 1; // TIFF tag 0x0112, read from IFD0

    while (pending.length > 0) {
      const ifdOffset = pending.shift()!;
      if (!ifdOffset || ifdOffset + 2 >= buffer.length || visited.has(ifdOffset)) continue;
      visited.add(ifdOffset);

      const count = readU16(ifdOffset);
      if (count === 0 || count > 1000) continue;

      let jpegOffset = 0, jpegLength = 0;
      let stripOffset = 0, stripLength = 0;

      for (let i = 0; i < count; i++) {
        const base = ifdOffset + 2 + i * 12;
        if (base + 12 > buffer.length) break;
        const tag  = readU16(base);
        const type = readU16(base + 2);
        const nval = readU32(base + 4);
        const val  = readU32(base + 8);

        if (tag === 0x0112) orientation = readU16(base + 8); // Orientation (SHORT)
        if (tag === 0x0201) jpegOffset = val;                // JPEGInterchangeFormat
        if (tag === 0x0202) jpegLength = val;                // JPEGInterchangeFormatLength
        if (tag === 0x0111) stripOffset = val;               // StripOffsets
        if (tag === 0x0117) stripLength = val;               // StripByteCounts

        // SubIFD pointer (tag 0x014A): value is an array of offsets
        if (tag === 0x014a && type === 4 /* LONG */ && nval <= 8) {
          if (nval === 1) {
            pending.push(val);
          } else {
            // val is a pointer to the array of offsets
            for (let j = 0; j < nval; j++) {
              const arrPos = val + j * 4;
              if (arrPos + 4 <= buffer.length) pending.push(readU32(arrPos));
            }
          }
        }
      }

      // Check JPEGInterchangeFormat candidate
      if (jpegOffset > 0 && jpegLength > 10_000 && jpegOffset + jpegLength <= buffer.length) {
        const slice = buffer.subarray(jpegOffset, jpegOffset + jpegLength);
        if (slice[0] === 0xff && slice[1] === 0xd8 && jpegLength > bestSize) {
          const candidate = Buffer.from(slice);
          if (isStandardJpeg(candidate)) {
            bestJpeg = candidate;
            bestSize = jpegLength;
            console.log('[raw-thumb] IFD JPEG offset:', jpegOffset, 'size:', jpegLength);
          } else {
            console.log('[raw-thumb] Skipped 14-bit IFD JPEG offset:', jpegOffset, 'size:', jpegLength);
          }
        }
      }

      // StripOffsets fallback (some Canon models store preview here)
      if (stripOffset > 0 && stripLength > 10_000 && stripOffset + stripLength <= buffer.length) {
        const slice = buffer.subarray(stripOffset, stripOffset + stripLength);
        if (slice[0] === 0xff && slice[1] === 0xd8 && stripLength > bestSize) {
          const candidate = Buffer.from(slice);
          if (isStandardJpeg(candidate)) {
            bestJpeg = candidate;
            bestSize = stripLength;
            console.log('[raw-thumb] Strip JPEG offset:', stripOffset, 'size:', stripLength);
          }
        }
      }

      // Enqueue next chained IFD
      const nextOffPos = ifdOffset + 2 + count * 12;
      if (nextOffPos + 4 <= buffer.length) {
        const nextIfd = readU32(nextOffPos);
        if (nextIfd > 0) pending.push(nextIfd);
      }
    }

    if (bestJpeg) {
      console.log('[raw-thumb] orientation:', orientation);
      return { jpeg: bestJpeg, orientation };
    }

    console.warn('[raw-thumb] IFD found nothing, trying byte carving');
    const carved = byteCarve(buffer);
    return carved ? { jpeg: carved, orientation: 1 } : null;
  } catch (err) {
    console.error('[raw-thumb] error:', err);
    return null;
  }
}

/** Scan raw bytes for JPEG SOI/EOI pairs, pick largest standard 8-bit JPEG ≤ 5 MB */
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
      if (len > 50_000 && len <= 5_000_000 && (!best || len > best.length)) {
        const candidate = Buffer.from(buffer.subarray(start, end + 2));
        if (isStandardJpeg(candidate)) {
          best = candidate;
          console.log('[raw-thumb] byteCarve candidate:', len, 'bytes');
        } else {
          console.log('[raw-thumb] byteCarve skipped 14-bit JPEG:', len, 'bytes');
        }
      }
    }
    pos = end !== -1 ? end + 2 : start + 2;
  }
  return best;
}

function orientationToDeg(orientation: number): number {
  if (orientation === 6) return 90;
  if (orientation === 8) return 270;
  if (orientation === 3) return 180;
  return 0;
}

/** Convert embedded JPEG → WebP thumbnail (400x300, grid quality) */
export async function toWebpThumb(jpegBuffer: Buffer, orientation = 1): Promise<Buffer | null> {
  try {
    const sharpMod = await import('sharp');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sharp = (sharpMod as any).default ?? sharpMod;
    const deg = orientationToDeg(orientation);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let pipeline: any = sharp(jpegBuffer);
    if (deg !== 0) pipeline = pipeline.rotate(deg);
    return await pipeline
      .resize(400, 300, { fit: 'cover', position: 'centre' })
      .webp({ quality: 75 })
      .toBuffer();
  } catch (err) {
    console.error('[raw-thumb] sharp WebP thumb failed:', err);
    return null;
  }
}

/** Convert embedded JPEG → WebP preview (1200px max, lightbox quality) */
export async function toWebpPreview(jpegBuffer: Buffer, orientation = 1): Promise<Buffer | null> {
  try {
    const sharpMod = await import('sharp');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sharp = (sharpMod as any).default ?? sharpMod;
    const deg = orientationToDeg(orientation);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let pipeline: any = sharp(jpegBuffer);
    if (deg !== 0) pipeline = pipeline.rotate(deg);
    return await pipeline
      .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer();
  } catch (err) {
    console.error('[raw-thumb] sharp WebP preview failed:', err);
    return null;
  }
}
