import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { r2, BUCKET, listImages } from '@/lib/r2';
import { CopyObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { loadMetadata, saveMetadata } from '@/lib/metadata';

// POST /api/migrate?targetUserId=user_xxx
// One-time migration: moves all prefixless images into a userId prefix.
// Delete this file after running.
export async function POST(request: NextRequest) {
  const authError = await requireAdmin();
  if (authError) return authError;

  const url = new URL(request.url);
  const targetUserId = url.searchParams.get('targetUserId');
  if (!targetUserId) {
    return NextResponse.json({ error: 'Missing targetUserId query param' }, { status: 400 });
  }

  // List all images with no userId filter to get legacy keys
  const allImages = await listImages();
  const legacy = allImages.filter((img) => !img.key.split('/')[0].startsWith('user_'));

  if (legacy.length === 0) {
    return NextResponse.json({ message: 'Nothing to migrate', moved: [], count: 0 });
  }

  const store = await loadMetadata();
  const moved: string[] = [];
  const errors: string[] = [];

  for (const img of legacy) {
    const newKey = `${targetUserId}/${img.key}`;
    try {
      await r2.send(new CopyObjectCommand({
        Bucket: BUCKET,
        CopySource: `${BUCKET}/${img.key}`,
        Key: newKey,
      }));
      await r2.send(new DeleteObjectCommand({
        Bucket: BUCKET,
        Key: img.key,
      }));

      if (store.images[img.key]) {
        store.images[newKey] = { ...store.images[img.key], key: newKey };
        delete store.images[img.key];
      }

      moved.push(`${img.key} → ${newKey}`);
    } catch (err) {
      errors.push(`Failed: ${img.key} — ${String(err)}`);
    }
  }

  await saveMetadata(store);

  return NextResponse.json({ moved, errors, count: moved.length });
}
