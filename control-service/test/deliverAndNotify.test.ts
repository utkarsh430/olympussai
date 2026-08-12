// Unit coverage for src/commands/deliverAndNotify.ts - the single delivery
// event every caller (the /deliver route, the inline attempt after
// create/supersede, and commandDeliverySweep) shares. What matters here is
// the idempotency key format (load-bearing: it's the primary key of
// ops_control_service_webhook_events on the web side) and that a failed
// webhook delivery is logged, not thrown.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/db/commands.js', () => ({
  deliverCommand: vi.fn(),
}));

vi.mock('../src/webhooks/dispatch.js', () => ({
  dispatchWebhook: vi.fn(),
}));

const { deliverCommand } = await import('../src/db/commands.js');
const { dispatchWebhook } = await import('../src/webhooks/dispatch.js');
const { deliverAndNotify } = await import('../src/commands/deliverAndNotify.js');
const { AppError } = await import('../src/lib/errors.js');

function sampleCommand(overrides: Record<string, unknown> = {}) {
  return {
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
    expiresAt: new Date(Date.now() + 120_000).toISOString(),
    policyVersion: null,
    status: 'delivered',
    version: 1,
    supersedesCommandId: null,
    deliveredAt: new Date().toISOString(),
    acknowledgedAt: null,
    acknowledgementReason: null,
    ackOutcome: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(deliverCommand).mockReset();
  vi.mocked(dispatchWebhook).mockReset();
});

describe('deliverAndNotify', () => {
  it('delivers the command and dispatches command.delivered with the load-bearing idempotency key format', async () => {
    const command = sampleCommand({ id: 'cmd-1', version: 3 });
    vi.mocked(deliverCommand).mockResolvedValueOnce(command);
    vi.mocked(dispatchWebhook).mockResolvedValueOnce({
      delivered: true,
      attempts: 1,
      idempotencyKey: 'cmd-1:delivered:v3',
      status: 200,
    });

    const result = await deliverAndNotify('cmd-1');

    expect(deliverCommand).toHaveBeenCalledWith('cmd-1');
    expect(dispatchWebhook).toHaveBeenCalledWith({
      type: 'command.delivered',
      idempotencyKey: 'cmd-1:delivered:v3',
      data: { command },
    });
    expect(result.command).toBe(command);
    expect(result.delivery.delivered).toBe(true);
  });

  it('does not throw when the webhook delivery itself fails', async () => {
    vi.mocked(deliverCommand).mockResolvedValueOnce(sampleCommand());
    vi.mocked(dispatchWebhook).mockResolvedValueOnce({
      delivered: false,
      attempts: 3,
      idempotencyKey: 'cmd-1:delivered:v1',
      status: 503,
    });

    const result = await deliverAndNotify('cmd-1');

    expect(result.delivery.delivered).toBe(false);
  });

  it('propagates a deliverCommand rejection without dispatching a webhook', async () => {
    vi.mocked(deliverCommand).mockRejectedValueOnce(
      new AppError('command_expired', 'command has expired and cannot be delivered', 410),
    );

    await expect(deliverAndNotify('cmd-1')).rejects.toMatchObject({ code: 'command_expired', status: 410 });
    expect(dispatchWebhook).not.toHaveBeenCalled();
  });
});
