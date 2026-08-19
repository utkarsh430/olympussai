// Link travel-time distributions, fitted from observed stop visits.
//
// ─── WHY A DISTRIBUTION AND NOT A MEAN ───────────────────────────────────
//
// Every controller above this depends on how long a bus takes between two
// stops, and every one of them is undone by the TAIL rather than by the
// average. A hold computed against a mean link time is correct on a median
// day and wrong on the day that actually needs control - the day one bus
// caught the level crossing. The reference architecture is explicit that
// robustness lives in the tails and that this must be stored as an empirical
// distribution rather than a fitted parametric one, so this module keeps the
// observed samples and reports quantiles from them rather than assuming a
// shape the data may not have.
//
// ─── WHERE THE OBSERVATIONS COME FROM ────────────────────────────────────
//
// One vehicle's consecutive `stop_visits`: it departed stop A at t1 and
// arrived at stop B at t2, so the link A->B took t2 - t1. That is available
// today from the GPS feed already running - no timetable and no ticketing
// needed - which is why this can be fitted from the day the stop-visit log
// starts filling rather than from the day UPSRTC supplies an archive.
//
// The precision inherited from `stop_visits` is one GPS polling interval at
// each end (see that migration's precision note). On links measured in
// minutes that is noise around a real signal; on very short links between
// adjacent city-centre stops it is not, and `sampleCount` plus the spread
// between p50 and p90 is what tells a reader which case they are looking at.
import type { StopVisitRecord } from '../headway/stopHeadway.js';

/** One observed traversal of one link by one vehicle. */
export interface LinkObservation {
  routeDirectionId: string;
  fromStopId: string;
  toStopId: string;
  travelSeconds: number;
  /** Hour of day (0-23, UTC) the traversal STARTED, for time-of-day banding. */
  hourOfDay: number;
}

export interface LinkTravelTimeModel {
  routeDirectionId: string;
  fromStopId: string;
  toStopId: string;
  /** Time-of-day band, or null for a model pooled across the whole day. */
  hourBand: number | null;
  sampleCount: number;
  meanSeconds: number;
  stddevSeconds: number;
  p50Seconds: number;
  p90Seconds: number;
  /** The full sorted sample, kept so a simulator can resample the real distribution rather than a summary of it. */
  samplesSeconds: number[];
}

/**
 * Consecutive visits by the same vehicle, turned into link traversals.
 *
 * Only ADJACENT visits in one vehicle's own timeline are paired. A gap in
 * the timeline - a missed geofence, a GPS dropout, the vehicle going off
 * route and returning - would otherwise be recorded as one enormous
 * traversal of a link it never made, and a single such row would dominate
 * the p90 this module exists to report. `maxPlausibleSeconds` is the guard,
 * and it drops the observation rather than clamping it: a clamped outlier is
 * indistinguishable from a real slow run in the sample it lands in.
 */
export function buildLinkObservations(
  visits: readonly StopVisitRecord[],
  maxPlausibleSeconds = 3600,
): LinkObservation[] {
  const byVehicle = new Map<string, StopVisitRecord[]>();
  for (const visit of visits) {
    const key = `${visit.vehicleId} ${visit.routeDirectionId}`;
    const bucket = byVehicle.get(key) ?? [];
    bucket.push(visit);
    byVehicle.set(key, bucket);
  }

  const observations: LinkObservation[] = [];
  for (const bucket of byVehicle.values()) {
    const sorted = [...bucket].sort(
      (a, b) => new Date(a.departedAt).getTime() - new Date(b.departedAt).getTime(),
    );
    for (let i = 1; i < sorted.length; i++) {
      const from = sorted[i - 1]!;
      const to = sorted[i]!;
      if (from.stopId === to.stopId) continue; // same stop revisited - not a link

      const departed = new Date(from.departedAt).getTime();
      const arrived = new Date(to.arrivedAt).getTime();
      const travelSeconds = (arrived - departed) / 1000;
      if (!Number.isFinite(travelSeconds)) continue;
      if (travelSeconds <= 0 || travelSeconds > maxPlausibleSeconds) continue;

      observations.push({
        routeDirectionId: from.routeDirectionId,
        fromStopId: from.stopId,
        toStopId: to.stopId,
        travelSeconds,
        hourOfDay: new Date(departed).getUTCHours(),
      });
    }
  }
  return observations;
}

function quantile(sortedAscending: readonly number[], q: number): number {
  if (sortedAscending.length === 0) return 0;
  // Nearest-rank on the sorted sample: a real observed value rather than an
  // interpolation between two, so a reported p90 is a traversal that
  // actually happened.
  const rank = Math.ceil(q * sortedAscending.length) - 1;
  return sortedAscending[Math.min(Math.max(rank, 0), sortedAscending.length - 1)]!;
}

/**
 * Empirical travel-time distribution per link.
 *
 * @param bandByHour groups hours into time-of-day bands - pass a function
 *   returning null to pool the whole day. Banding matters more than any
 *   other refinement here: a link's peak and off-peak distributions are
 *   different distributions, and pooling them produces a bimodal sample
 *   whose mean describes neither.
 * @param minSamples the fewest traversals before a link is reported. A p90
 *   over three observations is the slowest of three, not a ninetieth
 *   percentile.
 */
export function fitLinkTravelTimes(
  observations: readonly LinkObservation[],
  bandByHour: (hour: number) => number | null = () => null,
  minSamples = 8,
): LinkTravelTimeModel[] {
  const buckets = new Map<string, { key: LinkObservation; band: number | null; values: number[] }>();

  for (const observation of observations) {
    const band = bandByHour(observation.hourOfDay);
    const key = `${observation.routeDirectionId} ${observation.fromStopId} ${observation.toStopId} ${band ?? 'all'}`;
    const bucket = buckets.get(key) ?? { key: observation, band, values: [] };
    bucket.values.push(observation.travelSeconds);
    buckets.set(key, bucket);
  }

  const models: LinkTravelTimeModel[] = [];
  for (const bucket of buckets.values()) {
    if (bucket.values.length < minSamples) continue;
    const samples = [...bucket.values].sort((a, b) => a - b);
    const n = samples.length;
    const mean = samples.reduce((s, v) => s + v, 0) / n;
    const variance = samples.reduce((s, v) => s + (v - mean) ** 2, 0) / n;

    models.push({
      routeDirectionId: bucket.key.routeDirectionId,
      fromStopId: bucket.key.fromStopId,
      toStopId: bucket.key.toStopId,
      hourBand: bucket.band,
      sampleCount: n,
      meanSeconds: mean,
      stddevSeconds: Math.sqrt(variance),
      p50Seconds: quantile(samples, 0.5),
      p90Seconds: quantile(samples, 0.9),
      samplesSeconds: samples,
    });
  }

  return models.sort(
    (a, b) =>
      a.fromStopId.localeCompare(b.fromStopId) || a.toStopId.localeCompare(b.toStopId),
  );
}

/**
 * Three-band peak/off-peak split in IST, the operating frame this network
 * runs on.
 *
 * Band 0 = morning peak, 1 = inter-peak and night, 2 = evening peak. Deliberately
 * coarse: bands exist to stop peak and off-peak distributions being pooled,
 * and finer bands starve each one of samples faster than they sharpen it.
 * Hours arrive in UTC; IST is UTC+5:30, and only the hour matters, so the
 * half-hour offset is absorbed by taking the floor.
 */
export function istPeakBand(utcHour: number): number {
  const istHour = (utcHour + 5) % 24;
  if (istHour >= 7 && istHour < 11) return 0;
  if (istHour >= 16 && istHour < 21) return 2;
  return 1;
}
