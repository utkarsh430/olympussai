/**
 * Writes each day's KPI snapshot while its raw rows still exist.
 *
 * WHY THIS JOB HAD TO EXIST BEFORE RETENTION COULD. `daily_kpi_snapshots` is
 * the durable record - one small row per route-direction per day - and
 * `computeDailyKpiSnapshot` builds it by reading that day's `headway_states`,
 * `bunching_incidents`, `guardrail_breach_log` and `outcomes`. It was only ever
 * called ON DEMAND, from a dashboard read (src/pilot/dailyKpi.ts). That was
 * harmless while nothing deleted anything: the raw rows sat there forever, so
 * a snapshot could always be computed later.
 *
 * Retention removes that safety net. Once raw rows expire after a day, a day
 * nobody happened to open a dashboard for has no snapshot and no rows left to
 * build one from, and its numbers are gone for good. So the snapshot stops
 * being a read-through cache and becomes a scheduled capture.
 *
 * NEVER RECOMPUTE A CLOSED DAY. `computeDailyKpiSnapshot` upserts with
 * `on conflict do update`, so running it against a day whose rows have been
 * partly pruned would overwrite a complete snapshot with a thinner one - worse
 * than not running at all, because the number still looks authoritative. Today
 * is therefore always refreshed (its rows are by definition inside the
 * retention window); any earlier day is computed only if it has no snapshot
 * yet. See `shouldCompute`.
 */
import type { Pool } from 'pg';
import { getPool } from '../db/pool.js';
import { logger } from '../lib/logger.js';
import { computeDailyKpiSnapshot } from '../pilot/dailyKpi.js';

export interface DailyKpiSnapshotSweepResult {
  /** (route-direction, day) pairs with raw rows in the window. */
  candidates: number;
  /** Snapshots written or refreshed. */
  written: number;
  /** Past days already finalised, deliberately left alone. */
  skippedFinalised: number;
  failed: number;
  durationMs: number;
}

/** A day with raw headway rows, and whether it already has a snapshot. */
interface Candidate {
  routeDirectionId: string;
  day: string;
  hasSnapshot: boolean;
  isToday: boolean;
}

/**
 * Every (route-direction, day) that still has raw rows to snapshot, together
 * with whether it is already captured. One query rather than one per
 * route-direction: the sweep runs against ~1,000 route-directions and must
 * not turn into 1,000 round trips.
 *
 * EVERY day with raw rows is a candidate, with no lower bound on age. That
 * looks unbounded and is not, because of the invariant retention maintains:
 * a day's rows are only ever deleted once that day has a snapshot. So a day
 * still holding raw rows is either already snapshotted (skipped here) or has
 * never been pruned and is therefore COMPLETE - which is exactly the
 * condition under which computing its snapshot is correct.
 *
 * Bounding this to recent days instead would strand every older day forever:
 * never snapshotted, therefore never prunable, therefore never deleted. That
 * is how the first run of this job left ~1M rows behind.
 */
async function listCandidates(pool: Pool): Promise<Candidate[]> {
  const { rows } = await pool.query<{
    route_direction_id: string;
    day: string;
    has_snapshot: boolean;
    is_today: boolean;
  }>(
    // The distinct days come first, in their own CTE: the snapshot lookup and
    // the is-today test both key off the DATE, and a subquery cannot reach a
    // grouped cast expression from the outer query (42803).
    `with days as (
       select hs.route_direction_id, hs.computed_at::date as day
         from headway_states hs
        group by hs.route_direction_id, hs.computed_at::date
     )
     select d.route_direction_id,
            to_char(d.day, 'YYYY-MM-DD') as day,
            exists (
              select 1 from daily_kpi_snapshots k
               where k.route_direction_id = d.route_direction_id
                 and k.snapshot_date = d.day
            ) as has_snapshot,
            d.day = (now() at time zone 'UTC')::date as is_today
       from days d
      order by d.day, d.route_direction_id`,
  );
  return rows.map((r) => ({
    routeDirectionId: r.route_direction_id,
    day: r.day,
    hasSnapshot: r.has_snapshot,
    isToday: r.is_today,
  }));
}

/**
 * Today is always refreshed - it is still accumulating, and its rows cannot
 * have been pruned. A past day is computed exactly once, when it is first seen
 * without a snapshot; recomputing it later risks overwriting a complete
 * capture with whatever survived the pruner.
 */
export function shouldCompute(candidate: Candidate): boolean {
  return candidate.isToday || !candidate.hasSnapshot;
}

// Takes no Env, unlike its sibling sweeps: which days need capturing is a
// question the data answers on its own (see listCandidates), and a retention
// window passed in here would only ever be a second, disagreeing opinion
// about what retention.ts is already enforcing.
export async function runDailyKpiSnapshotSweep(
  pool: Pool = getPool(),
): Promise<DailyKpiSnapshotSweepResult> {
  const startedAt = Date.now();
  const candidates = await listCandidates(pool);

  let written = 0;
  let skippedFinalised = 0;
  let failed = 0;

  for (const candidate of candidates) {
    if (!shouldCompute(candidate)) {
      skippedFinalised += 1;
      continue;
    }
    try {
      await computeDailyKpiSnapshot(candidate.routeDirectionId, candidate.day, pool);
      written += 1;
    } catch (error) {
      // One route-direction's failure must not cost every other route-direction
      // its snapshot - and therefore its raw rows, which retention would then
      // never be cleared to prune.
      failed += 1;
      logger.warn(
        {
          routeDirectionId: candidate.routeDirectionId,
          day: candidate.day,
          error: error instanceof Error ? error.message : String(error),
        },
        'daily KPI snapshot failed for one route-direction; sweep continues',
      );
    }
  }

  const result: DailyKpiSnapshotSweepResult = {
    candidates: candidates.length,
    written,
    skippedFinalised,
    failed,
    durationMs: Date.now() - startedAt,
  };
  logger.info(result, 'daily KPI snapshot sweep complete');
  return result;
}
