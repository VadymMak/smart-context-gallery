import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { loadMetadata, assignProject } from '@/lib/metadata';

export async function GET() {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const store = await loadMetadata();
    return NextResponse.json({ projects: store.projects });
  } catch (error) {
    console.error('[projects] List error:', error);
    return NextResponse.json({ error: 'Failed to list projects' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  const { keys, project } = await request.json();
  if (!keys?.length || !project) {
    return NextResponse.json({ error: 'Missing keys or project' }, { status: 400 });
  }

  try {
    await assignProject(keys, project);
    return NextResponse.json({ success: true, project, count: keys.length });
  } catch (error) {
    console.error('[projects] Assign error:', error);
    return NextResponse.json({ error: 'Failed to assign project' }, { status: 500 });
  }
}
