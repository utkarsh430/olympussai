/**
 * A FABRICATED target headway must never drive detection.
 *
 * ─── THE DEFECT ──────────────────────────────────────────────────────────
 *
 * `route_policies.calibration_source` records where a target headway came from
 * (src/seed/harvest.ts). Two of its values mean "nowhere":
 *
 *   'none'     no target; the sentinel (1 second) sits in the not-null column
 *   'default'  harvest.ts's own word for it is FABRICATED - no evidence was
 *              found and a number was written anyway
 *
 * Only 'none' was ever excluded. Every threshold in src/headway/ is a RATIO of
 * H*, so a fabricated H* does not weaken detection, it inverts it: the pilot
 * database's 679 'default' rows carry targets from 60 seconds to 50,460 - a
 * 14-hour "planned gap", which at the default 0.25 bunched ratio flags any pair
 * closer than three and a half hours as bunched, i.e. every pair, permanently.
 *
 * Those particular rows have all been superseded by recalibration, so this is a
 * closed hole rather than a cleared backlog - but nothing prevented them from
 * being active, and a fresh seed writes more.
 *
 * The rule these tests hold is that an absent target fails CLOSED - the same
 * 404 `no_active_policy` that 'none' already produced - rather than degrading
 * into a plausible-looking number.
 *
 * ─── AND THAT ALL THREE CALLERS AGREE ────────────────────────────────────
 *
 * The predicate appears in three queries: the headway read, the corridor
 * picker's `has_active_policy` flag, and the sweep's eligibility list. They
 * were three hand-copied strings and they drifted - which is how 'default' came
 * to be missing from all of them at once. The last test pins them to one
 * constant, because a picker that promises a reading the headway endpoint then
 * refuses to give is its own, separate defect.
 *
 * Asserted on emitted SQL, matching this suite's convention of mocking the
 * database per-test and needing no Postgres.
 */
import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import {
  listActiveRouteDirections,
  listRouteDirectionsWithLiveHeadwayPairs,
  loadActiveRoutePolicy,
} from "../src/headway/repository.js";

function recordingPool(rows: unknown[] = []) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const query = vi.fn((sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    return Promise.resolve({ rows, rowCount: rows.length });
  });
  return { pool: { query } as unknown as Pool, calls };
}

const flat = (sql: string) => sql.replace(/\s+/g, " ");

describe("only a MEASURED target headway may drive detection", () => {
  it("refuses a fabricated policy on the headway read", async () => {
    const { pool, calls } = recordingPool();

    const policy = await loadActiveRoutePolicy("rd-1", pool);

    expect(flat(calls[0]!.sql)).toContain("calibration_source not in ('none', 'default')");
    // No row back means computeRouteDirectionHeadway raises the fail-closed
    // 404 `no_active_policy`, which is the whole point: detection off, loudly.
    expect(policy).toBeNull();
  });

  it("does not promise a reading the headway endpoint would refuse", async () => {
    const { pool, calls } = recordingPool();

    await listActiveRouteDirections(pool);

    // `has_active_policy` drives the corridor picker and
    // defaultRouteDirectionId. If it were laxer than the read above, a new
    // operator would land on a corridor of dashes.
    expect(flat(calls[0]!.sql)).toContain(
      "and p.calibration_source not in ('none', 'default')",
    );
  });

  it("does not spend a sweep cycle on a corridor that cannot report", async () => {
    const { pool, calls } = recordingPool();

    await listRouteDirectionsWithLiveHeadwayPairs(300, pool);

    const sql = flat(calls[0]!.sql);
    expect(sql).toContain("from route_policies p");
    expect(sql).toContain("and p.calibration_source not in ('none', 'default')");
    // The live-pair prune must survive alongside it - it is what makes the
    // sweep affordable at ~1,020 active route-directions.
    expect(sql).toContain("from vehicle_states vs");
    expect(sql).toContain("offset 1");
    expect(calls[0]!.params).toEqual([300]);
  });

  it("uses one identical predicate in all three, so they cannot drift again", async () => {
    const read = recordingPool();
    const picker = recordingPool();
    const sweep = recordingPool();

    await loadActiveRoutePolicy("rd-1", read.pool);
    await listActiveRouteDirections(picker.pool);
    await listRouteDirectionsWithLiveHeadwayPairs(300, sweep.pool);

    const predicate = "calibration_source not in ('none', 'default')";
    for (const recorded of [read, picker, sweep]) {
      expect(flat(recorded.calls[0]!.sql)).toContain(predicate);
    }
  });

  it("keeps 'none' excluded, so the sentinel can never masquerade as a target", async () => {
    const { pool, calls } = recordingPool();

    await loadActiveRoutePolicy("rd-1", pool);

    // UNCALIBRATED_HEADWAY_SENTINEL_SECONDS is 1. A regression that dropped
    // 'none' while keeping 'default' would put a one-second planned gap into
    // the bunching ratio.
    expect(flat(calls[0]!.sql)).toContain("'none'");
  });
});
