import { NextResponse } from 'next/server';
import { ListObjectsV2Command, HeadObjectCommand } from '@aws-sdk/client-s3';
import { requireAuth, getCurrentUser } from '@/lib/auth';
import { r2, BUCKET } from '@/lib/r2';
import { loadMetadata, saveMetadata, type ImageMetadata } from '@/lib/metadata';
import { analyzeImage } from '@/lib/vision';

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
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
    webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp',
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    mp4: 'video/mp4', mov: 'video/quicktime',
    mp3: 'audio/mpeg', wav: 'audio/wav',
    zip: 'application/zip',
  };
  return map[ext] || 'application/octet-stream';
}

export async function POST() {
  const authError = await requireAuth();
  if (authError) return authError;

  const user = await getCurrentUser();
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  }

  try {
    // 1. List all R2 objects
    const allObjects: { key: string; size: number; lastModified: Date; contentType?: string }[] = [];
    let continuationToken: string | undefined;

    do {
      const command = new ListObjectsV2Command({
        Bucket: BUCKET,
        ContinuationToken: continuationToken,
      });
      const response = await r2.send(command);
      for (const obj of response.Contents || []) {
        if (obj.Key && !obj.Key.startsWith('_') && !obj.Key.endsWith('/')) {
          allObjects.push({
            key: obj.Key,
            size: obj.Size || 0,
            lastModified: obj.LastModified || new Date(),
          });
        }
      }
      continuationToken = response.NextContinuationToken;
    } while (continuationToken);

    // 2. Load current metadata
    const store = await loadMetadata();
    const existingKeys = new Set(Object.keys(store.images));

    // 3. Find orphaned files
    const orphaned = allObjects.filter((o) => !existingKeys.has(o.key));

    if (orphaned.length === 0) {
      return NextResponse.json({ recovered: 0, failed: 0, details: [], message: 'No orphaned files found' });
    }

    const details: { key: string; status: 'recovered' | 'failed'; error?: string }[] = [];
    let recoveredCount = 0;
    let failedCount = 0;

    for (const obj of orphaned) {
      try {
        // Extract components from key: userId/folder/filename or userId/filename
        const parts = obj.key.split('/');
        const filename = parts[parts.length - 1];
        // folder = middle segments (between userId and filename), or 'uncategorized'
        const folder = parts.length > 2 ? parts.slice(1, -1).join('/') : 'uncategorized';

        // Get content-type from HeadObject
        let contentType = getMimeType(filename);
        try {
          const head = await r2.send(new HeadObjectCommand({ Bucket: BUCKET, Key: obj.key }));
          if (head.ContentType) contentType = head.ContentType;
        } catch { /* use fallback mime type */ }

        const category = getFileCategory(filename);
        const ext = filename.toLowerCase().split('.').pop() || 'file';

        const meta: ImageMetadata = {
          key: obj.key,
          filename,
          folder,
          size: obj.size,
          uploadedAt: obj.lastModified.toISOString(),
          description: '',
          tags: [category, ext],
          category,
          style: '',
          colors: [],
          fileType: contentType,
        };

        // Attempt vision analysis for images (non-fatal)
        if (contentType.startsWith('image/') && contentType !== 'image/svg+xml') {
          try {
            const { GetObjectCommand } = await import('@aws-sdk/client-s3');
            const getResponse = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: obj.key }));
            const bytes = await getResponse.Body?.transformToByteArray();
            if (bytes) {
              const buffer = Buffer.from(bytes);
              const analysis = await analyzeImage(buffer, contentType);
              meta.description = analysis.description;
              meta.tags = analysis.tags;
              meta.category = analysis.category;
              meta.style = analysis.style;
              meta.colors = analysis.colors;
            }
          } catch (visionErr) {
            console.error(`[r2-recover] Vision failed for ${obj.key}:`, visionErr);
          }
        }

        // Add to store (don't overwrite existing entries)
        if (!store.images[obj.key]) {
          store.images[obj.key] = meta;
          recoveredCount++;
          details.push({ key: obj.key, status: 'recovered' });
        }
      } catch (err) {
        console.error(`[r2-recover] Failed to recover ${obj.key}:`, err);
        failedCount++;
        details.push({ key: obj.key, status: 'failed', error: String(err) });
      }
    }

    // 4. Save updated metadata once (atomic batch write)
    if (recoveredCount > 0) {
      await saveMetadata(store);
    }

    return NextResponse.json({
      recovered: recoveredCount,
      failed: failedCount,
      total: orphaned.length,
      details,
    });
  } catch (error) {
    console.error('[r2-recover] Error:', error);
    return NextResponse.json({ error: 'Recovery failed' }, { status: 500 });
  }
}
