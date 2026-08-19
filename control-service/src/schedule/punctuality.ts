// On-time performance: the operator's first priority, measured.
//
// ─── WHY THIS DID NOT EXIST ──────────────────────────────────────────────
//
// Nothing in this system has ever reported whether a bus ran to time. The
// one field named for it - `simulation/kpi.ts#onTimeDispatchRate` - measures
// |h - H*| against a headway threshold and never touches a timetable at all:
// it is a spacing metric wearing a punctuality label. Meanwhile every hold
// the controller proposes makes a bus later, so the system was spending a
// quantity it could not measure.
//
// ─── WHAT IS MEASURED, AND AGAINST WHAT ──────────────────────────────────
//
// A `stop_visits` row says when a bus actually departed a stop.
// `trip_stop_times`, through a `ScheduleCurve`, says when it should have.
// The difference is the schedule deviation AT THAT STOP - the textbook
// definition, and a stronger one than the position-interpolated deviation
// `deviation.ts` computes for the control laws. Those two coexist on purpose:
//
//   deviation.ts   continuous, available between stops, used to DECIDE.
//   this module     discrete, available only after a departure, used to REPORT.
//
// A controller cannot wait for a departure to act, and a KPI should not be
// interpolated when a real crossing was observed.
//
// ─── THE ON-TIME WINDOW IS ASYMMETRIC, DELIBERATELY ──────────────────────
//
// Industry practice everywhere is a narrow early bound and a wider late one
// (commonly ~1 minute early to ~5 late). That is not sloppiness about
// lateness - it is that running EARLY is the worse failure. A late bus is
// still catchable; an early bus has left passengers who arrived on time
// standing at a stop, and there is no recovery from it. The default here
// follows that convention and both bounds are arguments, because a 30-minute
// intercity headway and a 10-minute city one do not deserve the same window.
import type { ScheduleCurve } from './deviation.js';
import { scheduledEpochMsAt } from './deviation.js';
import type { StopVisitRecord } from '../headway/stopHeadway.js';

/** Default on-time window: up to 60 s early, up to 300 s late. */
export const DEFAULT_EARLY_TOLERANCE_SECONDS = 60;
export const DEFAULT_LATE_TOLERANCE_SECONDS = 300;

export interface PunctualityObservation {
  stopId: string;
  routeDirectionId: string;
  vehicleId: string;
  departedAt: string;
  /** Positive = departed late, negative = departed early. */
  deviationSeconds: number;
}

export interface PunctualitySummary {
  routeDirectionId: string;
  sampleCount: number;
  /** Share of departures inside the on-time window. The headline number. */
  onTimeRate: number | null;
  /** Share that left MORE than the early tolerance ahead of schedule - the failure passengers cannot recover from. */
  earlyRate: number | null;
  lateRate: number | null;
  meanDeviationSeconds: number | null;
  /** 90th-percentile lateness. A mean hides the tail that generates complaints. */
  p90LatenessSeconds: number | null;
  earlyToleranceSeconds: number;
  lateToleranceSeconds: number;
}

/**
 * Schedule deviation at each observed departure.
 *
 * A visit whose trip has no loaded schedule contributes NOTHING rather than
 * a zero. Treating an unscheduled departure as on time would make on-time
 * performance rise as timetable coverage falls, which is the most misleading
 * direction a punctuality metric can move in - it would look like the
 * service improving.
 */
export function buildPunctualityObservations(
  visits: readonly StopVisitRecord[],
  curveByTripId: ReadonlyMap<string, ScheduleCurve>,
  stopDistanceByStopId: ReadonlyMap<string, number>,
): PunctualityObservation[] {
  const observations: PunctualityObservation[] = [];

  for (const visit of visits) {
    // The trip is what selects which schedule this departure is compared
    // against, and it is carried on the visit itself rather than looked up
    // through a side map - a side map keyed on (vehicle, stop, timestamp)
    // would silently drop every visit whose timestamp round-tripped through
    // the database differently than the caller expected.
    const tripId = visit.tripId;
    if (!tripId) continue;
    const curve = curveByTripId.get(tripId);
    if (!curve) continue;

    const distance = stopDistanceByStopId.get(visit.stopId);
    if (distance === undefined) continue;

    const scheduledMs = scheduledEpochMsAt(curve, distance);
    if (scheduledMs === null) continue;

    const deviationSeconds = (new Date(visit.departedAt).getTime() - scheduledMs) / 1000;
    if (!Number.isFinite(deviationSeconds)) continue;

    observations.push({
      stopId: visit.stopId,
      routeDirectionId: visit.routeDirectionId,
      vehicleId: visit.vehicleId,
      departedAt: visit.departedAt,
      deviationSeconds,
    });
  }

  return observations;
}

/**
 * On-time performance over a set of observed departures.
 *
 * Every rate is null rather than 0 when there is nothing to measure. A zero
 * on-time rate and an unmeasured one look identical on a dashboard and mean
 * opposite things, and today - with the timetable tables empty - unmeasured
 * is the honest answer for every corridor.
 */
export function summarisePunctuality(
  observations: readonly PunctualityObservation[],
  routeDirectionId: string,
  earlyToleranceSeconds = DEFAULT_EARLY_TOLERANCE_SECONDS,
  lateToleranceSeconds = DEFAULT_LATE_TOLERANCE_SECONDS,
): PunctualitySummary {
  const sampleCount = observations.length;
  if (sampleCount === 0) {
    return {
      routeDirectionId,
      sampleCount: 0,
      onTimeRate: null,
      earlyRate: null,
      lateRate: null,
      meanDeviationSeconds: null,
      p90LatenessSeconds: null,
      earlyToleranceSeconds,
      lateToleranceSeconds,
    };
  }

  const deviations = observations.map((o) => o.deviationSeconds);
  const early = deviations.filter((d) => d < -earlyToleranceSeconds).length;
  const late = deviations.filter((d) => d > lateToleranceSeconds).length;
  const onTime = sampleCount - early - late;

  const sortedAscending = [...deviations].sort((a, b) => a - b);
  const p90Index = Math.min(sortedAscending.length - 1, Math.ceil(0.9 * sortedAscending.length) - 1);

  return {
    routeDirectionId,
    sampleCount,
    onTimeRate: onTime / sampleCount,
    earlyRate: early / sampleCount,
    lateRate: late / sampleCount,
    meanDeviationSeconds: deviations.reduce((s, d) => s + d, 0) / sampleCount,
    p90LatenessSeconds: sortedAscending[Math.max(0, p90Index)]!,
    earlyToleranceSeconds,
    lateToleranceSeconds,
  };
}
