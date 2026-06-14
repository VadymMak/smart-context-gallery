import { NextRequest, NextResponse } from 'next/server';
import { getShareById, incrementViewCount, isShareExpired } from '@/lib/shares';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const share = await getShareById(id);

  if (!share) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const expired = isShareExpired(share);

  if (!expired) {
    // Fire-and-forget: increment view count (don't await to keep response fast)
    incrementViewCount(id).catch(() => {});
  }

  return NextResponse.json({
    id: share.id,
    fileName: share.fileName,
    fileType: share.fileType,
    mode: share.mode,
    createdByName: share.createdByName,
    createdAt: share.createdAt,
    expiresAt: share.expiresAt,
    watermarkText: share.watermarkText,
    viewCount: share.viewCount,
    expired,
  });
}
