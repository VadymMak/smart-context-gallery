import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getCurrentUser } from '@/lib/auth';
import { r2, BUCKET } from '@/lib/r2';
import { CopyObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { loadMetadata, saveMetadata } from '@/lib/metadata';

export async function POST(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { keys, targetFolder } = await request.json();
  if (!keys?.length || !targetFolder) {
    return NextResponse.json({ error: 'Missing keys or targetFolder' }, { status: 400 });
  }

  const sanitized = String(targetFolder)
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\-_]/g, '')
    .slice(0, 64) || 'uncategorized';

  // Verify all keys belong to this user
  for (const key of keys as string[]) {
    if (!key.startsWith(`${user.id}/`)) {
      return NextResponse.json({ error: 'Forbidden — not your image' }, { status: 403 });
    }
  }

  const store = await loadMetadata();
  const results: { oldKey: string; newKey: string }[] = [];

  for (const oldKey of keys as string[]) {
    const filename = oldKey.split('/').pop()!;
    // Preserve userId prefix: userId/targetFolder/filename
    const newKey = `${user.id}/${sanitized}/${filename}`;

    if (oldKey === newKey) continue;

    await r2.send(new CopyObjectCommand({
      Bucket: BUCKET,
      CopySource: `${BUCKET}/${oldKey}`,
      Key: newKey,
    }));

    await r2.send(new DeleteObjectCommand({
      Bucket: BUCKET,
      Key: oldKey,
    }));

    if (store.images[oldKey]) {
      const meta = { ...store.images[oldKey], key: newKey, folder: sanitized };
      delete store.images[oldKey];
      store.images[newKey] = meta;
    }

    results.push({ oldKey, newKey });
  }

  await saveMetadata(store);
  return NextResponse.json({ moved: results });
}
