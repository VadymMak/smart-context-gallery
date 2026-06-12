import { NextRequest, NextResponse } from 'next/server';
import { authenticateUser, setAuthCookies } from '@/lib/auth';

export async function POST(request: NextRequest) {
  const { username, password } = await request.json();

  if (!username || !password) {
    return NextResponse.json({ error: 'Username and password required' }, { status: 400 });
  }

  const user = await authenticateUser(username, password);
  if (!user) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  const response = NextResponse.json({ success: true, user });
  return setAuthCookies(response, user);
}
