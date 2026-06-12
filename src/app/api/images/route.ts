import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { listImages, uploadImage } from '@/lib/r2';

export async function GET(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  const folder = request.nextUrl.searchParams.get('folder') || undefined;

  try {
    const images = await listImages(folder);
    return NextResponse.json({ images });
  } catch (error) {
    console.error('[images] List error:', error);
    return NextResponse.json({ error: 'Failed to list images' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const formData = await request.formData();
    const files = formData.getAll('files') as File[];
    const folder = (formData.get('folder') as string) || 'uncategorized';

    if (!files.length) {
      return NextResponse.json({ error: 'No files provided' }, { status: 400 });
    }

    const MAX_SIZE = 10 * 1024 * 1024;
    const results: { key: string; filename: string }[] = [];

    for (const file of files) {
      if (file.size > MAX_SIZE) {
        return NextResponse.json(
          { error: `File ${file.name} exceeds 10MB limit` },
          { status: 400 }
        );
      }

      if (!file.type.startsWith('image/')) {
        return NextResponse.json(
          { error: `File ${file.name} is not an image` },
          { status: 400 }
        );
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      const key = await uploadImage(buffer, file.name, file.type, folder);
      results.push({ key, filename: file.name });
    }

    return NextResponse.json({ uploaded: results });
  } catch (error) {
    console.error('[images] Upload error:', error);
    return NextResponse.json({ error: 'Failed to upload' }, { status: 500 });
  }
}
