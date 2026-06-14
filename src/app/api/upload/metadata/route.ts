import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getCurrentUser } from '@/lib/auth';
import { addImageMetadata, type ImageMetadata } from '@/lib/metadata';

function getFileCategory(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop() || '';
  const map: Record<string, string> = {
    pdf: 'document', doc: 'document', docx: 'document',
    xls: 'spreadsheet', xlsx: 'spreadsheet',
    ppt: 'presentation', pptx: 'presentation',
    txt: 'text', md: 'text', csv: 'text',
    zip: 'archive', rar: 'archive', '7z': 'archive', tar: 'archive', gz: 'archive',
    mp4: 'video', mov: 'video', avi: 'video', mkv: 'video',
    mp3: 'audio', wav: 'audio', ogg: 'audio', flac: 'audio',
  };
  return map[ext] || 'file';
}

export async function POST(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { key, filename, contentType, size, folder } = await request.json();

    if (!key || !filename) {
      return NextResponse.json({ error: 'Missing key or filename' }, { status: 400 });
    }

    // Guard: key must belong to the authenticated user
    if (!key.startsWith(user.id + '/')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const category = getFileCategory(filename);
    const ext = filename.toLowerCase().split('.').pop() || 'file';
    const fileType = contentType || 'application/octet-stream';

    const meta: ImageMetadata = {
      key,
      filename,
      folder: folder || 'uncategorized',
      size: size || 0,
      uploadedAt: new Date().toISOString(),
      description: '',
      tags: [category, ext],
      category,
      style: '',
      colors: [],
      fileType,
    };

    await addImageMetadata(meta);

    return NextResponse.json({ success: true, key });
  } catch (error) {
    console.error('[upload/metadata] Error:', error);
    return NextResponse.json({ error: 'Failed to save metadata' }, { status: 500 });
  }
}
