// The wiring that lets a completed stop occupancy actually reach `stop_visits`.
//
// Two defects lived here, and both were invisible to the type system and to
// every test that constructed a repository directly:
//
//   1. `CachedGeometryRepository` - the decorator the production singleton
//      wraps EVERY repository in - did not forward `recordStopVisit`. Because
//      the interface member was optional, `implements StateEstimationRepository`
//      still type-checked, and `service.ts`'s `if (!this.repository.recordStopVisit)
//      return;` short-circuited on every fix in the running service. Measured
//      consequence: 77 minutes of healthy ingestion, 302 vehicles inside a stop
//      geofence, `stop_visits` still 0.
//
//   2. The estimator computed `stopEnteredAt` from the 30 m geofence but stored
//      it beside a `currentStopId` the classifier also sets inside the 150 m
//      approach window - so an approach-window occupancy got a stop id with a
//      null entry time, and `detectCompletedStopVisit` (which needs both) could
//      never close it. Measured consequence: 528 rows with `current_stop_id`,
//      only 302 with `stop_state_entered_at`.
//
// So these tests deliberately exercise the PRODUCTION wiring - the decorator,
// not the raw Pg repository - and assert the structural property that would
// have caught defect 1 at compile time.
import { describe, it, expect } from 'vitest';
import { CachedGeometryRepository, NetworkGeometryCache } from '../src/state-estimation/cache.js';
import { PgStateEstimationRepository } from '../src/state-estimation/repository.js';
import { InMemoryStateEstimationRepository } from '../src/state-estimation/testing/inMemoryRepository.js';
import { StateEstimationService } from '../src/state-estimation/service.js';
import { estimateVehicleState } from '../src/state-estimation/estimator.js';
import { classifyStopState } from '../src/state-estimation/stopStateClassifier.js';
import type {
  RouteDirectionShape,
  RouteDirectionStopPoint,
} from '../src/state-estimation/types.js';

const METERS_PER_DEGREE_LAT = 111_320;
const ORIGIN = { lat: 26.8467, lon: 80.9462 }; // Lucknow

function pointEast(meters: number) {
  const metersPerDegLon = METERS_PER_DEGREE_LAT * Math.cos((ORIGIN.lat * Math.PI) / 180);
  return { lat: ORIGIN.lat, lon: ORIGIN.lon + meters / metersPerDegLon };
}

const shape: RouteDirectionShape = {
  routeDirectionId: 'rd-1',
  routeId: 'route-1',
  directionCode: 'UP',
  corridorId: null,
  isLoop: false,
  corridorOffsetMeters: null,
  corridorDirectionSign: 1,
  totalDistanceMeters: 3000,
  points: [pointEast(0), pointEast(1500), pointEast(3000)],
};

function stop(stopId: string, cumulativeDistanceMeters: number): RouteDirectionStopPoint {
  return {
    routeDirectionId: 'rd-1',
    stopId,
    sequence: cumulativeDistanceMeters,
    cumulativeDistanceMeters,
    geofenceRadiusMeters: 30,
    isControlPoint: false,
  };
}

const STOPS = [stop('stop-A', 1000), stop('stop-B', 2500)];
const STOPS_BY_DIRECTION = new Map([['rd-1', STOPS]]);

function event(offsetMeters: number, observedAt: string, speedKmph = 20) {
  const p = pointEast(offsetMeters);
  return { vehicleId: 'UP25FT4823', lat: p.lat, lon: p.lon, headingDegrees: 90, speedKmph, observedAt };
}

// ── Defect 1 ──────────────────────────────────────────────────────────────

describe('CachedGeometryRepository forwards the full repository contract', () => {
  it('forwards recordStopVisit to the wrapped repository', async () => {
    const base = new InMemoryStateEstimationRepository([shape], STOPS_BY_DIRECTION);
    const cached = new CachedGeometryRepository(base, new NetworkGeometryCache(base));

    await cached.recordStopVisit({
      vehicleId: 'UP25FT4823',
      routeDirectionId: 'rd-1',
      stopId: 'stop-A',
      tripId: null,
      arrivedAt: '2026-09-06T10:00:00.000Z',
      departedAt: '2026-09-06T10:00:45.000Z',
    });

    expect(base.stopVisits).toHaveLength(1);
    expect(base.stopVisits[0]?.stopId).toBe('stop-A');
  });

  // The structural guard. `PgStateEstimationRepository` is the reference
  // implementation of StateEstimationRepository, so any method it has and the
  // decorator lacks is a method the decorator silently drops in production -
  // exactly the shape of the recordStopVisit bug. This fails for the NEXT one
  // too, which a hand-written per-method test would not.
  it('implements every method the reference repository implements', () => {
    const methodsOf = (proto: object) =>
      Object.getOwnPropertyNames(proto).filter(
        (name) => name !== 'constructor' && typeof (proto as Record<string, unknown>)[name] === 'function',
      );

    const missing = methodsOf(PgStateEstimationRepository.prototype).filter(
      (name) => !methodsOf(CachedGeometryRepository.prototype).includes(name),
    );

    expect(missing).toEqual([]);
  });
});

describe('the production wiring records a completed stop visit', () => {
  it('writes through the decorator the singleton actually injects', async () => {
    const base = new InMemoryStateEstimationRepository([shape], STOPS_BY_DIRECTION);
    // Exactly what getStateEstimationService() builds.
    const service = new StateEstimationService(
      new CachedGeometryRepository(base, new NetworkGeometryCache(base)),
    );
    await service.rehydrate();

    // Dwelling inside stop-A's geofence, then gone.
    await service.processPositionEvent(event(1000, '2026-09-06T10:00:00.000Z', 0));
    await service.processPositionEvent(event(2500, '2026-09-06T10:00:45.000Z', 0));

    expect(base.stopVisits).toHaveLength(1);
    expect(base.stopVisits[0]).toMatchObject({
      stopId: 'stop-A',
      arrivedAt: '2026-09-06T10:00:00.000Z',
      departedAt: '2026-09-06T10:00:45.000Z',
    });
  });
});

// ── Defect 2 ──────────────────────────────────────────────────────────────

describe('a stop association always carries an entry time', () => {
  it('sets stopEnteredAt for a vehicle in the approach window, not just the geofence', () => {
    // 900 m: 100 m short of stop-A, so outside the 30 m geofence but inside
    // the 150 m approach window the classifier associates on.
    const estimate = estimateVehicleState({
      vehicleId: 'UP25FT4823',
      event: event(900, '2026-09-06T10:00:00.000Z'),
      candidateShapes: [shape],
      nearestStopsByRouteDirection: STOPS_BY_DIRECTION,
      priorState: null,
      isHeldByController: false,
      tripId: null,
    });

    expect(estimate.stopState).toBe('approaching_stop');
    expect(estimate.currentStopId).toBe('stop-A');
    // The defect: a currentStopId with a null entry time can never close.
    expect(estimate.stopEnteredAt).toBe('2026-09-06T10:00:00.000Z');
  });

  it('closes a visit that began in the approach window', async () => {
    const base = new InMemoryStateEstimationRepository([shape], STOPS_BY_DIRECTION);
    const service = new StateEstimationService(
      new CachedGeometryRepository(base, new NetworkGeometryCache(base)),
    );
    await service.rehydrate();

    await service.processPositionEvent(event(900, '2026-09-06T11:00:00.000Z'));
    await service.processPositionEvent(event(2500, '2026-09-06T11:00:50.000Z', 0));

    expect(base.stopVisits).toHaveLength(1);
    expect(base.stopVisits[0]).toMatchObject({
      stopId: 'stop-A',
      arrivedAt: '2026-09-06T11:00:00.000Z',
      departedAt: '2026-09-06T11:00:50.000Z',
    });
  });

  it('does not associate a held vehicle with a stop it is nowhere near', () => {
    // A hold stays active in the table after the bus pulls away, so the held
    // branch can be reached with the nearest stop kilometres off. Associating
    // there would manufacture a stop visit spanning the whole inter-stop leg
    // once every association carries an entry time.
    const result = classifyStopState({
      speedKmph: 40,
      distanceAlongRouteMeters: 1800, // 800 m past stop-A, 700 m short of stop-B
      nearestStop: {
        stopId: 'stop-A',
        cumulativeDistanceMeters: 1000,
        geofenceRadiusMeters: 30,
      },
      isHeldByController: true,
      isOffRoute: false,
    });

    expect(result.stopState).toBe('held_by_controller');
    expect(result.currentStopId).toBeNull();
  });

  it('still associates a held vehicle that is actually at the stop', () => {
    const result = classifyStopState({
      speedKmph: 0,
      distanceAlongRouteMeters: 1010,
      nearestStop: {
        stopId: 'stop-A',
        cumulativeDistanceMeters: 1000,
        geofenceRadiusMeters: 30,
      },
      isHeldByController: true,
      isOffRoute: false,
    });

    expect(result.currentStopId).toBe('stop-A');
  });
});
