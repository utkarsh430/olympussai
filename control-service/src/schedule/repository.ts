// Loads published stop times and turns them into schedule curves.
//
// THE ONE QUERY THIS MODULE MAKES IS AGAINST THE TIMETABLE TABLES, and that
// is the whole reason it is a separate module from `arrival-prediction/`.
// That module's repository documents, at length, that it must never read
// `trips` or `trip_stop_times`, because a schedule time returned as if it
// were a prediction is the failure it exists to prevent. The distinction is
// not squeamishness about the same table - it is about what the number is
// being used FOR. There, a timetable time would be dressed up as a forecast
// of the future. Here it is the reference the present is measured against,
// which is the only thing a timetable can honestly be.
//
// EMPTY IS THE EXPECTED ANSWER TODAY. `trips` and `trip_stop_times` both
// hold 0 rows on this deployment (measured 2026-08-14), so every call
// returns an empty map and every downstream consumer degrades to
// pure-headway control. See schedule/deviation.ts's header.
import type { Pool } from 'pg';
import { getPool } from '../db/pool.js';
import { buildScheduleCurve, type ScheduleCurve, type ScheduledPoint } from './deviation.js';

interface StopTimeRow {
  trip_id: string;
  cumulative_distance_meters: string | null;
  scheduled_time: string | null;
}

/**
 * Schedule curves for the given trips, keyed by trip id.
 *
 * A trip whose stop times are missing, too few, or non-monotone is simply
 * absent from the map rather than present with a degraded curve -
 * `buildScheduleCurve` rejects rather than repairs, and a caller that finds
 * nothing reports a null deviation, which is the honest reading.
 *
 * Scheduled DEPARTURE is preferred over arrival, falling back only when the
 * feed published one and not the other; see `ScheduledPoint.epochMs`.
 */
export async function loadScheduleCurves(
  tripIds: readonly string[],
  pool: Pool = getPool(),
): Promise<Map<string, ScheduleCurve>> {
  const curves = new Map<string, ScheduleCurve>();
  const ids = Array.from(new Set(tripIds.filter((id) => id.length > 0)));
  if (ids.length === 0) return curves;

  const { rows } = await pool.query<StopTimeRow>(
    `select tst.trip_id,
            rds.cumulative_distance_meters,
            coalesce(tst.scheduled_departure, tst.scheduled_arrival) as scheduled_time
       from trip_stop_times tst
       join route_direction_stops rds on rds.id = tst.route_direction_stop_id
      where tst.trip_id = any($1::text[])
        and coalesce(tst.scheduled_departure, tst.scheduled_arrival) is not null
      order by tst.trip_id, rds.cumulative_distance_meters`,
    [ids],
  );

  const pointsByTrip = new Map<string, ScheduledPoint[]>();
  for (const row of rows) {
    if (row.cumulative_distance_meters === null || row.scheduled_time === null) continue;
    const distanceMeters = Number(row.cumulative_distance_meters);
    const epochMs = new Date(row.scheduled_time).getTime();
    if (!Number.isFinite(distanceMeters) || !Number.isFinite(epochMs)) continue;

    const bucket = pointsByTrip.get(row.trip_id) ?? [];
    bucket.push({ distanceMeters, epochMs });
    pointsByTrip.set(row.trip_id, bucket);
  }

  for (const [tripId, points] of pointsByTrip) {
    const curve = buildScheduleCurve(tripId, points);
    if (curve) curves.set(tripId, curve);
  }

  return curves;
}
