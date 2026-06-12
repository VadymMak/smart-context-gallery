import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

const AUTH_COOKIE = 'ak-gallery-auth';
const PASSWORD = process.env.GALLERY_PASSWORD || 'changeme';

export function verifyPassword(input: string): boolean {
  return input === PASSWORD;
}

export async function isAuthenticated(): Promise<boolean> {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE)?.value;
  return token === 'authenticated';
}

export function setAuthCookie(response: NextResponse): NextResponse {
  response.cookies.set(AUTH_COOKIE, 'authenticated', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30,
    path: '/',
  });
  return response;
}

export async function requireAuth(): Promise<NextResponse | null> {
  const authed = await isAuthenticated();
  if (!authed) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}
