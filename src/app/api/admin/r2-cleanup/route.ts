import { NextResponse } from 'next/server';
import { ListObjectsV2Command, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { requireAdmin } from '@/lib/auth';
import { r2, BUCKET } from '@/lib/r2';
import { loadMetadata, saveMetadata } from '@/lib/metadata';

export const maxDuration = 60;

// Files that must never be deleted regardless of prefix
const SYSTEM_KEYS = new Set(['_metadata.json', '_users.json', '_shares.json']);

function isOrphaned(key: string): boolean {
  if (SYSTEM_KEYS.has(key)) return false;   // system file
  if (key.startsWith('_')) return false;     // any other system file
  if (key.endsWith('/')) return false;       // folder marker
  if (key.startsWith('user_')) return false; // correct user-prefixed file
  return true;
}

export async function POST() {
  const adminError = await requireAdmin();
  if (adminError) return adminError;

  try {
    // 1. List all R2 objects
    const allKeys: string[] = [];
    let continuationToken: string | undefined;

    do {
      const command = new ListObjectsV2Command({
        Bucket: BUCKET,
        ContinuationToken: continuationToken,
      });
      const response = await r2.send(command);
      for (const obj of response.Contents || []) {
        if (obj.Key) allKeys.push(obj.Key);
      }
      continuationToken = response.NextContinuationToken;
    } while (continuationToken);

    // 2. Identify orphaned keys (no user_ prefix, not system files)
    const orphanedKeys = allKeys.filter(isOrphaned);

    if (orphanedKeys.length === 0) {
      const store = await loadMetadata();
      return NextResponse.json({
        deleted: 0,
        deletedKeys: [],
        metadataEntriesRemoved: 0,
        remaining: {
          totalR2: allKeys.length,
          totalMetadata: Object.keys(store.images).length,
        },
        message: 'Nothing to clean up',
      });
    }

    // 3. Delete orphaned objects from R2
    const deletedKeys: string[] = [];
    const failedKeys: string[] = [];

    for (const key of orphanedKeys) {
      try {
        await r2.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
        deletedKeys.push(key);
      } catch (err) {
        console.error(`[r2-cleanup] Failed to delete ${key}:`, err);
        failedKeys.push(key);
      }
    }

    // 4. Remove deleted keys from _metadata.json (one atomic write)
    const store = await loadMetadata();
    let metadataEntriesRemoved = 0;
    for (const key of deletedKeys) {
      if (store.images[key]) {
        delete store.images[key];
        metadataEntriesRemoved++;
      }
    }
    await saveMetadata(store);

    // 5. Count remaining
    const remainingR2 = allKeys.length - deletedKeys.length;
    const remainingMeta = Object.keys(store.images).length;

    console.log(
      `[r2-cleanup] Deleted ${deletedKeys.length} orphaned objects, ` +
      `removed ${metadataEntriesRemoved} metadata entries. ` +
      `Failed: ${failedKeys.length}.`
    );

    return NextResponse.json({
      deleted: deletedKeys.length,
      deletedKeys,
      failed: failedKeys.length,
      failedKeys,
      metadataEntriesRemoved,
      remaining: {
        totalR2: remainingR2,
        totalMetadata: remainingMeta,
      },
    });
  } catch (error) {
    console.error('[r2-cleanup] Error:', error);
    return NextResponse.json({ error: 'Cleanup failed' }, { status: 500 });
  }
}
