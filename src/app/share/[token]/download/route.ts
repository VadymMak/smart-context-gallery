import { NextRequest, NextResponse } from 'next/server';
import { getShare, incrementAccessCount } from '@/lib/shares';
import { r2, BUCKET } from '@/lib/r2';
import { GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { ZipArchive } from 'archiver';
import { PassThrough } from 'stream';

export const maxDuration = 60;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const share = await getShare(token);

  if (!share || (share.type !== 'folder' && share.type !== 'archive')) {
    return NextResponse.json({ error: 'Share not found or expired' }, { status: 404 });
  }

  await incrementAccessCount(token);

  const prefix = `${share.userId}/${share.target}/`;
  const listCmd = new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix });
  const response = await r2.send(listCmd);
  const objects = (response.Contents || []).filter(
    (obj) => obj.Key && !obj.Key.endsWith('/')
  );

  if (objects.length === 0) {
    return NextResponse.json({ error: 'No files in folder' }, { status: 404 });
  }

  const archive = new ZipArchive({ zlib: { level: 5 } });
  const passThrough = new PassThrough();
  archive.pipe(passThrough);

  for (const obj of objects) {
    const getCmd = new GetObjectCommand({ Bucket: BUCKET, Key: obj.Key! });
    const fileResponse = await r2.send(getCmd);
    const body = fileResponse.Body;
    if (!body) continue;
    const filename = obj.Key!.split('/').pop()!;
    const buffer = await body.transformToByteArray();
    archive.append(Buffer.from(buffer), { name: filename });
  }

  archive.finalize();

  const chunks: Buffer[] = [];
  for await (const chunk of passThrough) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const zipBuffer = Buffer.concat(chunks);

  const folderName = share.target.split('/').pop() || 'gallery';

  return new NextResponse(zipBuffer, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${folderName}.zip"`,
      'Content-Length': String(zipBuffer.byteLength),
    },
  });
}
