/**
 * Authorization guards for protected UPSRTC APIs.
 *
 * Every sensitive UPSRTC route calls `requireUpsrtcAccess()` independently —
 * middleware is a first line of defence, not the only one (Section 10, 13).
 */
import { NextResponse } from 'next/server';
import { getSession } from './server';
import { PROJECT_UPSRTC } from './config';
import type { SessionClaims } from './session';

/** Standard 401 response for unauthenticated API requests. */
export function unauthorizedResponse(): NextResponse {
  return NextResponse.json(
    { error: 'Unauthorized' },
    { status: 401, headers: { 'Cache-Control': 'no-store' } },
  );
}

/**
 * Require a valid session scoped to the UPSRTC project. Returns the claims when
 * authorized, or null when not — callers return `unauthorizedResponse()` on
 * null. Kept as a nullable return (rather than throwing) so route handlers stay
 * linear and explicit.
 */
export async function requireUpsrtcAccess(): Promise<SessionClaims | null> {
  const session = await getSession();
  if (!session) return null;
  if (session.project !== PROJECT_UPSRTC) return null;
  return session;
}
