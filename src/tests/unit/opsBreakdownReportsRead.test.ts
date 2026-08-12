// @vitest-environment node
//
// Part 2 regression proof: the two new breakdown-report read surfaces.
//
//   - GET /api/ops/fleet/breakdown-reports — fleet-wide, requireOpsRole(['control_room','dispatcher','depot']).
//   - GET /api/ops/driver/breakdown-reports — a driver's own history only,
//     requireOpsRole(['driver']), always scoped server-side to
//     guard.claims.sub. Same posture as GET /api/ops/pilot-driver/commands
//     (src/tests/unit/pilotDriverVehicleAssignment.test.ts): a
//     client-supplied id must never override the session's own.
//
// Route handlers are exercised directly with their auth guard, repo, and db
// error class mocked/imported — same approach as
// pilotDriverVehicleAssignment.test.ts.
import { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const requireOpsRole = vi.fn();
const listBreakdownReports = vi.fn();

vi.mock('@/lib/auth/rbac/guard', () => ({
  requireOpsRole: (...args: unknown[]) => requireOpsRole(...args),
}));

vi.mock('@/lib/auth/rbac/repo', () => ({
  getOpsRepo: () => ({ listBreakdownReports }),
}));

const REPORT = {
  id: 'br-1',
  driverUserId: 'driver-1',
  vehicleReg: 'UP25FT4823',
  category: 'Mechanical',
  description: 'Engine warning light',
  createdAt: '2026-08-10T00:00:00.000Z',
  reporterName: 'Driver One',
  reporterEmail: 'driver1@example.com',
};

beforeEach(() => {
  vi.clearAllMocks();
  listBreakdownReports.mockResolvedValue({ items: [REPORT], nextCursor: null });
});

describe('GET /api/ops/fleet/breakdown-reports', () => {
  function request(query = ''): NextRequest {
    return new NextRequest(`http://localhost:3000/api/ops/fleet/breakdown-reports${query}`);
  }

  it('guards with control_room/dispatcher/depot and returns guard.response on failure', async () => {
    const forbidden = { ok: false, response: new Response('nope', { status: 403 }) };
    requireOpsRole.mockResolvedValue(forbidden);

    const { GET } = await import('@/app/api/ops/fleet/breakdown-reports/route');
    const response = await GET(request());

    expect(requireOpsRole).toHaveBeenCalledWith(['control_room', 'dispatcher', 'depot']);
    expect(response.status).toBe(403);
    expect(listBreakdownReports).not.toHaveBeenCalled();
  });

  it('returns { reports, nextCursor } with no-store on success, passing default (unfiltered) query through', async () => {
    requireOpsRole.mockResolvedValue({ ok: true, claims: { sub: 'cr-1', email: 'c@example.com', role: 'control_room' } });

    const { GET } = await import('@/app/api/ops/fleet/breakdown-reports/route');
    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(body).toEqual({ reports: [REPORT], nextCursor: null });
    expect(listBreakdownReports).toHaveBeenCalledWith({
      limit: undefined,
      before: undefined,
      category: undefined,
      vehicleReg: undefined,
    });
  });

  it('parses limit/before/category/vehicleReg query params through to the repo', async () => {
    requireOpsRole.mockResolvedValue({ ok: true, claims: { sub: 'cr-1', email: 'c@example.com', role: 'control_room' } });

    const { GET } = await import('@/app/api/ops/fleet/breakdown-reports/route');
    const before = '2026-08-11T00:00:00.000Z';
    await GET(request(`?limit=10&before=${encodeURIComponent(before)}&category=Mechanical&vehicleReg=UP25FT4823`));

    expect(listBreakdownReports).toHaveBeenCalledWith({
      limit: 10,
      before,
      category: 'Mechanical',
      vehicleReg: 'UP25FT4823',
    });
  });

  it('returns INVALID_QUERY 400 for a malformed category', async () => {
    requireOpsRole.mockResolvedValue({ ok: true, claims: { sub: 'cr-1', email: 'c@example.com', role: 'control_room' } });

    const { GET } = await import('@/app/api/ops/fleet/breakdown-reports/route');
    const response = await GET(request('?category=NotACategory'));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('INVALID_QUERY');
    expect(listBreakdownReports).not.toHaveBeenCalled();
  });

  it('returns INVALID_QUERY 400 for a malformed before cursor', async () => {
    requireOpsRole.mockResolvedValue({ ok: true, claims: { sub: 'cr-1', email: 'c@example.com', role: 'control_room' } });

    const { GET } = await import('@/app/api/ops/fleet/breakdown-reports/route');
    const response = await GET(request('?before=not-a-date'));

    expect(response.status).toBe(400);
    expect(listBreakdownReports).not.toHaveBeenCalled();
  });

  it('returns INVALID_QUERY 400 for a limit outside 1-200', async () => {
    requireOpsRole.mockResolvedValue({ ok: true, claims: { sub: 'cr-1', email: 'c@example.com', role: 'control_room' } });

    const { GET } = await import('@/app/api/ops/fleet/breakdown-reports/route');
    const response = await GET(request('?limit=500'));

    expect(response.status).toBe(400);
  });

  it('maps OpsDbConfigError to 503 NOT_CONFIGURED', async () => {
    requireOpsRole.mockResolvedValue({ ok: true, claims: { sub: 'cr-1', email: 'c@example.com', role: 'control_room' } });
    const { OpsDbConfigError } = await import('@/lib/db/pool');
    listBreakdownReports.mockRejectedValue(new OpsDbConfigError('not configured'));

    const { GET } = await import('@/app/api/ops/fleet/breakdown-reports/route');
    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error.code).toBe('NOT_CONFIGURED');
  });
});

describe('GET /api/ops/driver/breakdown-reports — own history only', () => {
  const CALLER_CLAIMS = { sub: 'driver-1', email: 'd1@example.com', role: 'driver' as const };

  function request(query = ''): NextRequest {
    return new NextRequest(`http://localhost:3000/api/ops/driver/breakdown-reports${query}`);
  }

  it('guards with driver only', async () => {
    requireOpsRole.mockResolvedValue({ ok: true, claims: CALLER_CLAIMS });
    const { GET } = await import('@/app/api/ops/driver/breakdown-reports/route');
    await GET(request());
    expect(requireOpsRole).toHaveBeenCalledWith(['driver']);
  });

  it('scopes the repo call to guard.claims.sub, ignoring any client-supplied driverUserId in the query', async () => {
    requireOpsRole.mockResolvedValue({ ok: true, claims: CALLER_CLAIMS });

    const { GET } = await import('@/app/api/ops/driver/breakdown-reports/route');
    // An attacker-controlled query string still tries to claim someone
    // else's report history — the route must not read driverUserId from it
    // at all (there is no such field in its query schema).
    await GET(request('?driverUserId=some-other-driver'));

    expect(listBreakdownReports).toHaveBeenCalledTimes(1);
    expect(listBreakdownReports).toHaveBeenCalledWith(
      expect.objectContaining({ driverUserId: 'driver-1' }),
    );
    expect(listBreakdownReports).not.toHaveBeenCalledWith(
      expect.objectContaining({ driverUserId: 'some-other-driver' }),
    );
  });

  it('returns { reports, nextCursor } with no-store on success', async () => {
    requireOpsRole.mockResolvedValue({ ok: true, claims: CALLER_CLAIMS });

    const { GET } = await import('@/app/api/ops/driver/breakdown-reports/route');
    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(body).toEqual({ reports: [REPORT], nextCursor: null });
  });

  it('returns INVALID_QUERY 400 for a malformed category, never reaching the repo', async () => {
    requireOpsRole.mockResolvedValue({ ok: true, claims: CALLER_CLAIMS });

    const { GET } = await import('@/app/api/ops/driver/breakdown-reports/route');
    const response = await GET(request('?category=NotACategory'));

    expect(response.status).toBe(400);
    expect(listBreakdownReports).not.toHaveBeenCalled();
  });

  it('maps OpsDbConfigError to 503 NOT_CONFIGURED', async () => {
    requireOpsRole.mockResolvedValue({ ok: true, claims: CALLER_CLAIMS });
    const { OpsDbConfigError } = await import('@/lib/db/pool');
    listBreakdownReports.mockRejectedValue(new OpsDbConfigError('not configured'));

    const { GET } = await import('@/app/api/ops/driver/breakdown-reports/route');
    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error.code).toBe('NOT_CONFIGURED');
  });
});
