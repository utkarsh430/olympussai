// The corridor the fleet trial runs on: one long inter-city route-direction
// with a small number of stations, every one of them a holding point.
//
// ─── THIS CORRIDOR IS INVENTED, AND THAT IS THE POINT ────────────────────
//
// `rehearsal/corridor.ts` loads a REAL seeded route-direction and refuses any
// whose target headway was never measured. Nothing in this file loads
// anything. It exists because the trial asks a question no seeded corridor
// can answer: what happens to a THOUSAND buses on a 400 km route with ten
// holding points, when the longest corridor in the seeded network is 400 km
// with 48 stops and has never had more than a handful of vehicles reporting
// on it at once.
//
// So the geometry here is arithmetic and the demand is a model, and every
// surface that shows a result from it must say so. What is NOT invented is
// the part that is being tested: the control laws, their gains, the safety
// filter, the selection rule and the bunching detector are all the deployed
// ones, reached through `rehearsal/deployedControlLaws.ts` and
// `headway/`. The corridor is the test rig; the controller is the subject.
//
// Isolation is inherited rather than restated: this module produces a
// `CorridorInputs`, which is plain data, and issues no query and no write.
import type { CorridorInputs, CorridorStop } from '../rehearsal/corridor.js';
import type { RoutePolicyRow } from '../state/store.js';

/**
 * The shape of the trial corridor.
 *
 * Every field is a decision somebody made rather than a measurement, so each
 * one is named here instead of being buried as a literal further down.
 */
export interface FleetCorridorSpec {
  routeDirectionId: string;
  routeName: string;
  /** End-to-end length. 400 km: an inter-city trunk, not an urban loop. */
  totalDistanceMeters: number;
  /**
   * How many stations the route has - and therefore how many holding points,
   * because EVERY station on this corridor is a control point.
   *
   * That is the trial's central constraint ("holding can be done only at
   * these stops") expressed the way the engine and the deployed laws both
   * read it: `is_control_point`. A bus between two stations cannot be held
   * by anything here, and `mpc/eligibility.ts#canExecuteHold` refuses to
   * propose one to it, which is the deployed behaviour and not a rig rule.
   */
  stationCount: number;
  /** H*. Every bunching threshold in the system is a ratio of this. */
  targetHeadwaySeconds: number;
  /** Ratio of H* at or below which a gap counts as bunched. */
  bunchedThresholdRatio: number;
  /** Ratio of H* at or below which a gap counts as a warning. */
  warningThresholdRatio: number;
  /** Consecutive samples that must all breach before the reactive rule fires. */
  requiredSamples: number;
  kf: number;
  kb: number;
  selfEqualizingK: number;
  maxHoldSeconds: number;
  cooldownSeconds: number;
  /**
   * `route_policies.minimum_action_seconds`: the shortest hold worth giving.
   *
   * Zero on every seeded corridor, which is not a neutral default - it is the
   * guardrail that decides whether a marginal correction is issued at all,
   * switched off. See the trial's own sweep of it.
   */
  minimumActionSeconds: number;
}

/**
 * The trial's default corridor.
 *
 * H* = 1800 s is the seeded network's own median target headway, and on this
 * corridor it is also the only defensible choice. Stations are 44 km apart, so
 * a leg takes about 44 minutes and ordinary highway variability puts several
 * minutes of noise on each one. MEASURED at H* = 900 s: per-leg noise reached
 * half a headway, buses were effectively randomly placed after three legs, and
 * BOTH arms came apart - a corridor no controller can regulate, on which a
 * trial reports "barely any effect" about a working controller for a reason
 * that belongs to the fixture. At 1800 s the same noise is a fifth of a
 * headway, which is a corridor that bunches but can be held together.
 *
 * Roughly fourteen buses are on the corridor at any instant, which is a long
 * enough leader/follower chain for a disturbance to PROPAGATE down the line
 * rather than dissipate against the end of the fleet.
 *
 * Gains, thresholds and the hold cap are the same values `evaluation/
 * corridors.ts` uses for its synthetic corridors, so a number produced here is
 * comparable with one produced there rather than being a second, silently
 * different, set of assumptions.
 */
export const DEFAULT_FLEET_CORRIDOR: FleetCorridorSpec = {
  routeDirectionId: 'fleet-trial-400km',
  routeName: 'Trial corridor: 400 km inter-city trunk',
  totalDistanceMeters: 400_000,
  stationCount: 10,
  targetHeadwaySeconds: 1800,
  bunchedThresholdRatio: 0.25,
  warningThresholdRatio: 0.5,
  requiredSamples: 3,
  kf: 0.4,
  kb: 0.2,
  selfEqualizingK: 0.35,
  maxHoldSeconds: 600,
  cooldownSeconds: 60,
  minimumActionSeconds: 0,
};

/** Lucknow, the seeded network's hub. The corridor is drawn outward from it. */
const ORIGIN_LATITUDE = 26.8467;
const ORIGIN_LONGITUDE = 80.9462;
/** West-north-west, roughly the Lucknow -> Agra axis. Chosen so the drawn line lands on land. */
const BEARING_DEGREES = 288;
const EARTH_RADIUS_METERS = 6_371_000;

/**
 * A point `distanceMeters` along a great circle from the origin.
 *
 * Real spherical arithmetic rather than a linear lat/lng interpolation: at
 * this latitude a degree of longitude is ~11% shorter than a degree of
 * latitude, so a naive interpolation would draw stations that are visibly
 * unevenly spaced on a map while claiming to be 44.4 km apart.
 */
function destinationPoint(distanceMeters: number): { latitude: number; longitude: number } {
  const angular = distanceMeters / EARTH_RADIUS_METERS;
  const bearing = (BEARING_DEGREES * Math.PI) / 180;
  const lat1 = (ORIGIN_LATITUDE * Math.PI) / 180;
  const lon1 = (ORIGIN_LONGITUDE * Math.PI) / 180;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
      Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2),
    );

  return { latitude: (lat2 * 180) / Math.PI, longitude: (lon2 * 180) / Math.PI };
}

/** Stations get names rather than indices: an operator reads a place, not a subscript. */
const STATION_NAMES = [
  'Origin terminal',
  'Station 2',
  'Station 3',
  'Station 4',
  'Station 5',
  'Station 6',
  'Station 7',
  'Station 8',
  'Station 9',
  'Terminus',
];

function stationName(index: number, count: number): string {
  if (index === 0) return 'Origin terminal';
  if (index === count - 1) return 'Terminus';
  return STATION_NAMES[index] ?? `Station ${index + 1}`;
}

/**
 * The trial corridor as simulator inputs.
 *
 * `isControlPoint` is true on EVERY station, including the origin. The origin
 * matters more than the rest put together: `mpc/terminalDispatch.ts` -
 * Algorithm A - is the only lever that costs no passenger their seat, it is
 * suppressed for any stop that is not the origin terminal, and a corridor
 * that did not mark stop 0 a control point would report Algorithm A at 0%
 * coverage for a reason that belonged to the fixture rather than to the law.
 */
export function buildFleetCorridor(
  spec: FleetCorridorSpec = DEFAULT_FLEET_CORRIDOR,
): CorridorInputs {
  if (spec.stationCount < 2) {
    throw new Error(`fleet corridor needs at least 2 stations, got ${spec.stationCount}`);
  }

  const stops: CorridorStop[] = Array.from({ length: spec.stationCount }, (_, index) => {
    const fraction = index / (spec.stationCount - 1);
    const cumulativeDistanceMeters = Math.round(spec.totalDistanceMeters * fraction);
    const point = destinationPoint(cumulativeDistanceMeters);
    return {
      stopId: `${spec.routeDirectionId}-station-${index + 1}`,
      name: stationName(index, spec.stationCount),
      sequence: index,
      cumulativeDistanceMeters,
      isControlPoint: true,
      // No per-stop override: the policy's cap is the cap everywhere, so a
      // reader comparing two stations is not also comparing two limits.
      maxHoldSeconds: null,
      latitude: point.latitude,
      longitude: point.longitude,
    };
  });

  const policy: RoutePolicyRow = {
    id: `${spec.routeDirectionId}-policy`,
    routeDirectionId: spec.routeDirectionId,
    operatingPeriod: 'all',
    dayType: 'all',
    targetHeadwaySeconds: spec.targetHeadwaySeconds,
    bunchedThresholdRatio: spec.bunchedThresholdRatio,
    warningThresholdRatio: spec.warningThresholdRatio,
    kf: spec.kf,
    kb: spec.kb,
    selfEqualizingK: spec.selfEqualizingK,
    maxHoldSeconds: spec.maxHoldSeconds,
    cooldownSeconds: spec.cooldownSeconds,
    minimumActionSeconds: spec.minimumActionSeconds,
    predictionHorizonControlPoints: 3,
    // Null, deliberately, and NOT the trial's modelled capacity. This is the
    // corridor's real `route_policies` row as the deployed laws would read it,
    // and no corridor in this system has ever carried a measured occupancy
    // capacity. The trial's occupancy-aware phase supplies its own modelled
    // capacity to the rehearsal adapter, where it is labelled as modelled.
    occupancyCapacity: null,
    occupancyStaleSeconds: null,
    ks: null,
    maxLatenessSeconds: null,
    speedBandMinKmph: null,
    speedBandMaxKmph: null,
  };

  return {
    routeDirectionId: spec.routeDirectionId,
    routeId: spec.routeDirectionId,
    routeName: spec.routeName,
    directionCode: 'OUT',
    isLoop: false,
    totalDistanceMeters: spec.totalDistanceMeters,
    // Never 'timetable' or 'od_timetable'. Those two values mean a real
    // published schedule was measured, and claiming one here would make an
    // invented corridor indistinguishable from a calibrated one in every
    // downstream provenance check.
    calibrationSource: 'synthetic',
    policy,
    stops,
    shape: stops.map((stop) => ({ latitude: stop.latitude, longitude: stop.longitude })),
  };
}
