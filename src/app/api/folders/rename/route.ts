import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getCurrentUser } from '@/lib/auth';
import { r2, BUCKET } from '@/lib/r2';
import { ListObjectsV2Command, CopyObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { loadMetadata, saveMetadata } from '@/lib/metadata';

export async function POST(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { oldPath, newName } = await request.json();
  if (!oldPath || !newName) {
    return NextResponse.json({ error: 'Missing oldPath or newName' }, { status: 400 });
  }

  const safeName = String(newName)
    .toLowerCase()
    .replace(/[^a-z0-9\-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  if (!safeName) return NextResponse.json({ error: 'Invalid folder name' }, { status: 400 });

  // Replace last segment: animals/cats → animals/kittens
  const parts = String(oldPath).split('/');
  parts[parts.length - 1] = safeName;
  const newPath = parts.join('/');

  if (oldPath === newPath) return NextResponse.json({ renamed: { from: oldPath, to: newPath }, moved: 0 });

  const oldPrefix = `${user.id}/${oldPath}/`;
  const newPrefix = `${user.id}/${newPath}/`;

  try {
    const listCmd = new ListObjectsV2Command({ Bucket: BUCKET, Prefix: oldPrefix });
    const response = await r2.send(listCmd);
    const objects = response.Contents || [];

    const store = await loadMetadata();
    let movedCount = 0;

    for (const obj of objects) {
      if (!obj.Key) continue;
      const newKey = obj.Key.replace(oldPrefix, newPrefix);

      await r2.send(new CopyObjectCommand({
        Bucket: BUCKET,
        CopySource: `${BUCKET}/${obj.Key}`,
        Key: newKey,
      }));
      await r2.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: obj.Key }));

      if (!obj.Key.endsWith('/') && store.images[obj.Key]) {
        const folderInMeta = store.images[obj.Key].folder;
        const newFolder = folderInMeta.replace(oldPath, newPath);
        store.images[newKey] = { ...store.images[obj.Key], key: newKey, folder: newFolder };
        delete store.images[obj.Key];
      }

      movedCount++;
    }

    await saveMetadata(store);

    return NextResponse.json({ renamed: { from: oldPath, to: newPath }, moved: movedCount });
  } catch (error) {
    console.error('[folders/rename] Error:', error);
    return NextResponse.json({ error: 'Failed to rename folder' }, { status: 500 });
  }
}
