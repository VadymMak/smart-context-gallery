import { NextRequest } from 'next/server';
import { extractRawThumbnail, toWebpThumb } from '@/lib/raw-thumb';
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

  // ── Cache hit (shared with /api/thumb) ──────────────────────────────────
  const webpKey  = `_thumbs/${key}.webp`;
  const jpegKey  = `_thumbs/${key}.jpg`;
  const cacheKeys = isRaw ? [jpegKey, webpKey] : [webpKey];

  for (const cacheKey of cacheKeys) {
    try {
      const cached = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: cacheKey }));
      if (cached.Body) {
        const contentType = cacheKey.endsWith('.jpg') ? 'image/jpeg' : 'image/webp';
        return new Response(cached.Body.transformToWebStream(), {
          headers: {
            'Content-Type': contentType,
            'Cache-Control': 'public, max-age=31536000, immutable',
          },
        });
      }
    } catch {
      // cache miss — try next
    }
  }

  // ── Fetch full file from R2 ─────────────────────────────────────────────
  let obj;
  try {
    obj = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  } catch {
    return new Response('Not found', { status: 404 });
  }
  if (!obj.Body) return new Response('Not found', { status: 404 });

  const fileBuffer = Buffer.from(toArrayBuffer(await obj.Body.transformToByteArray()));

  // ── CR2/RAW: extract embedded JPEG → WebP ─────────────────────────────
  if (isRaw) {
    console.log('[share/thumb] CR2/RAW processing, file size:', fileBuffer.length);
    const extracted = extractRawThumbnail(fileBuffer);

    if (!extracted) {
      console.warn('[share/thumb] No embedded JPEG in', key);
      return new Response(null, { status: 204 });
    }

    const { jpeg: embedded, orientation } = extracted;
    console.log('[share/thumb] Embedded JPEG:', embedded.length, 'bytes, orientation:', orientation);

    const webp = await toWebpThumb(embedded, orientation);
    const body = webp ?? embedded;
    const contentType = webp ? 'image/webp' : 'image/jpeg';
    const saveKey = webp ? webpKey : jpegKey;

    r2.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: saveKey,
      Body: body,
      ContentType: contentType,
      Metadata: { 'source-key': key },
    })).catch(() => {});

    return new Response(toArrayBuffer(body), {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  }

  // ── Regular images: resize with sharp → WebP ────────────────────────────
  let thumbBuffer: Buffer;
  try {
    const sharpModule = await import('sharp');
    const sharpFn = sharpModule.default ?? sharpModule;
    thumbBuffer = await sharpFn(fileBuffer)
      .resize(320, 240, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
  } catch (err) {
    console.error('[share/thumb] sharp dynamic import failed for', key, ':', err);
    return new Response(fileBuffer, {
      headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=31536000' },
    });
  }

  r2.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: webpKey,
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
