/**
 * Authentication configuration and normalization.
 *
 * Edge-safe: this module imports nothing Node-only, so it can be used from
 * middleware (Edge runtime) as well as Node route handlers. Secret *values*
 * live only in the environment and are never logged or returned to clients.
 */

export const SESSION_COOKIE = 'olympuss_session';

/** Maximum session lifetime — 8 hours (Section 10). */
export const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;

/** Role stamped on every issued session. */
export const SESSION_ROLE = 'project-access';

/** Thrown when required auth environment variables are missing/invalid. */
export class AuthConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthConfigError';
  }
}

/**
 * Normalize a project-name input: trim surrounding whitespace and lowercase.
 * So "  Upsrtc ", "UPSRTC" and "upsrtc" all resolve equal. The PIN is NEVER
 * normalized — it must match exactly.
 */
export function normalizeProjectName(value: string): string {
  return value.trim().toLowerCase();
}

/** Configured project name (normalized). Throws if unset. */
export function getConfiguredProjectName(): string {
  const raw = process.env.PROJECT_NAME;
  if (!raw || !raw.trim()) {
    throw new AuthConfigError('PROJECT_NAME is not configured');
  }
  return normalizeProjectName(raw);
}

/**
 * Whether a session's `project` claim matches the configured PROJECT_NAME.
 * The single source of truth for "is this session authorized" — used by
 * middleware, the protected layout, and every protected API. Returns false
 * (never throws) if PROJECT_NAME is misconfigured, so callers can uniformly
 * deny access rather than crash.
 */
export function isAuthorizedProject(project: string): boolean {
  try {
    return project === getConfiguredProjectName();
  } catch {
    return false;
  }
}

/** Configured bcrypt hash of the project PIN. Throws if unset. */
export function getProjectPinHash(): string {
  const hash = process.env.PROJECT_PIN_HASH;
  if (!hash || !hash.trim()) {
    throw new AuthConfigError('PROJECT_PIN_HASH is not configured');
  }
  return hash;
}

/** Session signing secret as bytes. Throws if unset or too short. */
export function getSessionSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new AuthConfigError('SESSION_SECRET is missing or shorter than 32 characters');
  }
  return new TextEncoder().encode(secret);
}

/** True when running in production (used for the Secure cookie flag). */
export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}
