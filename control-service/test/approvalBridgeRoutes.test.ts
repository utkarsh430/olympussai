// Route-level coverage for the approval bridge on top of POST /v1/commands
// (see test/commandsRoute.test.ts for the pre-existing POST cases and
// test/approvalBridge.test.ts for the schema/transaction layer):
//   - the inline `dispatcherAction` mirror reaching createCommand intact
//   - the two cross-field rejections, refused at the wire with a 400 before
//     any database work happens
//   - routeDirectionId failing closed at the wire
//   - GET /v1/commands/by-dispatcher-action/:dispatcherActionId, the
//     reconciliation read that resolves "control returned 201 but the caller
//     never saw it"
// Mocks the db layer exactly as test/commandsRoute.test.ts does, so this
// proves request validation + status-code wiring only.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../src/db/pool.js', () => ({
  pingDb: vi.fn(),
  getPool: vi.fn(),
  closePool: vi.fn(),
}));

vi.mock('../src/db/commands.js', () => ({
  createCommand: vi.fn(),
  getCommandById: vi.fn(),
  getCommandByDispatcherActionId: vi.fn(),
  getActiveDeliveredCommandForVehicle: vi.fn(),
  deliverCommand: vi.fn(),
  acknowledgeCommand: vi.fn(),
  supersedeCommand: vi.fn(),
}));

vi.mock('../src/db/commandAudit.js', () => ({
  listCommandAuditLog: vi.fn(),
}));

vi.mock('../src/webhooks/dispatch.js', () => ({
  dispatchWebhook: vi.fn(),
}));

const { createApp } = await import('../src/app.js');
const { createCommand, getCommandByDispatcherActionId } = await import('../src/db/commands.js');
const { dispatchWebhook } = await import('../src/webhooks/dispatch.js');
const { AppError } = await import('../src/lib/errors.js');

const AUTH_HEADER = 'Bearer test-service-token-secret-value';
const DISPATCHER_ACTION_ID = '33333333-3333-3333-3333-333333333333';
const ROUTE_DIRECTION_ID = '44444444-4444-4444-4444-444444444444';

const inlineAction = {
  id: DISPATCHER_ACTION_ID,
  dispatcherId: 'ops-user-1',
  actionType: 'self_equalizing_hold',
  routeDirectionId: ROUTE_DIRECTION_ID,
  vehicleId: 'veh-1',
  incidentId: null,
  reason: 'Bunching on the northbound leg',
  authorizedAt: '2026-08-08T09:00:00.000Z',
};

function createBody(overrides: Record<string, unknown> = {}) {
  return {
    vehicleId: 'veh-1',
    actionType: 'self_equalizing_hold',
    ttlSeconds: 120,
    dispatcherActionId: DISPATCHER_ACTION_ID,
    dispatcherAction: inlineAction,
    ...overrides,
  };
}

function sampleCommand(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cmd-1',
    recommendationId: null,
    vehicleId: 'veh-1',
    tripId: null,
    actionType: 'self_equalizing_hold',
    targetStopId: null,
    parameters: {},
    dispatcherActionId: DISPATCHER_ACTION_ID,
    ttlSeconds: 120,
    validFrom: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 120_000).toISOString(),
    policyVersion: null,
    status: 'authorized',
    version: 1,
    supersedesCommandId: null,
    deliveredAt: null,
    acknowledgedAt: null,
    acknowledgementReason: null,
    ackOutcome: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(createCommand).mockReset();
  vi.mocked(getCommandByDispatcherActionId).mockReset();
  vi.mocked(dispatchWebhook).mockReset();
  vi.mocked(dispatchWebhook).mockResolvedValue({
    delivered: true,
    attempts: 1,
    idempotencyKey: 'cmd-1',
    status: 200,
  });
});

describe('POST /v1/commands — inline dispatcher action', () => {
  it('passes the inline approval through to createCommand unchanged', async () => {
    vi.mocked(createCommand).mockResolvedValueOnce(sampleCommand());

    const res = await request(createApp()).post('/v1/commands').set('Authorization', AUTH_HEADER).send(createBody());

    expect(res.status).toBe(201);
    expect(createCommand).toHaveBeenCalledWith(expect.objectContaining({ dispatcherAction: inlineAction }));
  });

  it('rejects an inline approval whose id differs from dispatcherActionId, before touching the database', async () => {
    const res = await request(createApp())
      .post('/v1/commands')
      .set('Authorization', AUTH_HEADER)
      .send(createBody({ dispatcherAction: { ...inlineAction, id: '55555555-5555-5555-5555-555555555555' } }));

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_request');
    expect(createCommand).not.toHaveBeenCalled();
  });

  it('rejects an inline approval authorizing a different action than the command', async () => {
    // An approval authorizes ONE action, not any action. Without this check a
    // caller could get sign-off for `speed_guidance` and issue `stop_skip`
    // against it, and the audit trail would describe an action nobody
    // approved.
    const res = await request(createApp())
      .post('/v1/commands')
      .set('Authorization', AUTH_HEADER)
      .send(
        createBody({
          actionType: 'stop_skip',
          dispatcherAction: { ...inlineAction, actionType: 'speed_guidance' },
        }),
      );

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_request');
    expect(createCommand).not.toHaveBeenCalled();
  });

  it.each([
    ['null', null],
    ['absent', undefined],
  ])('refuses an inline approval whose routeDirectionId is %s (the rollout gate would be unenforceable)', async (_label, value) => {
    const action: Record<string, unknown> = { ...inlineAction };
    if (value === undefined) delete action.routeDirectionId;
    else action.routeDirectionId = value;

    const res = await request(createApp())
      .post('/v1/commands')
      .set('Authorization', AUTH_HEADER)
      .send(createBody({ dispatcherAction: action }));

    expect(res.status).toBe(400);
    expect(createCommand).not.toHaveBeenCalled();
  });

  it('propagates a route_direction_required rejection from the gate as a 422, with no webhook', async () => {
    // The other half of failing closed: a dispatcher_actions row that predates
    // the bridge (or was written by hand) carries no route_direction_id, so
    // the gate refuses rather than allowing an ungated command through.
    vi.mocked(createCommand).mockRejectedValueOnce(
      new AppError('route_direction_required', 'dispatcher_action carries no route_direction_id', 422),
    );

    const res = await request(createApp()).post('/v1/commands').set('Authorization', AUTH_HEADER).send(createBody());

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('route_direction_required');
    expect(dispatchWebhook).not.toHaveBeenCalled();
  });

  it('propagates the 409 that makes a retry safe rather than creating a second command', async () => {
    vi.mocked(createCommand).mockRejectedValueOnce(
      new AppError('dispatcher_action_already_used', 'dispatcherActionId has already authorized a command', 409),
    );

    const res = await request(createApp()).post('/v1/commands').set('Authorization', AUTH_HEADER).send(createBody());

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('dispatcher_action_already_used');
    expect(dispatchWebhook).not.toHaveBeenCalled();
  });
});

describe('GET /v1/commands/by-dispatcher-action/:dispatcherActionId', () => {
  it('returns the command an approval authorized', async () => {
    vi.mocked(getCommandByDispatcherActionId).mockResolvedValueOnce(sampleCommand());

    const res = await request(createApp())
      .get(`/v1/commands/by-dispatcher-action/${DISPATCHER_ACTION_ID}`)
      .set('Authorization', AUTH_HEADER);

    expect(res.status).toBe(200);
    expect(res.body.command.id).toBe('cmd-1');
    expect(getCommandByDispatcherActionId).toHaveBeenCalledWith(DISPATCHER_ACTION_ID);
  });

  it('404s when the approval never authorized a command', async () => {
    // A real answer, not an error: the caller uses it to distinguish "my
    // earlier attempt landed" from "nothing was created".
    vi.mocked(getCommandByDispatcherActionId).mockResolvedValueOnce(null);

    const res = await request(createApp())
      .get(`/v1/commands/by-dispatcher-action/${DISPATCHER_ACTION_ID}`)
      .set('Authorization', AUTH_HEADER);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('command_not_found');
  });

  it('400s a non-uuid dispatcher action id', async () => {
    const res = await request(createApp())
      .get('/v1/commands/by-dispatcher-action/not-a-uuid')
      .set('Authorization', AUTH_HEADER);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_request');
    expect(getCommandByDispatcherActionId).not.toHaveBeenCalled();
  });

  it('requires the service token', async () => {
    const res = await request(createApp()).get(`/v1/commands/by-dispatcher-action/${DISPATCHER_ACTION_ID}`);

    expect(res.status).toBe(401);
    expect(getCommandByDispatcherActionId).not.toHaveBeenCalled();
  });

  it('is not swallowed by GET /v1/commands/:id', async () => {
    // "by-dispatcher-action" is a literal segment on a three-segment path; if
    // route registration order ever regressed, the two-segment :id route
    // would answer this with a "not a valid UUID" 400 instead.
    vi.mocked(getCommandByDispatcherActionId).mockResolvedValueOnce(sampleCommand());

    const res = await request(createApp())
      .get(`/v1/commands/by-dispatcher-action/${DISPATCHER_ACTION_ID}`)
      .set('Authorization', AUTH_HEADER);

    expect(res.status).toBe(200);
  });
});
