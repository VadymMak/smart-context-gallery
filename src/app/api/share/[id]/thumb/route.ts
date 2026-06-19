import { NextRequest } from 'next/server';
import sharp from 'sharp';
import { getShareById, isShareExpired } from '@/lib/shares';
import { r2, BUCKET } from '@/lib/r2';
import { GetObjectCommand } from '@aws-sdk/client-s3';

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

  let obj;
  try {
    obj = await r2.send(new GetObjectCommand({
      Bucket: BUCKET,
      Key: key,
      // For RAW, first 3 MB always covers the embedded JPEG preview
      ...(isRaw && { Range: 'bytes=0-3145727' }),
    }));
  } catch {
    return new Response('Not found', { status: 404 });
  }

  if (!obj.Body) return new Response('Not found', { status: 404 });

  const fileBuffer = Buffer.from(toArrayBuffer(await obj.Body.transformToByteArray()));

  let inputBuffer: Buffer = fileBuffer;
  if (isRaw) {
    const embedded = extractLargestJpeg(fileBuffer);
    if (!embedded) return new Response(null, { status: 204 });
    inputBuffer = embedded;
  }

  let thumbBuffer: Buffer;
  try {
    thumbBuffer = await sharp(inputBuffer)
      .resize(320, 240, { fit: 'cover', position: 'entropy' })
      .webp({ quality: 75 })
      .toBuffer();
  } catch (err) {
    console.error('[share/thumb] sharp error:', err);
    return new Response(null, { status: 204 });
  }

  return new Response(toArrayBuffer(thumbBuffer), {
    headers: {
      'Content-Type': 'image/webp',
      'Cache-Control': 'public, max-age=604800, immutable',
    },
  });
}

function extractLargestJpeg(buffer: Buffer): Buffer | null {
  let best: Buffer | null = null;
  let pos = 0;

  while (pos < buffer.length - 3) {
    const soi = buffer.indexOf(0xff, pos);
    if (soi === -1 || soi + 2 >= buffer.length) break;
    if (buffer[soi + 1] !== 0xd8 || buffer[soi + 2] !== 0xff) {
      pos = soi + 1;
      continue;
    }
    const eoi = buffer.indexOf(Buffer.from([0xff, 0xd9]), soi + 3);
    if (eoi === -1) { pos = soi + 1; continue; }
    const len = eoi + 2 - soi;
    if (!best || len > best.length) {
      const slice = buffer.subarray(soi, eoi + 2);
      best = Buffer.from(toArrayBuffer(slice));
    }
    pos = eoi + 2;
  }
  return best;
}
