import { NextRequest } from 'next/server';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { r2, BUCKET } from '@/lib/r2';
import { getCurrentUser } from '@/lib/auth';
import { extractRawThumbnail, toWebpPreview } from '@/lib/raw-thumb';

function toArrayBuffer(u8: Uint8Array<ArrayBufferLike>): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return new Response('Unauthorized', { status: 401 });

  const key = req.nextUrl.searchParams.get('key');
  if (!key) return new Response('Missing key', { status: 400 });

  if (!key.startsWith(`${user.id}/`)) {
    return new Response('Forbidden', { status: 403 });
  }

  // ── Cache check (_previews/ — separate namespace from _thumbs/) ────────
  const cacheKey = `_previews/${key}.webp`;
  try {
    const cached = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: cacheKey }));
    if (cached.Body) {
      console.log('[raw-preview] cache HIT:', cacheKey);
      return new Response(cached.Body.transformToWebStream(), {
        headers: {
          'Content-Type': 'image/webp',
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      });
    }
  } catch { /* cache miss */ }

  // ── Download original CR2 ────────────────────────────────────────────────
  let obj;
  try {
    obj = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  } catch {
    return new Response('Not found', { status: 404 });
  }
  if (!obj.Body) return new Response('Not found', { status: 404 });

  const fileBuffer = Buffer.from(toArrayBuffer(await obj.Body.transformToByteArray()));

  // ── Extract embedded JPEG ────────────────────────────────────────────────
  const embedded = extractRawThumbnail(fileBuffer);
  if (!embedded) {
    console.warn('[raw-preview] No embedded JPEG in:', key, 'size:', fileBuffer.length);
    return new Response(null, { status: 204 });
  }

  console.log('[raw-preview] Embedded JPEG:', embedded.length, 'bytes for:', key);

  // ── Convert to WebP (1200px, lightbox quality) ───────────────────────────
  const webp = await toWebpPreview(embedded);
  const output = webp ?? embedded; // fallback to JPEG if sharp fails
  const contentType = webp ? 'image/webp' : 'image/jpeg';

  console.log('[raw-preview] output:', output.length, 'bytes', contentType);

  // ── Cache in R2 (fire-and-forget) ───────────────────────────────────────
  r2.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: cacheKey,
    Body: output,
    ContentType: contentType,
    Metadata: { 'source-key': key },
  })).catch((err) => console.warn('[raw-preview] cache write failed:', err));

  return new Response(toArrayBuffer(output), {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
