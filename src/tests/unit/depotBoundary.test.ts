// @vitest-environment node
//
// The depot ownership boundary at the wire, exercised through the route
// handlers themselves (guard, repo and fleet source mocked) — the same
// approach as src/tests/unit/pilotDriverVehicleAssignment.test.ts, which
// proves the sibling vehicle boundary.
//
// The property under test is NOT "the depot dashboard filters its list". It
// is that a depot-role caller cannot obtain another depot's data by calling
// the API directly, whatever the UI does, and that a caller with no depot
// assigned is refused rather than served everything. Those are the two ways
// a scoping change of this shape is usually wrong.
import { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CanonicalLiveBus } from '@/models/canonical';

const requireOpsRole = vi.fn();
const findUserById = vi.fn();
const findDepotById = vi.fn();
const setUserDepot = vi.fn();
const recordAuditEvent = vi.fn();
const listBreakdownReports = vi.fn();
const getOpsVehicleSchedule = vi.fn();

// The real getOpsFleetSnapshot, minus the network: it returns the statewide
// fleet and applies the scope with the production filter, so these tests
// exercise the actual narrowing rather than a stand-in for it.
const statewideBuses = vi.fn<() => CanonicalLiveBus[]>();

vi.mock('@/lib/auth/rbac/guard', () => ({
  requireOpsRole: (...args: unknown[]) => requireOpsRole(...args),
}));

vi.mock('@/lib/auth/rbac/repo', () => ({
  getOpsRepo: () => ({ findUserById, findDepotById, setUserDepot, recordAuditEvent, listBreakdownReports }),
  BREAKDOWN_REPORT_CURSOR_PATTERN: /^.+$/,
}));

vi.mock('@/lib/ops/fleetData', async () => {
  const { filterBusesToScope } = await import('@/lib/ops/depotScope');
  return {
    getOpsFleetSnapshot: async (scope: Parameters<typeof filterBusesToScope>[1]) => ({
      buses: filterBusesToScope(statewideBuses(), scope),
      source: 'live',
      stale: false,
      fetchedAt: new Date().toISOString(),
      error: null,
    }),
    getOpsVehicleSchedule: (...args: unknown[]) => getOpsVehicleSchedule(...args),
  };
});

vi.mock('@/lib/auth/origin', () => ({ isSameOrigin: () => true }));
vi.mock('@/lib/auth/rate-limit', () => ({ clientIpFrom: () => '127.0.0.1' }));

function bus(registrationNumber: string, depotName: string | null): CanonicalLiveBus {
  return {
    id: registrationNumber,
    registrationNumber,
    latitude: 28.35,
    longitude: 79.42,
    speedKmph: 20,
    headingDegrees: 90,
    depotName,
    routeId: 'R1',
    routeName: 'Route 1',
    serviceNumber: 'S1',
    tripId: 'T1',
    vehicleType: null,
    gpsTimestamp: '2026-08-12T06:00:00Z',
    lastUpdatedAt: '2026-08-12T06:00:00Z',
    ignitionOn: true,
    rawStatus: 'RUNNING',
    tripDate: '2026-08-12',
    dataQuality: 'good',
  };
}

const BAREILLY_DEPOT = { id: 'aaaaaaaa-0000-4000-8000-00000000bbbb', code: 'BAREILLY', name: 'Bareilly', upstreamDepotId: '81', createdAt: '' };
const LUCKNOW_DEPOT = { id: 'cccccccc-0000-4000-8000-00000000dddd', code: 'LUCKNOW', name: 'Lucknow', upstreamDepotId: '9', createdAt: '' };

const BAREILLY_BUS = 'UP25FT4823';
const LUCKNOW_BUS = 'UP32AB1234';
const ORPHAN_BUS = 'UP99ZZ0001';

const BAREILLY_OPERATOR = { sub: 'user-bareilly', email: 'b@example.com', role: 'depot' as const };
const LUCKNOW_OPERATOR = { sub: 'user-lucknow', email: 'l@example.com', role: 'depot' as const };
const UNASSIGNED_OPERATOR = { sub: 'user-none', email: 'n@example.com', role: 'depot' as const };
const PLANNER = { sub: 'user-planner', email: 'p@example.com', role: 'planner' as const };

/** Wires findUserById/findDepotById so each operator resolves to their own depot. */
function withDirectory() {
  findUserById.mockImplementation(async (id: string) => {
    if (id === BAREILLY_OPERATOR.sub) return { id, depotId: BAREILLY_DEPOT.id, email: BAREILLY_OPERATOR.email };
    if (id === LUCKNOW_OPERATOR.sub) return { id, depotId: LUCKNOW_DEPOT.id, email: LUCKNOW_OPERATOR.email };
    if (id === UNASSIGNED_OPERATOR.sub) return { id, depotId: null, email: UNASSIGNED_OPERATOR.email };
    return null;
  });
  findDepotById.mockImplementation(async (id: string) => {
    if (id === BAREILLY_DEPOT.id) return BAREILLY_DEPOT;
    if (id === LUCKNOW_DEPOT.id) return LUCKNOW_DEPOT;
    return null;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  withDirectory();
  statewideBuses.mockReturnValue([
    bus(BAREILLY_BUS, 'BAREILLY'),
    bus(LUCKNOW_BUS, 'LUCKNOW'),
    bus(ORPHAN_BUS, null),
  ]);
  getOpsVehicleSchedule.mockResolvedValue({ schedule: { registrationNumber: 'x' }, source: 'live', stale: false, error: null });
});

async function scheduleRequest(regNum: string) {
  const { GET } = await import('@/app/api/ops/fleet/schedule/route');
  return GET(new NextRequest(`https://app.test/api/ops/fleet/schedule?regNum=${regNum}`));
}

describe('GET /api/ops/fleet/schedule — depot ownership', () => {
  it('serves a vehicle that belongs to the caller depot', async () => {
    requireOpsRole.mockResolvedValue({ ok: true, claims: BAREILLY_OPERATOR });
    const response = await scheduleRequest(BAREILLY_BUS);
    expect(response.status).toBe(200);
    expect(getOpsVehicleSchedule).toHaveBeenCalled();
  });

  // THE CROSS-DEPOT PROBE. This is the call a scoped-UI-only implementation
  // would happily answer.
  it('refuses another depot vehicle, and never reaches the schedule source', async () => {
    requireOpsRole.mockResolvedValue({ ok: true, claims: BAREILLY_OPERATOR });
    const response = await scheduleRequest(LUCKNOW_BUS);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: 'VEHICLE_NOT_IN_DEPOT', message: 'No such vehicle in your depot.' },
    });
    expect(getOpsVehicleSchedule).not.toHaveBeenCalled();
  });

  it('is symmetric — the other operator is refused the first depot vehicle', async () => {
    requireOpsRole.mockResolvedValue({ ok: true, claims: LUCKNOW_OPERATOR });
    expect((await scheduleRequest(BAREILLY_BUS)).status).toBe(404);
    requireOpsRole.mockResolvedValue({ ok: true, claims: LUCKNOW_OPERATOR });
    expect((await scheduleRequest(LUCKNOW_BUS)).status).toBe(200);
  });

  // An oracle that distinguished "another depot's bus" from "no such bus"
  // would let a depot operator enumerate the statewide fleet one probe at a
  // time, which is a slower version of the leak being closed.
  it('answers identically for another depot vehicle and a nonexistent one', async () => {
    requireOpsRole.mockResolvedValue({ ok: true, claims: BAREILLY_OPERATOR });
    const foreign = await scheduleRequest(LUCKNOW_BUS);
    requireOpsRole.mockResolvedValue({ ok: true, claims: BAREILLY_OPERATOR });
    const missing = await scheduleRequest('UP77QQ9999');
    expect(foreign.status).toBe(missing.status);
    expect(await foreign.json()).toEqual(await missing.json());
  });

  it('shows a vehicle with no depot to no depot operator', async () => {
    requireOpsRole.mockResolvedValue({ ok: true, claims: BAREILLY_OPERATOR });
    expect((await scheduleRequest(ORPHAN_BUS)).status).toBe(404);
    requireOpsRole.mockResolvedValue({ ok: true, claims: LUCKNOW_OPERATOR });
    expect((await scheduleRequest(ORPHAN_BUS)).status).toBe(404);
  });

  // The failure this ticket most had to avoid: an unassigned depot operator
  // falling through to the statewide fleet.
  it('refuses an unassigned depot operator instead of serving them anything', async () => {
    requireOpsRole.mockResolvedValue({ ok: true, claims: UNASSIGNED_OPERATOR });
    const response = await scheduleRequest(BAREILLY_BUS);
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe('DEPOT_NOT_ASSIGNED');
    expect(getOpsVehicleSchedule).not.toHaveBeenCalled();
  });

  it('refuses a depot operator whose assigned depot is no longer in the registry', async () => {
    findUserById.mockResolvedValue({ id: 'ghost', depotId: 'eeeeeeee-0000-4000-8000-00000000ffff', email: 'g@example.com' });
    requireOpsRole.mockResolvedValue({ ok: true, claims: { ...BAREILLY_OPERATOR, sub: 'ghost' } });
    const response = await scheduleRequest(BAREILLY_BUS);
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe('DEPOT_NOT_ASSIGNED');
  });

  it('leaves statewide roles unscoped', async () => {
    requireOpsRole.mockResolvedValue({ ok: true, claims: PLANNER });
    expect((await scheduleRequest(LUCKNOW_BUS)).status).toBe(200);
    // A planner never causes a depot lookup at all.
    expect(findDepotById).not.toHaveBeenCalled();
  });
});

async function breakdownRequest() {
  const { GET } = await import('@/app/api/ops/fleet/breakdown-reports/route');
  return GET(new NextRequest('https://app.test/api/ops/fleet/breakdown-reports'));
}

describe('GET /api/ops/fleet/breakdown-reports — depot ownership', () => {
  beforeEach(() => {
    listBreakdownReports.mockResolvedValue({
      items: [
        { id: 'r1', driverUserId: 'd1', vehicleReg: BAREILLY_BUS, category: 'Mechanical', description: 'x', createdAt: '', reporterName: 'A' },
        { id: 'r2', driverUserId: 'd2', vehicleReg: LUCKNOW_BUS, category: 'Tyre/wheel', description: 'y', createdAt: '', reporterName: 'B' },
        { id: 'r3', driverUserId: 'd3', vehicleReg: 'UP00TYPO0000', category: 'Other', description: 'z', createdAt: '', reporterName: 'C' },
      ],
      nextCursor: null,
    });
  });

  it('returns only reports on the caller own depot vehicles', async () => {
    requireOpsRole.mockResolvedValue({ ok: true, claims: BAREILLY_OPERATOR });
    const body = await (await breakdownRequest()).json();
    expect(body.reports.map((r: { id: string }) => r.id)).toEqual(['r1']);
  });

  it('gives two depots disjoint report sets', async () => {
    requireOpsRole.mockResolvedValue({ ok: true, claims: BAREILLY_OPERATOR });
    const mine = (await (await breakdownRequest()).json()).reports.map((r: { id: string }) => r.id);
    requireOpsRole.mockResolvedValue({ ok: true, claims: LUCKNOW_OPERATOR });
    const theirs = (await (await breakdownRequest()).json()).reports.map((r: { id: string }) => r.id);
    expect(mine).toEqual(['r1']);
    expect(theirs).toEqual(['r2']);
    expect(mine.filter((id: string) => theirs.includes(id))).toEqual([]);
  });

  // Documented consequence of scoping a self-reported field: a typo'd
  // registration is shown to nobody rather than to everybody.
  it('shows a report whose registration matches no live vehicle to no depot', async () => {
    for (const operator of [BAREILLY_OPERATOR, LUCKNOW_OPERATOR]) {
      requireOpsRole.mockResolvedValue({ ok: true, claims: operator });
      const body = await (await breakdownRequest()).json();
      expect(body.reports.map((r: { id: string }) => r.id)).not.toContain('r3');
    }
  });

  it('refuses an unassigned depot operator', async () => {
    requireOpsRole.mockResolvedValue({ ok: true, claims: UNASSIGNED_OPERATOR });
    const response = await breakdownRequest();
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe('DEPOT_NOT_ASSIGNED');
    expect(listBreakdownReports).not.toHaveBeenCalled();
  });

  it('leaves a statewide role seeing every report', async () => {
    requireOpsRole.mockResolvedValue({ ok: true, claims: { ...PLANNER, role: 'control_room' as const } });
    const body = await (await breakdownRequest()).json();
    expect(body.reports).toHaveLength(3);
  });
});

describe('POST /api/ops/admin/users/:id/depot', () => {
  async function assign(targetId: string, body: unknown, claims: unknown = { sub: 'admin-1', email: 'a@example.com', role: 'admin' }) {
    requireOpsRole.mockResolvedValue({ ok: true, claims });
    const { POST } = await import('@/app/api/ops/admin/users/[id]/depot/route');
    return POST(
      new NextRequest(`https://app.test/api/ops/admin/users/${targetId}/depot`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id: targetId }) },
    );
  }

  const TARGET = '11111111-1111-1111-1111-111111111111';

  beforeEach(() => {
    recordAuditEvent.mockResolvedValue({ id: 'audit-1' });
  });

  it('assigns a depot and records an audit event', async () => {
    findUserById.mockResolvedValue({ id: TARGET, email: 'op@example.com', depotId: null });
    setUserDepot.mockResolvedValue({ id: TARGET, email: 'op@example.com', depotId: BAREILLY_DEPOT.id });

    const response = await assign(TARGET, { depotId: BAREILLY_DEPOT.id });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, id: TARGET, depotId: BAREILLY_DEPOT.id });
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'admin.user.depot_assign', resourceId: TARGET }),
    );
  });

  it('unassigns on an explicit null', async () => {
    findUserById.mockResolvedValue({ id: TARGET, email: 'op@example.com', depotId: BAREILLY_DEPOT.id });
    setUserDepot.mockResolvedValue({ id: TARGET, email: 'op@example.com', depotId: null });
    const response = await assign(TARGET, { depotId: null });
    expect(response.status).toBe(200);
    expect(setUserDepot).toHaveBeenCalledWith(TARGET, null);
  });

  it('rejects an omitted depotId rather than treating it as "leave unchanged"', async () => {
    findUserById.mockResolvedValue({ id: TARGET, email: 'op@example.com', depotId: null });
    const response = await assign(TARGET, {});
    expect(response.status).toBe(400);
    expect(setUserDepot).not.toHaveBeenCalled();
  });

  it('404s an unknown depot instead of letting the foreign key raise a 500', async () => {
    findUserById.mockResolvedValue({ id: TARGET, email: 'op@example.com', depotId: null });
    findDepotById.mockResolvedValue(null);
    const response = await assign(TARGET, { depotId: '22222222-2222-2222-2222-222222222222' });
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe('DEPOT_NOT_FOUND');
    expect(setUserDepot).not.toHaveBeenCalled();
  });

  it('rejects a depot name in place of an id, so a typo cannot become a valid-looking assignment', async () => {
    findUserById.mockResolvedValue({ id: TARGET, email: 'op@example.com', depotId: null });
    const response = await assign(TARGET, { depotId: 'BAREILLY' });
    expect(response.status).toBe(400);
    expect(setUserDepot).not.toHaveBeenCalled();
  });

  it('is admin-only', async () => {
    requireOpsRole.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: { code: 'FORBIDDEN' } }), { status: 403 }),
    });
    const { POST } = await import('@/app/api/ops/admin/users/[id]/depot/route');
    const response = await POST(
      new NextRequest(`https://app.test/api/ops/admin/users/${TARGET}/depot`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ depotId: BAREILLY_DEPOT.id }),
      }),
      { params: Promise.resolve({ id: TARGET }) },
    );
    expect(response.status).toBe(403);
    expect(requireOpsRole).toHaveBeenCalledWith(['admin']);
    expect(setUserDepot).not.toHaveBeenCalled();
  });
});
