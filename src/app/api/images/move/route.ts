import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { r2, BUCKET } from '@/lib/r2';
import { CopyObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { loadMetadata, saveMetadata } from '@/lib/metadata';

export async function POST(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  const { keys, targetFolder } = await request.json();
  if (!keys?.length || !targetFolder) {
    return NextResponse.json({ error: 'Missing keys or targetFolder' }, { status: 400 });
  }

  const sanitized = String(targetFolder)
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\-_]/g, '')
    .slice(0, 64) || 'uncategorized';

  const store = await loadMetadata();
  const results: { oldKey: string; newKey: string }[] = [];

  for (const oldKey of keys as string[]) {
    const filename = oldKey.split('/').pop()!;
    const newKey = `${sanitized}/${filename}`;

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
