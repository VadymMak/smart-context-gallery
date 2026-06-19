import { NextRequest, NextResponse } from 'next/server';
import { getShareById, isShareExpired } from '@/lib/shares';
import { r2, BUCKET } from '@/lib/r2';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { ZipArchive } from 'archiver';

const MAX_FILES = 100;
const MAX_BYTES = 500 * 1024 * 1024; // 500 MB

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const share = await getShareById(id);

  if (!share || isShareExpired(share) || share.fileType !== 'folder' || !share.folderPath) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (share.mode !== 'download') {
    return NextResponse.json({ error: 'Download not allowed in preview mode' }, { status: 403 });
  }

  const body = await request.json() as { selectedKeys?: string[] };
  const selectedKeys = body.selectedKeys ?? [];

  if (!Array.isArray(selectedKeys) || selectedKeys.length === 0) {
    return NextResponse.json({ error: 'No files selected' }, { status: 400 });
  }

  if (selectedKeys.length > MAX_FILES) {
    return NextResponse.json({ error: `Max ${MAX_FILES} files per ZIP` }, { status: 400 });
  }

  // Security: every key must be inside the shared folder
  const invalidKey = selectedKeys.find((k) => !k.startsWith(share.folderPath!));
  if (invalidKey) {
    return NextResponse.json({ error: 'Forbidden key' }, { status: 403 });
  }

  // Fetch all file bytes and estimate total size
  type FileEntry = { filename: string; bytes: Buffer };
  const entries: FileEntry[] = [];
  let totalBytes = 0;

  for (const key of selectedKeys) {
    let obj;
    try {
      obj = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    } catch {
      continue; // skip missing files
    }
    if (!obj.Body) continue;

    const raw = await obj.Body.transformToByteArray();
    const bytes = Buffer.from(raw);
    totalBytes += bytes.length;

    if (totalBytes > MAX_BYTES) {
      return NextResponse.json(
        { error: `Selection exceeds ${MAX_BYTES / 1024 / 1024} MB limit` },
        { status: 400 }
      );
    }

    entries.push({ filename: key.split('/').pop()!, bytes });
  }

  if (entries.length === 0) {
    return NextResponse.json({ error: 'No files found' }, { status: 404 });
  }

  // Build ZIP
  const archive = new ZipArchive({ zlib: { level: 1 } });
  const chunks: Buffer[] = [];

  archive.on('data', (chunk: Buffer) => chunks.push(chunk));

  for (const { filename, bytes } of entries) {
    archive.append(bytes, { name: filename });
  }

  await new Promise<void>((resolve, reject) => {
    archive.on('end', resolve);
    archive.on('error', reject);
    archive.finalize();
  });

  const buffer = Buffer.concat(chunks);
  const folderName = share.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');

  return new Response(buffer, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${folderName}-selected.zip"`,
      'Content-Length': String(buffer.length),
    },
  });
}
