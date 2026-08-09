// @vitest-environment node
//
// The approval bridge, from this app's side: POST /api/ops/control-room/commands
// and POST /api/ops/control-room/overrides.
//
// What was broken before this bridge existed: this app recorded dispatcher
// approvals in its own `ops_dispatcher_actions`, while control-service refuses
// to insert into `commands` without a matching, unconsumed row in ITS OWN
// `dispatcher_actions` table — a row no control-service code path ever
// created. The command endpoint could therefore only ever write an audit row;
// no human approval could authorize a real command end to end.
//
// Route handlers are exercised directly with their guard, repo and
// control-service client mocked — same approach as
// src/tests/unit/pilotDriverVehicleAssignment.test.ts.
import { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ControlServiceRequestError, ControlServiceUnavailableError } from '@/lib/controlService/client';

const requireOpsRole = vi.fn();
const getActiveKillSwitches = vi.fn();
const findDispatcherAction = vi.fn();
const claimDispatcherAction = vi.fn();
const markDispatcherActionDispatched = vi.fn();
const releaseDispatcherActionClaim = vi.fn();
const recordAuditEvent = vi.fn();
const createControlServiceCommand = vi.fn();
const fetchCommandByDispatcherAction = vi.fn();

vi.mock('@/lib/auth/rbac/guard', () => ({
  requireOpsRole: (...args: unknown[]) => requireOpsRole(...args),
}));

vi.mock('@/lib/auth/rbac/repo', () => ({
  getOpsRepo: () => ({
    getActiveKillSwitches,
    findDispatcherAction,
    claimDispatcherAction,
    markDispatcherActionDispatched,
    releaseDispatcherActionClaim,
    recordAuditEvent,
  }),
}));

vi.mock('@/lib/controlService/createCommand', () => ({
  createControlServiceCommand: (...args: unknown[]) => createControlServiceCommand(...args),
  fetchCommandByDispatcherAction: (...args: unknown[]) => fetchCommandByDispatcherAction(...args),
}));

const CALLER_CLAIMS = { sub: 'ops-user-1', email: 'cr@example.com', role: 'control_room' as const };
const DISPATCHER_ACTION_ID = '33333333-3333-3333-3333-333333333333';
const ROUTE_DIRECTION_ID = '44444444-4444-4444-4444-444444444444';
const VEHICLE_ID = 'UP25FT4823';

/** A dispatcher approval as this app stores it, post-claim (dispatch_state 'claimed', consumed_at still null). */
function approvalRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: DISPATCHER_ACTION_ID,
    dispatcherUserId: 'ops-user-2',
    actionType: 'self_equalizing_hold',
    reason: 'Bunching on the northbound leg',
    routeDirectionId: ROUTE_DIRECTION_ID,
    vehicleId: VEHICLE_ID,
    incidentId: null,
    consumedAt: null,
    rejectedAt: null,
    rejectedBy: null,
    rejectionReason: null,
    createdAt: '2026-08-08T09:00:00.000Z',
    dispatchState: 'claimed',
    claimedAt: '2026-08-08T09:00:01.000Z',
    claimedBy: 'ops-user-1',
    controlServiceCommandId: null,
    controlServiceError: null,
    dispatchAttempts: 1,
    ...overrides,
  };
}

function controlCommand(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cmd-1',
    recommendationId: null,
    vehicleId: VEHICLE_ID,
    tripId: null,
    actionType: 'self_equalizing_hold',
    targetStopId: null,
    parameters: {},
    dispatcherActionId: DISPATCHER_ACTION_ID,
    ttlSeconds: 120,
    validFrom: '2026-08-08T09:00:02.000Z',
    expiresAt: '2026-08-08T09:02:02.000Z',
    policyVersion: null,
    status: 'authorized',
    deliveredAt: null,
    acknowledgedAt: null,
    acknowledgementReason: null,
    ...overrides,
  };
}

function commandBody(overrides: Record<string, unknown> = {}) {
  return {
    dispatcherActionId: DISPATCHER_ACTION_ID,
    actionType: 'self_equalizing_hold',
    vehicleId: VEHICLE_ID,
    routeDirectionId: ROUTE_DIRECTION_ID,
    parameters: {},
    ttlSeconds: 120,
    summary: 'Holding at the terminal per the approved plan',
    ...overrides,
  };
}

function buildRequest(path: string, body: unknown) {
  return new NextRequest(`http://localhost:3000${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost:3000',
      host: 'localhost:3000',
    },
    body: JSON.stringify(body),
  });
}

async function postCommand(body: unknown) {
  const { POST } = await import('@/app/api/ops/control-room/commands/route');
  return POST(buildRequest('/api/ops/control-room/commands', body) as never);
}

async function postOverride(body: unknown) {
  const { POST } = await import('@/app/api/ops/control-room/overrides/route');
  return POST(buildRequest('/api/ops/control-room/overrides', body) as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  requireOpsRole.mockResolvedValue({ ok: true, claims: CALLER_CLAIMS });
  getActiveKillSwitches.mockResolvedValue([]);
  findDispatcherAction.mockResolvedValue(approvalRecord({ dispatchState: 'pending', claimedAt: null, claimedBy: null, dispatchAttempts: 0 }));
  claimDispatcherAction.mockResolvedValue(approvalRecord());
  markDispatcherActionDispatched.mockResolvedValue(approvalRecord({ dispatchState: 'dispatched' }));
  releaseDispatcherActionClaim.mockResolvedValue(approvalRecord({ dispatchState: 'failed' }));
  recordAuditEvent.mockResolvedValue({ id: 'audit-1', createdAt: '2026-08-08T09:00:03.000Z' });
  createControlServiceCommand.mockResolvedValue(controlCommand());
  fetchCommandByDispatcherAction.mockResolvedValue(controlCommand());
});

describe('POST /api/ops/control-room/commands — the happy path really reaches the control service', () => {
  it('claims the approval, creates the command, then marks it dispatched and audits it', async () => {
    const response = await postCommand(commandBody());
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toMatchObject({ ok: true, commandId: 'cmd-1', expiresAt: '2026-08-08T09:02:02.000Z', auditEventId: 'audit-1' });

    // The claim must precede the dispatch: it is what stops a second request
    // issuing the same approval concurrently.
    const claimOrder = claimDispatcherAction.mock.invocationCallOrder[0]!;
    const createOrder = createControlServiceCommand.mock.invocationCallOrder[0]!;
    const markOrder = markDispatcherActionDispatched.mock.invocationCallOrder[0]!;
    const auditOrder = recordAuditEvent.mock.invocationCallOrder[0]!;
    expect(claimOrder).toBeLessThan(createOrder);
    expect(createOrder).toBeLessThan(markOrder);
    // The command id is persisted BEFORE the audit write: if the audit write
    // then fails and the request 500s, control_service_command_id is already
    // recorded, so the live command stays attributable rather than orphaned.
    expect(markOrder).toBeLessThan(auditOrder);

    expect(claimDispatcherAction).toHaveBeenCalledWith(DISPATCHER_ACTION_ID, 'ops-user-1');
    expect(markDispatcherActionDispatched).toHaveBeenCalledWith(DISPATCHER_ACTION_ID, 'cmd-1');
    expect(releaseDispatcherActionClaim).not.toHaveBeenCalled();
  });

  it('mirrors the approval inline so control-service can write it in the same transaction as the command', async () => {
    await postCommand(commandBody());

    // Mirroring THIS app's own uuid (rather than letting control generate
    // one) is what makes dispatch exactly-once — see the retry test below.
    expect(createControlServiceCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        dispatcherActionId: DISPATCHER_ACTION_ID,
        vehicleId: VEHICLE_ID,
        actionType: 'self_equalizing_hold',
        ttlSeconds: 120,
        dispatcherAction: {
          id: DISPATCHER_ACTION_ID,
          dispatcherId: 'ops-user-2',
          actionType: 'self_equalizing_hold',
          routeDirectionId: ROUTE_DIRECTION_ID,
          vehicleId: VEHICLE_ID,
          incidentId: null,
          reason: 'Bunching on the northbound leg',
          authorizedAt: '2026-08-08T09:00:00.000Z',
        },
      }),
    );
  });

  it('audits against the command id, not the approval id, so command-level audit is joinable', async () => {
    await postCommand(commandBody());

    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'ops-user-1',
        actorRole: 'control_room',
        action: 'control_room.command.create',
        resourceType: 'command',
        resourceId: 'cmd-1',
        metadata: expect.objectContaining({ dispatcherActionId: DISPATCHER_ACTION_ID, routeDirectionId: ROUTE_DIRECTION_ID }),
      }),
    );
  });
});

describe('POST /api/ops/control-room/commands — exactly-once dispatch on retry', () => {
  it('returns 201 both times and creates exactly one command when the same approval is submitted twice', async () => {
    // A retry-after-timeout is routine, not hypothetical: the control-service
    // client has an 8s timeout and a circuit breaker, so this app can fail to
    // see a 201 for a command that was in fact committed. Because the
    // mirrored id is ours and control's commands.dispatcher_action_id is
    // UNIQUE, the retry collides instead of creating a second live hold on
    // the same bus — the 409 is proof the first attempt landed.
    const created: string[] = [];
    createControlServiceCommand.mockImplementation((input: { dispatcherActionId: string }) => {
      if (created.includes(input.dispatcherActionId)) {
        return Promise.reject(
          new ControlServiceRequestError('dispatcherActionId has already authorized a command', 409, 'dispatcher_action_already_used'),
        );
      }
      created.push(input.dispatcherActionId);
      return Promise.resolve(controlCommand());
    });

    const first = await postCommand(commandBody());
    const firstBody = await first.json();

    // The approval is re-claimable on the retry: the first attempt's claim is
    // released/stale, and claiming again is safe precisely because the
    // dispatch itself is idempotent.
    const second = await postCommand(commandBody());
    const secondBody = await second.json();

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(secondBody.commandId).toBe(firstBody.commandId);
    expect(created).toEqual([DISPATCHER_ACTION_ID]);
    expect(createControlServiceCommand).toHaveBeenCalledTimes(2);

    // The retry reconciled against the command that already exists rather
    // than reporting a spurious conflict to the operator.
    expect(fetchCommandByDispatcherAction).toHaveBeenCalledWith(DISPATCHER_ACTION_ID);
    expect(markDispatcherActionDispatched).toHaveBeenLastCalledWith(DISPATCHER_ACTION_ID, 'cmd-1');
    expect(releaseDispatcherActionClaim).not.toHaveBeenCalled();
  });

  it('surfaces the conflict rather than inventing success when the already-created command cannot be fetched back', async () => {
    createControlServiceCommand.mockRejectedValueOnce(
      new ControlServiceRequestError('dispatcherActionId has already authorized a command', 409, 'dispatcher_action_already_used'),
    );
    // Control-service went away between the two calls, so this app knows a
    // command exists but not which one.
    fetchCommandByDispatcherAction.mockRejectedValueOnce(new ControlServiceUnavailableError('control service unreachable'));

    const response = await postCommand(commandBody());
    const body = await response.json();

    // The original 409 is reported as-is. "Already authorized a command" is
    // the true and useful statement here; the one thing that must never
    // happen is a fabricated 201 naming a command this app never saw.
    expect(response.status).toBe(409);
    expect(body.error.message).toMatch(/already authorized a command/);
    expect(body.ok).toBeUndefined();
    // Claim released, so the approval stays live and a later retry can
    // reconcile once the control service is reachable again.
    expect(releaseDispatcherActionClaim).toHaveBeenCalledWith(DISPATCHER_ACTION_ID, expect.any(String));
    expect(markDispatcherActionDispatched).not.toHaveBeenCalled();
    expect(recordAuditEvent).not.toHaveBeenCalled();
  });
});

describe('POST /api/ops/control-room/commands — the command must match the approval it cites', () => {
  it.each([
    ['actionType', { actionType: 'stop_skip' }],
    ['vehicleId', { vehicleId: 'SOME-OTHER-BUS' }],
    ['routeDirectionId', { routeDirectionId: '55555555-5555-5555-5555-555555555555' }],
  ])('rejects a command whose %s differs from the stored approval', async (_field, override) => {
    // Only this app can make this check: control-service sees nothing but the
    // payload this app builds, so it cannot know the approval said something
    // else. Without it, approval for `speed_guidance` could be spent on a
    // `stop_skip`.
    const response = await postCommand(commandBody(override));
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error.code).toBe('APPROVAL_MISMATCH');
    // Refused before the approval is claimed, so a mistyped command costs
    // nothing.
    expect(claimDispatcherAction).not.toHaveBeenCalled();
    expect(createControlServiceCommand).not.toHaveBeenCalled();
  });

  it('409s when the approval does not exist at all', async () => {
    findDispatcherAction.mockResolvedValueOnce(null);

    const response = await postCommand(commandBody());
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe('DISPATCHER_ACTION_INVALID');
    expect(createControlServiceCommand).not.toHaveBeenCalled();
  });

  it('409s when the approval cannot be claimed (already dispatched, rejected, or claimed by another request)', async () => {
    claimDispatcherAction.mockResolvedValueOnce(null);

    const response = await postCommand(commandBody());
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe('DISPATCHER_ACTION_INVALID');
    expect(createControlServiceCommand).not.toHaveBeenCalled();
  });
});

describe('POST /api/ops/control-room/commands — routeDirectionId fails closed', () => {
  it.each([
    ['absent', undefined],
    ['null', null],
    ['an empty string', ''],
    ['a non-uuid', 'rd-1'],
  ])('refuses a request whose routeDirectionId is %s, without contacting the control service', async (_label, value) => {
    // The hole this closes: control-service's rollout gate resolves the
    // route-direction it gates on from the approval row, and a null there
    // used to mean "nothing to gate against — allow". A bridge that sent null
    // would have silently disabled the rollout gate for EVERY command,
    // letting commands reach routes still in observation/shadow.
    const body: Record<string, unknown> = commandBody();
    if (value === undefined) delete body.routeDirectionId;
    else body.routeDirectionId = value;

    const response = await postCommand(body);
    const payload = await response.json();

    // Its own code, not a generic INVALID_BODY: this is the refusal that
    // proves the gate's precondition was enforced, so it has to be findable
    // in a log. 422 matches what control-service returns for the same thing.
    expect(response.status).toBe(422);
    expect(payload.error.code).toBe('ROUTE_DIRECTION_REQUIRED');
    expect(claimDispatcherAction).not.toHaveBeenCalled();
    expect(createControlServiceCommand).not.toHaveBeenCalled();
  });

  it('still reports a generic INVALID_BODY for a body broken in some other way', async () => {
    const body: Record<string, unknown> = commandBody();
    delete body.summary;

    const response = await postCommand(body);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe('INVALID_BODY');
  });

  it('maps control-service\'s own route_direction_required refusal to a 422 and releases the claim', async () => {
    // The second line of defence: a dispatcher_actions row that predates the
    // bridge carries no route_direction_id, so control-service refuses too.
    createControlServiceCommand.mockRejectedValueOnce(
      new ControlServiceRequestError('dispatcher_action carries no route_direction_id', 422, 'route_direction_required'),
    );

    const response = await postCommand(commandBody());
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error.code).toBe('ROUTE_DIRECTION_REQUIRED');
    expect(releaseDispatcherActionClaim).toHaveBeenCalledWith(DISPATCHER_ACTION_ID, expect.any(String));
    expect(markDispatcherActionDispatched).not.toHaveBeenCalled();
  });
});

describe('POST /api/ops/control-room/commands — kill switches', () => {
  it('now blocks a VEHICLE-targeted command on a killed route-direction', async () => {
    // The previous body took a {targetType, targetId} pair and consulted the
    // route-scoped kill switch only when targetType was 'route_direction', so
    // a vehicle-targeted command on a killed route sailed straight through
    // the switch meant to stop it. Every command now names its
    // route-direction, so every command is checked against it.
    getActiveKillSwitches.mockResolvedValueOnce([
      { id: 'ks-1', scope: 'route_direction', routeDirectionId: ROUTE_DIRECTION_ID, engagedAt: '2026-08-08T08:00:00.000Z', engagedBy: 'ops-user-3', reason: 'Signal failure', disengagedAt: null, disengagedBy: null, disengageReason: null },
    ]);

    const response = await postCommand(commandBody());
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe('KILL_SWITCH_ENGAGED');
    expect(getActiveKillSwitches).toHaveBeenCalledWith(ROUTE_DIRECTION_ID);
    // Nothing was claimed or dispatched: a kill switch must stop the command
    // before it costs an approval.
    expect(claimDispatcherAction).not.toHaveBeenCalled();
    expect(createControlServiceCommand).not.toHaveBeenCalled();
  });

  it('blocks on a network-wide kill switch too', async () => {
    getActiveKillSwitches.mockResolvedValueOnce([
      { id: 'ks-2', scope: 'network', routeDirectionId: null, engagedAt: '2026-08-08T08:00:00.000Z', engagedBy: 'ops-user-3', reason: 'Network outage', disengagedAt: null, disengagedBy: null, disengageReason: null },
    ]);

    const response = await postCommand(commandBody());
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.message).toMatch(/network-wide/i);
  });
});

describe("POST /api/ops/control-room/commands — 'override' is never dispatched", () => {
  it('rejects actionType "override" with an explanatory 400 rather than a generic schema error', async () => {
    // An override means a human acted outside the automated control set; the
    // attributable audit record IS the deliverable. It is not dispatchable:
    // control-service's commands.action_type CHECK omits it, and widening
    // that CHECK would let an unmodelled action reach applyHardSafetyFilter,
    // which switches on actionType and has no 'override' case.
    const response = await postCommand(commandBody({ actionType: 'override' }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('OVERRIDE_NOT_DISPATCHABLE');
    expect(body.error.message).toMatch(/overrides/);
    expect(getActiveKillSwitches).not.toHaveBeenCalled();
    expect(claimDispatcherAction).not.toHaveBeenCalled();
    expect(createControlServiceCommand).not.toHaveBeenCalled();
  });
});

describe('POST /api/ops/control-room/overrides', () => {
  const overrideApproval = approvalRecord({ actionType: 'override' });

  it('records the override and never contacts the control service', async () => {
    findDispatcherAction.mockResolvedValueOnce(overrideApproval);
    claimDispatcherAction.mockResolvedValueOnce(overrideApproval);

    const response = await postOverride({ dispatcherActionId: DISPATCHER_ACTION_ID, summary: 'Held by radio at Bareilly' });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toMatchObject({ ok: true, dispatcherActionId: DISPATCHER_ACTION_ID, auditEventId: 'audit-1' });
    expect(createControlServiceCommand).not.toHaveBeenCalled();
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'control_room.override.record', resourceType: 'ops_dispatcher_action', resourceId: DISPATCHER_ACTION_ID }),
    );
    // Null command id is the durable marker that this approval was recorded
    // rather than dispatched.
    expect(markDispatcherActionDispatched).toHaveBeenCalledWith(DISPATCHER_ACTION_ID, null);
  });

  it('refuses to record an approval that is not an override', async () => {
    findDispatcherAction.mockResolvedValueOnce(approvalRecord({ actionType: 'stop_skip' }));

    const response = await postOverride({ dispatcherActionId: DISPATCHER_ACTION_ID, summary: 'Held by radio' });
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error.code).toBe('APPROVAL_MISMATCH');
    expect(claimDispatcherAction).not.toHaveBeenCalled();
  });

  it('leaves the approval retryable when the audit write fails — the audit record is the whole deliverable', async () => {
    findDispatcherAction.mockResolvedValueOnce(overrideApproval);
    claimDispatcherAction.mockResolvedValueOnce(overrideApproval);
    recordAuditEvent.mockRejectedValueOnce(new Error('ops_audit_log unavailable'));

    await expect(postOverride({ dispatcherActionId: DISPATCHER_ACTION_ID, summary: 'Held by radio' })).rejects.toThrow(
      /ops_audit_log unavailable/,
    );

    expect(releaseDispatcherActionClaim).toHaveBeenCalledWith(DISPATCHER_ACTION_ID, expect.stringContaining('ops_audit_log'));
    expect(markDispatcherActionDispatched).not.toHaveBeenCalled();
  });
});

describe('POST /api/ops/control-room/commands — guards', () => {
  it('rejects a cross-origin request before doing anything else', async () => {
    const request = new NextRequest('http://localhost:3000/api/ops/control-room/commands', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.example', host: 'localhost:3000' },
      body: JSON.stringify(commandBody()),
    });
    const { POST } = await import('@/app/api/ops/control-room/commands/route');
    const response = await POST(request as never);

    expect(response.status).toBe(403);
    expect(requireOpsRole).not.toHaveBeenCalled();
  });

  it('requires the control_room role', async () => {
    await postCommand(commandBody());
    expect(requireOpsRole).toHaveBeenCalledWith(['control_room']);
  });

  it('releases the claim and reports a retryable 503 when the control service is unavailable', async () => {
    createControlServiceCommand.mockRejectedValueOnce(new ControlServiceUnavailableError('circuit open'));

    const response = await postCommand(commandBody());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error.code).toBe('CONTROL_SERVICE_UNAVAILABLE');
    // Releasing leaves consumed_at NULL, so the human approval is not burned
    // by an infrastructure failure — the old flow consumed it before dispatch
    // with no un-consume path anywhere.
    expect(releaseDispatcherActionClaim).toHaveBeenCalledWith(DISPATCHER_ACTION_ID, expect.any(String));
    expect(markDispatcherActionDispatched).not.toHaveBeenCalled();
  });
});
