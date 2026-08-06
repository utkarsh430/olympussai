import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { SESSION_COOKIE, isAuthorizedProject } from '@/lib/auth/config';
import { verifySessionToken } from '@/lib/auth/session';
import { OPS_SESSION_COOKIE } from '@/lib/auth/rbac/config';
import { verifyOpsSessionToken } from '@/lib/auth/rbac/session';
import { roleForSegment } from '@/lib/auth/rbac/roles';

/**
 * Edge middleware — the first line of defence for protected surfaces.
 *
 * This is NOT the only check: the protected layout and every UPSRTC API verify
 * the session independently (Section 10). Middleware only imports edge-safe
 * code (jose); bcrypt and next/headers are never pulled in here.
 *
 * - Unauthenticated page request under /project/*  → redirect to /login?next=…
 * - Unauthenticated API request under /api/upsrtc/* → 401 JSON
 *
 * /ops/* and /api/ops/* (the multi-role RBAC surface added by this ticket)
 * are handled by a completely separate branch (handleOpsRequest, below) that
 * never touches SESSION_COOKIE/verifySessionToken — the PIN logic above is
 * unchanged, byte-for-byte, from before this ticket.
 */
export const config = {
  matcher: ['/project/:path*', '/api/upsrtc/:path*', '/ops/:path*', '/api/ops/:path*'],
};

function isAuthorized(claims: Awaited<ReturnType<typeof verifySessionToken>>): boolean {
  return Boolean(claims && isAuthorizedProject(claims.project));
}

/**
 * Role gate for the ops RBAC surface. A path's required role is derived from
 * its first segment under /ops/ or /api/ops/ (e.g. /ops/control-room/... →
 * `control_room`). Paths whose segment is not a role surface at all (auth,
 * login, forbidden) are intentionally left unchecked here — each such route
 * enforces whatever it individually needs (see src/lib/auth/rbac/guard.ts).
 *
 * Authenticated-but-wrong-role never bounces to /ops/login (that would imply
 * "you are not signed in", which is false and would invite retrying with a
 * different account); it redirects to /ops/forbidden / returns 403 instead.
 */
async function handleOpsRequest(request: NextRequest): Promise<NextResponse> {
  const { pathname, search } = request.nextUrl;
  const isApi = pathname.startsWith('/api/ops/');
  const root = isApi ? '/api/ops/' : '/ops/';
  const segment = pathname.slice(root.length).split('/')[0] ?? '';
  const requiredRole = roleForSegment(segment);

  if (!requiredRole) {
    // Not a role-gated segment (auth/login/forbidden/etc.) — let it through;
    // the route handler or layout enforces its own requirement.
    return NextResponse.next();
  }

  const token = request.cookies.get(OPS_SESSION_COOKIE)?.value;
  const claims = await verifyOpsSessionToken(token);

  if (claims && claims.role === requiredRole) {
    return NextResponse.next();
  }

  if (isApi) {
    if (claims) {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: 'Your role does not permit this action.' } },
        { status: 403, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Authentication required.' } },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  if (claims) {
    return NextResponse.redirect(new URL('/ops/forbidden', request.url));
  }

  const loginUrl = new URL('/ops/login', request.url);
  loginUrl.searchParams.set('next', `${pathname}${search}`);
  return NextResponse.redirect(loginUrl);
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname, search } = request.nextUrl;

  if (pathname.startsWith('/ops/') || pathname.startsWith('/api/ops/')) {
    return handleOpsRequest(request);
  }

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
