// @vitest-environment node
//
// fetchActiveCommandForVehicle/acknowledgeCommand are server-only, same
// rationale as src/tests/unit/controlServiceClient.test.ts.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/controlService/client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/controlService/client')>(
    '@/lib/controlService/client',
  );
  return { ...actual, fetchControlService: vi.fn() };
});

describe('driver PWA control-service command calls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetchActiveCommandForVehicle returns null when there is no active command', async () => {
    const { fetchControlService } = await import('@/lib/controlService/client');
    vi.mocked(fetchControlService).mockResolvedValueOnce({ command: null });

    const { fetchActiveCommandForVehicle } = await import('@/lib/controlService/commands');
    const result = await fetchActiveCommandForVehicle('veh-1');

    expect(result).toBeNull();
    expect(fetchControlService).toHaveBeenCalledWith('/v1/commands/active', {
      method: 'GET',
      query: { vehicleId: 'veh-1' },
    });
  });

  it('fetchActiveCommandForVehicle throws a shape error on a malformed response', async () => {
    const { fetchControlService } = await import('@/lib/controlService/client');
    vi.mocked(fetchControlService).mockResolvedValueOnce({ notACommand: true });

    const { fetchActiveCommandForVehicle, ControlServiceResponseShapeError } = await import(
      '@/lib/controlService/commands'
    );
    await expect(fetchActiveCommandForVehicle('veh-1')).rejects.toBeInstanceOf(ControlServiceResponseShapeError);
  });

  it('acknowledgeCommand posts outcome/reason/actorId and returns the updated command', async () => {
    const command = {
      id: 'cmd-1',
      recommendationId: null,
      vehicleId: 'veh-1',
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
      acknowledgedAt: '2026-08-06T06:01:00Z',
      acknowledgementReason: null,
    };
    const { fetchControlService } = await import('@/lib/controlService/client');
    vi.mocked(fetchControlService).mockResolvedValueOnce({ command, webhookDelivered: true });

    const { acknowledgeCommand } = await import('@/lib/controlService/commands');
    const result = await acknowledgeCommand('cmd-1', { outcome: 'accept', actorId: 'user-1' });

    expect(result).toEqual(command);
    expect(fetchControlService).toHaveBeenCalledWith('/v1/commands/cmd-1/ack', {
      method: 'POST',
      body: { outcome: 'accept', reason: null, actorId: 'user-1' },
    });
  });
});
