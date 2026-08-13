/**
 * Front-door sign-out, for the /login page's own button.
 *
 * THE MIRROR IMAGE OF THE OPS DEFECT, AND EXACTLY AS BAD. This used to call
 * `supabase.auth.signOut()` and stop there, which ends the Supabase half and
 * leaves the legacy `olympuss_ops_session` cookie untouched. An operator who
 * came in through `/ops/login` and then pressed Sign out here was told they
 * were signed out while still holding a credential that resolves to a real,
 * active ops profile — and, since the project surface was gated on the same
 * profile, one that opens `/project/*` too.
 *
 * So both buttons now go through the SAME module (`endOpsSessions`,
 * src/lib/auth/rbac/signOut.ts), which is the only place that knows what
 * credentials a request can be carrying. Two sign-out implementations is how
 * one of them ends up ending one session out of two.
 *
 * `ok: false` means a credential survived and the caller must NOT tell the
 * visitor they are signed out.
 */
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { endOpsSessions } from '@/lib/auth/rbac/signOut';
import { isSameOrigin } from '@/lib/auth/origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<Response> {
  if (!isSameOrigin(request)) {
    return NextResponse.json(
      { error: 'Invalid request origin.' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const outcome = await endOpsSessions();

  if (outcome.residualCredentials.length > 0) {
    // Names the cookies, not their values, and only in the server log.
    console.error('[auth/logout] sign-out left a live credential behind', {
      supabase: outcome.supabase,
      supabaseError: outcome.supabaseError,
      residualCredentials: outcome.residualCredentials,
    });
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'SIGN_OUT_INCOMPLETE',
          message: 'Sign-out did not complete. You are still signed in — close this browser.',
        },
      },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  if (outcome.supabase === 'revoke_failed' || outcome.supabase === 'not_configured') {
    console.warn('[auth/logout] session ended locally but was not revoked at Supabase', {
      supabase: outcome.supabase,
      supabaseError: outcome.supabaseError,
    });
  }

  return NextResponse.json(
    { ok: true, supabase: outcome.supabase },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}
