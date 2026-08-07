import { NextResponse } from 'next/server';
import { getSupabaseUser } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Safe session-status endpoint. Returns only whether a session is active and,
 * when it is, the signed-in user's email. Never returns the raw token or any
 * credential configuration (Section 11).
 */
export async function GET(): Promise<Response> {
  const user = await getSupabaseUser();
  if (!user) {
    return NextResponse.json(
      { authenticated: false },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  return NextResponse.json(
    {
      authenticated: true,
      email: user.email ?? null,
    },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}
