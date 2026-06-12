import { NextResponse } from 'next/server';

export async function POST() {
  const response = NextResponse.json({ success: true });
  response.cookies.delete('ak-gallery-auth');
  response.cookies.delete('ak-gallery-user');
  return response;
}
