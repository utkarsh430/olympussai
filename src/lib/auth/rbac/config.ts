/**
 * Ops session configuration.
 *
 * Edge-safe (no Node-only imports) — usable from middleware. Deliberately a
 * SEPARATE cookie name and a SEPARATE secret env var from the other auth
 * system in this app, Supabase Auth (`@supabase/ssr` cookies,
 * NEXT_PUBLIC_SUPABASE_* / SUPABASE_SERVICE_ROLE_KEY — see
 * src/lib/supabase/), so the two cannot cross-authenticate each other's
 * tokens and a bug in one cannot widen the other's blast radius.
 *
 * (This used to describe the split against a pitch-demo PIN session in
 * src/lib/auth/config.ts. That system and that file are gone — the
 * project-facing surface moved to Supabase Auth — but the separation
 * argument is unchanged, only the neighbour it separates from.)
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
