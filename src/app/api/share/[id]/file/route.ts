import { NextRequest, NextResponse } from 'next/server';
import { getShareById, isShareExpired } from '@/lib/shares';
import { r2, BUCKET } from '@/lib/r2';
import { GetObjectCommand } from '@aws-sdk/client-s3';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const share = await getShareById(id);

  if (!share || isShareExpired(share)) {
    return NextResponse.json({ error: 'Not found or expired' }, { status: 404 });
  }

  const isDownloadAction = request.nextUrl.searchParams.get('download') === '1';

  const response = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: share.fileKey }));
  const body = response.Body;
  if (!body) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }

  const stream = body.transformToWebStream();
  const isPdf = share.fileName.toLowerCase().endsWith('.pdf');
  const headers: Record<string, string> = {
    'Content-Type': isPdf ? 'application/pdf' : (response.ContentType || 'application/octet-stream'),
    'X-Content-Type-Options': 'nosniff',
  };
  if (response.ContentLength) {
    headers['Content-Length'] = String(response.ContentLength);
  }

  if (isDownloadAction) {
    headers['Content-Disposition'] = `attachment; filename="${share.fileName}"`;
    headers['Cache-Control'] = 'private, max-age=3600';
  } else if (share.mode === 'preview') {
    // Never cache preview — R2 URL must stay hidden
    headers['Content-Disposition'] = 'inline';
    headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0';
    headers['Pragma'] = 'no-cache';
  } else {
    // Download mode, display (not download click) — e.g. PDF iframe or img/video tag
    headers['Content-Disposition'] = 'inline';
    headers['Cache-Control'] = 'private, max-age=3600';
  }

  return new NextResponse(stream, { headers });
}
