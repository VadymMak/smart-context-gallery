import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { deleteImage } from '@/lib/r2';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ key: string[] }> }
) {
  const authError = await requireAuth();
  if (authError) return authError;

  const { key } = await params;
  const imageKey = key.join('/');

  try {
    await deleteImage(imageKey);
    return NextResponse.json({ deleted: imageKey });
  } catch (error) {
    console.error('[images] Delete error:', error);
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
