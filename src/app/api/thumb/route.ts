import { NextRequest } from 'next/server';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { r2, BUCKET } from '@/lib/r2';
import { getShareById, isShareExpired } from '@/lib/shares';
import { getCurrentUser } from '@/lib/auth';
import sharp from 'sharp';
import { extractRawThumbnail } from '@/lib/raw-thumb';

const RAW_EXTS = new Set(['cr2', 'cr3', 'nef', 'arw', 'dng', 'raf', 'rw2', 'orf', 'pef']);

function toArrayBuffer(u8: Uint8Array<ArrayBufferLike>): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

export async function GET(req: NextRequest) {
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

    // ── Cache hit ───────────────────────────────────────────────────────────
    const thumbKey = `_thumbs/${key}.webp`;
    try {
      const cached = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: thumbKey }));
      if (cached.Body) {
        console.log('[thumb] cache HIT:', thumbKey);
        return new Response(cached.Body.transformToWebStream(), {
          headers: {
            'Content-Type': 'image/webp',
            'Cache-Control': 'public, max-age=31536000, immutable',
          },
        });
      }
    } catch (cacheErr) {
      console.log('[thumb] cache MISS:', (cacheErr as Error).message);
    }

    // ── Fetch from R2 ───────────────────────────────────────────────────────
    const ext   = key.split('.').pop()?.toLowerCase() ?? '';
    const isRaw = RAW_EXTS.has(ext);
    console.log('[thumb] ext:', ext, 'isRaw:', isRaw);

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

    // ── Generate thumbnail ──────────────────────────────────────────────────
    let source: Buffer = fileBuffer;
    if (isRaw) {
      console.log('[thumb] extracting RAW thumbnail, file size:', fileBuffer.length);
      const embedded = await extractRawThumbnail(fileBuffer);
      console.log('[thumb] extracted:', embedded ? `${embedded.length} bytes` : 'null');
      if (!embedded) {
        console.warn('[thumb] no embedded JPEG — returning 204');
        return new Response(null, { status: 204 });
      }
      source = embedded;
    }

    console.log('[thumb] calling sharp, source size:', source.length);
    let thumbBuffer: Buffer;
    try {
      thumbBuffer = await sharp(source)
        .resize(400, 300, { fit: 'cover', position: 'centre' })
        .webp({ quality: 75 })
        .toBuffer();
      console.log('[thumb] sharp OK, thumb size:', thumbBuffer.length);
    } catch (sharpErr) {
      console.error('[thumb] sharp CRASH:', sharpErr);
      return new Response(null, { status: 204 });
    }

    // ── Save to cache (fire-and-forget) ─────────────────────────────────────
    r2.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: thumbKey,
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
