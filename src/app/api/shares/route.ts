import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getCurrentUser } from '@/lib/auth';
import { createShare, getUserShares, deleteShare } from '@/lib/shares';

function getOrigin(request: NextRequest): string {
  const origin = request.headers.get('origin');
  if (origin) return origin;
  const host = request.headers.get('host') || 'smart-context.dev';
  const proto = host.includes('localhost') ? 'http' : 'https';
  return `${proto}://${host}`;
}

export async function GET() {
  const authError = await requireAuth();
  if (authError) return authError;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const shares = await getUserShares(user.id);
  return NextResponse.json({ shares });
}

export async function POST(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { mode, expiresAt } = body;

  if (mode !== 'download' && mode !== 'preview') {
    return NextResponse.json({ error: 'mode must be "download" or "preview"' }, { status: 400 });
  }

  // ── Folder share ──────────────────────────────────────────────────────────
  if (body.type === 'folder') {
    const { folderPath, folderName } = body as { folderPath: string; folderName: string };
    if (!folderPath || !folderName) {
      return NextResponse.json({ error: 'Missing folderPath or folderName' }, { status: 400 });
    }
    // folderPath must be owned by the current user
    const fullPrefix = `${user.id}/${folderPath}/`;
    if (!fullPrefix.startsWith(`${user.id}/`)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const share = await createShare({
      folderPath: fullPrefix,
      fileName: folderName,
      fileType: 'folder',
      mode,
      createdBy: user.id,
      createdByName: user.displayName,
      createdAt: new Date().toISOString(),
      expiresAt: expiresAt || undefined,
    });

    const url = `${getOrigin(request)}/share/${share.id}`;
    return NextResponse.json({ share, url });
  }

  // ── File share ────────────────────────────────────────────────────────────
  const { fileKey } = body as { fileKey: string };

  if (!fileKey) {
    return NextResponse.json({ error: 'Missing fileKey or mode' }, { status: 400 });
  }

  // Security: fileKey must belong to current user
  if (!fileKey.startsWith(`${user.id}/`)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const fileName = fileKey.split('/').pop() || fileKey;
  const ext = fileName.toLowerCase().split('.').pop() || '';
  const videoExts = new Set(['mp4', 'mov', 'avi', 'mkv', 'webm']);
  const imageExts = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'heic', 'avif']);
  const fileType = videoExts.has(ext) ? 'video' : imageExts.has(ext) ? 'image' : 'document';

  const share = await createShare({
    fileKey,
    fileName,
    fileType,
    mode,
    createdBy: user.id,
    createdByName: user.displayName,
    createdAt: new Date().toISOString(),
    expiresAt: expiresAt || undefined,
    watermarkText: `Shared by ${user.displayName}`,
  });

  const url = `${getOrigin(request)}/share/${share.id}`;
  return NextResponse.json({ share, url });
}

export async function DELETE(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const id = request.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  await deleteShare(id, user.id);
  return NextResponse.json({ deleted: true });
}
