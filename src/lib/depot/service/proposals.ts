import { compareText } from '../stats/order';
import { bandFigures, bandsOf, inBand, proposalId, splitOnSteps } from './bands';
import { unroutedCoverGuard } from './gap';
import { proposalImpact } from './impact';
import {
  ADD_MIN_BUSES,
  ADD_MIN_SHARE,
  HOLD_KEEP_MIN,
  HOLD_MIN_SURPLUS,
  MIN_BAND_HOURS,
  SPLIT_STEP_MIN_BUSES,
  SPLIT_STEP_SHARE,
} from './proposalConfig';
import { proposalReason } from './proposalReasons';
import { timetableFindings } from './timetableFindings';
import {
  MIN_SLOTS_FOR_AN_HOUR,
  type HourBand,
  type LedgerJourney,
  type NeedInputs,
  type ObservedDepotHour,
  type ObservedRouteHour,
  type Proposal,
  type ProposalKind,
  type ProposalSource,
  type ProposalTier,
  type RouteHourFigures,
} from './types';

/** Everything the proposals of one route's day are built from. */
export interface ProposalContext {
  readonly routeName: string;
  readonly operatingDate: string;
  /** Minutes past midnight on the feed clock; null without a feed clock. */
  readonly feedMinute: number | null;
  /** The route's 24 hours, from `routeHourFigures`. */
  readonly hours: readonly RouteHourFigures[];
  readonly need: NeedInputs;
  readonly ledger: readonly LedgerJourney[];
  /** The route's primary operating depot; null when none is known. */
  readonly depot: { readonly depotId: string; readonly depotName: string } | null;
  /** That depot's observed hours (others are ignored). */
  readonly depotHours: readonly ObservedDepotHour[];
  /** Idle buses at that depot in its modelled day plan; null when unknown. */
  readonly modelledIdleBuses: number | null;
  /** One-way route length in km, for the impact. */
  readonly lengthKm: number;
  readonly deadKmPerTrip?: number | null;
}

/** The depot running the most bus-hours on the route over its observed hours; ties to the lower id. */
export function primaryOperatorDepot(observed: readonly ObservedRouteHour[]): string | null {
  const totals = new Map<string, number>();
  for (const hour of observed) {
    for (const [depotId, buses] of Object.entries(hour.operators)) {
      totals.set(depotId, (totals.get(depotId) ?? 0) + buses);
    }
  }
  const ranked = [...totals].sort((a, b) => b[1] - a[1] || compareText(a[0], b[0]));
  return ranked[0]?.[0] ?? null;
}

function depotHourAt(ctx: ProposalContext, hour: number): ObservedDepotHour | null {
  if (ctx.depot === null) return null;
  const id = ctx.depot.depotId;
  return (
    ctx.depotHours.find(
      (d) => d.depotId === id && d.hour === hour && d.slotsObserved >= MIN_SLOTS_FOR_AN_HOUR,
    ) ?? null
  );
}

/** The depot's yard as observed in the hour before the band, else the modelled day plan. */
function sourceFor(ctx: ProposalContext, band: HourBand): ProposalSource | null {
  if (ctx.depot === null) return null;
  const before = depotHourAt(ctx, band.fromHour - 1);
  if (before !== null && before.standingInYardMean !== null) {
    return {
      ...ctx.depot,
      standingInYard: Math.round(before.standingInYardMean),
      basis: 'observed',
    };
  }
  return {
    ...ctx.depot,
    standingInYard: null,
    basis: 'modelled',
    idleInDayPlan: ctx.modelledIdleBuses,
  };
}

/** An add's source is none when only the modelled day plan was left and it leaves no bus idle. */
const noSourceFound = (source: ProposalSource | null): boolean =>
  source !== null && source.basis === 'modelled' && source.idleInDayPlan === 0;

/**
 * B: measured deployment against modelled demand. C when the deployment is modelled too
 * (demand always is today), when unrouted buses may cover the gap, or when an add has no source.
 */
function tierOf(rows: readonly RouteHourFigures[], covered: boolean, sourceless: boolean): ProposalTier {
  const allModelled = rows.every((h) => h.deployedBasis === 'modelled');
  return allModelled || covered || sourceless ? 'C' : 'B';
}

const addThreshold = (h: RouteHourFigures): number =>
  Math.max(ADD_MIN_BUSES, ADD_MIN_SHARE * h.needed);
/** Buses an hour must keep: at least one, and never fewer than its scheduled bus-hours. */
const keepOf = (h: RouteHourFigures): number =>
  Math.max(HOLD_KEEP_MIN, Math.ceil(h.scheduled ?? 0));
const releasable = (h: RouteHourFigures): number =>
  h.gap <= -HOLD_MIN_SURPLUS ? Math.min(Math.floor(-h.gap), Math.floor(h.deployed - keepOf(h))) : 0;

function supplyProposal(
  ctx: ProposalContext,
  kind: Extract<ProposalKind, 'add_buses' | 'hold_buses'>,
  band: HourBand,
): Proposal | null {
  const rows = ctx.hours.filter((h) => inBand(band, h.hour));
  const meanGap = rows.reduce((s, h) => s + h.gap, 0) / rows.length;
  const change = kind === 'add_buses' ? Math.ceil(meanGap) : -Math.min(...rows.map(releasable));
  if (change === 0) return null;
  const covered =
    kind === 'add_buses' && rows.some((h) => unroutedCoverGuard(h.gap, depotHourAt(ctx, h.hour)));
  const found = sourceFor(ctx, band);
  const sourceless = kind === 'add_buses' && noSourceFound(found);
  const source = sourceless ? null : found;
  const figures = bandFigures(band, ctx.hours);
  const reason =
    kind === 'add_buses'
      ? proposalReason({ kind, band, ...figures, change, source, noSourceFound: sourceless })
      : proposalReason({
          kind,
          band,
          ...figures,
          change,
          source,
          keep: Math.max(...rows.map(keepOf)),
        });
  return {
    id: proposalId(ctx.operatingDate, kind, ctx.routeName, band),
    kind,
    routeName: ctx.routeName,
    operatingDate: ctx.operatingDate,
    band,
    ...figures,
    change,
    source,
    tier: tierOf(rows, covered, sourceless),
    maybeCoveredByUnrouted: covered,
    reason,
    impact: proposalImpact({
      change,
      band,
      hours: ctx.hours,
      need: ctx.need,
      lengthKm: ctx.lengthKm,
      deadKmPerTrip: ctx.deadKmPerTrip,
    }),
  };
}

const STEP_RULE = { minBuses: SPLIT_STEP_MIN_BUSES, share: SPLIT_STEP_SHARE } as const;

/** The runs of qualifying hours, each split where its gap steps (so a band's figure fits every hour). */
function steppedBands(ctx: ProposalContext, hours: readonly number[]): readonly HourBand[] {
  const gapAt = (hour: number): number => ctx.hours.find((h) => h.hour === hour)?.gap ?? 0;
  return bandsOf(hours, MIN_BAND_HOURS).flatMap((band) =>
    splitOnSteps(band, gapAt, STEP_RULE, MIN_BAND_HOURS),
  );
}

const KIND_ORDER: readonly ProposalKind[] = [
  'add_buses',
  'hold_buses',
  'trips_not_run',
  'service_span_gap',
  'headway_gap',
  'revise_running_time',
  'shift_departures',
  'reserve_by_hour',
  'maintenance_window',
  'corridor_under_served',
  'corridor_over_served',
];

/** Passengers a proposal lets the route carry; none for a finding or a hold (which carries no more). */
const carried = (p: Proposal): number => Math.max(0, p.impact?.passengersPerDay.high ?? 0);

/** More passengers carried first, then the earlier hour, then kind. */
export function compareProposals(a: Proposal, b: Proposal): number {
  const ia = carried(a);
  const ib = carried(b);
  return (
    ib - ia ||
    a.band.fromHour - b.band.fromHour ||
    KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)
  );
}

/**
 * The route's proposals for the day. Add: a gap of at least max(2 buses, a
 * fifth of the need) for two hours or more, the band's mean gap rounded up; a band is
 * split where the gap steps from one hour to the next by more than max(2 buses, half the
 * larger gap), a piece shorter than two hours joining its nearest-gap neighbour.
 * Hold: a surplus of a bus or more for two hours or more, the least any hour
 * can release while keeping one bus and its scheduled supply. Then the tier-A
 * timetable findings. Recommendation only: nothing is dispatched.
 */
export function buildProposals(ctx: ProposalContext): Proposal[] {
  const short = ctx.hours.filter((h) => h.gap > 0 && h.gap >= addThreshold(h)).map((h) => h.hour);
  const spare = ctx.hours.filter((h) => releasable(h) >= 1).map((h) => h.hour);
  const supply = [
    ...steppedBands(ctx, short).map((band) => supplyProposal(ctx, 'add_buses', band)),
    ...steppedBands(ctx, spare).map((band) => supplyProposal(ctx, 'hold_buses', band)),
  ].filter((p): p is Proposal => p !== null);
  return [...supply, ...timetableFindings(ctx)].sort(compareProposals);
}
