import { LATE_AFTER_MIN } from '../routes/delayConfig';
import { MINUTES_PER_HOUR } from '../units';
import { bandFigures, bandsOf, inBand, proposalId } from './bands';
import { clockOf as clock, hourOf, minuteOfDay } from './feedMinutes';
import {
  HEADWAY_DAYTIME,
  HEADWAY_GAP_MIN,
  MIN_LEDGER_JOURNEYS,
  NOT_RUN_AFTER_MIN,
  RUNNING_TIME_MIN_COVERAGE,
  RUNNING_TIME_MIN_HOURS,
  SPAN_DEMAND_SHARE,
} from './proposalConfig';
import { proposalReason, type ReasonInput } from './proposalReasons';
import type { ProposalContext } from './proposals';
import { reliabilityByHour } from './reliability';
import type { HourBand, LedgerJourney, Proposal, RouteHourFigures } from './types';

/*
 * Tier-A findings: what the feed's own journeys measure about the timetable.
 * They change no bus count (change 0) and carry no modelled impact; the span
 * and headway findings compare the known journeys with the hours that have
 * modelled demand, so a route with few known journeys says nothing.
 */

function finding(ctx: ProposalContext, reason: ReasonInput): Proposal {
  const figures = bandFigures(reason.band, ctx.hours);
  return {
    id: proposalId(ctx.operatingDate, reason.kind, ctx.routeName, reason.band),
    kind: reason.kind,
    routeName: ctx.routeName,
    operatingDate: ctx.operatingDate,
    band: reason.band,
    ...figures,
    change: 0,
    source: null,
    tier: 'A',
    maybeCoveredByUnrouted: false,
    reason: proposalReason(reason),
    impact: null,
  };
}

const ofRoute = (ctx: ProposalContext): LedgerJourney[] =>
  ctx.ledger.filter((j) => j.routeName === ctx.routeName);

const demandIn = (band: HourBand, hours: readonly RouteHourFigures[]): number =>
  hours.filter((h) => inBand(band, h.hour)).reduce((s, h) => s + h.demand, 0);

/**
 * A journey not run: its scheduled start is more than NOT_RUN_AFTER_MIN behind
 * the feed clock and the feed never gave it an actual start. Banded by the
 * hour of the scheduled start. Nothing without a feed clock.
 */
function tripsNotRun(ctx: ProposalContext): Proposal[] {
  const now = ctx.feedMinute;
  if (now === null) return [];
  const missed = ofRoute(ctx).filter((j) => {
    const start = minuteOfDay(j.scheduledStart);
    return start !== null && j.actualStart === null && now - start > NOT_RUN_AFTER_MIN;
  });
  const hourOfStart = (j: LedgerJourney): number | null => hourOf(j.scheduledStart);
  return bandsOf(
    missed.map(hourOfStart).filter((h): h is number => h !== null),
    1,
  ).map((band) =>
    finding(ctx, {
      kind: 'trips_not_run',
      band,
      journeys: missed.filter((j) => inBand(band, hourOfStart(j) ?? -1)).length,
    }),
  );
}

function knownStarts(ctx: ProposalContext): number[] {
  return ofRoute(ctx)
    .map((j) => minuteOfDay(j.scheduledStart))
    .filter((m): m is number => m !== null)
    .sort((a, b) => a - b);
}

/** Hours with demand before the first known start, or after the last known end. */
function serviceSpanGap(ctx: ProposalContext): Proposal[] {
  const starts = knownStarts(ctx);
  if (starts.length < MIN_LEDGER_JOURNEYS) return [];
  const total = ctx.hours.reduce((s, h) => s + h.demand, 0);
  const busy = ctx.hours
    .filter((h) => total > 0 && h.demand >= total * SPAN_DEMAND_SHARE)
    .map((h) => h.hour);
  if (busy.length === 0) return [];
  const ends = ofRoute(ctx)
    .map((j) => minuteOfDay(j.scheduledEnd) ?? minuteOfDay(j.scheduledStart))
    .filter((m): m is number => m !== null);
  const first = starts[0] as number;
  const last = Math.max(...ends);
  const firstHour = Math.floor(first / MINUTES_PER_HOUR);
  const lastHour = Math.floor(last / MINUTES_PER_HOUR);
  const out: Proposal[] = [];
  const early = { fromHour: Math.min(...busy), toHour: firstHour - 1 };
  if (early.toHour >= early.fromHour) {
    const demand = demandIn(early, ctx.hours);
    out.push(
      finding(ctx, {
        kind: 'service_span_gap',
        band: early,
        demand,
        edge: 'before_first',
        at: clock(first),
      }),
    );
  }
  const late = { fromHour: lastHour + 1, toHour: Math.max(...busy) };
  if (late.toHour >= late.fromHour) {
    const demand = demandIn(late, ctx.hours);
    out.push(
      finding(ctx, {
        kind: 'service_span_gap',
        band: late,
        demand,
        edge: 'after_last',
        at: clock(last),
      }),
    );
  }
  return out;
}

/** Daytime hours with demand and no start, inside a gap of HEADWAY_GAP_MIN or more between starts. */
function headwayGap(ctx: ProposalContext): Proposal[] {
  const starts = knownStarts(ctx);
  if (starts.length < MIN_LEDGER_JOURNEYS) return [];
  const out: Proposal[] = [];
  for (let i = 1; i < starts.length; i += 1) {
    const from = starts[i - 1] as number;
    const to = starts[i] as number;
    if (to - from < HEADWAY_GAP_MIN) continue;
    const empty = ctx.hours
      .filter((h) => h.hour >= HEADWAY_DAYTIME.from && h.hour <= HEADWAY_DAYTIME.to && h.demand > 0)
      .map((h) => h.hour)
      .filter((h) => h * MINUTES_PER_HOUR > from && (h + 1) * MINUTES_PER_HOUR <= to);
    for (const band of bandsOf(empty, 1)) {
      const demand = demandIn(band, ctx.hours);
      out.push(
        finding(ctx, {
          kind: 'headway_gap',
          band,
          from: clock(from),
          to: clock(to),
          minutes: to - from,
          demand,
        }),
      );
    }
  }
  return out;
}

/** Bands of RUNNING_TIME_MIN_HOURS or more whose median delay is beyond the late mark, enough journeys each. */
function reviseRunningTime(ctx: ProposalContext): Proposal[] {
  const hours = reliabilityByHour(ctx.routeName, ctx.ledger);
  const late = hours.filter(
    (h) =>
      h.coverage.n >= RUNNING_TIME_MIN_COVERAGE &&
      h.delayMedianMin !== null &&
      h.delayMedianMin > LATE_AFTER_MIN,
  );
  return bandsOf(
    late.map((h) => h.hour),
    RUNNING_TIME_MIN_HOURS,
  ).map((band) => {
    const rows = late.filter((h) => inBand(band, h.hour));
    const medianMin = Math.min(...rows.map((h) => h.delayMedianMin as number));
    const journeys = rows.reduce((s, h) => s + h.coverage.n, 0);
    return finding(ctx, { kind: 'revise_running_time', band, medianMin, journeys });
  });
}

/** Every tier-A finding for the route, from the journey ledger and the feed clock. */
export function timetableFindings(ctx: ProposalContext): Proposal[] {
  return [
    ...tripsNotRun(ctx),
    ...serviceSpanGap(ctx),
    ...headwayGap(ctx),
    ...reviseRunningTime(ctx),
  ];
}
