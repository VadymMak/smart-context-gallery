import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getCurrentUser } from '@/lib/auth';
import { createShare, getUserShares, revokeShare } from '@/lib/shares';

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://smart-context.dev';

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

  const { type, target, expiresInDays, label } = await request.json();

  if (!type || !target) {
    return NextResponse.json({ error: 'Missing type or target' }, { status: 400 });
  }

  if (type === 'image' && !target.startsWith(`${user.id}/`)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const share = await createShare(type, target, user.id, user.displayName, {
    expiresInDays: expiresInDays || 7,
    label,
  });

  const url = `${BASE_URL}/share/${share.token}`;
  return NextResponse.json({ share, url });
}

export async function DELETE(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const token = request.nextUrl.searchParams.get('token');
  if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 400 });

  const revoked = await revokeShare(token, user.id);
  if (!revoked) return NextResponse.json({ error: 'Share not found' }, { status: 404 });

  return NextResponse.json({ revoked: true });
}
