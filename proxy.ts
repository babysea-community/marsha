import { NextResponse, type NextRequest } from 'next/server';

import { SESSION_COOKIE, verifySession } from '@/lib/auth/owner';

/**
 * Edge gate for the owner dashboard. Only `/dashboard/*` is guarded; the
 * dashboard layout performs the authoritative server-side check as well.
 */
export async function proxy(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const email = process.env.OWNER_EMAIL?.trim().toLowerCase();
  const secret = process.env.OWNER_SESSION_SECRET?.trim();

  if (token && email && secret) {
    const session = await verifySession(token, secret);
    if (session && session.email === email) {
      return NextResponse.next();
    }
  }

  const loginUrl = new URL('/login', request.url);
  loginUrl.searchParams.set('redirect', request.nextUrl.pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/dashboard', '/dashboard/:path*'],
};
