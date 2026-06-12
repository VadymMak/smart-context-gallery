import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { listFolders } from '@/lib/r2';

export async function GET() {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const folders = await listFolders();
    return NextResponse.json({ folders });
  } catch (error) {
    console.error('[folders] List error:', error);
    return NextResponse.json({ error: 'Failed to list folders' }, { status: 500 });
  }
}
