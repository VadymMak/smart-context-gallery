import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { loadMetadata } from '@/lib/metadata';

export async function GET() {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const store = await loadMetadata();
    return NextResponse.json({ images: store.images, projects: store.projects });
  } catch (error) {
    console.error('[metadata] Load error:', error);
    return NextResponse.json({ error: 'Failed to load metadata' }, { status: 500 });
  }
}
