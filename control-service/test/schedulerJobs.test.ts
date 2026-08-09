// The two jobs that carry real logic: the GPS poll and the headway sweep.
//
// Both are about doing LESS work than the naive version, and both have a
// specific failure mode if the filtering is wrong:
//
//  - gpsPoll: ingesting the ~8,600 non-Live rows would 9x the per-cycle
//    cost AND corrupt state, because a bus parked in a depot is nowhere
//    near a route shape and map-matches to `off_route`.
//  - headwayCompute: sweeping all ~1,020 active route-directions when only
//    a few dozen have two fresh vehicles is almost all waste, and the
//    round-robin cursor is what stops the tail of the list from never
//    being sampled at all.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadEnv, type Env } from '../src/config/env.js';
import { runGpsPoll, type LiveVehiclePosition } from '../src/scheduler/gpsPoll.js';
import {
  runHeadwayComputeSweep,
  selectBatch,
  _resetHeadwayCursorForTests,
} from '../src/scheduler/headwayCompute.js';
import type { HeadwayComputeResult } from '../src/headway/service.js';

/**
 * Minimal HeadwayComputeResult for sweep stubs.
 *
 * `pairs` matters: runHeadwayComputeSweep publishes the result into
 * stateStore for the MPC to read, so a stub returning `{}` would compile
 * against a loose type and silently re-create the empty-headway-map bug that
 * publish step exists to fix. Tests that care about the published rows pass
 * their own pairs.
 */
function computeResult(
  routeDirectionId: string,
  pairs: HeadwayComputeResult['pairs'] = [],
): HeadwayComputeResult {
  return {
    routeDirectionId,
    computedAt: new Date('2026-08-09T06:47:44.000Z').toISOString(),
    pairs,
    aggregate: {
      routeDirectionId,
      sampleCount: pairs.length,
      meanHeadwaySeconds: null,
      stddevHeadwaySeconds: null,
      cv: null,
      ewtSeconds: null,
      targetHeadwaySeconds: 600,
    },
    incidents: [],
  };
}

const NOW = Date.parse('2026-08-05T08:00:00.000Z');

function env(overrides: Partial<Env> = {}): Env {
  return { ...loadEnv(), ...overrides };
}

function livePosition(overrides: Partial<LiveVehiclePosition> = {}): LiveVehiclePosition {
  return {
    vehicleId: 'UP77AN2509',
    lat: 26.8467,
    lon: 80.9462,
    speedKmph: 32,
    headingDegrees: 91,
    observedAt: new Date(NOW - 10_000).toISOString(),
    status: 'Live',
    ...overrides,
  };
}

describe('runGpsPoll', () => {
  it('ingests only status=Live rows and reports fetched vs live', async () => {
    const ingest = vi.fn().mockResolvedValue({ accepted: 2, rejected: [] });

    const result = await runGpsPoll(env(), {
      now: () => NOW,
      ingest,
      fetchLiveFeed: () =>
        Promise.resolve({
          fetched: 9261,
          vehicles: [
            livePosition({ vehicleId: 'live-1' }),
            livePosition({ vehicleId: 'parked-1', status: 'Parked' }),
            livePosition({ vehicleId: 'live-2' }),
            livePosition({ vehicleId: 'offline-1', status: 'Offline' }),
          ],
        }),
    });

    expect(result.fetched).toBe(9261);
    expect(result.live).toBe(2);
    expect(result.ingested).toBe(2);
    const [events] = ingest.mock.calls[0] as [{ vehicleId: string }[]];
    expect(events.map((e) => e.vehicleId)).toEqual(['live-1', 'live-2']);
  });

  it('treats a stripped `status` as already-filtered rather than ingesting nothing', async () => {
    // If the shared upstream client applies the liveness filter itself and
    // drops the field, re-rejecting on it would silently ingest zero rows
    // while every log line still looked healthy.
    const ingest = vi.fn().mockResolvedValue({ accepted: 1, rejected: [] });
    const result = await runGpsPoll(env(), {
      now: () => NOW,
      ingest,
      fetchLiveFeed: () =>
        Promise.resolve({ fetched: 1, vehicles: [livePosition({ status: undefined })] }),
    });
    expect(result.live).toBe(1);
    expect(result.ingested).toBe(1);
  });

  it('drops fixes older than GPS_MAX_AGE_SECONDS instead of ingesting them', async () => {
    const ingest = vi.fn().mockResolvedValue({ accepted: 1, rejected: [] });

    const result = await runGpsPoll(env({ GPS_MAX_AGE_SECONDS: 300 }), {
      now: () => NOW,
      ingest,
      fetchLiveFeed: () =>
        Promise.resolve({
          fetched: 2,
          vehicles: [
            livePosition({ vehicleId: 'fresh', observedAt: new Date(NOW - 60_000).toISOString() }),
            livePosition({ vehicleId: 'ancient', observedAt: new Date(NOW - 3_600_000).toISOString() }),
          ],
        }),
    });

    expect(result.stale).toBe(1);
    const [events] = ingest.mock.calls[0] as [{ vehicleId: string }[]];
    expect(events.map((e) => e.vehicleId)).toEqual(['fresh']);
  });

  it('drops a fix with no parseable timestamp rather than stamping it "now"', async () => {
    // Inventing an observed_at would let an arbitrarily old fix win the
    // vehicle_states ordering guard against a genuinely current one.
    const ingest = vi.fn().mockResolvedValue({ accepted: 0, rejected: [] });
    const result = await runGpsPoll(env(), {
      now: () => NOW,
      ingest,
      fetchLiveFeed: () =>
        Promise.resolve({
          fetched: 2,
          vehicles: [
            livePosition({ vehicleId: 'no-ts', observedAt: null }),
            livePosition({ vehicleId: 'bad-ts', observedAt: 'not a date' }),
          ],
        }),
    });

    expect(result.stale).toBe(2);
    expect(ingest).not.toHaveBeenCalled();
  });

  it('wraps a bare 360 heading rather than letting it violate the heading CHECK', async () => {
    const ingest = vi.fn().mockResolvedValue({ accepted: 1, rejected: [] });
    await runGpsPoll(env(), {
      now: () => NOW,
      ingest,
      fetchLiveFeed: () =>
        Promise.resolve({ fetched: 1, vehicles: [livePosition({ headingDegrees: 360 })] }),
    });
    const [events] = ingest.mock.calls[0] as [{ headingDegrees: number }[]];
    expect(events[0]?.headingDegrees).toBe(0);
  });

  it('auto-registers vehicles: on this path the live feed IS the vehicle master', async () => {
    const ingest = vi.fn().mockResolvedValue({ accepted: 1, rejected: [] });
    await runGpsPoll(env(), {
      now: () => NOW,
      ingest,
      fetchLiveFeed: () => Promise.resolve({ fetched: 1, vehicles: [livePosition()] }),
    });
    expect(ingest.mock.calls[0]?.[1]).toEqual({ autoRegisterVehicles: true });
  });

  it('does not call the ingestion pipeline at all when nothing survives filtering', async () => {
    const ingest = vi.fn();
    const result = await runGpsPoll(env(), {
      now: () => NOW,
      ingest,
      fetchLiveFeed: () =>
        Promise.resolve({ fetched: 40, vehicles: [livePosition({ status: 'Parked' })] }),
    });
    expect(ingest).not.toHaveBeenCalled();
    expect(result).toMatchObject({ fetched: 40, live: 0, ingested: 0, rejected: 0 });
  });

  it('counts rejections reported per event by the pipeline', async () => {
    const ingest = vi.fn().mockResolvedValue({
      accepted: 1,
      rejected: [{ index: 1, vehicleId: 'ghost', code: 'unknown_vehicle', message: 'nope' }],
    });
    const result = await runGpsPoll(env(), {
      now: () => NOW,
      ingest,
      fetchLiveFeed: () =>
        Promise.resolve({
          fetched: 2,
          vehicles: [livePosition({ vehicleId: 'ok' }), livePosition({ vehicleId: 'ghost' })],
        }),
    });
    expect(result).toMatchObject({ ingested: 1, rejected: 1 });
  });
});

describe('selectBatch (round-robin cursor)', () => {
  const ids = ['a', 'b', 'c', 'd', 'e'];

  it('starts at the head on a cold cursor', () => {
    expect(selectBatch(ids, null, 2).batch).toEqual(['a', 'b']);
  });

  it('resumes after the cursor', () => {
    expect(selectBatch(ids, 'b', 2).batch).toEqual(['c', 'd']);
  });

  it('WRAPS at the end so the tail is not sampled less often than the head', () => {
    // Without wrapping, a route-direction that sorts late gets a different
    // effective detection window from one that sorts early - impossible to
    // reason about during an incident review.
    expect(selectBatch(ids, 'd', 3).batch).toEqual(['e', 'a', 'b']);
  });

  it('resolves the cursor BY VALUE, so an id leaving the set does not shift everyone else', () => {
    // 'b' dropped out (its vehicles went stale); the next turn is still 'c'.
    expect(selectBatch(['a', 'c', 'd'], 'b', 2).batch).toEqual(['c', 'd']);
  });

  it('never returns more entries than exist, even with a huge batch size', () => {
    const { batch } = selectBatch(ids, null, 1000);
    expect(batch).toEqual(ids);
    expect(new Set(batch).size).toBe(ids.length);
  });

  it('handles an empty eligible set', () => {
    expect(selectBatch([], 'x', 10)).toEqual({ batch: [], nextCursor: null });
  });
});

describe('runHeadwayComputeSweep', () => {
  beforeEach(() => {
    _resetHeadwayCursorForTests();
  });

  it('computes only the pruned, eligible route-directions', async () => {
    const compute = vi.fn().mockImplementation((id: string) => Promise.resolve(computeResult(id)));
    const result = await runHeadwayComputeSweep(env({ HEADWAY_BATCH_SIZE: 60 }), {
      listEligible: () => Promise.resolve(['rd-1', 'rd-2']),
      compute,
    });

    expect(compute).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ eligible: 2, attempted: 2, computed: 2, failed: 0 });
  });

  it('passes the freshness window through to the pruning query', async () => {
    const listEligible = vi.fn().mockResolvedValue([]);
    await runHeadwayComputeSweep(env({ HEADWAY_VEHICLE_FRESHNESS_SECONDS: 120 }), {
      listEligible,
      compute: vi.fn().mockImplementation((id: string) => Promise.resolve(computeResult(id))),
    });
    expect(listEligible).toHaveBeenCalledWith(120);
  });

  it('advances the cursor across sweeps instead of recomputing the same head forever', async () => {
    const seen: string[][] = [];
    const eligible = ['rd-1', 'rd-2', 'rd-3', 'rd-4'];
    const run = async () => {
      const batch: string[] = [];
      await runHeadwayComputeSweep(env({ HEADWAY_BATCH_SIZE: 2 }), {
        listEligible: () => Promise.resolve(eligible),
        compute: (id) => {
          batch.push(id);
          return Promise.resolve(computeResult(id));
        },
      });
      seen.push(batch.sort());
    };

    await run();
    await run();
    await run();

    expect(seen[0]).toEqual(['rd-1', 'rd-2']);
    expect(seen[1]).toEqual(['rd-3', 'rd-4']);
    expect(seen[2]).toEqual(['rd-1', 'rd-2']); // wrapped back around
  });

  it('never exceeds the configured concurrency (the pg pool maxes out at 10)', async () => {
    let inFlight = 0;
    let peak = 0;
    const compute = vi.fn().mockImplementation(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      return computeResult('rd-concurrency');
    });

    await runHeadwayComputeSweep(env({ HEADWAY_BATCH_SIZE: 20, HEADWAY_COMPUTE_CONCURRENCY: 4 }), {
      listEligible: () => Promise.resolve(Array.from({ length: 20 }, (_, i) => `rd-${i}`)),
      compute,
    });

    expect(compute).toHaveBeenCalledTimes(20);
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1); // ...and it really is concurrent
  });

  it('CONTAINS a per-route failure: one unconfigured route-direction cannot abort the sweep', async () => {
    const compute = vi.fn().mockImplementation((id: string) => {
      if (id === 'rd-2') return Promise.reject(new Error('no_active_policy'));
      return Promise.resolve(computeResult(id));
    });

    const result = await runHeadwayComputeSweep(env({ HEADWAY_BATCH_SIZE: 10 }), {
      listEligible: () => Promise.resolve(['rd-1', 'rd-2', 'rd-3']),
      compute,
    });

    expect(result).toMatchObject({ computed: 2, failed: 1 });
  });

  it('does nothing when nothing is eligible - the common case at low fleet activity', async () => {
    const compute = vi.fn();
    const result = await runHeadwayComputeSweep(env(), {
      listEligible: () => Promise.resolve([]),
      compute,
    });
    expect(compute).not.toHaveBeenCalled();
    expect(result).toMatchObject({ eligible: 0, attempted: 0 });
  });

  it('covers every eligible route-direction in ONE cycle when batch >= eligible (the ~3 min detection contract)', async () => {
    // Detection latency = required_samples x interval x ceil(eligible / batch).
    // The documented "~3 minutes to first detection" assumes that trailing
    // factor is 1; this pins it.
    const eligible = Array.from({ length: 45 }, (_, i) => `rd-${i}`);
    const seen: string[] = [];
    const result = await runHeadwayComputeSweep(env({ HEADWAY_BATCH_SIZE: 60 }), {
      listEligible: () => Promise.resolve(eligible),
      compute: (id) => {
        seen.push(id);
        return Promise.resolve(computeResult(id));
      },
    });

    expect(result.attempted).toBe(45);
    expect(new Set(seen).size).toBe(45);
    expect(Math.ceil(result.eligible / 60)).toBe(1);
  });
});
