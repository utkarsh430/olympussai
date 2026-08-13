/**
 * Ops sign-out.
 *
 * This used to clear the legacy `olympuss_ops_session` cookie and stop there,
 * which meant a Supabase-authenticated operator — every invite-created
 * account — stayed signed in while the UI showed them the login page. See
 * `src/lib/auth/rbac/signOut.ts` for what ending a session actually involves
 * now and why.
 *
 * The response is deliberately allowed to fail. `ok: false` means a
 * credential survived and the caller must NOT tell the operator they are
 * signed out; a sign-out button that reports success it cannot demonstrate is
 * the bug this route is fixing, not a style it may repeat.
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
      { error: { code: 'INVALID_ORIGIN', message: 'Invalid request origin.' } },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const outcome = await endOpsSessions();

  if (outcome.residualCredentials.length > 0) {
    // Names the cookies, not their values, and only in the server log.
    console.error('[ops/auth/logout] sign-out left a live credential behind', {
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
    // This device is signed out; the account's other devices are not. Worth a
    // log line, not worth failing the operator's sign-out over.
    console.warn('[ops/auth/logout] session ended locally but was not revoked at Supabase', {
      supabase: outcome.supabase,
      supabaseError: outcome.supabaseError,
    });
  }

  return NextResponse.json(
    {
      ok: true,
      // 'signed_out' = revoked everywhere; anything else = ended on this
      // device only. Reported so the browser can say which it was.
      supabase: outcome.supabase,
    },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}
