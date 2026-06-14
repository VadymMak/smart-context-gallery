import { NextRequest, NextResponse } from 'next/server';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { r2, BUCKET } from '@/lib/r2';
import { requireAuth, getCurrentUser } from '@/lib/auth';

export async function POST(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { filename, contentType, folder } = await request.json();

    if (!filename) {
      return NextResponse.json({ error: 'Missing filename' }, { status: 400 });
    }

    // Mirror the key format used by uploadImage() in r2.ts
    const safe = filename.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9.\-_]/g, '');
    const key = `${user.id}/${folder || 'uncategorized'}/${Date.now()}-${safe}`;

    const command = new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ContentType: contentType || 'application/octet-stream',
    });

    // Valid for 10 minutes — enough for a 24 MB file on a slow connection
    const signedUrl = await getSignedUrl(r2, command, { expiresIn: 600 });

    return NextResponse.json({ signedUrl, key });
  } catch (error) {
    console.error('[presign] Error:', error);
    return NextResponse.json({ error: 'Failed to generate upload URL' }, { status: 500 });
  }
}
