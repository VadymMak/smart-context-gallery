import { NextRequest, NextResponse } from 'next/server';
import { getShareById, isShareExpired } from '@/lib/shares';
import { r2, BUCKET } from '@/lib/r2';
import { GetObjectCommand } from '@aws-sdk/client-s3';

const MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', avif: 'image/avif',
  mp4: 'video/mp4', mov: 'video/quicktime', avi: 'video/x-msvideo', webm: 'video/webm',
  pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  zip: 'application/zip', txt: 'text/plain',
};

function mimeForFilename(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop() || '';
  return MIME[ext] || 'application/octet-stream';
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const share = await getShareById(id);

  if (!share || isShareExpired(share) || share.fileType !== 'folder' || !share.folderPath) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const key = request.nextUrl.searchParams.get('key');
  if (!key) {
    return NextResponse.json({ error: 'Missing key' }, { status: 400 });
  }

  // Security: key must be inside the shared folder
  if (!key.startsWith(share.folderPath)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let response;
  try {
    response = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  } catch {
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }

  const body = response.Body;
  if (!body) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }

  const filename = key.split('/').pop() || key;
  const contentType = mimeForFilename(filename) || response.ContentType || 'application/octet-stream';

  const headers: Record<string, string> = {
    'Content-Type': contentType,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, max-age=3600',
  };
  if (response.ContentLength) {
    headers['Content-Length'] = String(response.ContentLength);
  }

  if (share.mode === 'download') {
    const isDownload = request.nextUrl.searchParams.get('download') === '1';
    headers['Content-Disposition'] = isDownload
      ? `attachment; filename="${filename}"`
      : 'inline';
  } else {
    // preview mode — serve inline, no download
    headers['Content-Disposition'] = 'inline';
    headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0';
  }

  return new NextResponse(body.transformToWebStream(), { headers });
}
