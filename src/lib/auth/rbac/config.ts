/**
 * Ops session configuration.
 *
 * Edge-safe (no Node-only imports) — usable from middleware. Deliberately a
 * SEPARATE cookie name and a SEPARATE secret env var from the pitch-demo PIN
 * session (src/lib/auth/config.ts, SESSION_COOKIE / SESSION_SECRET), so the
 * two auth systems cannot cross-authenticate each other's tokens and a bug in
 * one cannot widen the other's blast radius. The PIN system's own config file
 * is untouched by this ticket.
 */

export const OPS_SESSION_COOKIE = 'olympuss_ops_session';

/** Shorter than the PIN session (8h): operational accounts re-auth more often. */
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
