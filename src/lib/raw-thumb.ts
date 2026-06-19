/**
 * Canon CR2 thumbnail extractor using TIFF/IFD structure.
 * CR2 = TIFF-based format with 4 IFDs. Each IFD may contain:
 *   Tag 0x0201 (513) = JPEGInterchangeFormat (offset to JPEG)
 *   Tag 0x0202 (514) = JPEGInterchangeFormatLength (JPEG size)
 *
 * Pure-JS, no native dependencies, no WASM.
 * Source: http://lclevy.free.fr/cr2/
 */
export function extractRawThumbnail(buffer: Buffer): Buffer | null {
  try {
    if (buffer.length < 8) return null;

    const isLE = buffer[0] === 0x49 && buffer[1] === 0x49; // 'II' = little-endian

    const readU16 = (off: number): number =>
      isLE ? buffer.readUInt16LE(off) : buffer.readUInt16BE(off);
    const readU32 = (off: number): number =>
      isLE ? buffer.readUInt32LE(off) : buffer.readUInt32BE(off);

    // Check TIFF magic (0x002A) or CR2 magic (0x5243 = 'RC')
    const magic = readU16(2);
    if (magic !== 0x002a && magic !== 0x5243) {
      console.warn('[raw-thumb] Not a TIFF/CR2 file, magic:', magic.toString(16));
      return fallbackByteCarving(buffer);
    }

    let ifdOffset = readU32(4);
    let bestJpeg: Buffer | null = null;
    let bestSize = 0;
    const visited = new Set<number>();

    // Walk all IFDs (CR2 has exactly 4)
    while (ifdOffset > 0 && ifdOffset + 2 < buffer.length && !visited.has(ifdOffset)) {
      visited.add(ifdOffset);

      const entryCount = readU16(ifdOffset);
      if (entryCount === 0 || entryCount > 1000) break;

      let jpegOffset = 0;
      let jpegLength = 0;

      for (let i = 0; i < entryCount; i++) {
        const base = ifdOffset + 2 + i * 12;
        if (base + 12 > buffer.length) break;

        const tag = readU16(base);
        const value = readU32(base + 8);

        if (tag === 0x0201) jpegOffset = value; // JPEGInterchangeFormat
        if (tag === 0x0202) jpegLength = value; // JPEGInterchangeFormatLength
      }

      // Valid JPEG found in this IFD?
      if (
        jpegOffset > 0 &&
        jpegLength > 10_000 &&
        jpegOffset + jpegLength <= buffer.length &&
        jpegLength > bestSize
      ) {
        const slice = buffer.subarray(jpegOffset, jpegOffset + jpegLength);
        if (slice[0] === 0xff && slice[1] === 0xd8) {
          bestJpeg = Buffer.from(slice);
          bestSize = jpegLength;
          console.log('[raw-thumb] IFD JPEG at offset', jpegOffset, 'size:', jpegLength);
        }
      }

      // Advance to next IFD
      const nextOff = ifdOffset + 2 + entryCount * 12;
      ifdOffset = nextOff + 4 <= buffer.length ? readU32(nextOff) : 0;
    }

    if (bestJpeg) return bestJpeg;

    console.warn('[raw-thumb] IFD found no JPEG, falling back to byte carving...');
    return fallbackByteCarving(buffer);
  } catch (err) {
    console.error('[raw-thumb] error:', err);
    return null;
  }
}

function fallbackByteCarving(buffer: Buffer): Buffer | null {
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
      if (len > 50_000 && (!best || len > best.length)) {
        best = Buffer.from(buffer.subarray(start, end + 2));
        console.log('[raw-thumb] carving JPEG at', start, 'size:', len);
      }
    }

    pos = end !== -1 ? end + 2 : start + 2;
  }

  return best;
}
