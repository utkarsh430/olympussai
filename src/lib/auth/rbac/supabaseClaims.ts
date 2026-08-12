/**
 * Read the ops role CEILING out of a Supabase Auth access token, locally.
 *
 * Edge-safe: this module imports nothing Node-only (no `pg`, no
 * `next/headers`, no `server-only`), so the SAME code runs in
 * `src/middleware.ts` on the Edge runtime and in Node route handlers/Server
 * Components. That symmetry is the point — one verification path, one place
 * to get it wrong.
 *
 * WHY NOT `supabase.auth.getUser()`. That call is unconditionally an HTTP
 * round-trip to Supabase Auth (GoTrueClient issues `GET /user` with no local
 * path and no cache). It is what the project surface already pays on every
 * /project/* request, but the OPS surface today verifies a local HS256 token
 * with zero network and zero database, and collapsing the two front doors
 * must not quietly hand every ops page load a network hop and a hard
 * dependency on Supabase Auth uptime. `getClaims()` verifies an asymmetric
 * (ES256/RS256) token locally with WebCrypto instead.
 *
 * WHY THE JWKS CACHE LIVES HERE AND NOT IN THE SDK. `createServerClient`
 * builds a FRESH client per request by design ("never share a client across
 * requests"), and the SDK's JWKS cache is per client INSTANCE. So a bare
 * `getClaims()` in middleware is always a cold cache and costs one
 * `/.well-known/jwks.json` fetch per request — trading one network call for
 * another. Holding the key set in module scope (warm per Edge isolate /
 * per Node process) and passing it in via `options.jwks` is what actually
 * makes the fast path fast. The TTL matches the SDK's own 10 minutes.
 *
 * KEY ROTATION is handled by not pinning: on a verification failure while a
 * cached key set was in use, the cache is dropped, refetched once, and the
 * verification retried. A single pinned JWK would break every token minted
 * after the project's next signing-key rotation.
 *
 * SYMMETRIC SIGNING IS A CONFIGURATION REGRESSION, NOT A DENIAL. If the
 * project's current signing key is a legacy HS256 secret, `getClaims()`
 * silently falls back to a `GET /user` round-trip: still cryptographically
 * sound (the Auth server is the authority), just slow. This module WARNS
 * once per process instead of rejecting, deliberately: rejecting would turn
 * a latency regression into a total lockout, and the standing requirement on
 * this migration is that it must never lock the captain out of his own
 * product. The warning names the exact dashboard setting to check.
 *
 * WHAT THIS MODULE IS NOT. The role it returns is a CEILING — an
 * edge-checkable approximation, baked into the token at mint time and
 * therefore stale by up to one access-token lifetime after a role change,
 * and carrying NO signal at all about whether the account has since been
 * disabled. `ops_users.role` and `ops_users.status`, re-read per guarded
 * request in src/lib/auth/rbac/server.ts, remain the sole authority. This is
 * the same ordering OPS_API_ROLE_OVERRIDES already has with `requireOpsRole`
 * (see src/lib/auth/rbac/roles.ts and guard.ts).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseUrl } from '@/lib/supabase/env';
import { isOpsRole, type OpsRole } from './roles';

/**
 * The claim shape `app_metadata` carries the ops role under. Written by the
 * role-assignment path (Supabase admin API, service role) alongside the
 * authoritative `ops_users.role` write. Only a role NAME goes in here: the
 * JWT payload is base64, not encrypted, and is readable by the browser.
 *
 * `status` deliberately never rides in the token. A disable signal that
 * cannot be trusted is worse than no signal, because someone would
 * eventually trust it — disable stays strictly a database check.
 */
export const OPS_ROLE_CLAIM = 'ops_role';

/** Verified, locally-checked identity carried by a Supabase access token. */
export interface SupabaseOpsClaim {
  /** `auth.users.id` — NOT `ops_users.id`. Never write this to an ops FK column. */
  supabaseUserId: string;
  email: string | null;
  /**
   * `app_metadata.ops_role`, or null when the token carries no ops role at
   * all (an ordinary project-viewer account, or a linked account whose claim
   * has not been pushed yet). Null means "no ceiling", never "any role".
   */
  roleClaim: OpsRole | null;
  iat: number;
  exp: number;
}

type GetClaimsOptions = NonNullable<Parameters<SupabaseClient['auth']['getClaims']>[1]>;
type SupabaseJwks = NonNullable<GetClaimsOptions['jwks']>;

/** Matches @supabase/auth-js's own JWKS_TTL. */
const JWKS_TTL_MS = 10 * 60 * 1000;

/**
 * Bound on how long a single claim verification may take. Only ever reached
 * when the token has actually expired and the SDK is retrying a refresh
 * against Supabase Auth (auth-js backs off up to ~30s). An Edge request must
 * not hang that long: timing out denies, the caller falls back to whatever
 * other session it has, and the user re-authenticates. Fails closed.
 */
const CLAIM_VERIFY_TIMEOUT_MS = 3_000;

interface JwksCacheEntry {
  jwks: SupabaseJwks;
  fetchedAt: number;
}

/** Module scope: warm per Edge isolate / Node process, keyed by project URL. */
let jwksCache: (JwksCacheEntry & { url: string }) | null = null;
let symmetricSigningWarned = false;

function jwksUrl(): string | null {
  try {
    return `${getSupabaseUrl().replace(/\/+$/, '')}/auth/v1/.well-known/jwks.json`;
  } catch {
    // Supabase not configured in this environment — callers fail closed.
    return null;
  }
}

function isJwks(value: unknown): value is SupabaseJwks {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { keys?: unknown }).keys) &&
    (value as { keys: unknown[] }).keys.length > 0
  );
}

async function fetchJwks(url: string): Promise<SupabaseJwks | null> {
  try {
    const response = await fetch(url, { headers: { accept: 'application/json' } });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    return isJwks(body) ? body : null;
  } catch {
    return null;
  }
}

/**
 * The project's signing key set, from module scope when warm. Returns null
 * when Supabase is unconfigured or the discovery endpoint is unreachable —
 * in which case the SDK is left to fetch it itself (slower, still correct)
 * rather than the request being denied for a cache miss.
 */
async function getJwks(): Promise<SupabaseJwks | null> {
  const url = jwksUrl();
  if (!url) return null;

  const now = Date.now();
  if (jwksCache && jwksCache.url === url && now - jwksCache.fetchedAt < JWKS_TTL_MS) {
    return jwksCache.jwks;
  }

  const fetched = await fetchJwks(url);
  if (!fetched) {
    // Keep serving a stale-but-valid key set rather than falling back to a
    // per-request SDK fetch on every request during a discovery blip.
    return jwksCache && jwksCache.url === url ? jwksCache.jwks : null;
  }
  jwksCache = { url, jwks: fetched, fetchedAt: now };
  return fetched;
}

/** Drops the cached key set so the next read refetches (signing-key rotation). */
function invalidateJwks(): void {
  jwksCache = null;
}

/** Test/ops seam: forget the cached key set. No effect on correctness. */
export function resetSupabaseJwksCache(): void {
  jwksCache = null;
  symmetricSigningWarned = false;
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

type ClaimsResult = Awaited<ReturnType<SupabaseClient['auth']['getClaims']>>;

/** Null means "timed out" — `getClaims` itself never resolves to null. */
async function verifyClaims(
  supabase: SupabaseClient,
  jwks: SupabaseJwks | null,
): Promise<ClaimsResult | null> {
  return withTimeout(
    supabase.auth.getClaims(undefined, jwks ? { jwks } : undefined),
    CLAIM_VERIFY_TIMEOUT_MS,
  );
}

/**
 * Verify the current request's Supabase access token and read the ops role
 * ceiling out of it. Returns null on ANY failure — no session, bad
 * signature, expired, unreachable, malformed — so every caller fails closed
 * on null. Never throws.
 */
export async function readSupabaseOpsClaim(
  supabase: SupabaseClient | null,
): Promise<SupabaseOpsClaim | null> {
  if (!supabase) return null;

  try {
    const jwks = await getJwks();
    let result = await verifyClaims(supabase, jwks);

    // Timing out is not a key-rotation symptom, and retrying it would simply
    // double the worst-case wait an Edge request is made to sit through.
    if (result === null) return null;

    // A verification FAILURE while a cached key set was in use, on the other
    // hand, is what a signing-key rotation looks like from here: the token's
    // `kid` is not in our copy of the JWKS. Refetch once and retry before
    // denying, so a rotation does not reject every session for a TTL.
    if (jwks && (result.error || !result.data)) {
      invalidateJwks();
      const refreshed = await getJwks();
      if (refreshed) {
        const retried = await verifyClaims(supabase, refreshed);
        if (retried === null) return null;
        result = retried;
      }
    }

    if (result.error || !result.data) return null;

    const { claims, header } = result.data;

    if (typeof header.alg === 'string' && header.alg.startsWith('HS') && !symmetricSigningWarned) {
      symmetricSigningWarned = true;
      // Not a denial — see this module's header. Loud once, then quiet.
      console.warn(
        '[ops-auth] Supabase project is signing access tokens with a symmetric key ' +
          `(alg=${header.alg}). Every session check therefore costs a network round-trip to ` +
          'Supabase Auth instead of a local verification. Switch the project to an asymmetric ' +
          'signing key (Supabase dashboard: Authentication -> JWT Keys) to restore the fast path.',
      );
    }

    const supabaseUserId = typeof claims.sub === 'string' ? claims.sub : '';
    if (!supabaseUserId) return null;
    if (typeof claims.iat !== 'number' || typeof claims.exp !== 'number') return null;

    const rawRole = (claims.app_metadata as Record<string, unknown> | undefined)?.[OPS_ROLE_CLAIM];

    return {
      supabaseUserId,
      email: typeof claims.email === 'string' && claims.email.length > 0 ? claims.email : null,
      // An unrecognised value is treated as NO ceiling, not as a wildcard.
      roleClaim: isOpsRole(rawRole) ? rawRole : null,
      iat: claims.iat,
      exp: claims.exp,
    };
  } catch {
    return null;
  }
}
