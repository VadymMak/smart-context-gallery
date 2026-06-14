import { NextRequest, NextResponse } from 'next/server';
import { getShareById, isShareExpired } from '@/lib/shares';
import { r2, BUCKET } from '@/lib/r2';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const share = await getShareById(id);

  if (!share || isShareExpired(share)) {
    return NextResponse.json({ error: 'Not found or expired' }, { status: 404 });
  }

  const command = new GetObjectCommand({ Bucket: BUCKET, Key: share.fileKey });

  if (share.mode === 'download') {
    // Download mode: redirect to 1-hour signed URL — fast, offloads bandwidth to R2
    const signedUrl = await getSignedUrl(r2, command, { expiresIn: 3600 });
    return NextResponse.redirect(signedUrl);
  }

  // Preview mode — stream bytes through server so R2 URL is NEVER exposed to client
  const response = await r2.send(command);
  const body = response.Body;
  if (!body) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }

  // Use web ReadableStream — memory-efficient, no full buffer in RAM
  const stream = body.transformToWebStream();

  return new NextResponse(stream, {
    headers: {
      'Content-Type': response.ContentType || 'application/octet-stream',
      ...(response.ContentLength ? { 'Content-Length': String(response.ContentLength) } : {}),
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'Pragma': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
