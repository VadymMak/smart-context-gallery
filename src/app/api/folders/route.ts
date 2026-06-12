import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getCurrentUser } from '@/lib/auth';
import { r2, BUCKET, listAllFolderPaths } from '@/lib/r2';
import { PutObjectCommand, ListObjectsV2Command, DeleteObjectCommand } from '@aws-sdk/client-s3';

export async function GET() {
  const authError = await requireAuth();
  if (authError) return authError;

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const folders = await listAllFolderPaths(user.id);
    return NextResponse.json({ folders });
  } catch (error) {
    console.error('[folders] List error:', error);
    return NextResponse.json({ error: 'Failed to list folders' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { path } = await request.json();
  if (!path) return NextResponse.json({ error: 'Missing path' }, { status: 400 });

  const safePath = String(path)
    .toLowerCase()
    .replace(/[^a-z0-9\-_/]/g, '-')
    .replace(/\/+/g, '/')
    .replace(/^\/|\/$/g, '');

  if (!safePath) return NextResponse.json({ error: 'Invalid path' }, { status: 400 });

  const key = `${user.id}/${safePath}/`;

  try {
    await r2.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: '',
      ContentType: 'application/x-directory',
    }));
    return NextResponse.json({ created: safePath });
  } catch (error) {
    console.error('[folders] Create error:', error);
    return NextResponse.json({ error: 'Failed to create folder' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const path = request.nextUrl.searchParams.get('path');
  if (!path) return NextResponse.json({ error: 'Missing path' }, { status: 400 });

  const prefix = `${user.id}/${path}/`;

  try {
    const listCmd = new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix });
    const response = await r2.send(listCmd);
    const objects = response.Contents || [];

    const imageCount = objects.filter((o) => o.Key && !o.Key.endsWith('/')).length;
    if (imageCount > 0) {
      return NextResponse.json(
        { error: `Folder contains ${imageCount} image${imageCount !== 1 ? 's' : ''}. Move or delete them first.` },
        { status: 400 }
      );
    }

    for (const obj of objects) {
      if (obj.Key?.endsWith('/')) {
        await r2.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: obj.Key }));
      }
    }

    return NextResponse.json({ deleted: path });
  } catch (error) {
    console.error('[folders] Delete error:', error);
    return NextResponse.json({ error: 'Failed to delete folder' }, { status: 500 });
  }
}
