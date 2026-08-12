// @vitest-environment node
//
// The fast-ceiling half: reading the ops role out of a Supabase access token
// without a network round-trip, and failing closed on everything else.
//
// Two properties here are easy to lose and expensive to lose silently:
//
//   * The JWKS must come from an APP-owned module-scope cache, not the SDK's.
//     `createServerClient` builds a fresh client per request by design and the
//     SDK caches key sets per client INSTANCE, so a bare getClaims() is always
//     a cold cache and costs one /.well-known/jwks.json fetch per request —
//     which would trade the ops surface's zero-network check for a
//     one-network-call check while looking correct in every test.
//   * An unknown or absent role claim must mean NO ceiling, never a wildcard.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { readSupabaseOpsClaim, resetSupabaseJwksCache } from '@/lib/auth/rbac/supabaseClaims';

const JWKS_BODY = {
  keys: [{ kty: 'EC', crv: 'P-256', alg: 'ES256', kid: 'key-1', key_ops: ['verify'], use: 'sig' }],
};

const getClaims = vi.fn();

function client(): SupabaseClient {
  return { auth: { getClaims } } as unknown as SupabaseClient;
}

function claimsResult(overrides: {
  claims?: Record<string, unknown>;
  alg?: string;
}) {
  return {
    data: {
      claims: {
        sub: 'supabase-user-1',
        email: 'operator@olympuss.local',
        iat: 1_770_000_000,
        exp: 1_770_003_600,
        app_metadata: { provider: 'email', ops_role: 'control_room' },
        ...overrides.claims,
      },
      header: { alg: overrides.alg ?? 'ES256', kid: 'key-1', typ: 'JWT' },
      signature: new Uint8Array(),
    },
    error: null,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  resetSupabaseJwksCache();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project-ref.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => JWKS_BODY }));
  vi.stubGlobal('fetch', fetchMock);
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  warnSpy.mockRestore();
  vi.useRealTimers();
});

describe('reading the ops ceiling from a Supabase token', () => {
  it('returns the verified identity and the ops role claim', async () => {
    getClaims.mockResolvedValue(claimsResult({}));

    const claim = await readSupabaseOpsClaim(client());

    expect(claim).toEqual({
      supabaseUserId: 'supabase-user-1',
      email: 'operator@olympuss.local',
      roleClaim: 'control_room',
      iat: 1_770_000_000,
      exp: 1_770_003_600,
    });
  });

  it('verifies against an app-owned key set: the JWKS is fetched ONCE and handed to every call', async () => {
    getClaims.mockResolvedValue(claimsResult({}));

    await readSupabaseOpsClaim(client());
    await readSupabaseOpsClaim(client());
    await readSupabaseOpsClaim(client());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://project-ref.supabase.co/auth/v1/.well-known/jwks.json',
    );
    for (const call of getClaims.mock.calls) {
      expect(call[1]).toEqual({ jwks: JWKS_BODY });
    }
  });

  it('refetches the key set and retries once when verification fails — signing-key rotation', async () => {
    const rotated = { keys: [{ ...JWKS_BODY.keys[0], kid: 'key-2' }] };
    // Warm the cache with key-1.
    getClaims.mockResolvedValue(claimsResult({}));
    await readSupabaseOpsClaim(client());
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Now the project rotates: the cached key set no longer verifies.
    fetchMock.mockResolvedValue({ ok: true, json: async () => rotated });
    getClaims.mockReset();
    getClaims
      .mockResolvedValueOnce({ data: null, error: new Error('no matching kid') })
      .mockResolvedValueOnce(claimsResult({}));

    const claim = await readSupabaseOpsClaim(client());

    expect(claim?.roleClaim).toBe('control_room');
    expect(getClaims).toHaveBeenCalledTimes(2);
    expect(getClaims.mock.calls[1]?.[1]).toEqual({ jwks: rotated });
  });
});

describe('fail closed', () => {
  it('returns null when Supabase is not configured for this environment', async () => {
    expect(await readSupabaseOpsClaim(null)).toBeNull();
  });

  it('returns null when the token does not verify', async () => {
    getClaims.mockResolvedValue({ data: null, error: new Error('bad signature') });
    expect(await readSupabaseOpsClaim(client())).toBeNull();
  });

  it('returns null when getClaims throws rather than letting it reach the caller', async () => {
    getClaims.mockRejectedValue(new Error('network down'));
    expect(await readSupabaseOpsClaim(client())).toBeNull();
  });

  it('returns null when the token carries no subject', async () => {
    getClaims.mockResolvedValue(claimsResult({ claims: { sub: undefined } }));
    expect(await readSupabaseOpsClaim(client())).toBeNull();
  });

  it('treats an ABSENT role claim as no ceiling, not as access', async () => {
    getClaims.mockResolvedValue(claimsResult({ claims: { app_metadata: { provider: 'email' } } }));

    const claim = await readSupabaseOpsClaim(client());
    expect(claim?.supabaseUserId).toBe('supabase-user-1');
    expect(claim?.roleClaim).toBeNull();
  });

  it('treats an UNRECOGNISED role claim as no ceiling, not as a wildcard', async () => {
    getClaims.mockResolvedValue(
      claimsResult({ claims: { app_metadata: { ops_role: 'superuser' } } }),
    );

    expect((await readSupabaseOpsClaim(client()))?.roleClaim).toBeNull();
  });

  it('gives up rather than hanging the request when verification stalls', async () => {
    // Only reachable when the token has actually expired and the SDK is
    // backing off against Supabase Auth (up to ~30s). An Edge request must
    // not wait that long; timing out denies and the caller falls back.
    vi.useFakeTimers();
    getClaims.mockImplementation(() => new Promise(() => {}));

    const pending = readSupabaseOpsClaim(client());
    // Let the JWKS read settle so the verification timer actually exists
    // before the clock is moved.
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    await vi.advanceTimersByTimeAsync(3_100);

    expect(await pending).toBeNull();
  });
});

describe('symmetric signing is reported, not punished', () => {
  it('still admits a token the SDK verified server-side, and warns once', async () => {
    // Rejecting HS256 would convert a latency regression (getClaims falls back
    // to a GET /user round-trip) into a total lockout. The requirement above
    // everything else on this migration is that it must never lock the captain
    // out of his own product, so this is loud, not fatal.
    getClaims.mockResolvedValue(claimsResult({ alg: 'HS256' }));

    expect((await readSupabaseOpsClaim(client()))?.roleClaim).toBe('control_room');
    await readSupabaseOpsClaim(client());

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain('symmetric');
  });
});
