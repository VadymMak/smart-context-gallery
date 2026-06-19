import { NextRequest } from 'next/server';
import { extractRawThumbnail } from '@/lib/raw-thumb';
import { getShareById, isShareExpired } from '@/lib/shares';
import { r2, BUCKET } from '@/lib/r2';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

const RAW_EXTS = new Set(['cr2', 'cr3', 'nef', 'arw', 'dng', 'raf', 'rw2', 'orf', 'pef']);

function toArrayBuffer(u8: Uint8Array<ArrayBufferLike>): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const keyParam = req.nextUrl.searchParams.get('key');
  const download = req.nextUrl.searchParams.get('download') === '1';

  const share = await getShareById(id);
  if (!share || isShareExpired(share)) {
    return new Response('Not found', { status: 404 });
  }

  // Folder share: key param required; single-file share: use share.fileKey
  let key: string;
  if (share.fileType === 'folder') {
    if (!keyParam || !share.folderPath) return new Response('Missing key', { status: 400 });
    if (!keyParam.startsWith(share.folderPath)) return new Response('Forbidden', { status: 403 });
    key = keyParam;
  } else {
    if (!share.fileKey) return new Response('Not found', { status: 404 });
    key = share.fileKey;
  }

  const ext = key.split('.').pop()?.toLowerCase() ?? '';
  if (!RAW_EXTS.has(ext)) {
    return new Response('Not a RAW file', { status: 400 });
  }

  const basename = key.split('/').pop() ?? 'photo';
  const jpegName = basename.replace(/\.[^.]+$/, '.jpg');
  const dispHeader = download ? `attachment; filename="${jpegName}"` : `inline; filename="${jpegName}"`;

  // ── Cache hit: _raws/${key}.jpg (saved by batch generator) ─────────────
  const rawsKey = `_raws/${key}.jpg`;
  try {
    const cached = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: rawsKey }));
    if (cached.Body) {
      return new Response(cached.Body.transformToWebStream(), {
        headers: {
          'Content-Type': 'image/jpeg',
          'Cache-Control': 'public, max-age=604800, stale-while-revalidate=86400',
          'Content-Disposition': dispHeader,
          ...(cached.ETag ? { 'ETag': cached.ETag } : {}),
        },
      });
    }
  } catch {
    // cache miss — extract on demand
  }

  // ── Fetch full CR2 from R2 ──────────────────────────────────────────────
  let obj;
  try {
    obj = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  } catch {
    return new Response('Not found', { status: 404 });
  }
  if (!obj.Body) return new Response('Not found', { status: 404 });

  const fileBuffer = Buffer.from(toArrayBuffer(await obj.Body.transformToByteArray()));

  // ── Extract embedded JPEG ────────────────────────────────────────────────
  const extracted = extractRawThumbnail(fileBuffer);
  if (!extracted) {
    console.warn('[share/raw-jpeg] No embedded JPEG in', key);
    return new Response(null, { status: 204 });
  }

  const { jpeg } = extracted;

  // Save to _raws/ for future requests (fire-and-forget)
  r2.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: rawsKey,
    Body: jpeg,
    ContentType: 'image/jpeg',
    Metadata: { 'source-key': key },
  })).catch(() => {});

  return new Response(toArrayBuffer(jpeg), {
    headers: {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'public, max-age=604800, stale-while-revalidate=86400',
      'Content-Disposition': dispHeader,
      'ETag': `"${key}-${jpeg.length}"`,
    },
  });
}
