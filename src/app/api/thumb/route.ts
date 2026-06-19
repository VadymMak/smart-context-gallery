import { NextRequest } from 'next/server';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { r2, BUCKET } from '@/lib/r2';
import { getShareById, isShareExpired } from '@/lib/shares';
import { getCurrentUser } from '@/lib/auth';
import sharp from 'sharp';
import { extractRawThumbnail } from '@/lib/raw-thumb';

console.log('[thumb] MODULE LOADED');

const RAW_EXTS = new Set(['cr2', 'cr3', 'nef', 'arw', 'dng', 'raf', 'rw2', 'orf', 'pef']);

function toArrayBuffer(u8: Uint8Array<ArrayBufferLike>): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

export async function GET(req: NextRequest) {
  console.log('[thumb] HANDLER CALLED');
  const { searchParams } = req.nextUrl;
  const key     = searchParams.get('key');
  const shareId = searchParams.get('shareId');

  console.log('[thumb] START key:', key, 'shareId:', shareId);

  if (!key) return new Response('Missing key', { status: 400 });

  try {
    // ── Auth / security ─────────────────────────────────────────────────────
    if (shareId) {
      const share = await getShareById(shareId);
      if (
        !share ||
        isShareExpired(share) ||
        share.fileType !== 'folder' ||
        !share.folderPath ||
        !key.startsWith(share.folderPath)
      ) {
        console.log('[thumb] share auth FAILED');
        return new Response('Forbidden', { status: 403 });
      }
    } else {
      const user = await getCurrentUser();
      if (!user) {
        console.log('[thumb] no user session');
        return new Response('Unauthorized', { status: 401 });
      }
      if (!key.startsWith(`${user.id}/`)) {
        console.log('[thumb] key forbidden for user', user.id);
        return new Response('Forbidden', { status: 403 });
      }
      console.log('[thumb] auth OK, user:', user.id);
    }

    // ── Cache hit — check .webp (regular) then .jpg (CR2) ──────────────────
    const ext   = key.split('.').pop()?.toLowerCase() ?? '';
    const isRaw = RAW_EXTS.has(ext);

    const webpKey = `_thumbs/${key}.webp`;
    const jpegKey = `_thumbs/${key}.jpg`;

    // For RAW: check jpg cache first, then webp. For images: check webp only.
    const cacheKeys = isRaw ? [jpegKey, webpKey] : [webpKey];
    for (const cacheKey of cacheKeys) {
      try {
        const cached = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: cacheKey }));
        if (cached.Body) {
          console.log('[thumb] cache HIT:', cacheKey);
          const contentType = cacheKey.endsWith('.jpg') ? 'image/jpeg' : 'image/webp';
          return new Response(cached.Body.transformToWebStream(), {
            headers: {
              'Content-Type': contentType,
              'Cache-Control': 'public, max-age=31536000, immutable',
            },
          });
        }
      } catch {
        // cache miss — try next key or continue
      }
    }
    console.log('[thumb] cache MISS, ext:', ext, 'isRaw:', isRaw);

    // ── Fetch full file from R2 ─────────────────────────────────────────────
    let fileBuffer: Buffer;
    try {
      console.log('[thumb] fetching from R2:', key);
      const obj = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
      console.log('[thumb] R2 fetch OK, ContentLength:', obj.ContentLength);
      if (!obj.Body) return new Response('Not found', { status: 404 });
      fileBuffer = Buffer.from(toArrayBuffer(await obj.Body.transformToByteArray()));
      console.log('[thumb] buffer size:', fileBuffer.length, 'bytes');
    } catch (r2Err) {
      console.error('[thumb] R2 fetch FAILED:', r2Err);
      return new Response('Not found', { status: 404 });
    }

    // ── CR2/RAW: return embedded JPEG directly (no sharp) ──────────────────
    if (isRaw) {
      console.log('[thumb] CR2/RAW processing, file size:', fileBuffer.length);
      const embedded = extractRawThumbnail(fileBuffer);

      if (!embedded) {
        console.warn('[thumb] No embedded JPEG found for:', key);
        return new Response(null, { status: 204 });
      }

      console.log('[thumb] Returning embedded JPEG:', embedded.length, 'bytes');

      // Cache as JPEG (fire-and-forget)
      r2.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: jpegKey,
        Body: embedded,
        ContentType: 'image/jpeg',
        Metadata: { 'source-key': key },
      })).catch((err) => console.warn('[thumb] cache write failed:', err));

      return new Response(toArrayBuffer(embedded), {
        headers: {
          'Content-Type': 'image/jpeg',
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      });
    }

    // ── Regular images: resize with sharp → WebP ────────────────────────────
    console.log('[thumb] Running sharp on', fileBuffer.length, 'bytes');
    let thumbBuffer: Buffer;
    try {
      thumbBuffer = await sharp(fileBuffer)
        .resize(320, 240, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();
      console.log('[thumb] WebP generated:', thumbBuffer.length, 'bytes');
    } catch (sharpErr) {
      console.error('[thumb] sharp failed:', sharpErr);
      return new Response(null, { status: 204 });
    }

    // Cache WebP (fire-and-forget)
    r2.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: webpKey,
      Body: thumbBuffer,
      ContentType: 'image/webp',
      Metadata: { 'source-key': key },
    })).catch((err) => console.warn('[thumb] cache write failed:', err));

    return new Response(toArrayBuffer(thumbBuffer), {
      headers: {
        'Content-Type': 'image/webp',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });

  } catch (outerErr) {
    console.error('[thumb] UNHANDLED ERROR:', outerErr);
    return new Response(
      `Internal error: ${outerErr instanceof Error ? outerErr.message : String(outerErr)}`,
      { status: 500 }
    );
  }
}
