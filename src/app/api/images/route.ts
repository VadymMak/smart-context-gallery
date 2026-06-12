import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getCurrentUser } from '@/lib/auth';
import { listImages, uploadImage } from '@/lib/r2';
import { analyzeImage } from '@/lib/vision';
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

function getMimeType(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop() || '';
  const map: Record<string, string> = {
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    txt: 'text/plain',
    md: 'text/markdown',
    csv: 'text/csv',
    zip: 'application/zip',
    rar: 'application/x-rar-compressed',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
  };
  return map[ext] || 'application/octet-stream';
}

export async function GET(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const folder = request.nextUrl.searchParams.get('folder') || undefined;

  try {
    const images = await listImages(folder, user.id);
    return NextResponse.json({ images });
  } catch (error) {
    console.error('[images] List error:', error);
    return NextResponse.json({ error: 'Failed to list files' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const formData = await request.formData();
    const files = formData.getAll('files') as File[];
    const folder = (formData.get('folder') as string) || 'uncategorized';

    if (!files.length) {
      return NextResponse.json({ error: 'No files provided' }, { status: 400 });
    }

    const MAX_SIZE = 50 * 1024 * 1024; // 50MB
    const results: { key: string; filename: string; tags: string[]; description: string }[] = [];

    for (const file of files) {
      if (file.size > MAX_SIZE) {
        return NextResponse.json(
          { error: `File ${file.name} exceeds 50MB limit` },
          { status: 400 }
        );
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      const fileType = file.type || getMimeType(file.name);
      const key = await uploadImage(buffer, file.name, fileType, folder, user.id);

      const isImage = file.type.startsWith('image/');
      let analysis = null;
      if (isImage) {
        analysis = await analyzeImage(buffer, file.type);
      }

      const category = analysis?.category || getFileCategory(file.name);
      const tags = analysis?.tags || [category, file.name.toLowerCase().split('.').pop() || 'file'];

      const meta: ImageMetadata = {
        key,
        filename: file.name,
        folder,
        size: file.size,
        uploadedAt: new Date().toISOString(),
        description: analysis?.description || '',
        tags,
        category,
        style: analysis?.style || '',
        colors: analysis?.colors || [],
        fileType,
      };

      await addImageMetadata(meta);

      if (isImage && analysis) {
        console.log(`[vision] ${file.name}: ${analysis.tags.join(', ')}`);
      }

      results.push({ key, filename: file.name, tags, description: meta.description });
    }

    return NextResponse.json({ uploaded: results });
  } catch (error) {
    console.error('[images] Upload error:', error);
    return NextResponse.json({ error: 'Failed to upload' }, { status: 500 });
  }
}
