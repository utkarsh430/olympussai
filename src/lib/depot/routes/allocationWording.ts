import { formatCount } from '../format';
import type { RouteMove, UnchangedReason } from '../optimise/allocateTypes';
import type { AllocationExclusion, AllocationParams, DepotAllocationResponse } from './api';

/**
 * Every sentence and label the routes page says about the allocation plan.
 * Kilometre figures are compared in tenths (the precision they are shown at),
 * so float noise can never flip a "no saving" into a saving.
 */

const KM_FORMAT = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** A kilometre figure in whole tenths; `-0` and non-finite values read as 0. */
export function toTenths(km: number): number {
  const tenths = Math.round(km * 10);
  return Number.isFinite(tenths) && tenths !== 0 ? tenths : 0;
}

/** One decimal, Indian digit grouping, never "-0.0". */
export function formatKm(km: number): string {
  return KM_FORMAT.format(toTenths(km) / 10);
}

function routes(n: number): string {
  return `${formatCount(n)} ${n === 1 ? 'route' : 'routes'}`;
}

/** The allocator's precedence: a route that meets several reasons carries the first. */
export const UNCHANGED_ORDER: readonly UnchangedReason[] = [
  'no_candidate',
  'already_best',
  'below_threshold',
  'over_capacity',
  'move_limit',
  'no_capacity',
];

export const EXCLUSION_ORDER: readonly AllocationExclusion[] = [
  'no_primary_depot',
  'operator_not_depot',
  'not_profiled',
  'too_few_located_stops',
  'no_depot_position',
];

type Params = Pick<AllocationParams, 'minSavingKmPerDay' | 'maxMoves'>;

/** Short phrase for counts in the summary line. */
function unchangedShort(reason: UnchangedReason, params: Params): string {
  switch (reason) {
    case 'no_candidate':
      return 'no comparable depot';
    case 'already_best':
      return 'already at the nearest depot';
    case 'below_threshold':
      return `saving under ${formatCount(params.minSavingKmPerDay)} km a day`;
    case 'over_capacity':
      return 'own depot over its modelled capacity';
    case 'move_limit':
      return 'stopped by the move cap';
    case 'no_capacity':
      return 'no depot with room';
  }
}

/** The full reason, used as the heading of a group of unmoved routes. */
export function unchangedReasonText(reason: UnchangedReason, params: Params): string {
  switch (reason) {
    case 'no_candidate':
      return 'No comparable depot: there is no dead-kilometre figure for its own depot or for any other.';
    case 'already_best':
      return 'Already at its nearest depot.';
    case 'below_threshold':
      return `A nearer depot exists, but the saving is under ${formatCount(params.minSavingKmPerDay)} km a day.`;
    case 'over_capacity':
      return 'Its own depot starts over its modelled capacity, and the plan does not repair that, so its routes stay.';
    case 'move_limit':
      return `The cap of ${formatCount(params.maxMoves)} moves was reached. It stopped a move that involves this route, possibly a swap in which this route's own leg costs kilometres.`;
    case 'no_capacity':
      return 'A better depot exists, but none has room.';
  }
}

const EXCLUSION_SHORT: Readonly<Record<AllocationExclusion, string>> = {
  no_primary_depot: 'run equally by two depots',
  operator_not_depot: 'run by a hired, electric or enforcement unit',
  not_profiled: 'no known profile',
  too_few_located_stops: 'no terminals to measure from',
  no_depot_position: 'depot location unknown',
};

const EXCLUSION_TEXT: Readonly<Record<AllocationExclusion, string>> = {
  no_primary_depot: 'Run equally by two or more depots, so there is no single depot to move it from.',
  operator_not_depot: 'Run by a hired, electric or enforcement unit, not by a depot.',
  not_profiled: 'No known profile: its stops have not been fetched yet.',
  too_few_located_stops: 'Fewer than two of its stops are located, so there are no terminals to measure from.',
  no_depot_position: 'Its depot has neither an inferred yard nor a median bus position, so its location is unknown.',
};

export function exclusionText(reason: AllocationExclusion): string {
  return EXCLUSION_TEXT[reason];
}

const MADE_ROOM = 'moved to make room';

/** The word for a route that moved so another could; null for an ordinary move. */
export function moveNote(move: Pick<RouteMove, 'madeRoom' | 'savedKmPerDay'>): string | null {
  if (!move.madeRoom) return null;
  return toTenths(move.savedKmPerDay) <= 0 ? `${MADE_ROOM}, no saving of its own` : MADE_ROOM;
}

function countsLine<T extends string>(
  items: readonly { readonly reason: T }[],
  order: readonly T[],
  short: (reason: T) => string,
): string {
  return order
    .map((reason) => ({ reason, n: items.filter((item) => item.reason === reason).length }))
    .filter((entry) => entry.n > 0)
    .map((entry) => `${formatCount(entry.n)} ${short(entry.reason)}`)
    .join(', ');
}

export interface AllocationHeadline {
  /** Kilometre figures without units; every one is MODELLED. */
  readonly now: string;
  readonly after: string;
  readonly saving: string;
  /** False when no route could be costed: show `emptyLine` instead of the totals. */
  readonly planned: boolean;
  readonly emptyLine: string;
  readonly movesLine: string;
  readonly stayLine: string | null;
  readonly excludedLine: string | null;
  readonly coverageLine: string;
  readonly positionsLine: string;
}

function positionsLine(p: DepotAllocationResponse['depotPositions']): string {
  const parts = [
    `${formatCount(p.yard)} ${p.yard === 1 ? 'depot' : 'depots'} placed at ${p.yard === 1 ? 'its' : 'their'} yard`,
    `${formatCount(p.median)} at the median position of ${p.median === 1 ? 'its' : 'their'} buses`,
    ...(p.none > 0 ? [`${formatCount(p.none)} with no position`] : []),
  ];
  return `Depot positions are inferred: ${parts.join(', ')}.`;
}

/** The hero's figures and sentences, from one allocation response. */
export function allocationHeadline(a: DepotAllocationResponse): AllocationHeadline {
  const { planned, profiled } = a.coverage;
  const params = a.params;
  const madeRoom = a.moves.filter((m) => m.madeRoom).length;
  const movesLine =
    a.moves.length === 0
      ? 'No route would move.'
      : `${routes(a.moves.length)} would move to another depot${
          madeRoom === 0 ? '' : `, ${formatCount(madeRoom)} of them to make room for another route`
        }.`;
  return {
    now: formatKm(a.beforeKmPerDay.value),
    after: formatKm(a.afterKmPerDay.value),
    saving: formatKm(a.savedKmPerDay.value),
    planned: planned.n > 0,
    emptyLine: `No route can be planned yet: none of the ${routes(planned.of)} in the feed has a known profile that can be measured from a depot.`,
    movesLine,
    stayLine:
      a.unchanged.length === 0
        ? null
        : `${routes(a.unchanged.length)} would stay: ${countsLine(a.unchanged, UNCHANGED_ORDER, (r) =>
            unchangedShort(r, params),
          )}.`,
    excludedLine:
      a.excluded.length === 0
        ? null
        : `${routes(a.excluded.length)} are outside the plan: ${countsLine(
            a.excluded,
            EXCLUSION_ORDER,
            (r) => EXCLUSION_SHORT[r],
          )}.`,
    coverageLine: `Based on ${formatCount(planned.n)} of ${routes(planned.of)} with a known profile that can be measured from a depot; ${formatCount(profiled.n)} of ${routes(profiled.of)} have a known profile.`,
    positionsLine: positionsLine(a.depotPositions),
  };
}

export function paramsSentence(params: AllocationParams): string {
  return `The plan moves a route only for a saving of at least ${formatCount(params.minSavingKmPerDay)} km a day and makes at most ${formatCount(params.maxMoves)} moves; road distance is taken as ${params.detourFactor} times the straight line. The server fixes these; they cannot be changed here.`;
}

export function notProfiledSentence(missing: number, total: number): string {
  if (missing === 0) return 'Every route in the feed has a known profile.';
  return `${formatCount(missing)} of ${routes(total)} have no known profile yet, so the plan cannot measure their dead kilometres.`;
}

export const TRIP_MEANING =
  'A trip here is one run out of the depot: the bus drives empty from its depot to the first stop, runs the route, and drives empty back from the last stop. The feed does not carry trip counts, so trips a day are modelled from the buses on the route and its scheduled length.';

export const PROFILES_GROW_WITH_USE =
  "A route's stops are fetched one route at a time, when a depot's roster or a bus on that route is opened, never in bulk, so coverage grows with use.";

export const RECOMMENDATION_ONLY =
  'Recommendation only: no route is reassigned. Any change of depot is decided and made outside this page.';
