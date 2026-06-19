import { NextRequest } from 'next/server';
import { extractRawThumbnail, toWebpPreview } from '@/lib/raw-thumb';
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
  const keyParam = req.nextUrl.searchParams.get('key');

  const share = await getShareById(id);
  if (!share || isShareExpired(share)) {
    return new Response('Not found', { status: 404 });
  }

  // Folder share: key param required, must be within the shared folder
  // Single-file share: use share.fileKey directly, no key param needed
  let key: string;
  if (share.fileType === 'folder') {
    if (!keyParam || !share.folderPath) return new Response('Missing key', { status: 400 });
    if (!keyParam.startsWith(share.folderPath)) return new Response('Forbidden', { status: 403 });
    key = keyParam;
  } else {
    if (!share.fileKey) return new Response('Not found', { status: 404 });
    key = share.fileKey;
  }

  const ext   = key.split('.').pop()?.toLowerCase() ?? '';
  const isRaw = RAW_EXTS.has(ext);
  if (!IMAGE_EXTS.has(ext) && !isRaw) {
    return new Response('Not an image', { status: 400 });
  }

  // ── Cache check: _previews/ first, then _thumbs/ fallback ──────────────
  const previewKey = `_previews/${key}.webp`;
  const thumbKey   = `_thumbs/${key}.webp`;
  const thumbJpeg  = `_thumbs/${key}.jpg`;

  const cacheKeys = isRaw
    ? [previewKey, thumbKey, thumbJpeg]
    : [previewKey, thumbKey];

  for (const cacheKey of cacheKeys) {
    try {
      const cached = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: cacheKey }));
      if (cached.Body) {
        const contentType = cacheKey.endsWith('.jpg') ? 'image/jpeg' : 'image/webp';
        const etag = cached.ETag ?? `"${cacheKey}"`;
        return new Response(cached.Body.transformToWebStream(), {
          headers: {
            'Content-Type': contentType,
            'Cache-Control': 'public, max-age=604800, stale-while-revalidate=86400',
            'ETag': etag,
            'Vary': 'Accept',
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

  // ── CR2/RAW: extract embedded JPEG → WebP 1200px preview ──────────────
  if (isRaw) {
    const extracted = extractRawThumbnail(fileBuffer);

    if (!extracted) {
      console.warn('[share/img-preview] No embedded JPEG in', key);
      return new Response(null, { status: 204 });
    }

    const { jpeg: embedded, orientation } = extracted;
    const webp = await toWebpPreview(embedded, orientation);
    const body = webp ?? embedded;
    const contentType = webp ? 'image/webp' : 'image/jpeg';

    r2.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: previewKey,
      Body: body,
      ContentType: contentType,
      Metadata: { 'source-key': key },
    })).catch(() => {});

    return new Response(toArrayBuffer(body), {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=604800, stale-while-revalidate=86400',
        'ETag': `"${key}-${body.length}"`,
        'Vary': 'Accept',
      },
    });
  }

  // ── Regular images: sharp resize → WebP 1200px ─────────────────────────
  let previewBuffer: Buffer;
  try {
    const sharpModule = await import('sharp');
    const sharpFn = sharpModule.default ?? sharpModule;
    previewBuffer = await sharpFn(fileBuffer)
      .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer();
  } catch (err) {
    console.error('[share/img-preview] sharp failed for', key, ':', err);
    return new Response(fileBuffer, {
      headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=604800' },
    });
  }

  r2.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: previewKey,
    Body: previewBuffer,
    ContentType: 'image/webp',
    Metadata: { 'source-key': key },
  })).catch(() => {});

  return new Response(toArrayBuffer(previewBuffer), {
    headers: {
      'Content-Type': 'image/webp',
      'Cache-Control': 'public, max-age=604800, stale-while-revalidate=86400',
      'ETag': `"${key}-${previewBuffer.length}"`,
      'Vary': 'Accept',
    },
  });
}
