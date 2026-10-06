import { SeededRandom } from '../../simulation/seededRandom';
import type { Yard } from '../infer/types';
import type { DepotBalance } from '../optimise/types';
import { componentValues } from '../score/dei';
import type { DepotScore } from '../score/types';
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
import { compareText } from '@/lib/depot/stats/order';

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

/** Numeric ids first, in numeric order; anything else after, alphabetically. */
function compareDepotIds(a: string, b: string): number {
  const aNumeric = /^\d+$/.test(a);
  const bNumeric = /^\d+$/.test(b);
  if (aNumeric && bNumeric) return Number(a) - Number(b) || compareText(a, b);
  if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
  return compareText(a, b);
}

/**
 * On-road shares by depot id; null when it has none. Built per snapshot over the rolling
 * score window, then held at each depot's highest so far in the operating date
 * (`live/peakShareHold.ts`) before the requirement reads it.
 */
export type WindowedOnRoadShares = ReadonlyMap<string, number | null>;

const NO_WINDOW: WindowedOnRoadShares = new Map();

/**
 * Per depot id, the highest peak requirement computed for it earlier in the
 * operating date (`live/peakRequirementHold.ts`): the peak does not fall below
 * it while the buses are available.
 */
export type PeakFloors = ReadonlyMap<string, number>;

const NO_FLOORS: PeakFloors = new Map();

/**
 * Each depot's on-road share over the rolling score window in this snapshot: the
 * `onRoad` component the scores were summed over, the same one the efficiency
 * index and the league breakdown use. Built by the callers from the analysis.
 */
export function windowedOnRoadShares(scores: readonly DepotScore[]): WindowedOnRoadShares {
  return new Map(
    scores.map((s) => [s.depotId, s.components.find((c) => c.key === 'onRoad')?.value ?? null]),
  );
}

const finiteOrNull = (value: number | null | undefined): number | null =>
  value !== null && value !== undefined && Number.isFinite(value) ? value : null;

/**
 * The share the requirement reads: the windowed one, else this snapshot's own
 * (a depot new to the window), else null (the caller falls back to the peers).
 */
function onRoadShare(depot: DepotSummary, windowed: WindowedOnRoadShares): number | null {
  return finiteOrNull(windowed.get(depot.id)) ?? finiteOrNull(componentValues(depot).onRoad);
}

function peerMedianOnRoad(
  depots: readonly DepotSummary[],
  windowed: WindowedOnRoadShares,
): number {
  const shares = depots.flatMap((d) => {
    if (d.kind !== 'depot' || d.fleet < MIN_PEER_FLEET) return [];
    const share = onRoadShare(d, windowed);
    return share === null ? [] : [share];
  });
  return median(shares) ?? 0;
}

function positionOf(depot: DepotSummary, yards: ReadonlyMap<string, Yard>): LatLng | null {
  const yard = yards.get(depot.id);
  if (yard !== undefined) return { lat: yard.lat, lng: yard.lng };
  return depot.centroid;
}

interface Basis {
  readonly peerMedian: number;
  readonly windowed: WindowedOnRoadShares;
  readonly floors: PeakFloors;
  readonly operatingDate: string;
  readonly params: RequirementParams;
}

/**
 * The depot's held on-road share (its busiest windowed share so far in the
 * operating date) against the peers' median of those: the instantaneous share
 * moves every minute, and even the windowed share falls through the evening, so
 * the modelled day and the transfer plan would move with them. Then a seeded draw.
 */
function peakRequirementFor(depot: DepotSummary, available: number, basis: Basis): number {
  const { peerMedian, operatingDate, params } = basis;
  const share = onRoadShare(depot, basis.windowed) ?? peerMedian;
  const rng = new SeededRandom(seedFor(depot.id, operatingDate, 'requirement'));
  const epsilon = rng.float(-params.noise, params.noise);
  const utilisation = clamp(
    params.baseUtilisation + params.utilisationSensitivity * (share - peerMedian) + epsilon,
    PEAK_SHARE_BOUNDS.min,
    PEAK_SHARE_BOUNDS.max,
  );
  return Math.round(available * utilisation);
}

/**
 * The computed peak, lifted to the depot's floor where it has one, the floor
 * capped at what is available now: a rounding at a boundary, a row the feed
 * dropped or a rising peer median cannot lower the peak within the date, but a
 * real loss of buses still does.
 */
function flooredPeak(computed: number, floor: number | undefined, available: number): number {
  if (floor === undefined || !Number.isFinite(floor)) return computed;
  return Math.max(computed, Math.min(Math.floor(floor), available));
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
  basis: Basis,
): DepotBalance {
  const { fleet } = depot;
  const offRoad = depot.states.offRoad;
  const available = fleet - offRoad;
  const modelled = depot.kind === 'depot' && available > 0;
  const peakRequirement = modelled
    ? flooredPeak(peakRequirementFor(depot, available, basis), basis.floors.get(depot.id), available)
    : available;
  const spareTarget = modelled ? spareTargetFor(peakRequirement, basis.params.spareRatio) : 0;
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

/**
 * One balance per depot, sorted by depot id. Pure; never mutates its inputs.
 * `windowed` gives each depot's busiest windowed on-road share so far in the
 * operating date (`live/peakShareHold.ts`); a depot it lacks a value for reads its
 * single-snapshot share, then the peer median. `floors` lifts each depot's
 * peak to the highest computed for it earlier in the date, capped at what is
 * available now; the spare target, requirement and balance follow the lifted
 * peak. Every caller that shows a requirement passes the same maps, so they
 * all rest on one requirement.
 */
export function modelBalances(
  depots: readonly DepotSummary[],
  yards: ReadonlyMap<string, Yard>,
  operatingDate: string,
  params: RequirementParams,
  windowed: WindowedOnRoadShares = NO_WINDOW,
  floors: PeakFloors = NO_FLOORS,
): DepotBalance[] {
  const safe = clampRequirementParams(params);
  const clean = depots.map(sanitiseAnchors);
  const peerMedian = peerMedianOnRoad(clean, windowed);
  const basis = { peerMedian, windowed, floors, operatingDate, params: safe };
  return clean
    .sort((a, b) => compareDepotIds(a.id, b.id))
    .map((d) => balanceFor(d, yards, basis));
}
