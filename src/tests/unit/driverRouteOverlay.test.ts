// @vitest-environment node
//
// What the driver's map is allowed to draw.
//
// The two properties that matter here are both about not lying with geometry:
// a stop with no surveyed position must not be drawn at (0, 0), and the line
// through the stops must not be mistakable for the road the bus drives on.
import { describe, it, expect } from 'vitest';
import { buildRouteStopOverlay, cameraFitPoints } from '@/lib/ops/driverRouteOverlay';
import type { JourneyStop } from '@/lib/ops/driverJourney';
import type { StopArrival } from '@/models/control';

function stop(overrides: Partial<JourneyStop> = {}): JourneyStop {
  const arrival = {
    stopId: 's1',
    stopName: 'ALAMBAGH',
    sequence: 1,
    isControlPoint: false,
    distanceRemainingMeters: 1000,
    intermediateStopCount: 0,
    latitude: 26.8,
    longitude: 80.9,
    status: 'predicted',
    etaSeconds: 600,
    etaAt: '2026-08-14T10:10:00.000Z',
    lowerBoundSeconds: 400,
    upperBoundSeconds: 900,
    confidence: 0.5,
    confidenceBand: 'usable',
    components: { travelSeconds: 600, dwellSeconds: 0, currentStopDwellSeconds: 0, stateAgeSeconds: 10 },
  } as StopArrival;

  return {
    stopId: 's1',
    stopName: 'ALAMBAGH',
    sequence: 1,
    isControlPoint: false,
    distanceRemainingMeters: 1000,
    latitude: 26.8,
    longitude: 80.9,
    arrival,
    scheduled: null,
    ...overrides,
  };
}

describe('buildRouteStopOverlay', () => {
  it('draws a mark for each stop that has a surveyed position', () => {
    const { overlay } = buildRouteStopOverlay([
      stop({ stopId: 'a', latitude: 26.8, longitude: 80.9 }),
      stop({ stopId: 'b', latitude: 26.7, longitude: 81.0 }),
    ]);
    // One connecting path plus one ring per stop.
    expect(overlay.marks.some((m) => m.id.includes('a'))).toBe(true);
    expect(overlay.marks.some((m) => m.id.includes('b'))).toBe(true);
  });

  it('refuses to draw a stop with no surveyed position, and says how many it dropped', () => {
    // Coercing a missing survey to (0, 0) is the defect src/lib/maps/plottable.ts
    // exists for: it is a valid-looking coordinate in the Gulf of Guinea, and a
    // camera fitted over it opens on empty ocean.
    const { overlay, undrawnStopCount } = buildRouteStopOverlay([
      stop({ stopId: 'a' }),
      stop({ stopId: 'b', latitude: null, longitude: null }),
    ]);
    expect(undrawnStopCount).toBe(1);
    expect(overlay.marks.some((m) => m.id.includes('b'))).toBe(false);
  });

  it('refuses a position that is not on the network this operator runs', () => {
    // Same bounding-box rule the fleet map applies to vehicles: a reading off
    // the served network is garbage, whichever table it came from.
    const { overlay, undrawnStopCount } = buildRouteStopOverlay([
      stop({ stopId: 'ocean', latitude: 0, longitude: 80.9 }),
    ]);
    expect(undrawnStopCount).toBe(1);
    expect(overlay.marks).toHaveLength(0);
  });

  it('dashes the line through the stops, so it never reads as the road', () => {
    // These are straight chords between stop positions, not the surveyed route
    // shape. Drawn solid, a driver would read them as the road to follow.
    const { overlay } = buildRouteStopOverlay([
      stop({ stopId: 'a', latitude: 26.8, longitude: 80.9 }),
      stop({ stopId: 'b', latitude: 26.7, longitude: 81.0 }),
    ]);
    const path = overlay.marks.find((m) => m.points.length > 1);
    expect(path).toBeDefined();
    expect(path!.dashed).toBe(true);
  });

  it('colours a timed stop differently from one it could not time', () => {
    // The honesty distinction, carried onto the map: a driver must be able to
    // see at a glance which of these stops the system actually has a time for.
    const timed = buildRouteStopOverlay([stop({ stopId: 'a' })]);
    const untimed = buildRouteStopOverlay([
      stop({
        stopId: 'a',
        arrival: { ...stop().arrival, status: 'unavailable', reason: 'beyond_prediction_horizon' } as StopArrival,
      }),
    ]);
    const timedRing = timed.overlay.marks.find((m) => m.points.length === 1)!;
    const untimedRing = untimed.overlay.marks.find((m) => m.points.length === 1)!;
    expect(timedRing.colour).not.toBe(untimedRing.colour);
  });

  it('labels only the next stop, not every stop', () => {
    // A label per stop over a dense basemap is unreadable; the list below the
    // map is where the detail belongs.
    const { overlay } = buildRouteStopOverlay([
      stop({ stopId: 'a', latitude: 26.8, longitude: 80.9 }),
      stop({ stopId: 'b', latitude: 26.7, longitude: 81.0 }),
      stop({ stopId: 'c', latitude: 26.6, longitude: 81.1 }),
    ]);
    const labelled = overlay.marks.filter((m) => m.label);
    expect(labelled).toHaveLength(1);
    expect(labelled[0]!.label).toBe('NEXT');
  });

  it('produces an empty overlay for no stops rather than throwing', () => {
    const { overlay, undrawnStopCount } = buildRouteStopOverlay([]);
    expect(overlay.marks).toEqual([]);
    expect(undrawnStopCount).toBe(0);
  });
});

describe('cameraFitPoints', () => {
  it('includes the bus and every drawable stop, so the whole stretch is in view', () => {
    const points = cameraFitPoints({ latitude: 26.9, longitude: 80.8 }, [
      stop({ stopId: 'a', latitude: 26.8, longitude: 80.9 }),
      stop({ stopId: 'b', latitude: 26.7, longitude: 81.0 }),
    ]);
    expect(points).toEqual([
      { latitude: 26.9, longitude: 80.8 },
      { latitude: 26.8, longitude: 80.9 },
      { latitude: 26.7, longitude: 81.0 },
    ]);
  });

  it('leaves out an unplottable stop, so one bad reading cannot drag the camera', () => {
    // The ocean defect in its camera form: fitBounds takes the extremes of
    // whatever it is given, so a single garbage point decides the opening view.
    const points = cameraFitPoints({ latitude: 26.9, longitude: 80.8 }, [
      stop({ stopId: 'a', latitude: 0, longitude: 80.9 }),
      stop({ stopId: 'b', latitude: 26.7, longitude: 81.0 }),
    ]);
    expect(points).toEqual([
      { latitude: 26.9, longitude: 80.8 },
      { latitude: 26.7, longitude: 81.0 },
    ]);
  });

  it('still fits the stops when the bus itself has no position', () => {
    const points = cameraFitPoints(null, [stop({ stopId: 'a', latitude: 26.8, longitude: 80.9 })]);
    expect(points).toEqual([{ latitude: 26.8, longitude: 80.9 }]);
  });

  it('returns nothing to fit when there is nothing drawable, rather than a default point', () => {
    // Fitting to a made-up centre would tell a driver the map is showing them
    // something. Empty leaves the map on its own fallback view.
    expect(cameraFitPoints(null, [stop({ latitude: null, longitude: null })])).toEqual([]);
  });
});
