import { NextRequest } from 'next/server';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { r2, BUCKET } from '@/lib/r2';
import { getShareById, isShareExpired } from '@/lib/shares';
import { getCurrentUser } from '@/lib/auth';
import sharp from 'sharp';

const RAW_EXTS = new Set(['cr2', 'cr3', 'nef', 'arw', 'dng', 'raf', 'rw2', 'orf', 'pef']);
// 2 MB range request covers embedded JPEG in virtually all CR2/RAW files
const RAW_RANGE = 'bytes=0-2097151';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const key     = searchParams.get('key');
  const shareId = searchParams.get('shareId');

  if (!key) return new Response('Missing key', { status: 400 });

  // ── Auth / security ───────────────────────────────────────────────────────
  if (shareId) {
    const share = await getShareById(shareId);
    if (
      !share ||
      isShareExpired(share) ||
      share.fileType !== 'folder' ||
      !share.folderPath ||
      !key.startsWith(share.folderPath)
    ) {
      return new Response('Forbidden', { status: 403 });
    }
  } else {
    const user = await getCurrentUser();
    if (!user) return new Response('Unauthorized', { status: 401 });
    if (!key.startsWith(`${user.id}/`)) return new Response('Forbidden', { status: 403 });
  }

  // ── Cache hit ─────────────────────────────────────────────────────────────
  const thumbKey = `_thumbs/${key}.webp`;
  try {
    const cached = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: thumbKey }));
    if (cached.Body) {
      return new Response(cached.Body.transformToWebStream(), {
        headers: {
          'Content-Type': 'image/webp',
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      });
    }
  } catch {
    // cache miss — continue
  }

  // ── Fetch from R2 ─────────────────────────────────────────────────────────
  const ext   = key.split('.').pop()?.toLowerCase() ?? '';
  const isRaw = RAW_EXTS.has(ext);

  let fileBuffer: Buffer;
  try {
    const cmd = new GetObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ...(isRaw && { Range: RAW_RANGE }),
    });
    const obj = await r2.send(cmd);
    if (!obj.Body) return new Response('Not found', { status: 404 });
    fileBuffer = Buffer.from(await obj.Body.transformToByteArray());
  } catch {
    return new Response('Not found', { status: 404 });
  }

  // ── Generate thumbnail ────────────────────────────────────────────────────
  let source: Buffer = fileBuffer;
  if (isRaw) {
    const embedded = extractEmbeddedJpeg(fileBuffer);
    if (embedded) source = embedded;
    // If no embedded JPEG found, try sharp directly on the raw bytes (may fail)
  }

  let thumbBuffer: Buffer;
  try {
    thumbBuffer = await sharp(source)
      .resize(400, 300, { fit: 'cover', position: 'centre' })
      .webp({ quality: 75 })
      .toBuffer();
  } catch {
    // Cannot generate thumbnail (unsupported format / corrupt file)
    return new Response(null, { status: 204 });
  }

  // ── Save to cache (fire-and-forget) ───────────────────────────────────────
  r2.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: thumbKey,
    Body: thumbBuffer,
    ContentType: 'image/webp',
    Metadata: { 'source-key': key },
  })).catch(() => {});

  // Extract a true ArrayBuffer (TS 5.9 requires this, Buffer/Uint8Array have ArrayBufferLike)
  const ab = thumbBuffer.buffer.slice(thumbBuffer.byteOffset, thumbBuffer.byteOffset + thumbBuffer.byteLength);
  return new Response(ab as ArrayBuffer, {
    headers: {
      'Content-Type': 'image/webp',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}

/**
 * Scan buffer for embedded JPEG segments (SOI…EOI).
 * Returns the largest one — in CR2 files this is the full-size preview JPEG.
 */
function extractEmbeddedJpeg(buffer: Buffer): Buffer | null {
  let best: Buffer | null = null;
  let pos = 0;

  while (pos < buffer.length - 3) {
    // Locate SOI: FF D8 FF
    const soi = buffer.indexOf(0xff, pos);
    if (soi === -1 || soi + 2 >= buffer.length) break;
    if (buffer[soi + 1] !== 0xd8 || buffer[soi + 2] !== 0xff) {
      pos = soi + 1;
      continue;
    }

    // Locate EOI: FF D9
    const eoi = buffer.indexOf(Buffer.from([0xff, 0xd9]), soi + 3);
    if (eoi === -1) { pos = soi + 1; continue; }

    const len = eoi + 2 - soi;
    if (!best || len > best.length) {
      // Copy to avoid keeping a reference to the large source buffer
      best = Buffer.from(buffer.subarray(soi, eoi + 2));
    }
    pos = eoi + 2;
  }

  return best;
}
