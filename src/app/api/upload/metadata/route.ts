import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { requireAuth, getCurrentUser } from '@/lib/auth';
import { addImageMetadata, type ImageMetadata } from '@/lib/metadata';
import { r2, BUCKET } from '@/lib/r2';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

function getFileCategory(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop() || '';
  const map: Record<string, string> = {
    pdf: 'document', doc: 'document', docx: 'document',
    xls: 'spreadsheet', xlsx: 'spreadsheet',
    ppt: 'presentation', pptx: 'presentation',
    txt: 'text', md: 'text', csv: 'text',
    zip: 'archive', rar: 'archive', '7z': 'archive', tar: 'archive', gz: 'archive',
    mp4: 'video', mov: 'video', avi: 'video', mkv: 'video',
    mp3: 'audio', wav: 'audio', ogg: 'audio', flac: 'audio',
  };
  return map[ext] || 'file';
}

const RAW_EXT = /\.(cr2|cr3|nef|arw|dng|raf|rw2|orf|pef)$/i;

async function generateRawVersions(key: string): Promise<void> {
  console.log('[generate] Starting for:', key);

  // 1. Download original from R2
  const obj = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  if (!obj.Body) throw new Error('No body from R2');

  const bytes = await obj.Body.transformToByteArray();
  const fileBuffer = Buffer.from(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  console.log('[generate] Downloaded:', fileBuffer.length, 'bytes');

  // 2. Extract embedded JPEG
  const { extractRawThumbnail, toWebpThumb, toWebpPreview } = await import('@/lib/raw-thumb');
  const embedded = extractRawThumbnail(fileBuffer);
  if (!embedded) {
    console.warn('[generate] No embedded JPEG found for:', key);
    return;
  }
  console.log('[generate] Embedded JPEG:', embedded.length, 'bytes');

  // 3. Generate WebP versions in parallel
  const [thumb, preview] = await Promise.all([
    toWebpThumb(embedded),
    toWebpPreview(embedded),
  ]);

  // 4. Save all 3 versions in parallel
  const saves = [
    thumb && r2.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: `_thumbs/${key}.webp`,
      Body: thumb,
      ContentType: 'image/webp',
      Metadata: { 'source-key': key },
    })),
    preview && r2.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: `_previews/${key}.webp`,
      Body: preview,
      ContentType: 'image/webp',
      Metadata: { 'source-key': key },
    })),
    r2.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: `_raws/${key}.jpg`,
      Body: embedded,
      ContentType: 'image/jpeg',
      Metadata: { 'source-key': key },
    })),
  ].filter(Boolean) as Promise<unknown>[];

  await Promise.all(saves);

  console.log(
    '[generate] Done:',
    `thumb=${Math.round((thumb?.length ?? 0) / 1024)}KB`,
    `preview=${Math.round((preview?.length ?? 0) / 1024)}KB`,
    `jpeg=${Math.round(embedded.length / 1024)}KB`,
  );
}

export async function POST(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { key, filename, contentType, size, folder } = await request.json();

    if (!key || !filename) {
      return NextResponse.json({ error: 'Missing key or filename' }, { status: 400 });
    }

    if (!key.startsWith(user.id + '/')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const category = getFileCategory(filename);
    const ext = filename.toLowerCase().split('.').pop() || 'file';
    const fileType = contentType || 'application/octet-stream';

    const meta: ImageMetadata = {
      key,
      filename,
      folder: folder || 'uncategorized',
      size: size || 0,
      uploadedAt: new Date().toISOString(),
      description: '',
      tags: [category, ext],
      category,
      style: '',
      colors: [],
      fileType,
    };

    await addImageMetadata(meta);

    // Fire WebP generation after response is sent — does not block the client
    if (RAW_EXT.test(filename)) {
      after(() =>
        generateRawVersions(key).catch((err) =>
          console.error('[upload/metadata] generateRawVersions failed:', err)
        )
      );
    }

    return NextResponse.json({ success: true, key });
  } catch (error) {
    console.error('[upload/metadata] Error:', error);
    return NextResponse.json({ error: 'Failed to save metadata' }, { status: 500 });
  }
}
