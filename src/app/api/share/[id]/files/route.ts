import { NextRequest, NextResponse } from 'next/server';
import { getShareById, isShareExpired, incrementViewCount } from '@/lib/shares';
import { listFolderFiles } from '@/lib/r2';

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'heic', 'bmp', 'svg']);
const RAW_EXTS   = new Set(['cr2', 'cr3', 'nef', 'arw', 'dng', 'raf', 'rw2', 'orf', 'pef']);
const VIDEO_EXTS = new Set(['mp4', 'mov', 'avi', 'mkv', 'webm']);
const DOC_EXTS   = new Set(['pdf', 'docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt', 'txt', 'csv']);

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const share = await getShareById(id);

  if (!share || isShareExpired(share) || share.fileType !== 'folder' || !share.folderPath) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const raw = await listFolderFiles(share.folderPath);

  const files = raw
    .map((f) => {
      const ext = f.filename.toLowerCase().split('.').pop() || '';
      return {
        key: f.key,
        filename: f.filename,
        size: f.size,
        lastModified: f.lastModified instanceof Date ? f.lastModified.toISOString() : String(f.lastModified),
        ext,
        isImage: IMAGE_EXTS.has(ext),
        isRaw: RAW_EXTS.has(ext),
        isVideo: VIDEO_EXTS.has(ext),
        isDocument: DOC_EXTS.has(ext),
      };
    })
    .sort((a, b) => a.filename.localeCompare(b.filename));

  // Increment view count on first list (fire-and-forget)
  incrementViewCount(id).catch(() => {});

  return NextResponse.json({
    files,
    folderName: share.fileName,
    mode: share.mode,
  });
}
