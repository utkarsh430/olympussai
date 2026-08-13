// @vitest-environment node
//
// Sign-out has to END the session, not navigate away from it.
//
// The shipped button called POST /api/ops/auth/logout, which cleared the
// legacy `olympuss_ops_session` cookie and nothing else, then sent the browser
// to /login. Every invite-created operator signs in through Supabase, so for
// all of them the button showed a login page over a session that was still
// fully live: the next person on a shared depot tablet opened /ops/driver and
// was still the previous driver.
//
// The proof that matters here is the last describe block: after logout, the
// SAME cookie store no longer resolves to an ops session. Asserting only that
// `signOut()` was called would pass just as happily against a logout that
// forgot to drop the cookie, which is the exact shape of the original bug.
import { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { OpsUserRecord } from '@/lib/auth/rbac/repo';

/**
 * A cookie store that behaves like the one a Route Handler gets: writes are
 * visible to later reads within the same request, and an expired write reads
 * back as an empty value.
 */
class FakeCookieStore {
  private jar = new Map<string, string>();
  /** Every set() the request made, so a test can inspect the wire behaviour. */
  readonly writes: { name: string; value: string; options: Record<string, unknown> }[] = [];
  /** When true, set() throws — a read-only store (Server Component render). */
  readOnly = false;

  seed(name: string, value: string) {
    this.jar.set(name, value);
  }
  reset() {
    this.jar.clear();
    this.writes.length = 0;
    this.readOnly = false;
  }
  get(name: string) {
    const value = this.jar.get(name);
    return value === undefined ? undefined : { name, value };
  }
  getAll() {
    return [...this.jar.entries()].map(([name, value]) => ({ name, value }));
  }
  set(name: string, value: string, options: Record<string, unknown> = {}) {
    if (this.readOnly) throw new Error('Cookies can only be modified in a Route Handler.');
    this.writes.push({ name, value, options });
    this.jar.set(name, value);
  }
}

const store = new FakeCookieStore();
const signOut = vi.fn<() => Promise<{ error: { message: string } | null }>>();
const createSupabaseServerClient = vi.fn();
const findUserBySupabaseId = vi.fn<(id: string) => Promise<OpsUserRecord | null>>();
const findUserById = vi.fn<(id: string) => Promise<OpsUserRecord | null>>();

const isSameOrigin = vi.fn(() => true);

vi.mock('next/headers', () => ({ cookies: async () => store }));
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: () => createSupabaseServerClient(),
}));
vi.mock('@/lib/auth/origin', () => ({ isSameOrigin: () => isSameOrigin() }));
vi.mock('@/lib/auth/rbac/repo', () => ({
  getOpsRepo: () => ({ findUserBySupabaseId, findUserById }),
}));
// The claim reader is driven by the cookie store on purpose. A Supabase
// session exists exactly as long as its cookie does, so a logout that fails to
// clear the cookie leaves this returning a claim — and the refusal proofs at
// the bottom fail, as they should.
vi.mock('@/lib/auth/rbac/supabaseClaims', () => ({
  OPS_ROLE_CLAIM: 'ops_role',
  readSupabaseOpsClaim: async () => {
    const cookie = store.get(SUPABASE_COOKIE);
    if (!cookie?.value) return null;
    return {
      supabaseUserId: SUPABASE_USER_ID,
      email: 'operator@olympuss.local',
      roleClaim: 'control_room' as const,
      iat: 1_770_000_000,
      exp: 1_770_003_600,
    };
  },
}));

const { POST } = await import('@/app/api/ops/auth/logout/route');
const { POST: frontDoorPOST } = await import('@/app/api/auth/logout/route');
const { resolveOpsSession } = await import('@/lib/auth/rbac/server');
const { OPS_SESSION_COOKIE } = await import('@/lib/auth/rbac/config');
const { createOpsSessionToken } = await import('@/lib/auth/rbac/session');

const SUPABASE_COOKIE = 'sb-abcdefghijklmnop-auth-token';
const SUPABASE_USER_ID = '99999999-9999-9999-9999-999999999999';
const OPS_USER_ID = '11111111-1111-1111-1111-111111111111';

function operator(): OpsUserRecord {
  return {
    id: OPS_USER_ID,
    email: 'operator@olympuss.local',
    name: 'An Operator',
    role: 'control_room',
    passwordHash: 'supabase-managed:no-local-password',
    status: 'active',
    vehicleId: null,
    supabaseUserId: SUPABASE_USER_ID,
    createdAt: new Date('2026-08-12T00:00:00Z').toISOString(),
  };
}

function logoutRequest(): NextRequest {
  return new NextRequest('https://olympuss.test/api/ops/auth/logout', { method: 'POST' });
}

function frontDoorLogoutRequest(): NextRequest {
  return new NextRequest('https://olympuss.test/api/auth/logout', { method: 'POST' });
}

/** A browser holding both credentials — the state the cutover deliberately allows. */
async function signedInThroughBothDoors() {
  process.env.OPS_SESSION_SECRET = 'd'.repeat(40);
  store.seed(
    OPS_SESSION_COOKIE,
    await createOpsSessionToken({
      id: OPS_USER_ID,
      email: 'operator@olympuss.local',
      role: 'control_room',
    }),
  );
  store.seed(SUPABASE_COOKIE, 'base64-eyJhY2Nlc3NfdG9rZW4iOiJ4In0');
}

beforeEach(() => {
  vi.clearAllMocks();
  store.reset();
  process.env.OPS_SESSION_SECRET = 'd'.repeat(40);
  isSameOrigin.mockReturnValue(true);
  signOut.mockResolvedValue({ error: null });
  createSupabaseServerClient.mockResolvedValue({ auth: { signOut } });
  findUserBySupabaseId.mockResolvedValue(operator());
  findUserById.mockResolvedValue(operator());
});

describe('POST /api/ops/auth/logout ends both sessions', () => {
  it('revokes the Supabase session and expires both credentials', async () => {
    await signedInThroughBothDoors();

    const response = await POST(logoutRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, supabase: 'signed_out' });
    // Global scope by default — the operator's other devices go too.
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(signOut).toHaveBeenCalledWith();
    expect(store.get(OPS_SESSION_COOKIE)?.value).toBe('');
    expect(store.get(SUPABASE_COOKIE)?.value).toBe('');
  });

  it('expires the Supabase cookie with maxAge 0 on the whole site, not just this path', async () => {
    await signedInThroughBothDoors();

    await POST(logoutRequest());

    const expiry = store.writes.find((write) => write.name === SUPABASE_COOKIE);
    expect(expiry).toBeDefined();
    expect(expiry?.value).toBe('');
    expect(expiry?.options).toMatchObject({ path: '/', maxAge: 0 });
  });

  it('clears chunked Supabase cookies, not only the unchunked name', async () => {
    await signedInThroughBothDoors();
    store.seed(`${SUPABASE_COOKIE}.0`, 'chunk-one');
    store.seed(`${SUPABASE_COOKIE}.1`, 'chunk-two');

    await POST(logoutRequest());

    expect(store.get(`${SUPABASE_COOKIE}.0`)?.value).toBe('');
    expect(store.get(`${SUPABASE_COOKIE}.1`)?.value).toBe('');
  });

  it('still ends the session on this device when Supabase cannot be reached', async () => {
    await signedInThroughBothDoors();
    createSupabaseServerClient.mockRejectedValue(new Error('fetch failed'));

    const response = await POST(logoutRequest());
    const body = await response.json();

    // Degraded to "ended here", never to "did nothing" — and it says which.
    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, supabase: 'revoke_failed' });
    expect(store.get(SUPABASE_COOKIE)?.value).toBe('');
    expect(store.get(OPS_SESSION_COOKIE)?.value).toBe('');
  });

  it('reports a configuration failure as configuration, not as a revoke failure', async () => {
    await signedInThroughBothDoors();
    createSupabaseServerClient.mockRejectedValue(
      new Error('NEXT_PUBLIC_SUPABASE_URL is not configured'),
    );

    const body = await (await POST(logoutRequest())).json();

    expect(body).toEqual({ ok: true, supabase: 'not_configured' });
    expect(store.get(SUPABASE_COOKIE)?.value).toBe('');
  });

  it('does not call Supabase at all for a legacy-only session', async () => {
    process.env.OPS_SESSION_SECRET = 'd'.repeat(40);
    store.seed(
      OPS_SESSION_COOKIE,
      await createOpsSessionToken({
        id: OPS_USER_ID,
        email: 'operator@olympuss.local',
        role: 'control_room',
      }),
    );

    const body = await (await POST(logoutRequest())).json();

    expect(body).toEqual({ ok: true, supabase: 'no_session' });
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
    expect(store.get(OPS_SESSION_COOKIE)?.value).toBe('');
  });

  it('refuses to claim success when a credential survives', async () => {
    await signedInThroughBothDoors();
    // Nothing can be written — the closest reproduction of "the cookie is
    // still there when the response goes out".
    store.readOnly = true;

    const response = await POST(logoutRequest());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('SIGN_OUT_INCOMPLETE');
    // The names of the surviving cookies never reach the client, and neither
    // does any value.
    expect(JSON.stringify(body)).not.toContain(SUPABASE_COOKIE);
  });

  it('rejects a cross-origin logout without touching the session', async () => {
    await signedInThroughBothDoors();
    const before = store.get(SUPABASE_COOKIE)?.value;
    isSameOrigin.mockReturnValue(false);

    const response = await POST(logoutRequest());

    expect(response.status).toBe(403);
    expect(signOut).not.toHaveBeenCalled();
    // A forged logout is a nuisance, not a vulnerability — but it must not be
    // able to sign an operator out of a live control surface either.
    expect(store.get(SUPABASE_COOKIE)?.value).toBe(before);
    expect(store.writes).toHaveLength(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// THE OTHER BUTTON
// ───────────────────────────────────────────────────────────────────────────

/**
 * /login has a Sign Out button too, and it had the mirror of the same defect:
 * POST /api/auth/logout called `supabase.auth.signOut()` and never touched the
 * legacy cookie. An operator who came in through /ops/login and signed out
 * here was told they were signed out while still holding a credential that
 * resolves to a real, active ops profile — and, since the project surface is
 * gated on that same profile, one that still opens /project/*.
 *
 * Both buttons now go through the one module, so these are the same
 * assertions asked of the other door.
 */
describe('POST /api/auth/logout ends both sessions too', () => {
  it('clears the legacy ops cookie, which it used to leave completely alone', async () => {
    await signedInThroughBothDoors();

    const response = await frontDoorPOST(frontDoorLogoutRequest());

    expect(response.status).toBe(200);
    expect(store.get(OPS_SESSION_COOKIE)?.value ?? '').toBe('');
    expect(signOut).toHaveBeenCalled();
    expect(store.get(SUPABASE_COOKIE)?.value ?? '').toBe('');
  });

  it('leaves no resolvable ops session behind on the very next request', async () => {
    await signedInThroughBothDoors();
    // Precondition: this store really does resolve to an operator right now.
    expect(await resolveOpsSession()).toMatchObject({ ok: true });

    await frontDoorPOST(frontDoorLogoutRequest());

    expect(await resolveOpsSession()).toEqual({ ok: false, reason: 'no_session' });
  });

  it('refuses to claim success when a credential survives', async () => {
    await signedInThroughBothDoors();
    store.readOnly = true;

    const response = await frontDoorPOST(frontDoorLogoutRequest());

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: { code: 'SIGN_OUT_INCOMPLETE' },
    });
  });

  it('rejects a cross-origin logout without touching the session', async () => {
    await signedInThroughBothDoors();
    isSameOrigin.mockReturnValue(false);

    const response = await frontDoorPOST(frontDoorLogoutRequest());

    expect(response.status).toBe(403);
    expect(signOut).not.toHaveBeenCalled();
    expect(store.get(OPS_SESSION_COOKIE)?.value ?? '').not.toBe('');
  });
});

describe('a signed-out operator is genuinely refused, not merely redirected', () => {
  it('resolves to no session at all on the very next request', async () => {
    await signedInThroughBothDoors();

    // Before: this browser is a working ops session.
    const before = await resolveOpsSession();
    expect(before.ok).toBe(true);

    await POST(logoutRequest());

    const after = await resolveOpsSession();
    expect(after.ok).toBe(false);
    if (after.ok) return;
    // `no_session`, not `no_profile`: both credentials are gone, so there is
    // nothing left to look a profile up by.
    expect(after.reason).toBe('no_session');
  });

  it('is refused even when only the Supabase door was used', async () => {
    store.seed(SUPABASE_COOKIE, 'base64-eyJhY2Nlc3NfdG9rZW4iOiJ4In0');

    expect((await resolveOpsSession()).ok).toBe(true);
    await POST(logoutRequest());

    const after = await resolveOpsSession();
    expect(after.ok).toBe(false);
    if (after.ok) return;
    expect(after.reason).toBe('no_session');
  });

  it('is refused by the API guard every ops route uses', async () => {
    await signedInThroughBothDoors();
    await POST(logoutRequest());

    const { requireOpsSession, requireOpsRole } = await import('@/lib/auth/rbac/guard');

    const anyRoute = await requireOpsSession();
    expect(anyRoute.ok).toBe(false);
    if (anyRoute.ok) return;
    expect(anyRoute.response.status).toBe(401);

    const theirOwnDashboardApi = await requireOpsRole(['control_room']);
    expect(theirOwnDashboardApi.ok).toBe(false);
    if (theirOwnDashboardApi.ok) return;
    expect(theirOwnDashboardApi.response.status).toBe(401);
    expect((await theirOwnDashboardApi.response.json()).error.code).toBe('UNAUTHORIZED');
  });
});
