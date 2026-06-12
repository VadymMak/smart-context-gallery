import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { verifyUser, loadUsers, saveUsers, type User } from '@/lib/users';

const AUTH_COOKIE = 'ak-gallery-auth';
const USER_COOKIE = 'ak-gallery-user';

async function ensureAdminExists(): Promise<void> {
  const seed = process.env.ADMIN_SEED;
  if (!seed) return;

  const store = await loadUsers();
  const userEntries = seed.split(',');

  for (const entry of userEntries) {
    const [username, password, displayName, role] = entry.split(':');
    if (!username || !password) continue;

    if (store.users.find((u) => u.username === username)) continue;

    const passwordHash = await bcrypt.hash(password, 10);
    store.users.push({
      id: `user_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      username,
      displayName: displayName || username,
      role: (role as 'admin' | 'member') || 'member',
      createdAt: new Date().toISOString(),
      passwordHash,
    });
    console.log(`[auth] User "${username}" created from ADMIN_SEED`);
  }

  await saveUsers(store);
}

export async function authenticateUser(username: string, password: string): Promise<User | null> {
  await ensureAdminExists();
  return verifyUser(username, password);
}

export async function isAuthenticated(): Promise<boolean> {
  const cookieStore = await cookies();
  return cookieStore.get(AUTH_COOKIE)?.value === 'authenticated';
}

export async function getCurrentUser(): Promise<User | null> {
  const cookieStore = await cookies();
  const userJson = cookieStore.get(USER_COOKIE)?.value;
  if (!userJson) return null;
  try {
    return JSON.parse(userJson) as User;
  } catch {
    return null;
  }
}

export function setAuthCookies(response: NextResponse, user: User): NextResponse {
  const opts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge: 60 * 60 * 24 * 30,
    path: '/',
  };
  response.cookies.set(AUTH_COOKIE, 'authenticated', opts);
  response.cookies.set(USER_COOKIE, JSON.stringify(user), opts);
  return response;
}

export async function requireAuth(): Promise<NextResponse | null> {
  const authed = await isAuthenticated();
  if (!authed) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}

export async function requireAdmin(): Promise<NextResponse | null> {
  const authError = await requireAuth();
  if (authError) return authError;

  const user = await getCurrentUser();
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ error: 'Admin required' }, { status: 403 });
  }
  return null;
}
