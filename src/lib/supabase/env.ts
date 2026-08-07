/**
 * Supabase configuration and normalization.
 *
 * Edge-safe: this module imports nothing Node-only, so it can be used from
 * middleware (Edge runtime) as well as Node route handlers. Secret *values*
 * live only in the environment and are never logged or returned to clients.
 *
 * Replaces the pitch-demo PIN system's `src/lib/auth/config.ts` — enterprise
 * accounts now live in Supabase Auth rather than a single shared project PIN.
 */

/** Thrown when required Supabase environment variables are missing/invalid. */
export class SupabaseConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SupabaseConfigError';
  }
}

/** Supabase project URL. Public by design (embedded in the browser bundle). */
export function getSupabaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url || !url.trim()) {
    throw new SupabaseConfigError('NEXT_PUBLIC_SUPABASE_URL is not configured');
  }
  return url;
}

/** Supabase anon (public) key. Safe for the browser — RLS enforces access. */
export function getSupabaseAnonKey(): string {
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!key || !key.trim()) {
    throw new SupabaseConfigError('NEXT_PUBLIC_SUPABASE_ANON_KEY is not configured');
  }
  return key;
}

/**
 * Supabase service-role key. Server-only, never bundled to the browser and
 * never imported from an Edge-safe module — only from Node scripts / route
 * handlers that explicitly need to bypass RLS (e.g. admin user provisioning).
 */
export function getSupabaseServiceRoleKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || !key.trim()) {
    throw new SupabaseConfigError('SUPABASE_SERVICE_ROLE_KEY is not configured');
  }
  return key;
}

/** True when running in production (used for the Secure cookie flag). */
export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}
