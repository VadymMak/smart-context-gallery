import { NextResponse } from 'next/server';
import { requireAuth, getCurrentUser } from '@/lib/auth';
import { loadMetadata } from '@/lib/metadata';

export async function GET() {
  const authError = await requireAuth();
  if (authError) return authError;

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const store = await loadMetadata();
    const userImages = Object.fromEntries(
      Object.entries(store.images).filter(([key]) => key.startsWith(`${user.id}/`))
    );
    const userProjects = [
      ...new Set(
        Object.values(userImages)
          .map((img) => img.project)
          .filter((p): p is string => !!p)
      ),
    ];
    return NextResponse.json({ images: userImages, projects: userProjects });
  } catch (error) {
    console.error('[metadata] Load error:', error);
    return NextResponse.json({ error: 'Failed to load metadata' }, { status: 500 });
  }
}
