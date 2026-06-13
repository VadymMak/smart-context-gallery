import { NextResponse } from 'next/server';
import { ListObjectsV2Command } from '@aws-sdk/client-s3';
import { requireAuth, getCurrentUser } from '@/lib/auth';
import { r2, BUCKET } from '@/lib/r2';
import { loadMetadata } from '@/lib/metadata';

export const maxDuration = 60;

export async function GET() {
  const authError = await requireAuth();
  if (authError) return authError;

  const user = await getCurrentUser();
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  }

  try {
    const allObjects: { key: string; size: number; lastModified: string }[] = [];
    let continuationToken: string | undefined;

    do {
      const command = new ListObjectsV2Command({
        Bucket: BUCKET,
        ContinuationToken: continuationToken,
      });
      const response = await r2.send(command);
      for (const obj of response.Contents || []) {
        if (obj.Key) {
          allObjects.push({
            key: obj.Key,
            size: obj.Size || 0,
            lastModified: obj.LastModified?.toISOString() || '',
          });
        }
      }
      continuationToken = response.NextContinuationToken;
    } while (continuationToken);

    const metadata = await loadMetadata();
    const metadataKeys = new Set(Object.keys(metadata.images));

    const userFiles = allObjects.filter(
      (o) => !o.key.startsWith('_') && !o.key.endsWith('/')
    );

    // Group by user prefix (first path segment)
    const byUser: Record<string, number> = {};
    for (const obj of userFiles) {
      const prefix = obj.key.split('/')[0];
      byUser[prefix] = (byUser[prefix] || 0) + 1;
    }

    // Orphaned: in R2 but missing from _metadata.json
    const orphaned = userFiles.filter((o) => !metadataKeys.has(o.key));

    // Ghost: in _metadata.json but missing from R2
    const r2Keys = new Set(userFiles.map((o) => o.key));
    const ghost = Object.keys(metadata.images).filter((k) => !r2Keys.has(k));

    return NextResponse.json({
      summary: {
        totalR2Objects: allObjects.length,
        userFiles: userFiles.length,
        metadataEntries: metadataKeys.size,
        orphanedInR2: orphaned.length,
        ghostInMetadata: ghost.length,
        byUser,
      },
      orphaned,
      ghost,
      allObjects,
      metadata: metadata.images,
    });
  } catch (error) {
    console.error('[r2-debug] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch R2 debug info' }, { status: 500 });
  }
}
