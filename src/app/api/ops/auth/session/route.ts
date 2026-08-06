import { NextResponse } from 'next/server';
import { getOpsSession } from '@/lib/auth/rbac/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Safe session-status endpoint. Never returns the raw token, password hash,
 * or session secret — only whether a session is active and, when it is, the
 * role and expiry (mirrors /api/auth/session for the PIN system).
 */
export async function GET(): Promise<Response> {
  const session = await getOpsSession();
  if (!session) {
    return NextResponse.json(
      { authenticated: false },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  return NextResponse.json(
    {
      authenticated: true,
      role: session.role,
      email: session.email,
      expiresAt: new Date(session.exp * 1000).toISOString(),
    },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}
