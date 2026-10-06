import { SeededRandom } from '../../simulation/seededRandom';
import type { Yard } from '../infer/types';
import type { DepotBalance } from '../optimise/types';
import { componentValues } from '../score/dei';
import { clamp, median } from '../stats/robust';
import type { DepotSummary, LatLng } from '../types';
import {
  BASE_UTILISATION_BOUNDS,
  BASIS_POINTS,
  DEFAULT_REQUIREMENT_PARAMS,
  MIN_PEER_FLEET,
  NOISE_BOUNDS,
  PEAK_SHARE_BOUNDS,
  SPARE_RATIO_BOUNDS,
  UTILISATION_SENSITIVITY_BOUNDS,
} from './config';
import { seedFor } from './seed';
import type { RequirementParams } from './types';

interface Bounds {
  readonly min: number;
  readonly max: number;
}

function clampParam(value: number, bounds: Bounds, fallback: number): number {
  return clamp(Number.isFinite(value) ? value : fallback, bounds.min, bounds.max);
}

/** Out-of-range or non-finite parameters are pulled into range, never rejected. */
export function clampRequirementParams(params: RequirementParams): RequirementParams {
  const d = DEFAULT_REQUIREMENT_PARAMS;
  return {
    spareRatio: clampParam(params.spareRatio, SPARE_RATIO_BOUNDS, d.spareRatio),
    baseUtilisation: clampParam(params.baseUtilisation, BASE_UTILISATION_BOUNDS, d.baseUtilisation),
    utilisationSensitivity: clampParam(
      params.utilisationSensitivity,
      UTILISATION_SENSITIVITY_BOUNDS,
      d.utilisationSensitivity,
    ),
    noise: clampParam(params.noise, NOISE_BOUNDS, d.noise),
  };
}

/** ceil(peak x ratio) in integers: Math.ceil(100 * 0.07) is 8 in floating point. */
export function spareTargetFor(peakRequirement: number, spareRatio: number): number {
  return Math.ceil((peakRequirement * Math.round(spareRatio * BASIS_POINTS)) / BASIS_POINTS);
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Numeric ids first, in numeric order; anything else after, alphabetically. */
function compareDepotIds(a: string, b: string): number {
  const aNumeric = /^\d+$/.test(a);
  const bNumeric = /^\d+$/.test(b);
  if (aNumeric && bNumeric) return Number(a) - Number(b) || compareText(a, b);
  if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
  return compareText(a, b);
}

function peerMedianOnRoad(depots: readonly DepotSummary[]): number {
  const shares = depots.flatMap((d) => {
    if (d.kind !== 'depot' || d.fleet < MIN_PEER_FLEET) return [];
    const share = componentValues(d).onRoad;
    return share === null || !Number.isFinite(share) ? [] : [share];
  });
  return median(shares) ?? 0;
}

function positionOf(depot: DepotSummary, yards: ReadonlyMap<string, Yard>): LatLng | null {
  const yard = yards.get(depot.id);
  if (yard !== undefined) return { lat: yard.lat, lng: yard.lng };
  return depot.centroid;
}

function peakRequirementFor(
  depot: DepotSummary,
  available: number,
  peerMedian: number,
  operatingDate: string,
  params: RequirementParams,
): number {
  const live = componentValues(depot).onRoad;
  const share = live !== null && Number.isFinite(live) ? live : peerMedian;
  const rng = new SeededRandom(seedFor(depot.id, operatingDate, 'requirement'));
  const epsilon = rng.float(-params.noise, params.noise);
  const utilisation = clamp(
    params.baseUtilisation + params.utilisationSensitivity * (share - peerMedian) + epsilon,
    PEAK_SHARE_BOUNDS.min,
    PEAK_SHARE_BOUNDS.max,
  );
  return Math.round(available * utilisation);
}

/** A count: finite, whole and non-negative; anything else is zero. */
function wholeCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

/**
 * The live anchors, made consistent once at the door so that
 * `available = fleet - offRoad` holds literally for every output: fleet is a
 * non-negative integer and off-road an integer within [0, fleet].
 */
function sanitiseAnchors(depot: DepotSummary): DepotSummary {
  const fleet = wholeCount(depot.fleet);
  const offRoad = Math.min(fleet, wholeCount(depot.states.offRoad));
  return { ...depot, fleet, states: { ...depot.states, offRoad } };
}

function balanceFor(
  depot: DepotSummary,
  yards: ReadonlyMap<string, Yard>,
  peerMedian: number,
  operatingDate: string,
  params: RequirementParams,
): DepotBalance {
  const { fleet } = depot;
  const offRoad = depot.states.offRoad;
  const available = fleet - offRoad;
  const modelled = depot.kind === 'depot' && available > 0;
  const peakRequirement = modelled
    ? peakRequirementFor(depot, available, peerMedian, operatingDate, params)
    : available;
  const spareTarget = modelled ? spareTargetFor(peakRequirement, params.spareRatio) : 0;
  const required = peakRequirement + spareTarget;
  return {
    depotId: depot.id,
    depotName: depot.name,
    kind: depot.kind,
    fleet,
    offRoad,
    available,
    peakRequirement,
    spareTarget,
    required,
    balance: available - required,
    position: positionOf(depot, yards),
  };
}

/** One balance per depot, sorted by depot id. Never mutates its inputs. */
export function modelBalances(
  depots: readonly DepotSummary[],
  yards: ReadonlyMap<string, Yard>,
  operatingDate: string,
  params: RequirementParams,
): DepotBalance[] {
  const safe = clampRequirementParams(params);
  const clean = depots.map(sanitiseAnchors);
  const peerMedian = peerMedianOnRoad(clean);
  return clean
    .sort((a, b) => compareDepotIds(a.id, b.id))
    .map((d) => balanceFor(d, yards, peerMedian, operatingDate, safe));
}
