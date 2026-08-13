// @vitest-environment node
//
// WHO MAY OPEN THE ENTERPRISE SURFACE — /project/* and the /api/upsrtc/*
// feeds behind it.
//
// The defect these hold against: `requireUpsrtcAccess()` was literally
// `return getSupabaseUser()`, the dashboard layout checked `if (!user)`, and
// middleware's project branch was `if (user) return supabaseResponse`. Three
// checks, all asking the same question, none of which was an authorization
// question. The Supabase project accepts public self-signup, so the honest
// reading of that gate was "anyone who completed a registration form may open
// the UPSRTC command centre and read every vehicle's live position" — which
// is exactly what it did, measured end-to-end at 9,153 buses.
//
// Every test in the first three blocks FAILS against that implementation.
//
// The authority is mocked at src/lib/auth/rbac/server.ts rather than driven
// through a real Postgres: what is under test here is that each surface
// refuses each refusal reason, not `resolveOpsSession` itself, which is
// proved directly (and against a real database) in opsSessionAuthority.test.ts
// and opsDisableRevokesBothPaths.test.ts. Same seam and same reasoning as
// opsMiddlewareSupabaseCeiling.test.ts.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { OpsSessionResolution } from '@/lib/auth/rbac/server';
import type { OpsRole } from '@/lib/auth/rbac/roles';

const resolveOpsSession = vi.fn<() => Promise<OpsSessionResolution>>();

vi.mock('@/lib/auth/rbac/server', () => ({
  resolveOpsSession: () => resolveOpsSession(),
}));

function activeProfile(role: OpsRole = 'dispatcher'): OpsSessionResolution {
  return {
    ok: true,
    claims: {
      sub: '11111111-1111-1111-1111-111111111111',
      email: 'operator@olympuss.local',
      role,
      iat: 1_770_000_000,
      exp: 1_770_003_600,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  process.env.OPS_SESSION_SECRET = 'e'.repeat(40);
});

/* ------------------------------------------------------------------ *
 * The API guard — GET /api/upsrtc/live and /api/upsrtc/schedule.
 * ------------------------------------------------------------------ */

describe('requireUpsrtcAccess', () => {
  it('admits an active, linked ops profile', async () => {
    resolveOpsSession.mockResolvedValue(activeProfile());
    const { requireUpsrtcAccess } = await import('@/lib/auth/authorize');

    const guard = await requireUpsrtcAccess();

    expect(guard.ok).toBe(true);
    expect(guard.ok && guard.claims.role).toBe('dispatcher');
  });

  // THE LIVE HOLE. A stranger who self-signed-up holds a perfectly valid
  // Supabase session and no ops profile at all.
  it('refuses a signed-in Supabase user who has no ops profile', async () => {
    resolveOpsSession.mockResolvedValue({ ok: false, reason: 'no_profile' });
    const { requireUpsrtcAccess } = await import('@/lib/auth/authorize');

    const guard = await requireUpsrtcAccess();

    expect(guard.ok).toBe(false);
    expect(guard.ok === false && guard.response.status).toBe(401);
  });

  it('refuses a disabled profile on its very next request', async () => {
    resolveOpsSession.mockResolvedValue({ ok: false, reason: 'profile_disabled' });
    const { requireUpsrtcAccess } = await import('@/lib/auth/authorize');

    const guard = await requireUpsrtcAccess();

    expect(guard.ok === false && guard.response.status).toBe(401);
  });

  it('answers every caller-side refusal identically, so /login cannot enumerate accounts', async () => {
    const bodies: string[] = [];
    for (const reason of ['no_session', 'no_profile', 'profile_disabled'] as const) {
      resolveOpsSession.mockResolvedValue({ ok: false, reason });
      const { requireUpsrtcAccess } = await import('@/lib/auth/authorize');
      const guard = await requireUpsrtcAccess();
      expect(guard.ok).toBe(false);
      bodies.push(guard.ok === false ? await guard.response.text() : '');
    }

    expect(new Set(bodies).size).toBe(1);
    expect(bodies[0]).not.toMatch(/disabled|profile|linked/i);
  });

  it('turns an authority outage into a 503 refusal rather than an unhandled 500', async () => {
    // The authority reports an unreadable ops database as its own refusal
    // (`unavailable`, src/lib/auth/rbac/server.ts). Answered as 401 it would
    // send an operator to re-authenticate against a fault no session can fix;
    // left to throw it would be a 500 with a stack attached.
    resolveOpsSession.mockResolvedValue({ ok: false, reason: 'unavailable' });
    const { requireUpsrtcAccess } = await import('@/lib/auth/authorize');

    const guard = await requireUpsrtcAccess();

    expect(guard.ok).toBe(false);
    expect(guard.ok === false && guard.response.status).toBe(503);
  });
});

/* ------------------------------------------------------------------ *
 * The route handlers themselves, so the guard cannot be correct while
 * the routes forget to call it.
 * ------------------------------------------------------------------ */

describe('the UPSRTC feeds refuse before they fetch anything', () => {
  it('GET /api/upsrtc/live answers 401 and no vehicle data to a profile-less account', async () => {
    resolveOpsSession.mockResolvedValue({ ok: false, reason: 'no_profile' });
    const upstream = vi.fn();
    vi.stubGlobal('fetch', upstream);

    const { GET } = await import('@/app/api/upsrtc/live/route');
    const response = await GET(new NextRequest('http://localhost/api/upsrtc/live'));

    expect(response.status).toBe(401);
    expect(await response.text()).not.toMatch(/buses|registration|latitude/i);
    // Refused before the upstream was touched: an unauthorized caller must
    // not be able to drive traffic at the UPSRTC API either.
    expect(upstream).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('GET /api/upsrtc/schedule answers 401 to a profile-less account', async () => {
    resolveOpsSession.mockResolvedValue({ ok: false, reason: 'no_profile' });
    const upstream = vi.fn();
    vi.stubGlobal('fetch', upstream);

    const { GET } = await import('@/app/api/upsrtc/schedule/route');
    const response = await GET(
      new NextRequest('http://localhost/api/upsrtc/schedule?regNum=UP25FT4823'),
    );

    expect(response.status).toBe(401);
    expect(upstream).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

/* ------------------------------------------------------------------ *
 * The page guard.
 * ------------------------------------------------------------------ */

describe('requireProjectSurface', () => {
  /** next/navigation's redirect() throws; catch it and read the target. */
  async function redirectTargetOf(reason: 'no_session' | 'no_profile' | 'profile_disabled' | 'role_claim_mismatch') {
    resolveOpsSession.mockResolvedValue({ ok: false, reason });
    const { requireProjectSurface } = await import('@/lib/auth/projectPageGuard');
    try {
      await requireProjectSurface('/project/upsrtc');
    } catch (error) {
      const digest = (error as { digest?: string }).digest ?? '';
      return digest;
    }
    throw new Error(`requireProjectSurface returned instead of refusing ${reason}`);
  }

  it('renders for an active profile', async () => {
    resolveOpsSession.mockResolvedValue(activeProfile('depot'));
    const { requireProjectSurface } = await import('@/lib/auth/projectPageGuard');

    await expect(requireProjectSurface('/project/upsrtc')).resolves.toMatchObject({ role: 'depot' });
  });

  it('sends an unauthenticated request to sign in, keeping the deep link', async () => {
    expect(await redirectTargetOf('no_session')).toContain('/login?next=%2Fproject%2Fupsrtc');
  });

  it('sends a stale role claim to sign in, because signing in again mints a correct one', async () => {
    expect(await redirectTargetOf('role_claim_mismatch')).toContain('/login?next=%2Fproject%2Fupsrtc');
  });

  // The distinction that keeps this from being a loop: a signed-in account
  // with no usable profile must NOT be handed `next` back, or /login will
  // honour it, this guard will refuse again, and the product will look broken
  // while behaving correctly.
  it('sends a profile-less account to a terminal explanation, without a next to bounce off', async () => {
    const target = await redirectTargetOf('no_profile');
    expect(target).toContain('/login?notice=no-ops-access');
    expect(target).not.toContain('next=');
  });

  it('sends a disabled account to the same explanation, which names no reason', async () => {
    const target = await redirectTargetOf('profile_disabled');
    expect(target).toContain('/login?notice=no-ops-access');
    expect(target).not.toMatch(/disabled/);
  });

  it('sends an authority outage to the outage page, not to sign-in and not to a stack trace', async () => {
    // Both surfaces are gated on the same row, so both get the same honest
    // explanation. /login would blame the account; throwing would answer an
    // outage with a 500, which is the very shape being removed here.
    resolveOpsSession.mockResolvedValue({ ok: false, reason: 'unavailable' });
    const { requireProjectSurface } = await import('@/lib/auth/projectPageGuard');
    const { OPS_UNAVAILABLE_PATH } = await import('@/lib/auth/rbac/pageGuard');

    let digest = '';
    try {
      await requireProjectSurface('/project/upsrtc');
    } catch (error) {
      digest = (error as { digest?: string }).digest ?? '';
    }

    expect(digest).toContain(`${OPS_UNAVAILABLE_PATH}?next=%2Fproject%2Fupsrtc`);
    expect(digest).not.toContain('/login');
  });
});

/* ------------------------------------------------------------------ *
 * Edge middleware. It decides nothing — but it must not refuse what the
 * authority would admit, and it must still turn away a request carrying
 * no credential at all.
 * ------------------------------------------------------------------ */

describe('the middleware ceiling for /project/* and /api/upsrtc/*', () => {
  const middlewareUser = vi.fn<() => Promise<{ id: string } | null>>();

  beforeEach(() => {
    vi.doMock('@/lib/supabase/middleware', () => ({
      createMiddlewareSupabaseClient: () => ({
        supabase: {} as unknown,
        supabaseResponse: NextResponse.next(),
      }),
      getMiddlewareUser: () => middlewareUser(),
    }));
    vi.doMock('@/lib/auth/rbac/supabaseClaims', () => ({
      readSupabaseOpsClaim: async () => null,
      OPS_ROLE_CLAIM: 'ops_role',
    }));
    middlewareUser.mockResolvedValue(null);
  });

  async function request(path: string, cookie?: string): Promise<Response> {
    const { middleware } = await import('@/middleware');
    return middleware(
      new NextRequest(`http://localhost:3000${path}`, {
        headers: cookie ? { cookie } : {},
      }),
    );
  }

  it('redirects a credential-less page request to /login, carrying the deep link', async () => {
    const response = await request('/project/upsrtc');

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('/login?next=%2Fproject%2Fupsrtc');
  });

  it('answers a credential-less API request with 401 JSON, never a login redirect', async () => {
    // A redirect here would be followed by fetch() and answered as HTTP 200
    // with an HTML body — a client would read that as success.
    const response = await request('/api/upsrtc/live');

    expect(response.status).toBe(401);
  });

  it('lets a Supabase session through for the Node guards to decide on', async () => {
    middlewareUser.mockResolvedValue({ id: 'sb-1' });

    const response = await request('/project/upsrtc');

    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  // A legacy-cookie operator holds a real, active ops profile — strictly MORE
  // than a bare Supabase session proves. The edge was refusing them and
  // bouncing them to /login, so the cutover's lockout safety net could not
  // reach the product it exists to rescue you into.
  it('lets the legacy ops cookie through, which the authority already admits', async () => {
    const { createOpsSessionToken } = await import('@/lib/auth/rbac/session');
    const { OPS_SESSION_COOKIE } = await import('@/lib/auth/rbac/config');
    const token = await createOpsSessionToken({
      id: 'ops-user',
      email: 'depot@olympuss.local',
      role: 'depot',
    });

    const response = await request('/project/upsrtc', `${OPS_SESSION_COOKIE}=${token}`);

    expect(response.headers.get('x-middleware-next')).toBe('1');
  });
});

/* ------------------------------------------------------------------ *
 * Structural. The protected surfaces are gated one page at a time (the
 * simulator is deliberately not nested under the dashboard layout, so
 * there is no shared parent to hold the check), which means a new
 * /project/* page that simply forgot to call the guard would be open.
 * ------------------------------------------------------------------ */

describe('every protected route file carries the gate', () => {
  it('has no renderable surface under src/app/(protected) without requireProjectSurface', () => {
    const root = path.resolve(__dirname, '../../app/(protected)');

    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((entry) => {
        const full = path.join(dir, entry);
        return statSync(full).isDirectory() ? walk(full) : [full];
      });

    const routeFiles = walk(root).filter((file) => /\/(page|layout)\.tsx$/.test(file));
    expect(routeFiles.length).toBeGreaterThan(0);

    // A page nested under a layout that guards is covered by it; every file
    // here must be reachable-through-a-guard, so check each directory chain.
    const guarded = new Set(
      routeFiles.filter((file) => readFileSync(file, 'utf8').includes('requireProjectSurface')),
    );

    const ungated = routeFiles.filter((file) => {
      if (guarded.has(file)) return false;
      // Covered if any layout.tsx at or above this file's directory guards.
      let dir = path.dirname(file);
      while (dir.startsWith(root)) {
        const layout = path.join(dir, 'layout.tsx');
        if (guarded.has(layout)) return false;
        dir = path.dirname(dir);
      }
      return true;
    });

    expect(ungated).toEqual([]);
  });
});
