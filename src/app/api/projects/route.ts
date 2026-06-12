import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getCurrentUser } from '@/lib/auth';
import { loadMetadata, assignProject } from '@/lib/metadata';

export async function GET() {
  const authError = await requireAuth();
  if (authError) return authError;

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const store = await loadMetadata();
    const userProjects = [
      ...new Set(
        Object.values(store.images)
          .filter((img) => img.key.startsWith(`${user.id}/`))
          .map((img) => img.project)
          .filter((p): p is string => !!p)
      ),
    ];
    return NextResponse.json({ projects: userProjects });
  } catch (error) {
    console.error('[projects] List error:', error);
    return NextResponse.json({ error: 'Failed to list projects' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { keys, project } = await request.json();
  if (!keys?.length || !project) {
    return NextResponse.json({ error: 'Missing keys or project' }, { status: 400 });
  }

  // Verify all keys belong to this user
  for (const key of keys as string[]) {
    if (!key.startsWith(`${user.id}/`)) {
      return NextResponse.json({ error: 'Forbidden — not your image' }, { status: 403 });
    }
  }

  try {
    await assignProject(keys, project);
    return NextResponse.json({ success: true, project, count: keys.length });
  } catch (error) {
    console.error('[projects] Assign error:', error);
    return NextResponse.json({ error: 'Failed to assign project' }, { status: 500 });
  }
}
