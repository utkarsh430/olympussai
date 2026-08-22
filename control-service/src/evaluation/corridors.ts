// Where the corridors an evaluation runs on come from.
//
// Two sources, and the difference between them is the difference between a
// result about this network and a result about a shape:
//
//   'db'         real seeded route-directions, read through the SAME reader
//                the live detection path uses (`loadCorridorInputs`), so an
//                uncalibrated corridor is refused here exactly as it is
//                refused there. 561 of 759 seeded route-directions have no
//                measured target headway; every threshold in the controller
//                is a ratio of that target, so a sweep against their sentinel
//                would optimise gains against a denominator nobody measured.
//
//   'synthetic'  hand-built corridors with no database at all, so the harness
//                can be run and tested anywhere. Their geometry is real
//                arithmetic but their existence is invented, and a report
//                built on them says so.
//
// Nothing here writes. `loadCorridorInputs` issues SELECTs and this module
// adds one more.
import { getPool } from '../db/pool.js';
import { AppError } from '../lib/errors.js';
import { loadCorridorInputs } from '../rehearsal/corridor.js';
import { MEASURED_POLICY_PREDICATE } from '../headway/repository.js';
import type { CorridorInputs, CorridorStop } from '../rehearsal/corridor.js';
import type { CorridorSource } from './spec.js';

export interface CorridorSelection {
  corridors: CorridorInputs[];
  /** 'measured' when every corridor came from the seeded network; 'synthetic' when they were invented here. */
  provenance: 'measured' | 'synthetic';
}

/**
 * A spread of calibrated corridors, longest to shortest.
 *
 * Ordered by length and then sampled at even intervals rather than taken from
 * the top, because corridor length is the variable that most changes how a
 * control law behaves: a 20 km urban route and a 400 km intercity one differ
 * in how many control points a hold propagates through before the trip ends.
 * Ten of the longest corridors is one experiment repeated ten times.
 */
async function sampleCalibratedRouteDirectionIds(limit: number): Promise<string[]> {
  const { rows } = await getPool().query<{ route_direction_id: string }>(
    `select rd.id as route_direction_id
       from route_directions rd
       join route_shapes rs on rs.route_direction_id = rd.id
       join route_policies rp on rp.route_direction_id = rd.id
      where rd.is_active
        and rp.effective_to is null
        and ${MEASURED_POLICY_PREDICATE}
      group by rd.id, rs.total_distance_meters
      order by rs.total_distance_meters desc, rd.id asc`,
  );
  if (rows.length === 0) return [];
  if (rows.length <= limit) return rows.map((r) => r.route_direction_id);

  const step = rows.length / limit;
  const picked: string[] = [];
  for (let i = 0; i < limit; i++) {
    const row = rows[Math.floor(i * step)];
    if (row) picked.push(row.route_direction_id);
  }
  return picked;
}

/**
 * Synthetic corridors, sized from the measured seeded-network averages
 * (19 stops, ~215 km) and then varied around them.
 *
 * Control points start at the ORIGIN. That is not decoration: `is_control_point`
 * on the first stop is what makes a bus at the terminal holdable, and terminal
 * dispatch regulation is the highest-return lever in both the blueprint and
 * `algo_new.md` section 4.1. A synthetic corridor that skipped it would report
 * 0% coverage for Algorithm A and leave a reader to conclude the law is dead
 * when the fixture simply never offered it a decision.
 */
function syntheticCorridor(index: number): CorridorInputs {
  const stopCount = 12 + index * 4;
  const totalMeters = 90_000 + index * 45_000;
  const routeDirectionId = `synthetic-rd-${index + 1}`;

  const stops: CorridorStop[] = Array.from({ length: stopCount }, (_, i) => {
    const fraction = i / (stopCount - 1);
    return {
      stopId: `${routeDirectionId}-stop-${i}`,
      name: `Stop ${i}`,
      sequence: i,
      cumulativeDistanceMeters: Math.round(totalMeters * fraction),
      isControlPoint: i % 4 === 0,
      maxHoldSeconds: null,
      latitude: 26.8 - fraction * 0.4,
      longitude: 80.9 - fraction * 0.6,
    };
  });

  return {
    routeDirectionId,
    routeId: `synthetic-${index + 1}`,
    routeName: `Synthetic corridor ${index + 1}`,
    directionCode: 'OUT',
    isLoop: false,
    totalDistanceMeters: totalMeters,
    calibrationSource: 'synthetic',
    policy: {
      id: `${routeDirectionId}-policy`,
      routeDirectionId,
      operatingPeriod: 'all',
      dayType: 'all',
      targetHeadwaySeconds: 900,
      bunchedThresholdRatio: 0.25,
      warningThresholdRatio: 0.5,
      kf: 0.4,
      kb: 0.2,
      selfEqualizingK: 0.35,
      maxHoldSeconds: 600,
      cooldownSeconds: 60,
      minimumActionSeconds: 0,
      predictionHorizonControlPoints: 3,
      occupancyStaleSeconds: null,
      occupancyCapacity: null,
      ks: null,
      maxLatenessSeconds: null,
      speedBandMinKmph: null,
      speedBandMaxKmph: null,
    },
    stops,
    shape: stops.map((s) => ({ latitude: s.latitude, longitude: s.longitude })),
  };
}

export async function selectCorridors(source: CorridorSource): Promise<CorridorSelection> {
  if (source.source === 'synthetic') {
    return {
      corridors: Array.from({ length: source.count }, (_, i) => syntheticCorridor(i)),
      provenance: 'synthetic',
    };
  }

  const ids =
    source.routeDirectionIds ?? (await sampleCalibratedRouteDirectionIds(source.sample ?? 10));
  if (ids.length === 0) {
    throw new AppError(
      'no_calibrated_corridors',
      'No calibrated route-direction is available to evaluate. Seed the network and confirm at least one route_policies row has a measured calibration_source.',
      404,
    );
  }

  const corridors: CorridorInputs[] = [];
  const refused: string[] = [];
  for (const id of ids) {
    try {
      corridors.push(await loadCorridorInputs(id));
    } catch (error) {
      // An uncalibrated corridor named explicitly is reported, not skipped in
      // silence: the caller asked for it, and a run that quietly evaluates
      // eight of the ten corridors somebody listed is a run whose denominator
      // is wrong.
      if (error instanceof AppError && error.code === 'no_active_policy') {
        refused.push(id);
        continue;
      }
      throw error;
    }
  }

  if (corridors.length === 0) {
    throw new AppError(
      'no_calibrated_corridors',
      `None of the ${ids.length} requested route-directions has a measured target headway: ${refused.join(', ')}`,
      404,
    );
  }
  if (refused.length > 0) {
    process.stderr.write(
      `evaluation: skipped ${refused.length} uncalibrated route-direction(s): ${refused.join(', ')}\n`,
    );
  }

  return { corridors, provenance: 'measured' };
}
