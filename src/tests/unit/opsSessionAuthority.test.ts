// @vitest-environment node
//
// The database-is-the-authority half of collapsing the two auth systems.
//
// Before this, the ops token WAS the entire authority: getOpsSession()
// verified a cookie and returned its claims, and nothing on the request path
// ever read ops_users. ops_users.status was checked only at login, so a
// disabled operator kept full dispatch/command authority until their 4h token
// happened to expire — and nothing anywhere logged it.
//
// Every test below is a proof about the THREE ways a token can be ahead of
// the database, all of which must end in no access:
//
//   1. the identity has no linked ops_users row at all,
//   2. the linked row is disabled,
//   3. the row exists and is active but its role disagrees with the claim.
//
// Plus the regression that would silently corrupt the audit trail: the claims
// handed back must carry ops_users.id in `sub`, never the Supabase user id.
// 27 call sites write that value straight into columns with a FK to
// ops_users(id), and one of them (control-service's dispatcher_id) has no FK
// at all to catch the mistake.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { OpsUserRecord } from '@/lib/auth/rbac/repo';
import type { SupabaseOpsClaim } from '@/lib/auth/rbac/supabaseClaims';
import type { OpsRole } from '@/lib/auth/rbac/roles';

const readSupabaseOpsClaim = vi.fn<() => Promise<SupabaseOpsClaim | null>>();
const findUserBySupabaseId = vi.fn<(id: string) => Promise<OpsUserRecord | null>>();
const findUserById = vi.fn<(id: string) => Promise<OpsUserRecord | null>>();
const cookieGet = vi.fn<(name: string) => { value: string } | undefined>();
const redirect = vi.fn((path: string) => {
  // next/navigation's redirect() never returns; modelling that is what lets
  // the page-guard tests assert on the destination instead of on a return
  // value the real function would never produce.
  throw new Error(`REDIRECT:${path}`);
});

vi.mock('@/lib/auth/rbac/supabaseClaims', () => ({
  readSupabaseOpsClaim: () => readSupabaseOpsClaim(),
  OPS_ROLE_CLAIM: 'ops_role',
}));
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({}),
}));
vi.mock('@/lib/auth/rbac/repo', () => ({
  getOpsRepo: () => ({
    findUserBySupabaseId: (id: string) => findUserBySupabaseId(id),
    findUserById: (id: string) => findUserById(id),
  }),
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (name: string) => cookieGet(name) }),
}));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => redirect(path),
}));

const { resolveOpsSession, getOpsSession } = await import('@/lib/auth/rbac/server');
const { requireOpsSession, requireOpsRole } = await import('@/lib/auth/rbac/guard');
const { requireOpsRolePage } = await import('@/lib/auth/rbac/pageGuard');
const { createOpsSessionToken } = await import('@/lib/auth/rbac/session');
const { OPS_SESSION_COOKIE } = await import('@/lib/auth/rbac/config');

const OPS_USER_ID = '11111111-1111-1111-1111-111111111111';
const SUPABASE_USER_ID = '99999999-9999-9999-9999-999999999999';

function profile(overrides: Partial<OpsUserRecord> = {}): OpsUserRecord {
  return {
    id: OPS_USER_ID,
    email: 'dispatcher@olympuss.local',
    name: 'A Dispatcher',
    role: 'dispatcher',
    passwordHash: '$2a$10$notarealhash',
    status: 'active',
    vehicleId: null,
    supabaseUserId: SUPABASE_USER_ID,
    createdAt: new Date('2026-01-01T00:00:00Z').toISOString(),
    ...overrides,
  };
}

function supabaseClaim(roleClaim: OpsRole | null): SupabaseOpsClaim {
  return {
    supabaseUserId: SUPABASE_USER_ID,
    email: 'dispatcher@olympuss.local',
    roleClaim,
    iat: 1_770_000_000,
    exp: 1_770_003_600,
  };
}

/** Puts a real signed legacy ops cookie on the request, with no Supabase session. */
async function signedInWithLegacyCookie(role: OpsRole): Promise<void> {
  readSupabaseOpsClaim.mockResolvedValue(null);
  const token = await createOpsSessionToken({ id: OPS_USER_ID, email: 'x@olympuss.local', role });
  cookieGet.mockImplementation((name) => (name === OPS_SESSION_COOKIE ? { value: token } : undefined));
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.OPS_SESSION_SECRET = 'd'.repeat(40);
  readSupabaseOpsClaim.mockResolvedValue(null);
  findUserBySupabaseId.mockResolvedValue(null);
  findUserById.mockResolvedValue(null);
  cookieGet.mockReturnValue(undefined);
});

describe('ops session authority — the identity handed to callers', () => {
  it('resolves a Supabase session to its ops profile and returns ops_users.id in sub, NOT the Supabase id', async () => {
    readSupabaseOpsClaim.mockResolvedValue(supabaseClaim('dispatcher'));
    findUserBySupabaseId.mockResolvedValue(profile());

    const resolution = await resolveOpsSession();

    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(findUserBySupabaseId).toHaveBeenCalledWith(SUPABASE_USER_ID);
    // The whole point: 27 call sites write this into ops_users FK columns.
    expect(resolution.claims.sub).toBe(OPS_USER_ID);
    expect(resolution.claims.sub).not.toBe(SUPABASE_USER_ID);
    // The Supabase id is still reachable, just never confusable with sub.
    expect(resolution.claims.supabaseUserId).toBe(SUPABASE_USER_ID);
  });

  it('takes the role from the database row, not from the token', async () => {
    readSupabaseOpsClaim.mockResolvedValue(supabaseClaim(null));
    findUserBySupabaseId.mockResolvedValue(profile({ role: 'control_room' }));

    const claims = await getOpsSession();
    expect(claims?.role).toBe('control_room');
  });

  it('reads the profile on EVERY call — the token is never allowed to stand in for it', async () => {
    readSupabaseOpsClaim.mockResolvedValue(supabaseClaim('dispatcher'));
    findUserBySupabaseId.mockResolvedValue(profile());

    await getOpsSession();
    await getOpsSession();

    expect(findUserBySupabaseId).toHaveBeenCalledTimes(2);
  });
});

describe('fail closed 1/3 — an identity with no linked ops profile gets no access', () => {
  it('refuses a signed-in Supabase user who has no ops_users row (an ordinary project viewer)', async () => {
    readSupabaseOpsClaim.mockResolvedValue(supabaseClaim('admin'));
    findUserBySupabaseId.mockResolvedValue(null);

    const resolution = await resolveOpsSession();
    expect(resolution).toEqual({ ok: false, reason: 'no_profile' });
    expect(await getOpsSession()).toBeNull();
  });

  it('401s that user at the API guard rather than crashing or admitting them', async () => {
    readSupabaseOpsClaim.mockResolvedValue(supabaseClaim('admin'));
    findUserBySupabaseId.mockResolvedValue(null);

    const guard = await requireOpsSession();
    expect(guard.ok).toBe(false);
    if (guard.ok) return;
    expect(guard.response.status).toBe(401);
    expect((await guard.response.json()).error.code).toBe('UNAUTHORIZED');
  });

  it('sends that user to sign in rather than to a dead-end forbidden page', async () => {
    readSupabaseOpsClaim.mockResolvedValue(supabaseClaim('admin'));
    findUserBySupabaseId.mockResolvedValue(null);

    await expect(requireOpsRolePage('admin', '/ops/admin')).rejects.toThrow(
      'REDIRECT:/ops/login?next=%2Fops%2Fadmin',
    );
  });

  it('refuses a legacy cookie whose ops_users row no longer exists', async () => {
    await signedInWithLegacyCookie('dispatcher');
    findUserById.mockResolvedValue(null);

    expect(await resolveOpsSession()).toEqual({ ok: false, reason: 'no_profile' });
  });
});

describe('fail closed 2/3 — a disabled profile gets no access, on its very next request', () => {
  it('refuses a disabled account arriving through Supabase', async () => {
    readSupabaseOpsClaim.mockResolvedValue(supabaseClaim('dispatcher'));
    findUserBySupabaseId.mockResolvedValue(profile({ status: 'disabled' }));

    expect(await resolveOpsSession()).toEqual({ ok: false, reason: 'profile_disabled' });
  });

  it('refuses a disabled account still holding a valid, unexpired legacy ops token', async () => {
    // This is the pre-existing four-hour hole: the token below is genuinely
    // signed and genuinely unexpired, and used to be the entire authority.
    await signedInWithLegacyCookie('dispatcher');
    findUserById.mockResolvedValue(profile({ status: 'disabled' }));

    expect(await resolveOpsSession()).toEqual({ ok: false, reason: 'profile_disabled' });
  });

  it('401s a disabled account at the API guard', async () => {
    readSupabaseOpsClaim.mockResolvedValue(supabaseClaim('control_room'));
    findUserBySupabaseId.mockResolvedValue(profile({ role: 'control_room', status: 'disabled' }));

    const guard = await requireOpsRole(['control_room']);
    expect(guard.ok).toBe(false);
    if (guard.ok) return;
    expect(guard.response.status).toBe(401);
  });

  it('redirects a disabled account off every ops page', async () => {
    readSupabaseOpsClaim.mockResolvedValue(supabaseClaim('control_room'));
    findUserBySupabaseId.mockResolvedValue(profile({ role: 'control_room', status: 'disabled' }));

    await expect(requireOpsRolePage('control_room', '/ops/control-room')).rejects.toThrow(
      /REDIRECT:\/ops\/login/,
    );
  });
});

describe('fail closed 3/3 — a role claim that disagrees with the database gets no access', () => {
  it('refuses a token claiming a WIDER role than the database grants', async () => {
    readSupabaseOpsClaim.mockResolvedValue(supabaseClaim('admin'));
    findUserBySupabaseId.mockResolvedValue(profile({ role: 'driver' }));

    expect(await resolveOpsSession()).toEqual({ ok: false, reason: 'role_claim_mismatch' });
  });

  it('refuses a token claiming a NARROWER role than the database grants', async () => {
    // Denied too, deliberately: a disagreement means the two writers are out
    // of sync and picking either value is guessing. Signing in again mints a
    // correct claim, so this is self-healing rather than a lockout.
    readSupabaseOpsClaim.mockResolvedValue(supabaseClaim('driver'));
    findUserBySupabaseId.mockResolvedValue(profile({ role: 'admin' }));

    expect(await resolveOpsSession()).toEqual({ ok: false, reason: 'role_claim_mismatch' });
  });

  it('refuses a stale LEGACY cookie whose role no longer matches the database', async () => {
    await signedInWithLegacyCookie('admin');
    findUserById.mockResolvedValue(profile({ role: 'driver' }));

    expect(await resolveOpsSession()).toEqual({ ok: false, reason: 'role_claim_mismatch' });
  });

  it('answers with a distinct SESSION_STALE code so a client can tell it from "please sign in"', async () => {
    readSupabaseOpsClaim.mockResolvedValue(supabaseClaim('admin'));
    findUserBySupabaseId.mockResolvedValue(profile({ role: 'driver' }));

    const guard = await requireOpsRole(['driver']);
    expect(guard.ok).toBe(false);
    if (guard.ok) return;
    expect(guard.response.status).toBe(401);
    expect((await guard.response.json()).error.code).toBe('SESSION_STALE');
  });

  it('sends the user to re-authenticate rather than to /ops/forbidden', async () => {
    readSupabaseOpsClaim.mockResolvedValue(supabaseClaim('driver'));
    findUserBySupabaseId.mockResolvedValue(profile({ role: 'admin' }));

    await expect(requireOpsRolePage('admin', '/ops/admin')).rejects.toThrow(/REDIRECT:\/ops\/login/);
  });

  it('a token carrying NO ops role is not a mismatch — the database simply decides', async () => {
    // The transition case: every linked account looks like this until its
    // claim has been pushed. Treating "absent" as "disagrees" would refuse
    // everyone at once. Absent means no ceiling, and the edge has already
    // applied whatever ceiling let the request get this far.
    readSupabaseOpsClaim.mockResolvedValue(supabaseClaim(null));
    findUserBySupabaseId.mockResolvedValue(profile({ role: 'planner' }));

    const resolution = await resolveOpsSession();
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.claims.role).toBe('planner');
  });
});

describe('dual-accept window — both front doors keep working', () => {
  it('falls back to the legacy ops cookie when the Supabase identity has no ops profile yet', async () => {
    readSupabaseOpsClaim.mockResolvedValue(supabaseClaim(null));
    findUserBySupabaseId.mockResolvedValue(null);
    const token = await createOpsSessionToken({
      id: OPS_USER_ID,
      email: 'dispatcher@olympuss.local',
      role: 'dispatcher',
    });
    cookieGet.mockImplementation((name) =>
      name === OPS_SESSION_COOKIE ? { value: token } : undefined,
    );
    findUserById.mockResolvedValue(profile());

    const resolution = await resolveOpsSession();
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.claims.sub).toBe(OPS_USER_ID);
  });

  it('refuses with no_session when neither door yields anything', async () => {
    expect(await resolveOpsSession()).toEqual({ ok: false, reason: 'no_session' });
    expect(findUserById).not.toHaveBeenCalled();
    expect(findUserBySupabaseId).not.toHaveBeenCalled();
  });
});

describe('role decisions still come from requireOpsRole, using the database role', () => {
  it('403s a valid, active, agreeing session whose database role is outside the allowlist', async () => {
    readSupabaseOpsClaim.mockResolvedValue(supabaseClaim('driver'));
    findUserBySupabaseId.mockResolvedValue(profile({ role: 'driver' }));

    const guard = await requireOpsRole(['control_room', 'dispatcher']);
    expect(guard.ok).toBe(false);
    if (guard.ok) return;
    expect(guard.response.status).toBe(403);
    expect((await guard.response.json()).error.code).toBe('FORBIDDEN');
  });

  it('admits a session whose database role is in the allowlist', async () => {
    readSupabaseOpsClaim.mockResolvedValue(supabaseClaim('dispatcher'));
    findUserBySupabaseId.mockResolvedValue(profile());

    const guard = await requireOpsRole(['dispatcher', 'control_room']);
    expect(guard.ok).toBe(true);
    if (!guard.ok) return;
    expect(guard.claims.sub).toBe(OPS_USER_ID);
  });

  it('keeps pages on strict equality against the database role', async () => {
    readSupabaseOpsClaim.mockResolvedValue(supabaseClaim('control_room'));
    findUserBySupabaseId.mockResolvedValue(profile({ role: 'control_room' }));

    await expect(requireOpsRolePage('dispatcher', '/ops/dispatcher')).rejects.toThrow(
      'REDIRECT:/ops/forbidden',
    );
  });
});
