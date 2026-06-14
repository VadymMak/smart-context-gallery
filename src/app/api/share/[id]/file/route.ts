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
    // Generate 1-hour signed URL and redirect to it
    const signedUrl = await getSignedUrl(r2, command, { expiresIn: 3600 });
    return NextResponse.redirect(signedUrl, {
      headers: {
        'Content-Disposition': `attachment; filename="${encodeURIComponent(share.fileName)}"`,
      },
    });
  }

  // preview mode
  if (share.fileType === 'video') {
    // Videos can't be efficiently proxied — return a short-lived signed URL
    const signedUrl = await getSignedUrl(r2, command, { expiresIn: 300 });
    return NextResponse.json({ url: signedUrl });
  }

  // Images: proxy through server so R2 URL is never exposed to client
  const response = await r2.send(command);
  const body = response.Body;
  if (!body) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }

  const bytes = await body.transformToByteArray();
  const contentType = response.ContentType || 'application/octet-stream';

  return new NextResponse(Buffer.from(bytes), {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline',
    },
  });
}
