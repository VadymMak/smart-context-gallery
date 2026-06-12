import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { createUser, listUsers, deleteUser } from '@/lib/users';

export async function GET() {
  const authError = await requireAdmin();
  if (authError) return authError;

  const users = await listUsers();
  return NextResponse.json({ users });
}

export async function POST(request: NextRequest) {
  const authError = await requireAdmin();
  if (authError) return authError;

  const { username, password, displayName } = await request.json();

  if (!username || !password) {
    return NextResponse.json({ error: 'Username and password required' }, { status: 400 });
  }

  try {
    const user = await createUser(username, password, displayName || username);
    return NextResponse.json({ user });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to create user';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  const authError = await requireAdmin();
  if (authError) return authError;

  const userId = request.nextUrl.searchParams.get('id');
  if (!userId) {
    return NextResponse.json({ error: 'Missing user id' }, { status: 400 });
  }

  await deleteUser(userId);
  return NextResponse.json({ deleted: userId });
}
