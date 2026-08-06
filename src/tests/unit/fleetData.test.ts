// @vitest-environment node
//
// getOpsFleetSnapshot/getOpsVehicleSchedule are Node-only (server-only,
// fetch to an upstream HTTP endpoint), same rationale as
// src/tests/unit/rbac.test.ts for its per-file node environment.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('getOpsFleetSnapshot', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.NEXT_PUBLIC_DEMO_MODE;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns a live snapshot when the upstream responds with usable records', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => 'application/json' },
        text: async () =>
          JSON.stringify([
            { regNum: 'UP25FT4823', latitude: 28.35, longitude: 79.42, speed: 10, timestamp: new Date().toISOString() },
          ]),
      }),
    );

    const { getOpsFleetSnapshot } = await import('@/lib/ops/fleetData');
    const snapshot = await getOpsFleetSnapshot();

    expect(snapshot.source).toBe('live');
    expect(snapshot.stale).toBe(false);
    expect(snapshot.error).toBeNull();
    expect(snapshot.buses).toHaveLength(1);
    expect(snapshot.buses[0]?.registrationNumber).toBe('UP25FT4823');
  });

  it('falls back to the bundled fixture, with a visible error, when the upstream is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unreachable')));

    const { getOpsFleetSnapshot } = await import('@/lib/ops/fleetData');
    const snapshot = await getOpsFleetSnapshot();

    expect(snapshot.source).toBe('fixture');
    expect(snapshot.stale).toBe(true);
    expect(snapshot.error).toBeTruthy();
    // The bundled fixture must still produce a non-empty, renderable fleet —
    // never a blank dashboard.
    expect(snapshot.buses.length).toBeGreaterThan(0);
  });

  it('serves the last-known-good cached snapshot (flagged stale) when a later call fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        text: async () =>
          JSON.stringify([
            { regNum: 'UP25FT4823', latitude: 28.35, longitude: 79.42, speed: 10, timestamp: new Date().toISOString() },
          ]),
      })
      .mockRejectedValue(new Error('network unreachable'));
    vi.stubGlobal('fetch', fetchMock);

    const { getOpsFleetSnapshot } = await import('@/lib/ops/fleetData');

    const first = await getOpsFleetSnapshot(Date.now());
    expect(first.source).toBe('live');

    // Advance past the 15s in-module TTL so the second call re-fetches
    // instead of serving the fresh cache.
    const second = await getOpsFleetSnapshot(Date.now() + 20_000);
    expect(second.source).toBe('cache');
    expect(second.stale).toBe(true);
    expect(second.error).toBeTruthy();
    expect(second.buses).toHaveLength(1);
  });
});

describe('getOpsVehicleSchedule', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.NEXT_PUBLIC_DEMO_MODE;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects a malformed registration number without calling upstream', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { getOpsVehicleSchedule } = await import('@/lib/ops/fleetData');
    const result = await getOpsVehicleSchedule('not a reg number');

    expect(result.schedule).toBeNull();
    expect(result.error).toMatch(/malformed/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to the bundled fixture when the upstream is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unreachable')));

    const { getOpsVehicleSchedule } = await import('@/lib/ops/fleetData');
    const result = await getOpsVehicleSchedule('UP25FT4823');

    expect(result.source).toBe('fixture');
    expect(result.stale).toBe(true);
    expect(result.error).toBeTruthy();
  });
});
