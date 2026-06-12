import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getCurrentUser } from '@/lib/auth';
import { searchImages } from '@/lib/metadata';

export async function GET(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const query = request.nextUrl.searchParams.get('q');
  if (!query) {
    return NextResponse.json({ error: 'Missing query parameter q' }, { status: 400 });
  }

  try {
    const results = await searchImages(query, user.id);
    return NextResponse.json({ results, count: results.length });
  } catch (error) {
    console.error('[search] Error:', error);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}
