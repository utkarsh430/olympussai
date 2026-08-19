/**
 * Retention deletes data. These tests exist to keep it honest about WHICH.
 *
 * The two properties that matter are both "never" properties, and neither is
 * visible from a passing sweep:
 *
 *   1. No day's raw headway rows are deleted before that day's KPI snapshot
 *      exists. The snapshot is computed FROM those rows, so deleting first
 *      loses the day permanently.
 *   2. No incident that an audit record points at is deleted, however old.
 *      The FKs are ON DELETE SET NULL, so the delete would succeed and simply
 *      strip the link out of a permanent record.
 *
 * Asserted on emitted SQL, matching this suite's convention of mocking the
 * database per-test (no Postgres needed to run it).
 */
import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { loadEnv } from "../src/config/env.js";
import { runRetentionSweep } from "../src/scheduler/retention.js";
import { shouldCompute } from "../src/scheduler/dailyKpiSnapshot.js";

function recordingPool(rows: unknown[] = [{ count: "0" }]) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const query = vi.fn((sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    return Promise.resolve({ rows, rowCount: 0 });
  });
  return { pool: { query } as unknown as Pool, calls };
}

const flat = (sql: string) => sql.replace(/\s+/g, " ");
const find = (calls: { sql: string }[], needle: string) =>
  flat(calls.find((c) => c.sql.includes(needle))?.sql ?? "");

const env = () =>
  loadEnv({
    CONTROL_SERVICE_DATABASE_URL: "postgres://x/y",
    SERVICE_TOKEN_SECRET: "s".repeat(32),
    WEBHOOK_HMAC_SECRET: "w".repeat(32),
  });

describe("retention sweep", () => {
  it("only deletes headway rows for a day that already has a KPI snapshot", async () => {
    const { pool, calls } = recordingPool();

    await runRetentionSweep(env(), pool);

    const sql = find(calls, "delete from headway_states");
    expect(sql).toContain("from daily_kpi_snapshots k");
    expect(sql).toContain("k.route_direction_id = hs.route_direction_id");
    expect(sql).toContain("k.snapshot_date = hs.computed_at::date");
    // The guard must be a requirement, not an exclusion.
    expect(sql).toMatch(/and exists \(/);
    expect(sql).not.toMatch(/and not exists \(\s*select 1 from daily_kpi_snapshots/);
  });

  it("never deletes an incident an audit record points at", async () => {
    const { pool, calls } = recordingPool();

    await runRetentionSweep(env(), pool);

    const sql = find(calls, "delete from bunching_incidents");
    expect(sql).toContain("and not (");
    for (const table of [
      "dispatcher_actions",
      "recommendations",
      "outcomes",
      "war_room_incident_reviews",
    ]) {
      expect(sql).toContain(table);
    }
  });

  it("counts retained incidents with the same predicate that retains them", async () => {
    const { pool, calls } = recordingPool();

    await runRetentionSweep(env(), pool);

    const del = find(calls, "delete from bunching_incidents");
    const count = find(calls, "count(*)::text as count");
    // Same four tables on both sides - a count computed from a different rule
    // would report a number of "kept" rows that nothing actually kept.
    for (const table of [
      "dispatcher_actions",
      "recommendations",
      "outcomes",
      "war_room_incident_reviews",
    ]) {
      expect(del).toContain(table);
      expect(count).toContain(table);
    }
  });

  it("prunes vehicle_states purely on age, with no snapshot precondition", async () => {
    const { pool, calls } = recordingPool();

    await runRetentionSweep(env(), pool);

    // Bounded by its own primary key (one row per vehicle), so there is no
    // history here to lose - only dark buses to stop drawing.
    const sql = find(calls, "delete from vehicle_states");
    expect(sql).toContain("observed_at < now()");
    expect(sql).not.toContain("daily_kpi_snapshots");
  });

  it("uses the configured windows", async () => {
    const { pool, calls } = recordingPool();
    const e = { ...env(), HEADWAY_STATE_RETENTION_HOURS: 24, INCIDENT_RETENTION_DAYS: 3 };

    await runRetentionSweep(e, pool);

    expect(calls.find((c) => c.sql.includes("delete from headway_states"))!.params).toEqual([24]);
    expect(calls.find((c) => c.sql.includes("delete from bunching_incidents"))!.params).toEqual([3]);
  });
});

describe("daily KPI snapshot: which days get (re)computed", () => {
  const day = (over: Partial<Parameters<typeof shouldCompute>[0]>) =>
    ({ routeDirectionId: "rd-1", day: "2026-08-19", hasSnapshot: false, isToday: false, ...over });

  it("always refreshes today, snapshot or not", () => {
    expect(shouldCompute(day({ isToday: true, hasSnapshot: false }))).toBe(true);
    expect(shouldCompute(day({ isToday: true, hasSnapshot: true }))).toBe(true);
  });

  it("captures a past day that was never snapshotted", () => {
    expect(shouldCompute(day({ isToday: false, hasSnapshot: false }))).toBe(true);
  });

  it("never recomputes a finalised past day", () => {
    // computeDailyKpiSnapshot upserts with `on conflict do update`, so running
    // it against a day whose rows have been partly pruned would overwrite a
    // complete snapshot with a thinner one that still looks authoritative.
    expect(shouldCompute(day({ isToday: false, hasSnapshot: true }))).toBe(false);
  });
});
