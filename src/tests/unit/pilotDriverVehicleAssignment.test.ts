// @vitest-environment node
//
// Regression proof for the A01 fix in this ticket: GET
// /api/ops/pilot-driver/commands and POST
// /api/ops/pilot-driver/commands/:id/ack must derive the vehicle to look up
// from the caller's OWN ops_users row (session sub -> repo.findUserById),
// never from client-supplied input. Before the fix, a `pilot_driver`
// account could pass an arbitrary vehicleId (query param on GET, body field
// on POST) and observe/ack another vehicle's commands, because the RBAC
// schema had no driver-to-vehicle assignment to check against.
//
// Route handlers are exercised directly (not through a real Next.js server)
// with their auth guard, repo, and control-service client mocked — same
// approach as src/tests/unit/pilotDriverCommandsClient.test.ts for the
// control-service layer one level down.
import { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const requireOpsRole = vi.fn();
const findUserById = vi.fn();
const recordAuditEvent = vi.fn();
const fetchActiveCommandForVehicle = vi.fn();
const acknowledgeCommand = vi.fn();

vi.mock('@/lib/auth/rbac/guard', () => ({
  requireOpsRole: (...args: unknown[]) => requireOpsRole(...args),
}));

vi.mock('@/lib/auth/rbac/repo', () => ({
  getOpsRepo: () => ({
    findUserById,
    recordAuditEvent,
  }),
}));

vi.mock('@/lib/controlService/commands', () => ({
  fetchActiveCommandForVehicle: (...args: unknown[]) => fetchActiveCommandForVehicle(...args),
  acknowledgeCommand: (...args: unknown[]) => acknowledgeCommand(...args),
}));

const CALLER_CLAIMS = { sub: 'driver-1', email: 'd1@example.com', role: 'pilot_driver' as const };
const ASSIGNED_VEHICLE = 'BUS-100';
const ATTACKER_VEHICLE = 'BUS-999-NOT-MINE';

const ACTIVE_COMMAND = {
  id: 'cmd-1',
  recommendationId: null,
  vehicleId: ASSIGNED_VEHICLE,
  tripId: null,
  actionType: 'speed_guidance',
  targetStopId: null,
  parameters: {},
  dispatcherActionId: 'd1',
  ttlSeconds: 120,
  validFrom: '2026-08-06T06:00:00Z',
  expiresAt: '2026-08-06T06:02:00Z',
  policyVersion: null,
  status: 'executing',
  deliveredAt: '2026-08-06T06:00:00Z',
  acknowledgedAt: null,
  acknowledgementReason: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  requireOpsRole.mockResolvedValue({ ok: true, claims: CALLER_CLAIMS });
  recordAuditEvent.mockResolvedValue({ id: 'audit-1', createdAt: new Date().toISOString() });
});

describe('GET /api/ops/pilot-driver/commands — vehicle ownership', () => {
  it('polls the caller\'s own assigned vehicle — the handler takes no request/query input at all', async () => {
    findUserById.mockResolvedValue({ id: 'driver-1', vehicleId: ASSIGNED_VEHICLE });
    fetchActiveCommandForVehicle.mockResolvedValue(ACTIVE_COMMAND);

    const { GET } = await import('@/app/api/ops/pilot-driver/commands/route');
    // GET() intentionally takes no arguments (see route.ts): unlike the
    // pre-fix version, there is no `?vehicleId=` for a caller to smuggle a
    // different vehicle through, structurally as well as behaviourally.
    const response = await GET();

    expect(response.status).toBe(200);
    expect(fetchActiveCommandForVehicle).toHaveBeenCalledTimes(1);
    expect(fetchActiveCommandForVehicle).toHaveBeenCalledWith(ASSIGNED_VEHICLE);
    expect(fetchActiveCommandForVehicle).not.toHaveBeenCalledWith(ATTACKER_VEHICLE);
    expect(findUserById).toHaveBeenCalledWith('driver-1');
  });

  it('returns 409 VEHICLE_NOT_ASSIGNED instead of trusting client input when no vehicle is assigned', async () => {
    findUserById.mockResolvedValue({ id: 'driver-1', vehicleId: null });

    const { GET } = await import('@/app/api/ops/pilot-driver/commands/route');
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe('VEHICLE_NOT_ASSIGNED');
    expect(fetchActiveCommandForVehicle).not.toHaveBeenCalled();
  });
});

describe('POST /api/ops/pilot-driver/commands/:id/ack — vehicle ownership', () => {
  function buildRequest(body: unknown) {
    return new NextRequest('http://localhost:3000/api/ops/pilot-driver/commands/cmd-1/ack', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost:3000',
        host: 'localhost:3000',
      },
      body: JSON.stringify(body),
    });
  }

  it('acks against the caller\'s own assigned vehicle, ignoring a client-supplied vehicleId in the body', async () => {
    findUserById.mockResolvedValue({ id: 'driver-1', vehicleId: ASSIGNED_VEHICLE });
    fetchActiveCommandForVehicle.mockResolvedValue(ACTIVE_COMMAND);
    acknowledgeCommand.mockResolvedValue({ ...ACTIVE_COMMAND, status: 'acknowledged' });

    const { POST } = await import('@/app/api/ops/pilot-driver/commands/[id]/ack/route');
    // An attacker-controlled body still tries to claim someone else's
    // vehicle — the route must not read `vehicleId` from it at all.
    const request = buildRequest({ vehicleId: ATTACKER_VEHICLE, outcome: 'accept' });
    const response = await POST(request as never, { params: Promise.resolve({ id: 'cmd-1' }) });

    expect(response.status).toBe(200);
    expect(fetchActiveCommandForVehicle).toHaveBeenCalledWith(ASSIGNED_VEHICLE);
    expect(fetchActiveCommandForVehicle).not.toHaveBeenCalledWith(ATTACKER_VEHICLE);
    expect(acknowledgeCommand).toHaveBeenCalledWith('cmd-1', expect.objectContaining({ outcome: 'accept' }));
  });

  it('refuses to ack (409) when the command is only active for a vehicle the caller is not assigned', async () => {
    // The caller's own vehicle has no active command; the "active" command
    // belongs to a different vehicle. Even though the attacker's body
    // named that other vehicle, the ack must fail rather than proceed.
    findUserById.mockResolvedValue({ id: 'driver-1', vehicleId: ASSIGNED_VEHICLE });
    fetchActiveCommandForVehicle.mockResolvedValue(null);

    const { POST } = await import('@/app/api/ops/pilot-driver/commands/[id]/ack/route');
    const request = buildRequest({ vehicleId: ATTACKER_VEHICLE, outcome: 'accept' });
    const response = await POST(request as never, { params: Promise.resolve({ id: 'cmd-1' }) });
    const responseBody = await response.json();

    expect(response.status).toBe(409);
    expect(responseBody.error.code).toBe('COMMAND_NOT_ACTIVE');
    expect(acknowledgeCommand).not.toHaveBeenCalled();
  });

  it('returns 409 VEHICLE_NOT_ASSIGNED and never calls the control service when no vehicle is assigned', async () => {
    findUserById.mockResolvedValue({ id: 'driver-1', vehicleId: null });

    const { POST } = await import('@/app/api/ops/pilot-driver/commands/[id]/ack/route');
    const request = buildRequest({ vehicleId: ATTACKER_VEHICLE, outcome: 'accept' });
    const response = await POST(request as never, { params: Promise.resolve({ id: 'cmd-1' }) });
    const responseBody = await response.json();

    expect(response.status).toBe(409);
    expect(responseBody.error.code).toBe('VEHICLE_NOT_ASSIGNED');
    expect(fetchActiveCommandForVehicle).not.toHaveBeenCalled();
    expect(acknowledgeCommand).not.toHaveBeenCalled();
  });
});
