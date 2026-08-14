// Repository tests: the row-to-domain translation, and the predicates that are
// enforced in SQL rather than in the model.
//
// The SQL text itself is additionally checked against a live PostGIS schema by
// scripts/check-arrival-sql.mjs, because no amount of TypeScript proves a query
// parses.
import { describe, it, expect } from 'vitest';
import type { Pool } from 'pg';
import {
  loadActiveHold,
  loadPeerSpeeds,
  loadRouteDirectionStops,
  loadRouteGeometry,
  loadVehicleStateForPrediction,
  vehicleExists,
} from '../src/arrival-prediction/repository.js';

interface Captured {
  text: string;
  params: readonly unknown[] | undefined;
}

function fakePool(rows: Record<string, unknown>[], captured: Captured[] = []): Pool {
  return {
    query: (text: string, params?: readonly unknown[]) => {
      captured.push({ text, params });
      return Promise.resolve({ rows });
    },
  } as unknown as Pool;
}

const baseRow = {
  vehicle_id: 'UP78JT5520',
  route_direction_id: 'rd-1',
  distance_along_route_meters: '4000.5',
  speed_kmph: '40.2',
  stop_state: 'departed_stop',
  current_stop_id: null,
  stop_state_entered_at: null,
  confidence: '0.812',
  is_low_confidence: false,
  observed_at: new Date('2026-08-14T09:59:30.000Z'),
  lat: '28.35',
  lon: '79.42',
  kf_state: { s: 4000.5, v: 11.2, p: [[9, 0.4], [0.4, 2.25]], updatedAt: '2026-08-14T09:59:30.000Z' },
};

describe('loadVehicleStateForPrediction', () => {
  it('converts pg numeric strings and a pg Date into the domain shape', async () => {
    const state = await loadVehicleStateForPrediction('UP78JT5520', fakePool([baseRow]));
    expect(state).toEqual({
      vehicleId: 'UP78JT5520',
      routeDirectionId: 'rd-1',
      distanceAlongRouteMeters: 4000.5,
      speedKmph: 40.2,
      stopState: 'departed_stop',
      currentStopId: null,
      stopEnteredAt: null,
      confidence: 0.812,
      isLowConfidence: false,
      observedAt: '2026-08-14T09:59:30.000Z',
      position: { lat: 28.35, lon: 79.42 },
      velocityVarianceMeters2PerSecond2: 2.25,
    });
  });

  it('returns null when the vehicle has no state row', async () => {
    expect(await loadVehicleStateForPrediction('UP78JT5520', fakePool([]))).toBeNull();
  });

  it('reports a missing position as null rather than as (0, 0)', async () => {
    // (0, 0) is the GPS "no fix" sentinel, and the whole point of the plausible-
    // position guard is that it must not be manufactured here.
    const state = await loadVehicleStateForPrediction(
      'UP78JT5520',
      fakePool([{ ...baseRow, lat: null, lon: null }]),
    );
    expect(state?.position).toBeNull();
  });

  it.each([
    ['a null filter state', null],
    ['a filter state that is not an object', 'nonsense'],
    ['a covariance that is not a matrix', { p: 'x' }],
    ['a covariance row of the wrong width', { p: [[1], [1]] }],
    ['a non-numeric variance', { p: [[1, 0], [0, 'wide']] }],
    ['a NaN variance', { p: [[1, 0], [0, Number.NaN]] }],
    ['a negative variance', { p: [[1, 0], [0, -4]] }],
  ])('degrades %s to "no covariance information" rather than to NaN', async (_label, kfState) => {
    // kf_state is jsonb: it holds whatever was written, not whatever the type
    // says. A NaN leaking out here would poison every bound computed from it,
    // and NaN comparisons are silently false - the band would just vanish.
    const state = await loadVehicleStateForPrediction(
      'UP78JT5520',
      fakePool([{ ...baseRow, kf_state: kfState }]),
    );
    expect(state?.velocityVarianceMeters2PerSecond2).toBeNull();
  });

  it('keeps an unreadable observed_at as a string so the core can name it', async () => {
    // Swallowing it into null would read downstream as "no state at all", which
    // is a different and less actionable answer than "the timestamp is broken".
    const state = await loadVehicleStateForPrediction(
      'UP78JT5520',
      fakePool([{ ...baseRow, observed_at: new Date('nope') }]),
    );
    expect(state?.observedAt).toBe('invalid-date');
    expect(Number.isNaN(Date.parse(state!.observedAt))).toBe(true);
  });
});

describe('loadPeerSpeeds', () => {
  it('excludes flagged and unmatched vehicles, and bounds freshness on BOTH sides', async () => {
    const captured: Captured[] = [];
    await loadPeerSpeeds('rd-1', 600, fakePool([], captured));
    const { text, params } = captured[0]!;
    expect(text).toContain('is_low_confidence = false');
    expect(text).toContain('distance_along_route_meters is not null');
    // Two-sided. A row stamped in 2046 has a negative age and sails through any
    // one-sided "recent enough" test forever; it must not be able to set the
    // speed another bus's countdown is computed from.
    expect(text).toContain('observed_at <= now()');
    expect(text).toContain('observed_at >= now() - make_interval');
    expect(params).toEqual(['rd-1', 600, 0.4]);
  });

  it('maps rows to peers', async () => {
    const peers = await loadPeerSpeeds(
      'rd-1',
      600,
      fakePool([{ vehicle_id: 'v2', distance_along_route_meters: '9000', speed_kmph: '35.5' }]),
    );
    expect(peers).toEqual([{ vehicleId: 'v2', distanceAlongRouteMeters: 9000, speedKmph: 35.5 }]);
  });
});

describe('the other reads', () => {
  it('loads geometry only for an active route-direction', async () => {
    const captured: Captured[] = [];
    await loadRouteGeometry('rd-1', fakePool([], captured));
    expect(captured[0]!.text).toContain('rd.is_active = true');
  });

  it('returns null geometry when the route-direction has no shape', async () => {
    expect(await loadRouteGeometry('rd-1', fakePool([]))).toBeNull();
  });

  it('returns stops in timetable order with their surveyed distances', async () => {
    const stops = await loadRouteDirectionStops(
      'rd-1',
      fakePool([
        { stop_id: 's1', stop_name: 'Faridpur', sequence: 2, cumulative_distance_meters: '8000', is_control_point: true },
      ]),
    );
    expect(stops).toEqual([
      { stopId: 's1', stopName: 'Faridpur', sequence: 2, cumulativeDistanceMeters: 8000, isControlPoint: true },
    ]);
  });

  it('treats an unknown vehicle as not existing', async () => {
    expect(await vehicleExists('nope', fakePool([]))).toBe(false);
    expect(await vehicleExists('yes', fakePool([{ exists: true }]))).toBe(true);
  });

  it('asks about holds with exactly the predicate the state estimator uses', async () => {
    // If these two ever disagreed, one subsystem would know a bus was held while
    // the other one gave its driver a countdown.
    const captured: Captured[] = [];
    await loadActiveHold('UP78JT5520', fakePool([], captured));
    expect(captured[0]!.params).toEqual([
      'UP78JT5520',
      ['terminal_dispatch_hold', 'two_way_hold', 'self_equalizing_hold'],
      ['delivered', 'acknowledged', 'executing'],
    ]);
    expect(captured[0]!.text).toContain('now() < expires_at');
  });

  it('treats a missing hold row as not held', async () => {
    expect(await loadActiveHold('UP78JT5520', fakePool([]))).toBe(false);
  });
});
