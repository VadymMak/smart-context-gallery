import { NextRequest } from 'next/server';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { r2, BUCKET } from '@/lib/r2';
import { getShareById, isShareExpired } from '@/lib/shares';
import { getCurrentUser } from '@/lib/auth';
import sharp from 'sharp';
import exifr from 'exifr';

const RAW_EXTS = new Set(['cr2', 'cr3', 'nef', 'arw', 'dng', 'raf', 'rw2', 'orf', 'pef']);
// 2 MB range request covers embedded JPEG in virtually all CR2/RAW files
const RAW_RANGE = 'bytes=0-2097151';

function toArrayBuffer(u8: Uint8Array<ArrayBufferLike>): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

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
    fileBuffer = Buffer.from(toArrayBuffer(await obj.Body.transformToByteArray()));
  } catch {
    return new Response('Not found', { status: 404 });
  }

  // ── Generate thumbnail ────────────────────────────────────────────────────
  let source: Buffer = fileBuffer;
  if (isRaw) {
    const embedded = await exifr.thumbnail(fileBuffer);
    if (!embedded) return new Response(null, { status: 204 });
    source = Buffer.from(toArrayBuffer(embedded));
  }

  let thumbBuffer: Buffer;
  try {
    thumbBuffer = await sharp(source)
      .resize(400, 300, { fit: 'cover', position: 'centre' })
      .webp({ quality: 75 })
      .toBuffer();
  } catch {
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

  return new Response(toArrayBuffer(thumbBuffer), {
    headers: {
      'Content-Type': 'image/webp',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
