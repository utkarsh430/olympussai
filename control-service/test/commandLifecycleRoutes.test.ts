// Route-level coverage for the command lifecycle endpoints added on top of
// POST /v1/commands (see test/commandsRoute.test.ts for that one):
// GET /v1/commands/:id, GET /v1/commands/:id/audit,
// POST /v1/commands/:id/deliver, POST /v1/commands/:id/ack,
// POST /v1/commands/:id/supersede. Mocks the db layer (src/db/commands.ts,
// src/db/commandAudit.ts) the same way test/commandsRoute.test.ts does, so
// this only proves request validation + status-code + webhook-dispatch
// wiring, not the transactional DB logic (that's test/commandLifecycleDb.test.ts).
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
const {
  getCommandById,
  deliverCommand,
  acknowledgeCommand,
  supersedeCommand,
} = await import('../src/db/commands.js');
const { listCommandAuditLog } = await import('../src/db/commandAudit.js');
const { dispatchWebhook } = await import('../src/webhooks/dispatch.js');
const { AppError } = await import('../src/lib/errors.js');

const AUTH_HEADER = 'Bearer test-service-token-secret-value';
const COMMAND_ID = '22222222-2222-2222-2222-222222222222';

function sampleCommand(overrides: Record<string, unknown> = {}) {
  return {
    id: COMMAND_ID,
    recommendationId: null,
    vehicleId: 'veh-1',
    tripId: null,
    actionType: 'self_equalizing_hold',
    targetStopId: null,
    parameters: {},
    dispatcherActionId: '00000000-0000-0000-0000-000000000000',
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
  vi.mocked(getCommandById).mockReset();
  vi.mocked(deliverCommand).mockReset();
  vi.mocked(acknowledgeCommand).mockReset();
  vi.mocked(supersedeCommand).mockReset();
  vi.mocked(listCommandAuditLog).mockReset();
  vi.mocked(dispatchWebhook).mockReset();
  vi.mocked(dispatchWebhook).mockResolvedValue({ delivered: true, attempts: 1, idempotencyKey: 'k', status: 200 });
});

describe('GET /v1/commands/:id', () => {
  it('404s for an unknown command', async () => {
    vi.mocked(getCommandById).mockResolvedValueOnce(null);
    const app = createApp();
    const res = await request(app).get(`/v1/commands/${COMMAND_ID}`).set('Authorization', AUTH_HEADER);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('command_not_found');
  });

  it('rejects a non-UUID id', async () => {
    const app = createApp();
    const res = await request(app).get('/v1/commands/not-a-uuid').set('Authorization', AUTH_HEADER);
    expect(res.status).toBe(400);
    expect(getCommandById).not.toHaveBeenCalled();
  });

  it('returns the command', async () => {
    vi.mocked(getCommandById).mockResolvedValueOnce(sampleCommand());
    const app = createApp();
    const res = await request(app).get(`/v1/commands/${COMMAND_ID}`).set('Authorization', AUTH_HEADER);
    expect(res.status).toBe(200);
    expect(res.body.command.id).toBe(COMMAND_ID);
  });
});

describe('GET /v1/commands/:id/audit', () => {
  it('returns the full ordered audit trail for a known command', async () => {
    vi.mocked(getCommandById).mockResolvedValueOnce(sampleCommand({ status: 'delivered' }));
    vi.mocked(listCommandAuditLog).mockResolvedValueOnce([
      {
        id: 'audit-1',
        commandId: COMMAND_ID,
        eventType: 'created',
        fromStatus: null,
        toStatus: 'authorized',
        actorType: 'dispatcher',
        actorId: null,
        reason: null,
        metadata: {},
        occurredAt: new Date().toISOString(),
      },
      {
        id: 'audit-2',
        commandId: COMMAND_ID,
        eventType: 'delivered',
        fromStatus: 'authorized',
        toStatus: 'delivered',
        actorType: 'system',
        actorId: null,
        reason: 'delivered to recipient',
        metadata: {},
        occurredAt: new Date().toISOString(),
      },
    ]);

    const app = createApp();
    const res = await request(app).get(`/v1/commands/${COMMAND_ID}/audit`).set('Authorization', AUTH_HEADER);

    expect(res.status).toBe(200);
    expect(res.body.auditLog).toHaveLength(2);
    expect(res.body.auditLog[0].eventType).toBe('created');
    expect(res.body.auditLog[1].eventType).toBe('delivered');
  });

  it('404s for an unknown command instead of returning an empty log', async () => {
    vi.mocked(getCommandById).mockResolvedValueOnce(null);
    const app = createApp();
    const res = await request(app).get(`/v1/commands/${COMMAND_ID}/audit`).set('Authorization', AUTH_HEADER);
    expect(res.status).toBe(404);
    expect(listCommandAuditLog).not.toHaveBeenCalled();
  });
});

describe('POST /v1/commands/:id/deliver', () => {
  it('delivers an authorized command and dispatches a webhook', async () => {
    vi.mocked(deliverCommand).mockResolvedValueOnce(sampleCommand({ status: 'delivered' }));
    const app = createApp();
    const res = await request(app).post(`/v1/commands/${COMMAND_ID}/deliver`).set('Authorization', AUTH_HEADER);

    expect(res.status).toBe(200);
    expect(res.body.command.status).toBe('delivered');
    expect(dispatchWebhook).toHaveBeenCalledWith(expect.objectContaining({ type: 'command.delivered' }));
  });

  it('propagates a command_expired rejection as a 410 without dispatching a webhook', async () => {
    vi.mocked(deliverCommand).mockRejectedValueOnce(
      new AppError('command_expired', 'command has expired and cannot be delivered', 410),
    );
    const app = createApp();
    const res = await request(app).post(`/v1/commands/${COMMAND_ID}/deliver`).set('Authorization', AUTH_HEADER);

    expect(res.status).toBe(410);
    expect(res.body.error.code).toBe('command_expired');
    expect(dispatchWebhook).not.toHaveBeenCalled();
  });

  it('propagates a command_not_authorized rejection as a 409 (approval-required queue gate)', async () => {
    vi.mocked(deliverCommand).mockRejectedValueOnce(
      new AppError('command_not_authorized', 'command must be authorized first', 409),
    );
    const app = createApp();
    const res = await request(app).post(`/v1/commands/${COMMAND_ID}/deliver`).set('Authorization', AUTH_HEADER);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('command_not_authorized');
  });
});

describe('POST /v1/commands/:id/ack', () => {
  it('rejects a payload with an invalid outcome', async () => {
    const app = createApp();
    const res = await request(app)
      .post(`/v1/commands/${COMMAND_ID}/ack`)
      .set('Authorization', AUTH_HEADER)
      .send({ outcome: 'maybe', actorId: 'driver-1' });

    expect(res.status).toBe(400);
    expect(acknowledgeCommand).not.toHaveBeenCalled();
  });

  it('rejects a payload missing actorId', async () => {
    const app = createApp();
    const res = await request(app)
      .post(`/v1/commands/${COMMAND_ID}/ack`)
      .set('Authorization', AUTH_HEADER)
      .send({ outcome: 'accept' });

    expect(res.status).toBe(400);
    expect(acknowledgeCommand).not.toHaveBeenCalled();
  });

  it.each(['accept', 'unable', 'unsafe'] as const)('accepts a valid %s ack and records it', async (outcome) => {
    const nextStatus = outcome === 'accept' ? 'executing' : 'failed';
    vi.mocked(acknowledgeCommand).mockResolvedValueOnce(
      sampleCommand({ status: nextStatus, ackOutcome: outcome, acknowledgedAt: new Date().toISOString() }),
    );

    const app = createApp();
    const res = await request(app)
      .post(`/v1/commands/${COMMAND_ID}/ack`)
      .set('Authorization', AUTH_HEADER)
      .send({ outcome, actorId: 'driver-1', reason: outcome === 'accept' ? undefined : 'brakes flagged' });

    expect(res.status).toBe(200);
    expect(res.body.command.ackOutcome).toBe(outcome);
    expect(acknowledgeCommand).toHaveBeenCalledWith(
      COMMAND_ID,
      expect.objectContaining({ outcome, actorId: 'driver-1' }),
    );
  });
});

describe('POST /v1/commands/:id/supersede', () => {
  it('requires a fresh dispatcherActionId', async () => {
    const app = createApp();
    const res = await request(app)
      .post(`/v1/commands/${COMMAND_ID}/supersede`)
      .set('Authorization', AUTH_HEADER)
      .send({ ttlSeconds: 90 });

    expect(res.status).toBe(400);
    expect(supersedeCommand).not.toHaveBeenCalled();
  });

  it('supersedes the command and dispatches a webhook naming the prior id', async () => {
    vi.mocked(supersedeCommand).mockResolvedValueOnce(
      sampleCommand({ id: 'cmd-new', version: 2, supersedesCommandId: COMMAND_ID }),
    );

    const app = createApp();
    const res = await request(app)
      .post(`/v1/commands/${COMMAND_ID}/supersede`)
      .set('Authorization', AUTH_HEADER)
      .send({ dispatcherActionId: '33333333-3333-3333-3333-333333333333', ttlSeconds: 90 });

    expect(res.status).toBe(201);
    expect(res.body.command.version).toBe(2);
    expect(dispatchWebhook).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'command.superseded', data: expect.objectContaining({ supersedesCommandId: COMMAND_ID }) }),
    );
  });
});
