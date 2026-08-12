// @vitest-environment node
//
// Middleware after the front doors are collapsed: the ops role now arrives in
// a Supabase access token (app_metadata.ops_role) as well as in the legacy ops
// cookie, and BOTH must behave identically at the edge.
//
// The companion file opsMiddlewareRoleGate.test.ts already drives the real
// middleware with real signed LEGACY cookies and is deliberately unmocked.
// This file is its Supabase twin: same paths, same expectations, different
// front door — so the OPS_API_ROLE_OVERRIDES ceiling and the
// pages-keep-strict-equality rule cannot be preserved on one path and quietly
// lost on the other.
//
// The Supabase claim is mocked at src/lib/auth/rbac/supabaseClaims.ts rather
// than by minting real ES256 tokens: that module's own verification, caching
// and fail-closed behaviour is proven directly in
// opsSupabaseClaimCeiling.test.ts, and re-proving it here would test the SDK
// instead of the wiring.
import { NextRequest, NextResponse } from 'next/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseOpsClaim } from '@/lib/auth/rbac/supabaseClaims';
import type { OpsRole } from '@/lib/auth/rbac/roles';

const readSupabaseOpsClaim = vi.fn<() => Promise<SupabaseOpsClaim | null>>();

vi.mock('@/lib/auth/rbac/supabaseClaims', () => ({
  readSupabaseOpsClaim: () => readSupabaseOpsClaim(),
  OPS_ROLE_CLAIM: 'ops_role',
}));
vi.mock('@/lib/supabase/middleware', () => ({
  createMiddlewareSupabaseClient: () => ({
    supabase: {} as unknown,
    supabaseResponse: NextResponse.next(),
  }),
  getMiddlewareUser: async () => null,
}));

const { createOpsSessionToken } = await import('@/lib/auth/rbac/session');
const { OPS_SESSION_COOKIE } = await import('@/lib/auth/rbac/config');

function claim(roleClaim: OpsRole | null): SupabaseOpsClaim {
  return {
    supabaseUserId: '99999999-9999-9999-9999-999999999999',
    email: 'operator@olympuss.local',
    roleClaim,
    iat: 1_770_000_000,
    exp: 1_770_003_600,
  };
}

async function request(
  path: string,
  { method = 'GET', legacyRole }: { method?: string; legacyRole?: OpsRole } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (legacyRole) {
    const token = await createOpsSessionToken({
      id: 'ops-user',
      email: `${legacyRole}@olympuss.local`,
      role: legacyRole,
    });
    headers.cookie = `${OPS_SESSION_COOKIE}=${token}`;
  }
  const { middleware } = await import('@/middleware');
  return middleware(new NextRequest(`http://localhost:3000${path}`, { method, headers }));
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.OPS_SESSION_SECRET = 'e'.repeat(40);
  readSupabaseOpsClaim.mockResolvedValue(null);
});

describe('a Supabase session carries the ops ceiling', () => {
  it('lets the matching role through to its own page', async () => {
    readSupabaseOpsClaim.mockResolvedValue(claim('dispatcher'));
    const response = await request('/ops/dispatcher');
    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it('keeps pages on strict equality — a wider API override never widens a page', async () => {
    // GET /api/ops/dispatcher/approvals deliberately admits control_room, but
    // /ops/dispatcher is one role's screen and nothing may widen it.
    readSupabaseOpsClaim.mockResolvedValue(claim('control_room'));
    const response = await request('/ops/dispatcher');
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('/ops/forbidden');
  });

  it('honours OPS_API_ROLE_OVERRIDES for a Supabase claim, exactly as for the legacy cookie', async () => {
    readSupabaseOpsClaim.mockResolvedValue(claim('control_room'));
    expect((await request('/api/ops/dispatcher/approvals')).status).toBe(200);

    readSupabaseOpsClaim.mockResolvedValue(claim('planner'));
    const denied = await request('/api/ops/dispatcher/approvals');
    expect(denied.status).toBe(403);
    expect((await denied.json()).error.code).toBe('FORBIDDEN');
  });

  it('requires authentication on an /api/ops/* path the override map cannot classify', async () => {
    expect((await request('/api/ops/fleet/incidents')).status).toBe(401);

    readSupabaseOpsClaim.mockResolvedValue(claim('control_room'));
    expect((await request('/api/ops/fleet/incidents')).status).toBe(200);
  });
});

describe('fail closed at the edge', () => {
  it('gives a signed-in Supabase user with NO ops role claim no ops access at all', async () => {
    // The live exposure this closes: any Supabase account — including a plain
    // project viewer — used to be irrelevant to /ops/*, and must stay
    // irrelevant now that the two front doors share a session.
    readSupabaseOpsClaim.mockResolvedValue(claim(null));

    const api = await request('/api/ops/control-room/commands');
    expect(api.status).toBe(401);
    expect((await api.json()).error.code).toBe('UNAUTHORIZED');

    const page = await request('/ops/control-room');
    expect(page.status).toBe(307);
    expect(page.headers.get('location')).toContain('/ops/login');
  });

  it('does not let a Supabase claim reach a role it does not name', async () => {
    readSupabaseOpsClaim.mockResolvedValue(claim('driver'));
    expect((await request('/api/ops/admin/users')).status).toBe(403);
    expect((await request('/ops/admin')).headers.get('location')).toContain('/ops/forbidden');
  });
});

describe('dual-accept — the legacy door stays open until the cutover is proven', () => {
  it('accepts the legacy ops cookie when there is no Supabase session', async () => {
    expect((await request('/ops/planner', { legacyRole: 'planner' })).status).toBe(200);
  });

  it('accepts the legacy ops cookie even while a Supabase session with no ops claim is present', async () => {
    // An operator signed in to the project surface as a plain viewer must not
    // be locked out of the old ops login by that fact alone.
    readSupabaseOpsClaim.mockResolvedValue(claim(null));
    expect((await request('/ops/planner', { legacyRole: 'planner' })).status).toBe(200);
  });

  it('prefers the Supabase claim when both are present and it carries a role', async () => {
    readSupabaseOpsClaim.mockResolvedValue(claim('planner'));
    const response = await request('/ops/dispatcher', { legacyRole: 'dispatcher' });
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('/ops/forbidden');
  });
});
