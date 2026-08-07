/**
 * Authorization guards for protected UPSRTC APIs.
 *
 * Every sensitive UPSRTC route calls `requireUpsrtcAccess()` independently —
 * middleware is a first line of defence, not the only one (Section 10, 13).
 * Backed by Supabase Auth: any admin-provisioned, signed-in Supabase user is
 * authorized. There is no separate "project" claim to check any more — the
 * earlier env-var PIN system (`isAuthorizedProject`) has been removed.
 */
import { NextResponse } from 'next/server';
import type { User } from '@supabase/supabase-js';
import { getSupabaseUser } from '@/lib/supabase/server';

/** Standard 401 response for unauthenticated API requests. */
export function unauthorizedResponse(): NextResponse {
  return NextResponse.json(
    { error: 'Unauthorized' },
    { status: 401, headers: { 'Cache-Control': 'no-store' } },
  );
}

/**
 * Require a valid Supabase session. Returns the authenticated user when
 * authorized, or null when not — callers return `unauthorizedResponse()` on
 * null. Kept as a nullable return (rather than throwing) so route handlers
 * stay linear and explicit.
 */
export async function requireUpsrtcAccess(): Promise<User | null> {
  return getSupabaseUser();
}
