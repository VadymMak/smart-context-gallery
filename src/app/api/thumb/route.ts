import { NextRequest } from 'next/server';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { r2, BUCKET } from '@/lib/r2';
import { getShareById, isShareExpired } from '@/lib/shares';
import { getCurrentUser } from '@/lib/auth';
import { extractRawThumbnail, toWebpThumb } from '@/lib/raw-thumb';

console.log('[thumb] MODULE LOADED v2 - dynamic sharp only');

const RAW_EXT = /\.(cr2|cr3|nef|arw|dng|raf|rw2|orf|pef)$/i;

function toArrayBuffer(u8: Uint8Array<ArrayBufferLike>): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

export async function GET(req: NextRequest) {
  console.log('[thumb] HANDLER CALLED');
  const { searchParams } = req.nextUrl;
  const key     = searchParams.get('key');
  const shareId = searchParams.get('shareId');

  if (!key) return new Response('Missing key', { status: 400 });

  try {
    // ── Auth ────────────────────────────────────────────────────────────────
    if (shareId) {
      const share = await getShareById(shareId);
      if (
        !share || isShareExpired(share) ||
        share.fileType !== 'folder' || !share.folderPath ||
        !key.startsWith(share.folderPath)
      ) return new Response('Forbidden', { status: 403 });
    } else {
      const user = await getCurrentUser();
      if (!user) return new Response('Unauthorized', { status: 401 });
      if (!key.startsWith(`${user.id}/`)) return new Response('Forbidden', { status: 403 });
    }

    const isRaw = RAW_EXT.test(key);
    const cacheKey = `_thumbs/${key}.webp`;

    // ── Cache hit ────────────────────────────────────────────────────────────
    try {
      const cached = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: cacheKey }));
      if (cached.Body) {
        console.log('[thumb] cache HIT:', cacheKey);
        return new Response(cached.Body.transformToWebStream(), {
          headers: {
            'Content-Type': 'image/webp',
            'Cache-Control': 'public, max-age=31536000, immutable',
          },
        });
      }
    } catch { /* cache miss */ }

    // ── Fetch original ───────────────────────────────────────────────────────
    let fileBuffer: Buffer;
    try {
      const obj = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
      if (!obj.Body) return new Response('Not found', { status: 404 });
      fileBuffer = Buffer.from(toArrayBuffer(await obj.Body.transformToByteArray()));
      console.log('[thumb] fetched', fileBuffer.length, 'bytes');
    } catch {
      return new Response('Not found', { status: 404 });
    }

    let thumbnail: Buffer;

    if (isRaw) {
      // CR2: extract embedded JPEG → WebP via sharp@0.34.5
      const embedded = extractRawThumbnail(fileBuffer);
      if (!embedded) {
        console.warn('[thumb] No embedded JPEG:', key);
        return new Response(null, { status: 204 });
      }
      console.log('[thumb] Embedded JPEG:', embedded.length, 'bytes');

      const webp = await toWebpThumb(embedded);
      if (webp) {
        thumbnail = webp;
        console.log('[thumb] WebP thumb:', thumbnail.length, 'bytes');
      } else {
        // Fallback: return embedded JPEG without conversion
        thumbnail = embedded;
      }
    } else {
      // JPEG/PNG: sharp resize → WebP
      try {
        const sharpMod = await import('sharp');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sharp = (sharpMod as any).default ?? sharpMod;
        thumbnail = await sharp(fileBuffer)
          .resize(400, 300, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 75 })
          .toBuffer();
        console.log('[thumb] WebP from image:', thumbnail.length, 'bytes');
      } catch (err) {
        console.warn('[thumb] sharp failed for regular image:', err);
        thumbnail = fileBuffer; // fallback: return original
      }
    }

    // ── Cache in R2 ──────────────────────────────────────────────────────────
    r2.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: cacheKey,
      Body: thumbnail,
      ContentType: 'image/webp',
      Metadata: { 'source-key': key },
    })).catch((e) => console.warn('[thumb] cache save failed:', e));

    return new Response(toArrayBuffer(thumbnail), {
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
