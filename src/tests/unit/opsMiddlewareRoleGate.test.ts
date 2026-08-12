// @vitest-environment node
//
// Part 1 regression proof: src/middleware.ts's handleOpsRequest used to
// derive an /api/ops/* request's required role from the URL's first path
// segment alone and check `claims.role === requiredRole`. That was wrong in
// both directions:
//
//   - Too strict: GET /api/ops/dispatcher/approvals deliberately allows
//     ['dispatcher', 'control_room'] (its own requireOpsRole call), but
//     middleware saw the `dispatcher` segment and 403'd a control_room
//     session before the route's own broader guard ever ran. Same latent
//     cause for GET /api/ops/control-room/kill-switches, which allows
//     ['dispatcher', 'depot', 'control_room'].
//   - Too loose: roleForSegment('fleet') is null (there is no `fleet` role),
//     so GET /api/ops/fleet/schedule — which self-guards with
//     requireOpsRole(OPERATIONAL_ROLES) — passed through middleware with no
//     check at all, not even authentication.
//
// This drives the real `middleware` export end-to-end with real signed
// session cookies (via createOpsSessionToken — not mocked), the same way
// controlServiceWebhookMiddleware.test.ts proves the machine-API exemption,
// so a regression in either roles.ts's OPS_API_ROLE_OVERRIDES or
// middleware.ts's wiring of it would fail here even if the two were changed
// consistently with each other but wrongly.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { describe, it, expect, beforeAll } from 'vitest';
import { createOpsSessionToken } from '@/lib/auth/rbac/session';
import { OPS_SESSION_COOKIE } from '@/lib/auth/rbac/config';
import { isPublicOpsApiPath, type OpsRole } from '@/lib/auth/rbac/roles';

beforeAll(() => {
  process.env.OPS_SESSION_SECRET = 'c'.repeat(40);
});

async function requestAs(
  role: OpsRole | null,
  path: string,
  method: string = 'GET',
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (role) {
    const token = await createOpsSessionToken({ id: `user-${role}`, email: `${role}@example.com`, role });
    headers.cookie = `${OPS_SESSION_COOKIE}=${token}`;
  }
  const { middleware } = await import('@/middleware');
  return middleware(new NextRequest(`http://localhost:3000${path}`, { method, headers }));
}

describe('middleware — ops API role gate (Part 1 fix)', () => {
  describe('too-strict bug: dispatcher approvals and control-room kill-switches no longer 403 their own broader allowlist', () => {
    it('lets a control_room session through GET /api/ops/dispatcher/approvals', async () => {
      const response = await requestAs('control_room', '/api/ops/dispatcher/approvals');
      expect(response.status).toBe(200);
      expect(response.headers.get('x-middleware-next')).toBe('1');
    });

    it('still lets a dispatcher session through GET /api/ops/dispatcher/approvals', async () => {
      const response = await requestAs('dispatcher', '/api/ops/dispatcher/approvals');
      expect(response.status).toBe(200);
    });

    it('403s a role outside the override entirely (planner) for GET /api/ops/dispatcher/approvals', async () => {
      const response = await requestAs('planner', '/api/ops/dispatcher/approvals');
      expect(response.status).toBe(403);
      expect((await response.json()).error.code).toBe('FORBIDDEN');
    });

    it('lets dispatcher, depot, AND control_room through GET /api/ops/control-room/kill-switches', async () => {
      for (const role of ['dispatcher', 'depot', 'control_room'] as const) {
        const response = await requestAs(role, '/api/ops/control-room/kill-switches');
        expect(response.status, `role ${role} should pass`).toBe(200);
      }
    });

    it('403s a role outside that allowlist (planner) for GET /api/ops/control-room/kill-switches', async () => {
      const response = await requestAs('planner', '/api/ops/control-room/kill-switches');
      expect(response.status).toBe(403);
    });
  });

  describe('too-loose bug: fleet/schedule no longer passes through unauthenticated', () => {
    it('401s an unauthenticated request to GET /api/ops/fleet/schedule', async () => {
      const response = await requestAs(null, '/api/ops/fleet/schedule');
      expect(response.status).toBe(401);
      expect((await response.json()).error.code).toBe('UNAUTHORIZED');
    });

    it('403s an authenticated-but-wrong-role (admin, which OPERATIONAL_ROLES excludes) session', async () => {
      const response = await requestAs('admin', '/api/ops/fleet/schedule');
      expect(response.status).toBe(403);
    });

    it('lets any operational role through, e.g. driver and planner', async () => {
      for (const role of ['driver', 'planner'] as const) {
        const response = await requestAs(role, '/api/ops/fleet/schedule');
        expect(response.status, `role ${role} should pass`).toBe(200);
      }
    });

    it('gives the new fleet/breakdown-reports GET the same real defence from day one', async () => {
      expect((await requestAs(null, '/api/ops/fleet/breakdown-reports')).status).toBe(401);
      expect((await requestAs('planner', '/api/ops/fleet/breakdown-reports')).status).toBe(403);
      for (const role of ['control_room', 'dispatcher', 'depot'] as const) {
        expect((await requestAs(role, '/api/ops/fleet/breakdown-reports')).status).toBe(200);
      }
    });
  });

  describe('pages keep strict equality — no widening leaks from the API override map', () => {
    it('redirects a control_room session away from the dispatcher page even though the API override widens dispatcher/approvals to control_room', async () => {
      const response = await requestAs('control_room', '/ops/dispatcher');
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toContain('/ops/forbidden');
    });

    it('lets the exactly-matching role through to its own page', async () => {
      const response = await requestAs('dispatcher', '/ops/dispatcher');
      expect(response.status).toBe(200);
    });

    it('redirects an unauthenticated page request to login with a next param', async () => {
      const response = await requestAs(null, '/ops/dispatcher');
      expect(response.status).toBe(307);
      const location = response.headers.get('location') ?? '';
      expect(location).toContain('/ops/login');
      expect(location).toContain('next=%2Fops%2Fdispatcher');
    });
  });

  // Adversarial-review regression: an /api/ops/* path with no matching
  // override AND no bare segment role (roleForSegment('fleet') is null)
  // used to fall through to `return NextResponse.next()` with no check at
  // all — not even authentication — under a doc comment that claimed the
  // opposite ("fails closed"). Proven live: an unauthenticated GET to a
  // hypothetical /api/ops/fleet/incidents, and HEAD/POST to the two real
  // fleet routes (whose overrides only ever listed GET), all passed
  // straight through. None of the 33 real route handlers are exploitable by
  // this today (29 call requireOpsRole themselves; the other 4 are
  // /api/ops/auth/*, intentionally public), but the NEXT /api/ops/fleet/*
  // route anyone adds would have been, silently, until this fix.
  describe('fail-open gap closed: an unclassified /api/ops/* path now requires authentication, not passthrough', () => {
    it('401s an unauthenticated GET to a fleet path with no override at all (not even a route that exists yet)', async () => {
      const response = await requestAs(null, '/api/ops/fleet/incidents');
      expect(response.status).toBe(401);
      expect((await response.json()).error.code).toBe('UNAUTHORIZED');
    });

    it('lets an authenticated session through an unclassified fleet path (middleware is a ceiling, not the decision)', async () => {
      const response = await requestAs('control_room', '/api/ops/fleet/incidents');
      expect(response.status).toBe(200);
      expect(response.headers.get('x-middleware-next')).toBe('1');
    });

    it('401s an unauthenticated HEAD to fleet/schedule — its override only lists GET', async () => {
      const response = await requestAs(null, '/api/ops/fleet/schedule', 'HEAD');
      expect(response.status).toBe(401);
    });

    it('401s an unauthenticated POST to fleet/schedule — its override only lists GET', async () => {
      const response = await requestAs(null, '/api/ops/fleet/schedule', 'POST');
      expect(response.status).toBe(401);
    });

    it('401s an unauthenticated HEAD to fleet/breakdown-reports — its override only lists GET', async () => {
      const response = await requestAs(null, '/api/ops/fleet/breakdown-reports', 'HEAD');
      expect(response.status).toBe(401);
    });

    it('401s an unauthenticated POST to fleet/breakdown-reports — its override only lists GET', async () => {
      const response = await requestAs(null, '/api/ops/fleet/breakdown-reports', 'POST');
      expect(response.status).toBe(401);
    });

    it('still lets /api/ops/auth/* through with no session — that surface authenticates itself', async () => {
      const response = await requestAs(null, '/api/ops/auth/login', 'POST');
      expect(response.status).toBe(200);
      expect(response.headers.get('x-middleware-next')).toBe('1');
    });
  });
});

/**
 * Coverage-completeness proof for the fail-open fix above: rather than
 * trusting a hand-maintained list of "the fleet routes", this walks the
 * REAL src/app/api/ops/**\/route.ts tree and drives every exported HTTP
 * method of every non-public route through the real middleware,
 * unauthenticated. Every one of them must come back 401, never a
 * passthrough — so a future route added under /api/ops/* with no
 * requireOpsRole call of its own, and no OPS_API_ROLE_OVERRIDES /
 * OPS_ROLE_SEGMENT entry, still cannot reopen this gap: this test starts
 * failing the moment such a route exists, without anyone remembering to
 * update an allowlist by hand.
 */
const OPS_API_ROOT = path.join(process.cwd(), 'src/app/api/ops');
const HTTP_METHOD_NAMES = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

function findRouteFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return findRouteFiles(full);
    return entry.name === 'route.ts' ? [full] : [];
  });
}

/** `.../src/app/api/ops/fleet/[id]/route.ts` -> `/api/ops/fleet/x` (dynamic segments become a concrete dummy value). */
function routeFileToPathname(routeFile: string): string {
  const rel = path.relative(path.join(process.cwd(), 'src/app'), routeFile);
  const withoutRouteFile = rel.slice(0, -'/route.ts'.length);
  const segments = withoutRouteFile
    .split(path.sep)
    .map((segment) => (segment.startsWith('[') && segment.endsWith(']') ? 'x' : segment));
  return `/${segments.join('/')}`;
}

function exportedHttpMethods(routeFile: string): string[] {
  const source = readFileSync(routeFile, 'utf8');
  return HTTP_METHOD_NAMES.filter((method) =>
    new RegExp(`^export\\s+(?:async\\s+)?function\\s+${method}\\b`, 'm').test(source),
  );
}

describe('middleware coverage completeness — every real /api/ops/* route requires auth or is explicitly public', () => {
  const routeFiles = findRouteFiles(OPS_API_ROOT);
  const cases = routeFiles.flatMap((routeFile) => {
    const pathname = routeFileToPathname(routeFile);
    if (isPublicOpsApiPath(pathname)) return [];
    return exportedHttpMethods(routeFile).map((method) => ({ pathname, method }));
  });

  it('found real route files and methods to check (guards against this scan silently going empty)', () => {
    expect(routeFiles.length).toBeGreaterThan(20);
    expect(cases.length).toBeGreaterThan(20);
  });

  it.each(cases)('$method $pathname 401s an unauthenticated request rather than passing through', async ({ pathname, method }) => {
    const response = await requestAs(null, pathname, method);
    expect(response.status).toBe(401);
  });
});
