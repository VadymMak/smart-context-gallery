import { NextResponse } from 'next/server';
import { requireAuth, getCurrentUser } from '@/lib/auth';
import { listFolders } from '@/lib/r2';

export async function GET() {
  const authError = await requireAuth();
  if (authError) return authError;

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const folders = await listFolders(user.id);
    return NextResponse.json({ folders });
  } catch (error) {
    console.error('[folders] List error:', error);
    return NextResponse.json({ error: 'Failed to list folders' }, { status: 500 });
  }
}
