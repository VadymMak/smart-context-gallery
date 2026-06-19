import { NextRequest } from 'next/server';
import sharp from 'sharp';
import exifr from 'exifr';
import { getShareById, isShareExpired } from '@/lib/shares';
import { r2, BUCKET } from '@/lib/r2';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'bmp', 'heic']);
const RAW_EXTS   = new Set(['cr2', 'cr3', 'nef', 'arw', 'dng', 'raf', 'rw2', 'orf', 'pef']);

function toArrayBuffer(u8: Uint8Array<ArrayBufferLike>): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const key = req.nextUrl.searchParams.get('key');
  if (!key) return new Response('Missing key', { status: 400 });

  const share = await getShareById(id);
  if (!share || isShareExpired(share) || share.fileType !== 'folder' || !share.folderPath) {
    return new Response('Not found', { status: 404 });
  }
  if (!key.startsWith(share.folderPath)) {
    return new Response('Forbidden', { status: 403 });
  }

  const ext   = key.split('.').pop()?.toLowerCase() ?? '';
  const isRaw = RAW_EXTS.has(ext);
  if (!IMAGE_EXTS.has(ext) && !isRaw) {
    return new Response('Not an image', { status: 400 });
  }

  // ── Cache hit — same key used by /api/thumb so cache is shared ──────────
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

  // ── Fetch full file from R2 (no Range — CR2 preview can sit past 3 MB) ──
  let obj;
  try {
    obj = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  } catch {
    return new Response('Not found', { status: 404 });
  }

  if (!obj.Body) return new Response('Not found', { status: 404 });

  const fileBuffer = Buffer.from(toArrayBuffer(await obj.Body.transformToByteArray()));

  let inputBuffer: Buffer = fileBuffer;
  if (isRaw) {
    let embedded: Uint8Array | undefined;
    try {
      embedded = await exifr.thumbnail(fileBuffer);
    } catch (err) {
      console.warn('[share/thumb] exifr.thumbnail failed for', key, ':', err);
    }
    if (!embedded || embedded.length < 100) {
      console.warn('[share/thumb] No embedded JPEG in', key, '— file size:', fileBuffer.length);
      return new Response(null, { status: 204 });
    }
    inputBuffer = Buffer.from(toArrayBuffer(embedded));
  }

  let thumbBuffer: Buffer;
  try {
    thumbBuffer = await sharp(inputBuffer)
      .resize(320, 240, { fit: 'cover', position: 'entropy' })
      .webp({ quality: 75 })
      .toBuffer();
  } catch (err) {
    console.error('[share/thumb] sharp error for', key, ':', err);
    return new Response(null, { status: 204 });
  }

  // ── Write to cache (fire-and-forget) ────────────────────────────────────
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
