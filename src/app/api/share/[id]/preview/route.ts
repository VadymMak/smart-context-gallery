import { NextRequest, NextResponse } from 'next/server';
import { getShareById, isShareExpired } from '@/lib/shares';
import { r2, BUCKET } from '@/lib/r2';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { convertToHtml } from 'mammoth';

export const maxDuration = 30;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const share = await getShareById(id);

  if (!share || isShareExpired(share)) {
    return NextResponse.json({ error: 'Not found or expired' }, { status: 404 });
  }

  if (share.mode !== 'preview') {
    return NextResponse.json({ error: 'Not a preview share' }, { status: 403 });
  }

  const lowerName = share.fileName.toLowerCase();
  if (!lowerName.endsWith('.docx')) {
    return NextResponse.json(
      { error: lowerName.endsWith('.doc') ? 'Legacy .doc format is not supported. Only .docx is supported.' : 'Unsupported format' },
      { status: 415 }
    );
  }

  try {
    const response = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: share.fileKey }));
    const body = response.Body;
    if (!body) return NextResponse.json({ error: 'File not found' }, { status: 404 });

    const bytes = await body.transformToByteArray();
    const buffer = Buffer.from(bytes);

    const result = await convertToHtml({ buffer });

    return NextResponse.json({ html: result.value, type: 'docx' });
  } catch (err) {
    console.error('[preview] Conversion error:', err);
    return NextResponse.json({ error: 'Failed to convert document' }, { status: 500 });
  }
}
