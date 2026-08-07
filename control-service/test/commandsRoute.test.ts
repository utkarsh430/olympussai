// POST /v1/commands integration: request validation, dispatcherActionId
// requirement, and the happy path through to webhook dispatch.
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
const { createCommand } = await import('../src/db/commands.js');
const { dispatchWebhook } = await import('../src/webhooks/dispatch.js');
const { AppError } = await import('../src/lib/errors.js');

const AUTH_HEADER = 'Bearer test-service-token-secret-value';

describe('POST /v1/commands', () => {
  beforeEach(() => {
    vi.mocked(createCommand).mockReset();
    vi.mocked(dispatchWebhook).mockReset();
  });

  it('rejects a request missing dispatcherActionId', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/v1/commands')
      .set('Authorization', AUTH_HEADER)
      .send({
        vehicleId: 'veh-1',
        actionType: 'self_equalizing_hold',
        ttlSeconds: 120,
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_request');
    expect(createCommand).not.toHaveBeenCalled();
  });

  it('rejects a request with a non-UUID dispatcherActionId', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/v1/commands')
      .set('Authorization', AUTH_HEADER)
      .send({
        vehicleId: 'veh-1',
        actionType: 'self_equalizing_hold',
        ttlSeconds: 120,
        dispatcherActionId: 'not-a-uuid',
      });

    expect(res.status).toBe(400);
    expect(createCommand).not.toHaveBeenCalled();
  });

  it('requires the service token even for a well-formed request', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/v1/commands')
      .send({
        vehicleId: 'veh-1',
        actionType: 'self_equalizing_hold',
        ttlSeconds: 120,
        dispatcherActionId: '00000000-0000-0000-0000-000000000000',
      });

    expect(res.status).toBe(401);
    expect(createCommand).not.toHaveBeenCalled();
  });

  it('creates the command and dispatches a webhook on a valid request', async () => {
    const command = {
      id: 'cmd-1',
      recommendationId: null,
      vehicleId: 'veh-1',
      tripId: null,
      actionType: 'self_equalizing_hold',
      targetStopId: null,
      parameters: {},
      dispatcherActionId: '00000000-0000-0000-0000-000000000000',
      ttlSeconds: 120,
      validFrom: new Date().toISOString(),
      expiresAt: new Date().toISOString(),
      policyVersion: null,
      status: 'authorized',
      version: 1,
      supersedesCommandId: null,
      deliveredAt: null,
      acknowledgedAt: null,
      acknowledgementReason: null,
      ackOutcome: null,
      createdAt: new Date().toISOString(),
    };
    vi.mocked(createCommand).mockResolvedValueOnce(command);
    vi.mocked(dispatchWebhook).mockResolvedValueOnce({
      delivered: true,
      attempts: 1,
      idempotencyKey: 'cmd-1',
      status: 200,
    });

    const app = createApp();
    const res = await request(app)
      .post('/v1/commands')
      .set('Authorization', AUTH_HEADER)
      .send({
        vehicleId: 'veh-1',
        actionType: 'self_equalizing_hold',
        ttlSeconds: 120,
        dispatcherActionId: '00000000-0000-0000-0000-000000000000',
      });

    expect(res.status).toBe(201);
    expect(res.body.command.id).toBe('cmd-1');
    expect(res.body.webhookDelivered).toBe(true);
    expect(createCommand).toHaveBeenCalledTimes(1);
    expect(dispatchWebhook).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'command.created', idempotencyKey: 'cmd-1' }),
    );
  });

  it('propagates a dispatcher_action_invalid rejection from createCommand as a 422', async () => {
    vi.mocked(createCommand).mockRejectedValueOnce(
      new AppError('dispatcher_action_invalid', 'dispatcher_action ... is already consumed', 422),
    );

    const app = createApp();
    const res = await request(app)
      .post('/v1/commands')
      .set('Authorization', AUTH_HEADER)
      .send({
        vehicleId: 'veh-1',
        actionType: 'self_equalizing_hold',
        ttlSeconds: 120,
        dispatcherActionId: '00000000-0000-0000-0000-000000000000',
      });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('dispatcher_action_invalid');
    expect(dispatchWebhook).not.toHaveBeenCalled();
  });
});
