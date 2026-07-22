import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { SESSION_COOKIE, isAuthorizedProject } from '@/lib/auth/config';
import { verifySessionToken } from '@/lib/auth/session';

/**
 * Edge middleware — the first line of defence for protected surfaces.
 *
 * This is NOT the only check: the protected layout and every UPSRTC API verify
 * the session independently (Section 10). Middleware only imports edge-safe
 * code (jose); bcrypt and next/headers are never pulled in here.
 *
 * - Unauthenticated page request under /project/*  → redirect to /login?next=…
 * - Unauthenticated API request under /api/upsrtc/* → 401 JSON
 */
export const config = {
  matcher: ['/project/:path*', '/api/upsrtc/:path*'],
};

function isAuthorized(claims: Awaited<ReturnType<typeof verifySessionToken>>): boolean {
  return Boolean(claims && isAuthorizedProject(claims.project));
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname, search } = request.nextUrl;
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const claims = await verifySessionToken(token);

  if (isAuthorized(claims)) {
    return NextResponse.next();
  }

  // Unauthorized.
  if (pathname.startsWith('/api/')) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const loginUrl = new URL('/login', request.url);
  loginUrl.searchParams.set('next', `${pathname}${search}`);
  return NextResponse.redirect(loginUrl);
}
