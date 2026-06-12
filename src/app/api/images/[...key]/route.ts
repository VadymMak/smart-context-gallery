import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getCurrentUser } from '@/lib/auth';
import { deleteImage } from '@/lib/r2';
import { removeImageMetadata } from '@/lib/metadata';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ key: string[] }> }
) {
  const authError = await requireAuth();
  if (authError) return authError;

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { key } = await params;
  const imageKey = key.join('/');

  if (!imageKey.startsWith(`${user.id}/`)) {
    return NextResponse.json({ error: 'Forbidden — not your image' }, { status: 403 });
  }

  try {
    await deleteImage(imageKey);
    await removeImageMetadata(imageKey);
    return NextResponse.json({ deleted: imageKey });
  } catch (error) {
    console.error('[images] Delete error:', error);
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
