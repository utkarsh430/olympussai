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
import { loadEnv } from '../config/env.js';
import { CORRIDOR_PRESETS } from '../fleetTrial/presets.js';
import { assessCorridorEligibility } from './eligibility.js';
import { loadCorridorShapes } from './eligibilityRepository.js';
import type { ControllabilityAssumptions } from './eligibility.js';
import type { CorridorInputs, CorridorStop } from '../rehearsal/corridor.js';
import type { ModelledInputs } from '../rehearsal/run.js';
import type { CorridorSource } from './spec.js';

export type CorridorProvenance = 'measured' | 'synthetic' | 'preset';

export interface CorridorSelection {
  corridors: CorridorInputs[];
  /** 'measured' when every corridor came from the seeded network; 'synthetic' when they were invented here; 'preset' when they are the three trial shapes. */
  provenance: CorridorProvenance;
  /**
   * Each preset's OWN modelled inputs, keyed by route-direction id.
   *
   * A preset is its whole package - its demand, dwell, cruise speed and
   * running-time spread were chosen together with its geometry - so running
   * one under another corridor's inputs would not be running that preset. Only
   * populated for `source: 'preset'`.
   */
  presetInputs?: ReadonlyMap<string, Partial<ModelledInputs>>;
  /**
   * Why each corridor the caller asked for is NOT in `corridors`, when it was
   * left out for a reason worth naming. Reported rather than silently dropped:
   * a run that quietly evaluates eight of ten corridors has a wrong denominator.
   */
  excluded?: Array<{ routeDirectionId: string; reason: string }>;
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

/**
 * The three trial presets as corridors THIS harness can run.
 *
 * Built from `CORRIDOR_PRESETS`, never re-declared: a second copy of the urban
 * corridor's headway is exactly how a comparison stops being a comparison with
 * the thing it names. Stops are laid out evenly over the preset's own distance
 * and station count, which is what `fleetTrial/corridor.ts` does with the same
 * two numbers.
 *
 * Every stop is a control point, matching both presets' own
 * `holdingPointCount: undefined`. The ORIGIN being one is load-bearing:
 * terminal dispatch can only fire at a control point, and a fixture that
 * skipped it would report 0% coverage for Algorithm A and invite the reader to
 * conclude the law is dead.
 */
function presetCorridor(presetId: keyof typeof CORRIDOR_PRESETS): CorridorInputs {
  const preset = CORRIDOR_PRESETS[presetId];
  const spec = preset.corridor;
  const routeDirectionId = spec.routeDirectionId;
  const stopCount = spec.stationCount;

  const stops: CorridorStop[] = Array.from({ length: stopCount }, (_, i) => {
    const fraction = stopCount > 1 ? i / (stopCount - 1) : 0;
    return {
      stopId: `${routeDirectionId}-stop-${i}`,
      name: `Stop ${i}`,
      sequence: i,
      cumulativeDistanceMeters: Math.round(spec.totalDistanceMeters * fraction),
      isControlPoint: true,
      maxHoldSeconds: null,
      latitude: 26.8 - fraction * 0.4,
      longitude: 80.9 - fraction * 0.6,
    };
  });

  return {
    routeDirectionId,
    routeId: `${routeDirectionId}-route`,
    routeName: preset.title,
    directionCode: 'OUT',
    isLoop: false,
    totalDistanceMeters: spec.totalDistanceMeters,
    calibrationSource: 'preset',
    policy: {
      id: `${routeDirectionId}-policy`,
      routeDirectionId,
      operatingPeriod: 'all',
      dayType: 'all',
      targetHeadwaySeconds: spec.targetHeadwaySeconds,
      bunchedThresholdRatio: spec.bunchedThresholdRatio,
      warningThresholdRatio: spec.warningThresholdRatio,
      kf: spec.kf,
      kb: spec.kb,
      selfEqualizingK: spec.selfEqualizingK,
      maxHoldSeconds: spec.maxHoldSeconds,
      cooldownSeconds: 60,
      minimumActionSeconds: 0,
      predictionHorizonControlPoints: 3,
      occupancyStaleSeconds: null,
      occupancyCapacity: null,
      ks: null,
      maxLatenessSeconds: spec.maxLatenessSeconds ?? null,
      speedBandMinKmph: null,
      speedBandMaxKmph: null,
    },
    stops,
    shape: stops.map((s) => ({ latitude: s.latitude, longitude: s.longitude })),
  };
}

/**
 * The route-directions `sim:eligibility` returns a verdict of `eligible` for.
 *
 * The verdict comes from `assessCorridorEligibility`, called on the shapes
 * `eligibilityRepository.ts` reads - the same two functions the eligibility
 * report and the decision cycle's own gate use. Nothing about the band is
 * re-derived here.
 *
 * The ASSUMPTIONS are the run's, not the eligibility CLI's, and that is the
 * whole reason this takes an argument. sigma_leg scales linearly with
 * `travelTimeVariation`; the eligibility CLI defaults to 0.12 and an
 * evaluation runs at 0.2 (`EVALUATION_DEFAULT_INPUTS`). Selecting corridors at
 * one spread and then simulating them at another would put "in band" corridors
 * outside the band in the run that was supposed to be about them - measured on
 * this network, 132 corridors are controllable at 0.12 and 103 at 0.2.
 */
async function selectEligibleRouteDirectionIds(
  assumptions: ControllabilityAssumptions,
  requireLivePair: boolean,
): Promise<{ ids: string[]; excluded: Array<{ routeDirectionId: string; reason: string }> }> {
  const env = loadEnv();
  const shapes = await loadCorridorShapes({
    freshnessSeconds: env.HEADWAY_VEHICLE_FRESHNESS_SECONDS,
  });

  const ids: string[] = [];
  const excluded: Array<{ routeDirectionId: string; reason: string }> = [];
  for (const shape of shapes) {
    const verdict = assessCorridorEligibility(shape, assumptions);
    // `too_few_vehicles` is the one verdict this may waive. The simulator
    // dispatches its own fleet, so a live pair is a fact about whether the
    // DECISION CYCLE could act on the corridor today, not about whether the
    // corridor can be simulated - and it is a 300-second snapshot either way.
    const onlyBlockerIsVehicles =
      !verdict.eligible &&
      verdict.verdict === 'too_few_vehicles' &&
      verdict.controllability?.band === 'controllable';

    if (verdict.eligible || (!requireLivePair && onlyBlockerIsVehicles)) {
      ids.push(shape.routeDirectionId);
      // Uncalibrated corridors are not listed as exclusions. There are 561 of
      // them and they are refused by every reader in this service, not by this
      // selection - `sim:eligibility` is where that population is reported.
      // What belongs here is a corridor this run could plausibly have taken
      // and did not.
    } else if (verdict.verdict !== 'uncalibrated') {
      excluded.push({
        routeDirectionId: shape.routeDirectionId,
        reason: verdict.reasons[0] ?? verdict.verdict,
      });
    }
  }
  return { ids, excluded };
}

/**
 * Thin a list to `limit`, evenly across its order rather than from the top.
 *
 * What this drops is NOT recorded as an exclusion: a corridor left out by a
 * cap the caller asked for is not a corridor that failed anything. The run
 * writes the ids it resolved to into its own `spec.json`, which is what makes
 * the sample re-runnable.
 *
 * The list is ordered by corridor length, and corridor length is the variable
 * that most changes how a control law behaves. Ten of the longest corridors is
 * one experiment repeated ten times.
 */
function sampleEvenly<T>(items: readonly T[], limit: number | undefined): T[] {
  if (limit === undefined || items.length <= limit) return [...items];
  const step = items.length / limit;
  const picked: T[] = [];
  for (let i = 0; i < limit; i++) {
    const item = items[Math.floor(i * step)];
    if (item !== undefined) picked.push(item);
  }
  return picked;
}

/** Longest first, so `sampleEvenly` spreads a cap across the length range. */
async function orderByLength(ids: readonly string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const { rows } = await getPool().query<{ route_direction_id: string }>(
    `select rd.id as route_direction_id
       from route_directions rd
       left join route_shapes rs on rs.route_direction_id = rd.id
      where rd.id = any($1::uuid[])
      order by coalesce(rs.total_distance_meters, 0) desc, rd.id asc`,
    [[...ids]],
  );
  return rows.map((row) => row.route_direction_id);
}

export async function selectCorridors(
  source: CorridorSource,
  /**
   * The running-time assumptions the RUN will simulate under. Required by
   * `source: 'eligible'`, which decides a band on them; ignored otherwise.
   */
  assumptions?: ControllabilityAssumptions,
): Promise<CorridorSelection> {
  if (source.source === 'synthetic') {
    return {
      corridors: Array.from({ length: source.count }, (_, i) => syntheticCorridor(i)),
      provenance: 'synthetic',
    };
  }

  if (source.source === 'preset') {
    const ids = Object.keys(CORRIDOR_PRESETS) as Array<keyof typeof CORRIDOR_PRESETS>;
    const presetInputs = new Map<string, Partial<ModelledInputs>>(
      ids.map((id) => [CORRIDOR_PRESETS[id].corridor.routeDirectionId, CORRIDOR_PRESETS[id].inputs]),
    );
    return { corridors: ids.map(presetCorridor), provenance: 'preset', presetInputs };
  }

  let excluded: Array<{ routeDirectionId: string; reason: string }> = [];
  let ids: string[];
  if (source.source === 'eligible') {
    if (!assumptions) {
      throw new AppError(
        'invalid_request',
        "Selecting eligible corridors needs the running-time assumptions the run will simulate under: the controllability band is a ratio of sigma_leg, which scales with travelTimeVariation.",
        400,
      );
    }
    const found = await selectEligibleRouteDirectionIds(assumptions, source.requireLivePair);
    excluded = found.excluded;
    if (found.ids.length === 0) {
      throw new AppError(
        'no_eligible_corridors',
        `No ACTIVE route-direction is both calibrated and inside the controllable band at travelTimeVariation ${assumptions.travelTimeVariation}${source.requireLivePair ? ', carrying at least two live vehicles' : ''}. Run \`pnpm sim:eligibility\` to see why.`,
        404,
      );
    }
    ids = sampleEvenly(await orderByLength(found.ids), source.sample);
  } else {
    ids = source.routeDirectionIds ?? (await sampleCalibratedRouteDirectionIds(source.sample ?? 10));
    if (ids.length === 0) {
      throw new AppError(
        'no_calibrated_corridors',
        'No calibrated route-direction is available to evaluate. Seed the network and confirm at least one route_policies row has a measured calibration_source.',
        404,
      );
    }
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
        excluded.push({ routeDirectionId: id, reason: 'no measured target headway' });
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

  return { corridors, provenance: 'measured', excluded };
}
