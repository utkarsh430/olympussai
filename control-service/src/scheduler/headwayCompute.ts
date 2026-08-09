// Periodic headway sweep: the thing that actually produces the sample
// history the reactive bunching rule reads.
//
// WHY THIS IS A SCHEDULED JOB AND NOT PART OF INGESTION
// -----------------------------------------------------
// Computing headway on the ingestion path looks tempting ("we just got a
// new position, recompute") and is catastrophic. One poll cycle carries
// ~665 fixes; a per-event recompute would run the whole route-direction
// computation 665 times per cycle and append 665x the samples. The
// reactive rule fires on k CONSECUTIVE samples over threshold - it is a
// rule about time, expressed in samples - so collapsing three samples from
// three minutes apart to 45 milliseconds apart doesn't make detection
// faster, it makes every transient GPS wobble an instant "bunching
// incident". The cadence IS the semantics.
//
// COST
// ----
// A naive sweep computes all ~1,020 active route-directions every cycle.
// With ~665 live buses spread over ~517 routes, the overwhelming majority
// have zero or one vehicle on them and cannot produce a leader/follower
// pair at all. listRouteDirectionsWithLiveHeadwayPairs() prunes to the
// few dozen that have at least TWO fresh map-matched vehicles - that
// pruning, not the concurrency cap, is what makes this affordable.
//
// DETECTION LATENCY
// -----------------
//   latency = required_samples x HEADWAY_COMPUTE_INTERVAL_MS x ceil(eligible / HEADWAY_BATCH_SIZE)
//
// The batch size is a round-robin window, so a route-direction is only
// visited once every ceil(eligible / batch) cycles. With
// HEADWAY_BATCH_SIZE >= eligible every eligible direction is visited every
// cycle and the multiplier is 1, giving ~3 minutes to first detection at
// the default 60 s interval and 3 required samples. Setting the batch
// BELOW the eligible count multiplies latency; raising the INTERVAL
// multiplies it directly and is the more dangerous knob of the two.

import { loadEnv, type Env } from '../config/env.js';
import { computeRouteDirectionHeadway, type HeadwayComputeResult } from '../headway/service.js';
import { listRouteDirectionsWithLiveHeadwayPairs } from '../headway/repository.js';
import { logger } from '../lib/logger.js';
import { stateStore, type HeadwayStateRow } from '../state/store.js';

/**
 * Project a compute result onto the store's row shape. Deliberately explicit
 * rather than a spread: HeadwayPairResult carries `gapMeters`, `confidence`
 * and `forecastHFwdSeconds` that HeadwayStateRow has no place for, and the
 * MPC must read exactly the fields the boot-time rehydrate would have loaded.
 */
function toHeadwayStateRows(result: HeadwayComputeResult): HeadwayStateRow[] {
  return result.pairs.map((pair) => ({
    id: pair.id,
    routeDirectionId: pair.routeDirectionId,
    leaderVehicleId: pair.leaderVehicleId,
    followerVehicleId: pair.followerVehicleId,
    hFwdSeconds: pair.hFwdSeconds,
    hBwdSeconds: pair.hBwdSeconds,
    targetHeadwaySeconds: pair.targetHeadwaySeconds,
    deviationSeconds: pair.deviationSeconds,
    computedAt: pair.computedAt,
  }));
}

/**
 * Round-robin cursor: the last route-direction id processed. Module-level
 * (not per-call) precisely so consecutive sweeps advance through the
 * eligible set instead of re-computing the same head of the list forever
 * while the tail is never sampled at all.
 */
let cursor: string | null = null;

/** Test-only: rewind the round-robin cursor. */
export function _resetHeadwayCursorForTests(): void {
  cursor = null;
}

export interface HeadwaySweepResult {
  eligible: number;
  attempted: number;
  computed: number;
  failed: number;
  durationMs: number;
}

export interface HeadwaySweepDeps {
  listEligible?: (freshnessSeconds: number) => Promise<string[]>;
  /**
   * Must return the real result shape, not `unknown`: the sweep publishes it
   * into stateStore for the MPC to read, so a stub that returns nothing would
   * type-check while silently reproducing the empty-headway-map bug this
   * publish step exists to fix.
   */
  compute?: (routeDirectionId: string) => Promise<HeadwayComputeResult>;
  now?: () => number;
}

/**
 * Selects at most `batchSize` ids starting just after `cursor`, wrapping
 * around the end of the (id-ordered) list. Returns the selection and the
 * new cursor.
 *
 * Wrapping matters: without it the tail of the list is only ever reached
 * by a sweep that starts near it, and a route-direction that sorts late
 * would be sampled at a different rate from one that sorts early - the
 * reactive rule would then have a different effective detection window per
 * route, which is impossible to reason about during an incident review.
 */
export function selectBatch(
  ids: readonly string[],
  cursorId: string | null,
  batchSize: number,
): { batch: string[]; nextCursor: string | null } {
  if (ids.length === 0) return { batch: [], nextCursor: null };

  // The eligible set changes between sweeps, so the cursor is resolved by
  // VALUE (first id strictly greater than it) rather than by index - an id
  // that dropped out of the set must not shift every later id's turn.
  let start = ids.findIndex((id) => cursorId === null || id > cursorId);
  if (start === -1) start = 0;

  const take = Math.min(batchSize, ids.length);
  const batch: string[] = [];
  for (let i = 0; i < take; i++) {
    batch.push(ids[(start + i) % ids.length]!);
  }
  return { batch, nextCursor: batch[batch.length - 1] ?? null };
}

/**
 * Runs `worker` over `items` with at most `limit` in flight.
 *
 * The cap is not decoration: the pg Pool maxes out at 10 connections and
 * computeRouteDirectionHeadway issues several queries per route-direction.
 * Firing the whole batch at once would starve /v1 request traffic of
 * connections for the duration of the sweep - the dashboard would time out
 * every time the scheduler ticked.
 */
async function mapWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      await worker(items[index]!);
    }
  });
  await Promise.all(runners);
}

/**
 * One sweep. Never rejects for a single route-direction's failure: a
 * route-direction with no active policy throws a 404 AppError, and one
 * unconfigured route must not abort the sweep for the ~50 that are
 * correctly configured.
 */
export async function runHeadwayComputeSweep(
  env: Env = loadEnv(),
  deps: HeadwaySweepDeps = {},
): Promise<HeadwaySweepResult> {
  const now = deps.now ?? Date.now;
  const listEligible = deps.listEligible ?? listRouteDirectionsWithLiveHeadwayPairs;
  const compute = deps.compute ?? computeRouteDirectionHeadway;

  const startedAt = now();
  const eligible = await listEligible(env.HEADWAY_VEHICLE_FRESHNESS_SECONDS);
  const { batch, nextCursor } = selectBatch(eligible, cursor, env.HEADWAY_BATCH_SIZE);
  cursor = nextCursor;

  let computed = 0;
  let failed = 0;

  await mapWithConcurrency(batch, env.HEADWAY_COMPUTE_CONCURRENCY, async (routeDirectionId) => {
    try {
      const result = await compute(routeDirectionId);
      // Publish into the MPC's read model. compute() persists to
      // `headway_states`, but stateStore is loaded once at boot by
      // rehydrate.ts, so without this the solver reads a permanently empty
      // headway map: mpc/solver.ts iterates getHeadwayStates() to build both
      // terminal-dispatch and two-way candidates, and returned zero
      // candidates on a genuinely bunched route. Persisting is not
      // publishing.
      stateStore.upsertHeadwayStates(routeDirectionId, toHeadwayStateRows(result));
      computed += 1;
    } catch (error) {
      failed += 1;
      logger.warn(
        { routeDirectionId, error: error instanceof Error ? error.message : String(error) },
        'headway compute failed for one route-direction; sweep continues',
      );
    }
  });

  const result: HeadwaySweepResult = {
    eligible: eligible.length,
    attempted: batch.length,
    computed,
    failed,
    durationMs: now() - startedAt,
  };

  // Visited-every-cycle is the assumption the documented detection latency
  // rests on, so say so out loud when it stops holding.
  if (eligible.length > env.HEADWAY_BATCH_SIZE) {
    logger.warn(
      {
        ...result,
        batchSize: env.HEADWAY_BATCH_SIZE,
        cyclesPerVisit: Math.ceil(eligible.length / env.HEADWAY_BATCH_SIZE),
      },
      'headway sweep cannot cover every eligible route-direction in one cycle; detection latency is multiplied',
    );
  } else {
    logger.info(result, 'headway sweep complete');
  }

  return result;
}
