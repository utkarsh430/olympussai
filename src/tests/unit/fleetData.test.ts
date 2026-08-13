// @vitest-environment node
//
// getOpsFleetSnapshot/getOpsVehicleSchedule are Node-only (server-only,
// fetch to an upstream HTTP endpoint), same rationale as
// src/tests/unit/rbac.test.ts for its per-file node environment.
//
// The governing principle these tests defend: every algorithm and system
// operates on live data obtained from the APIs — never assumed or placeholder
// data. The bundled fixture may only stand in for a failed live call when
// someone has explicitly asked for it (ALLOW_FIXTURE_FALLBACK, or the
// deliberate NEXT_PUBLIC_DEMO_MODE=1 offline demo); otherwise an outage
// produces an explicit 'unavailable' state with zero rows.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OPS_FLEET_SCOPE_ALL } from '@/lib/ops/depotScope';

/** One usable live vehicle, as the upstream would return it. */
function upstreamOk(rows: unknown[]) {
  return {
    ok: true,
    headers: { get: () => 'application/json' },
    text: async () => JSON.stringify(rows),
  };
}

const ONE_BUS = [
  { regNum: 'UP25FT4823', latitude: 28.35, longitude: 79.42, speed: 10, timestamp: new Date().toISOString() },
];

function clearFixtureEnv() {
  delete process.env.NEXT_PUBLIC_DEMO_MODE;
  delete process.env.ALLOW_FIXTURE_FALLBACK;
}

describe('getOpsFleetSnapshot', () => {
  beforeEach(() => {
    vi.resetModules();
    clearFixtureEnv();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearFixtureEnv();
  });

  it('returns a live snapshot when the upstream responds with usable records', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(upstreamOk(ONE_BUS)));

    const { getOpsFleetSnapshot } = await import('@/lib/ops/fleetData');
    const snapshot = await getOpsFleetSnapshot(OPS_FLEET_SCOPE_ALL);

    expect(snapshot.source).toBe('live');
    expect(snapshot.stale).toBe(false);
    expect(snapshot.error).toBeNull();
    expect(snapshot.buses).toHaveLength(1);
    expect(snapshot.buses[0]?.registrationNumber).toBe('UP25FT4823');
  });

  // THE REGRESSION TEST. Against the previous implementation this failed:
  // an unreachable upstream silently returned `source: 'fixture'` with the
  // bundled sample fleet, so a dispatcher saw demo buses that do not exist in
  // the same table as real ones. With no explicit opt-in the answer must now
  // be an empty, explicitly-unavailable snapshot.
  it('returns an explicit unavailable state with ZERO rows — never fixture rows — when the upstream is unreachable and the fallback is not enabled', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unreachable')));

    const { getOpsFleetSnapshot } = await import('@/lib/ops/fleetData');
    const snapshot = await getOpsFleetSnapshot(OPS_FLEET_SCOPE_ALL);

    expect(snapshot.source).toBe('unavailable');
    expect(snapshot.buses).toHaveLength(0);
    expect(snapshot.source).not.toBe('fixture');
    // The reason the live call failed is preserved, not swallowed.
    expect(snapshot.error).toMatch(/network unreachable/i);
    expect(snapshot.message).toMatch(/unavailable/i);
  });

  it('serves the bundled fixture when ALLOW_FIXTURE_FALLBACK is explicitly enabled', async () => {
    process.env.ALLOW_FIXTURE_FALLBACK = '1';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unreachable')));

    const { getOpsFleetSnapshot } = await import('@/lib/ops/fleetData');
    const snapshot = await getOpsFleetSnapshot(OPS_FLEET_SCOPE_ALL);

    expect(snapshot.source).toBe('fixture');
    expect(snapshot.stale).toBe(true);
    expect(snapshot.error).toBeTruthy();
    expect(snapshot.buses.length).toBeGreaterThan(0);
  });

  it('treats an unrecognized ALLOW_FIXTURE_FALLBACK value as off', async () => {
    process.env.ALLOW_FIXTURE_FALLBACK = 'maybe';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unreachable')));

    const { getOpsFleetSnapshot } = await import('@/lib/ops/fleetData');
    const snapshot = await getOpsFleetSnapshot(OPS_FLEET_SCOPE_ALL);

    expect(snapshot.source).toBe('unavailable');
    expect(snapshot.buses).toHaveLength(0);
  });

  it('serves the fixture under NEXT_PUBLIC_DEMO_MODE=1 regardless of the fallback flag, without calling the upstream', async () => {
    process.env.NEXT_PUBLIC_DEMO_MODE = '1';
    // Flag explicitly OFF: demo mode is its own deliberate switch and must
    // keep working for presentations without connectivity.
    process.env.ALLOW_FIXTURE_FALLBACK = '0';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { getOpsFleetSnapshot } = await import('@/lib/ops/fleetData');
    const snapshot = await getOpsFleetSnapshot(OPS_FLEET_SCOPE_ALL);

    expect(snapshot.source).toBe('fixture');
    expect(snapshot.buses.length).toBeGreaterThan(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('serves the last-known-good cached snapshot (flagged stale) when a later call fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(upstreamOk(ONE_BUS))
      .mockRejectedValue(new Error('network unreachable'));
    vi.stubGlobal('fetch', fetchMock);

    const { getOpsFleetSnapshot } = await import('@/lib/ops/fleetData');

    const first = await getOpsFleetSnapshot(OPS_FLEET_SCOPE_ALL, Date.now());
    expect(first.source).toBe('live');

    // Advance past the 15s in-module TTL so the second call re-fetches
    // instead of serving the fresh cache.
    const second = await getOpsFleetSnapshot(OPS_FLEET_SCOPE_ALL, Date.now() + 20_000);
    expect(second.source).toBe('cache');
    expect(second.stale).toBe(true);
    expect(second.error).toBeTruthy();
    expect(second.buses).toHaveLength(1);
  });

  // Serving a recently-cached REAL response is legitimate degradation, not
  // placeholder data: the flag must not touch it in either direction.
  it('does not downgrade a fresh cache hit to unavailable', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(upstreamOk(ONE_BUS));
    vi.stubGlobal('fetch', fetchMock);

    const { getOpsFleetSnapshot } = await import('@/lib/ops/fleetData');

    const now = Date.now();
    const first = await getOpsFleetSnapshot(OPS_FLEET_SCOPE_ALL, now);
    expect(first.source).toBe('live');

    // Well inside the 15s TTL — served from cache, still fresh, still real.
    const second = await getOpsFleetSnapshot(OPS_FLEET_SCOPE_ALL, now + 1_000);
    expect(second.source).toBe('cache');
    expect(second.stale).toBe(false);
    expect(second.error).toBeNull();
    expect(second.buses).toHaveLength(1);
    // One upstream call total: the cache answered the second.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('distinguishes "upstream unreachable" from "upstream answered with zero vehicles"', async () => {
    // A quiet night: the upstream answered normally with an empty list.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(upstreamOk([])));
    const { getOpsFleetSnapshot: quietNight } = await import('@/lib/ops/fleetData');
    const empty = await quietNight(OPS_FLEET_SCOPE_ALL);

    vi.resetModules();
    vi.unstubAllGlobals();

    // An incident: the upstream could not be reached at all.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unreachable')));
    const { getOpsFleetSnapshot: outage } = await import('@/lib/ops/fleetData');
    const unreachable = await outage(OPS_FLEET_SCOPE_ALL);

    // Both show zero vehicles...
    expect(empty.buses).toHaveLength(0);
    expect(unreachable.buses).toHaveLength(0);

    // ...but they are not the same state, and must never be conflated.
    expect(empty.source).toBe('live');
    expect(empty.stale).toBe(false);
    expect(empty.error).toBeNull();

    expect(unreachable.source).toBe('unavailable');
    expect(unreachable.stale).toBe(true);
    expect(unreachable.error).toBeTruthy();

    expect(empty.source).not.toBe(unreachable.source);
  });
});

describe('getOpsVehicleSchedule', () => {
  beforeEach(() => {
    vi.resetModules();
    clearFixtureEnv();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearFixtureEnv();
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

  // Companion regression test to the fleet one above: this also failed
  // against the previous implementation, which returned the bundled sample
  // schedule for an unreachable upstream.
  it('returns an explicit unavailable state — never a fixture schedule — when the upstream is unreachable and the fallback is not enabled', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unreachable')));

    const { getOpsVehicleSchedule } = await import('@/lib/ops/fleetData');
    const result = await getOpsVehicleSchedule('UP25FT4823');

    expect(result.source).toBe('unavailable');
    expect(result.source).not.toBe('fixture');
    expect(result.schedule).toBeNull();
    expect(result.error).toMatch(/network unreachable/i);
    expect(result.message).toMatch(/unavailable/i);
  });

  it('serves the bundled fixture schedule when ALLOW_FIXTURE_FALLBACK is explicitly enabled', async () => {
    process.env.ALLOW_FIXTURE_FALLBACK = 'true';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unreachable')));

    const { getOpsVehicleSchedule } = await import('@/lib/ops/fleetData');
    const result = await getOpsVehicleSchedule('UP25FT4823');

    expect(result.source).toBe('fixture');
    expect(result.stale).toBe(true);
    expect(result.error).toBeTruthy();
  });

  it('serves the fixture schedule under NEXT_PUBLIC_DEMO_MODE=1 regardless of the fallback flag', async () => {
    process.env.NEXT_PUBLIC_DEMO_MODE = '1';
    process.env.ALLOW_FIXTURE_FALLBACK = '0';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { getOpsVehicleSchedule } = await import('@/lib/ops/fleetData');
    const result = await getOpsVehicleSchedule('UP25FT4823');

    expect(result.source).toBe('fixture');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('distinguishes "upstream unreachable" from "vehicle genuinely has no assignment"', async () => {
    // Every candidate date answers, none carries an assignment.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(upstreamOk([])));
    const { getOpsVehicleSchedule: assigned } = await import('@/lib/ops/fleetData');
    const noAssignment = await assigned('UP25FT4823');

    vi.resetModules();
    vi.unstubAllGlobals();

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unreachable')));
    const { getOpsVehicleSchedule: outage } = await import('@/lib/ops/fleetData');
    const unreachable = await outage('UP25FT4823');

    // Both have no schedule to show...
    expect(noAssignment.schedule).toBeNull();
    expect(unreachable.schedule).toBeNull();

    // ...but one is a fact about the roster and the other about the network.
    expect(noAssignment.source).toBe('live');
    expect(noAssignment.error).toBeNull();
    expect(noAssignment.message).toMatch(/no schedule assigned/i);

    expect(unreachable.source).toBe('unavailable');
    expect(unreachable.error).toBeTruthy();
  });
});
