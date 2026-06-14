import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getCurrentUser } from '@/lib/auth';
import { listImages, uploadImage } from '@/lib/r2';
import { analyzeImage } from '@/lib/vision';
import { addImageMetadata, type ImageMetadata } from '@/lib/metadata';

export const maxDuration = 60;

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
    const errors: { filename: string; error: string }[] = [];

    for (const file of files) {
      if (file.size > MAX_SIZE) {
        errors.push({ filename: file.name, error: `Exceeds 50MB limit` });
        continue;
      }

      try {
        const buffer = Buffer.from(await file.arrayBuffer());
        const fileType = file.type || getMimeType(file.name);
        const key = await uploadImage(buffer, file.name, fileType, folder, user.id);
        const category = getFileCategory(file.name);
        const ext = file.name.toLowerCase().split('.').pop() || 'file';

        // Save basic metadata immediately — before vision, so file is never orphaned
        const meta: ImageMetadata = {
          key,
          filename: file.name,
          folder,
          size: file.size,
          uploadedAt: new Date().toISOString(),
          description: '',
          tags: [category, ext],
          category,
          style: '',
          colors: [],
          fileType,
        };
        await addImageMetadata(meta);

        // Vision analysis is optional — failure must not orphan the file
        // Use computed fileType (with MIME fallback) not raw file.type which can be empty
        const isImage = fileType.startsWith('image/');
        if (isImage) {
          try {
            const analysis = await analyzeImage(buffer, file.type);
            const enriched: ImageMetadata = {
              ...meta,
              description: analysis.description,
              tags: analysis.tags,
              category: analysis.category,
              style: analysis.style,
              colors: analysis.colors,
            };
            await addImageMetadata(enriched);
            console.log(`[vision] ${file.name}: ${analysis.tags.join(', ')}`);
            results.push({ key, filename: file.name, tags: analysis.tags, description: analysis.description });
            continue;
          } catch (visionError) {
            console.error(`[vision] Failed for ${file.name} (user=${user.id}):`, visionError);
            // File is already saved with basic metadata — continue without vision data
          }
        }

        results.push({ key, filename: file.name, tags: meta.tags, description: '' });
      } catch (fileError) {
        console.error(`[images] Upload failed for ${file.name} (user=${user.id}):`, fileError);
        errors.push({ filename: file.name, error: 'Upload failed' });
      }
    }

    if (results.length === 0 && errors.length > 0) {
      return NextResponse.json(
        { error: `All uploads failed: ${errors.map((e) => e.filename).join(', ')}`, errors },
        { status: 500 }
      );
    }

    return NextResponse.json({ uploaded: results, errors: errors.length > 0 ? errors : undefined });
  } catch (error) {
    console.error('[images] Upload error:', error);
    return NextResponse.json({ error: 'Failed to upload' }, { status: 500 });
  }
}
