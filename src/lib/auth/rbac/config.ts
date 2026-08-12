/**
 * LEGACY ops session configuration — the old ops front door.
 *
 * Edge-safe (no Node-only imports) — usable from middleware.
 *
 * READ THIS BEFORE DELETING ANYTHING HERE. This file used to argue FOR
 * keeping the ops session deliberately separate from Supabase Auth: a
 * separate cookie name and a separate secret, so the two systems could not
 * cross-authenticate each other's tokens and a bug in one could not widen the
 * other's blast radius. That argument has been overturned on purpose — the
 * two front doors are being collapsed into one, with Supabase Auth as the
 * single sign-in and `ops_users` surviving as the role/profile table.
 *
 * Everything below is retained through the cutover, not left behind. It backs
 * POST /api/ops/auth/login and /ops/login, which stay live and working until
 * the new path is proven, and it is the only credential path that still
 * functions if Supabase Auth is unreachable. Both doors are accepted at once
 * (src/lib/auth/rbac/edgeSession.ts, server.ts), so rollback is a
 * configuration change rather than a data restore.
 *
 * OPS_SESSION_SECRET is the LAST thing to remove, after the code that reads
 * it, never before: `getOpsSessionSecret()` throws, `verifyOpsSessionToken`
 * catches and returns null, so removing it while any fallback path survives
 * is a silent universal deny with no error surfaced anywhere.
 */

export const OPS_SESSION_COOKIE = 'olympuss_ops_session';

/**
 * Shorter than a Supabase browser session: operational accounts hold
 * dispatch/command authority, so they re-authenticate more often.
 */
export const OPS_SESSION_MAX_AGE_SECONDS = 4 * 60 * 60;

export class OpsAuthConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpsAuthConfigError';
  }
}

/** Session signing secret as bytes. Throws if unset or too short. */
export function getOpsSessionSecret(): Uint8Array {
  const secret = process.env.OPS_SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new OpsAuthConfigError('OPS_SESSION_SECRET is missing or shorter than 32 characters');
  }
  return new TextEncoder().encode(secret);
}

/** True when running in production (used for the Secure cookie flag). */
export function isOpsProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}
