import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Safe session-status endpoint. Returns only whether a session is active and,
 * when it is, the project identifier and expiry. Never returns the raw token,
 * PIN hash, session secret, or any credential configuration (Section 11).
 */
export async function GET(): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { authenticated: false },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  return NextResponse.json(
    {
      authenticated: true,
      project: session.project,
      expiresAt: new Date(session.exp * 1000).toISOString(),
    },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}
