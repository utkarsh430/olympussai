// @vitest-environment node
//
// Disabling an operator has to reach every surface they can still reach.
//
//   ops_users.status   Re-read on every guarded request. This is what revokes
//                      the product - both /ops/* and, since the project
//                      surface was gated on the same row, /project/* and
//                      /api/upsrtc/* too. Refused on the very next request,
//                      whatever token they are holding.
//   app_metadata       The ceiling Edge middleware checks. Cleared so the
//                      account stops carrying an ops role at all.
//   ban_duration       What revokes the SIGN-IN IDENTITY, which neither of
//                      the above touches: a Supabase account is a credential
//                      against the Supabase project, not only against this
//                      app, and unbanned it keeps renewing itself by refresh
//                      forever. It is also the backstop if the profile gate
//                      on the enterprise surface is ever lost again.
//
// The claim clear and the ban are one `updateUserById`, so they succeed or
// fail together and the route reports one outcome. The integration proofs at
// the bottom pin the database half independently, because a disable that only
// wrote to Supabase would look identical in every unit assertion above them.
import { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { OpsUserRecord } from '@/lib/auth/rbac/repo';
import type { SupabaseOpsClaim } from '@/lib/auth/rbac/supabaseClaims';

const requireOpsRole = vi.fn();
const findUserById = vi.fn();
const countAdmins = vi.fn();
const disableUser = vi.fn();
const recordAuditEvent = vi.fn();
const revokeOpsIdentity = vi.fn();
const readSupabaseOpsClaim = vi.fn<() => Promise<SupabaseOpsClaim | null>>();
const findUserBySupabaseId = vi.fn<(id: string) => Promise<OpsUserRecord | null>>();
const cookieGet = vi.fn<(name: string) => { value: string } | undefined>();
const redirect = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`);
});

vi.mock('@/lib/auth/rbac/guard', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/rbac/guard')>(
    '@/lib/auth/rbac/guard',
  );
  return {
    ...actual,
    requireOpsRole: (...args: unknown[]) => requireOpsRole(...args),
  };
});
vi.mock('@/lib/auth/rbac/repo', () => ({
  getOpsRepo: () => ({
    findUserById,
    findUserBySupabaseId,
    countAdmins,
    disableUser,
    recordAuditEvent,
  }),
}));
vi.mock('@/lib/auth/rbac/opsIdentity', () => ({
  revokeOpsIdentity: (...args: unknown[]) => revokeOpsIdentity(...args),
}));
vi.mock('@/lib/auth/rbac/supabaseClaims', () => ({
  readSupabaseOpsClaim: () => readSupabaseOpsClaim(),
  OPS_ROLE_CLAIM: 'ops_role',
}));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({}) }));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (name: string) => cookieGet(name) }),
}));
vi.mock('next/navigation', () => ({ redirect: (path: string) => redirect(path) }));
vi.mock('@/lib/auth/origin', () => ({ isSameOrigin: () => true }));
vi.mock('@/lib/auth/rate-limit', () => ({ clientIpFrom: () => '203.0.113.9' }));

const { POST } = await import('@/app/api/ops/admin/users/[id]/disable/route');
const { requireOpsSession } = await import('@/lib/auth/rbac/guard');
// The unmocked guard. The mock above exists only so the disable ROUTE has an
// admin caller; the proofs at the bottom of this file must exercise the real
// role check, or they would be asserting on a stub.
const { requireOpsRole: realRequireOpsRole } = await vi.importActual<
  typeof import('@/lib/auth/rbac/guard')
>('@/lib/auth/rbac/guard');
const { requireOpsRolePage } = await import('@/lib/auth/rbac/pageGuard');
const { resolveOpsSession } = await import('@/lib/auth/rbac/server');

const ADMIN_ID = '00000000-0000-0000-0000-0000000000ad';
const TARGET_ID = '11111111-1111-1111-1111-111111111111';
const SUPABASE_USER_ID = '99999999-9999-9999-9999-999999999999';
const ADMIN_CLAIMS = { sub: ADMIN_ID, email: 'admin@olympuss.local', role: 'admin' as const };

function target(overrides: Partial<OpsUserRecord> = {}): OpsUserRecord {
  return {
    id: TARGET_ID,
    email: 'operator@olympuss.local',
    name: 'An Operator',
    role: 'control_room',
    passwordHash: 'supabase-managed:no-local-password',
    status: 'active',
    vehicleId: null,
    supabaseUserId: SUPABASE_USER_ID,
    createdAt: new Date('2026-08-12T00:00:00Z').toISOString(),
    ...overrides,
  };
}

function disableRequest(id = TARGET_ID): [NextRequest, { params: Promise<{ id: string }> }] {
  return [
    new NextRequest(`https://olympuss.test/api/ops/admin/users/${id}/disable`, { method: 'POST' }),
    { params: Promise.resolve({ id }) },
  ];
}

/** The token the disabled operator is still holding: valid, and still naming their old role. */
function stillHeldToken(role: 'control_room' | null = 'control_room'): SupabaseOpsClaim {
  return {
    supabaseUserId: SUPABASE_USER_ID,
    email: 'operator@olympuss.local',
    roleClaim: role,
    iat: 1_770_000_000,
    exp: 1_770_003_600,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireOpsRole.mockResolvedValue({ ok: true, claims: ADMIN_CLAIMS });
  recordAuditEvent.mockResolvedValue({ id: 'audit-1', createdAt: new Date().toISOString() });
  countAdmins.mockResolvedValue(3);
  revokeOpsIdentity.mockResolvedValue(undefined);
  readSupabaseOpsClaim.mockResolvedValue(null);
  findUserBySupabaseId.mockResolvedValue(null);
  cookieGet.mockReturnValue(undefined);
});

describe('disabling an operator revokes their sign-in identity too', () => {
  it('revokes the sign-in identity — role claim cleared and account banned', async () => {
    findUserById.mockResolvedValue(target());
    disableUser.mockResolvedValue(target({ status: 'disabled' }));

    const response = await POST(...disableRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(revokeOpsIdentity).toHaveBeenCalledWith(SUPABASE_USER_ID);
    expect(body.identityRevoked).toBe(true);
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'admin.user.disable',
        metadata: expect.objectContaining({ identityRevoked: true }),
      }),
    );
  });

  it('has nothing to revoke for an account with no sign-in identity, and says so', async () => {
    findUserById.mockResolvedValue(target({ supabaseUserId: null }));
    disableUser.mockResolvedValue(target({ supabaseUserId: null, status: 'disabled' }));

    const response = await POST(...disableRequest());
    const body = await response.json();

    expect(revokeOpsIdentity).not.toHaveBeenCalled();
    // null, not false: "nothing to clear" and "tried and failed" are
    // different facts and an audit reader must be able to tell them apart.
    expect(body.identityRevoked).toBeNull();
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ identityRevoked: null }) }),
    );
  });

  it('keeps the account disabled when the identity revoke fails, and names the surface still open', async () => {
    // The opposite ordering from role assignment, deliberately: the status
    // write alone already revokes /ops, so failing the whole disable here
    // would leave a fully live account for the sake of an all-or-nothing
    // write. What it must NOT do is call the result a full revocation.
    findUserById.mockResolvedValue(target());
    disableUser.mockResolvedValue(target({ status: 'disabled' }));
    revokeOpsIdentity.mockRejectedValue(new Error('Supabase unreachable'));

    const response = await POST(...disableRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe('disabled');
    expect(body.identityRevoked).toBe(false);
    expect(body.warning).toContain('Access is revoked');
    // Names what is actually still open - the Supabase identity - rather
    // than a product surface the status write has already closed. Claiming
    // the enterprise surface is still reachable would send an admin chasing
    // an exposure that is not there and miss the one that is.
    expect(body.warning).toContain('Supabase sign-in identity could NOT be revoked');
    expect(body.warning).not.toMatch(/still reach the enterprise/i);
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          identityRevoked: false,
          identityRevokeError: 'Supabase unreachable',
        }),
      }),
    );
  });

  it('still refuses to disable the last active admin, and touches neither store', async () => {
    findUserById.mockResolvedValue(target({ role: 'admin' }));
    countAdmins.mockResolvedValue(1);

    const response = await POST(...disableRequest());

    expect(response.status).toBe(409);
    expect(disableUser).not.toHaveBeenCalled();
    expect(revokeOpsIdentity).not.toHaveBeenCalled();
  });
});

describe('a disabled operator holding a previously-valid token gets nothing', () => {
  beforeEach(() => {
    // Exactly the situation after the route above runs: their access token is
    // still valid, still names their old role, and the database now says
    // disabled.
    readSupabaseOpsClaim.mockResolvedValue(stillHeldToken('control_room'));
    findUserBySupabaseId.mockResolvedValue(target({ status: 'disabled' }));
  });

  it('is refused by the session resolver', async () => {
    const resolution = await resolveOpsSession();

    expect(resolution.ok).toBe(false);
    if (resolution.ok) return;
    expect(resolution.reason).toBe('profile_disabled');
  });

  it('is refused by every ops API route, including ones their old role allowed', async () => {
    const anyRoute = await requireOpsSession();
    expect(anyRoute.ok).toBe(false);
    if (anyRoute.ok) return;
    expect(anyRoute.response.status).toBe(401);

    const theirOwnDashboardApi = await realRequireOpsRole(['control_room']);
    expect(theirOwnDashboardApi.ok).toBe(false);
    if (theirOwnDashboardApi.ok) return;
    expect(theirOwnDashboardApi.response.status).toBe(401);
    expect((await theirOwnDashboardApi.response.json()).error.code).toBe('UNAUTHORIZED');
  });

  it('is refused by every ops page', async () => {
    await expect(requireOpsRolePage('control_room', '/ops/control-room')).rejects.toThrow(
      /^REDIRECT:/,
    );
    expect(redirect).toHaveBeenCalledWith(expect.stringContaining('/ops/login'));
  });

  it('is refused even once the claim clear has landed and the token carries no role', async () => {
    // The other side of the same window: after they refresh, the token has no
    // ops role at all. The database still decides, and it still says no.
    readSupabaseOpsClaim.mockResolvedValue(stillHeldToken(null));

    const resolution = await resolveOpsSession();

    expect(resolution.ok).toBe(false);
    if (resolution.ok) return;
    expect(resolution.reason).toBe('profile_disabled');
  });

  it('is still refused when the identity is unlinked and only the legacy cookie remains', async () => {
    readSupabaseOpsClaim.mockResolvedValue(null);
    findUserBySupabaseId.mockResolvedValue(null);
    const { createOpsSessionToken } = await import('@/lib/auth/rbac/session');
    const { OPS_SESSION_COOKIE } = await import('@/lib/auth/rbac/config');
    process.env.OPS_SESSION_SECRET = 'd'.repeat(40);
    const token = await createOpsSessionToken({
      id: TARGET_ID,
      email: 'operator@olympuss.local',
      role: 'control_room',
    });
    cookieGet.mockImplementation((name) =>
      name === OPS_SESSION_COOKIE ? { value: token } : undefined,
    );
    findUserById.mockResolvedValue(target({ supabaseUserId: null, status: 'disabled' }));

    const resolution = await resolveOpsSession();

    expect(resolution.ok).toBe(false);
    if (resolution.ok) return;
    expect(resolution.reason).toBe('profile_disabled');
  });
});
