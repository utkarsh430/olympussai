/**
 * An open incident must stop being reported once its evidence goes cold.
 *
 * THE INCIDENT THIS LOCKS DOWN. `bunching_incidents` rows used to be closed in
 * exactly one place - `rule.recovered` in src/headway/service.ts - and getting
 * there requires the leader/follower pair to be recomputed, which requires the
 * route-direction to still carry two fresh vehicles. Stop the service for a
 * week and none of that happens: every incident open at the moment it stopped
 * stays open forever. The read path bounded nothing, so the control room drew
 * them all at once, as bunching between buses hundreds of kilometres apart, on
 * week-old positions.
 *
 * The lifecycle is fixed properly elsewhere now (closeSupersededIncidents in
 * src/headway/service.ts, and scheduler/incidentStalenessSweep.ts). This bound
 * is the read-side belt to those braces, and it is deliberately the STRONGER
 * of the two readings: bunching is a claim about a PAIR, so every member has
 * to be live AND still on the corridor the pair was measured on. Measured on
 * the pilot database, the weaker "at least one member is live" reading let
 * 7,504 of 9,692 undead incidents through - one bus of each pair had simply
 * been reassigned and was reporting fine from another district.
 *
 * The second describe below covers the WRITE half - `closeStaleOpenIncidents`,
 * the sweep that ends these rows properly instead of merely hiding them from a
 * read. It lives here rather than beside its sweep in
 * test/incidentLifecycle.test.ts because that file mocks ./repository
 * module-wide, which would replace the very function under test.
 *
 * These tests assert the SHAPE of the emitted SQL rather than running it,
 * matching the rest of this suite (which mocks the database per-test and needs
 * no Postgres). The behaviour they protect is a `where` clause, so a `where`
 * clause is the honest thing to assert on.
 */
import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import {
  closeStaleOpenIncidents,
  countOpenIncidents,
  listOpenIncidents,
} from "../src/headway/repository.js";

/** Captures the last SQL + params a repository call emitted. */
function recordingPool(rows: unknown[] = []) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const query = vi.fn((sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    return Promise.resolve({ rows, rowCount: rows.length });
  });
  return { pool: { query } as unknown as Pool, calls };
}

/** Collapse whitespace so assertions are not hostage to SQL indentation. */
const flat = (sql: string) => sql.replace(/\s+/g, " ");

describe("open-incident reads are bounded by member-vehicle liveness", () => {
  it("requires EVERY member vehicle observed inside the freshness window", async () => {
    const { pool, calls } = recordingPool();

    await listOpenIncidents(undefined, undefined, pool, 900);

    const { sql, params } = calls[0]!;
    expect(flat(sql)).toContain("from bunching_incident_members bim");
    expect(flat(sql)).toContain("vs.observed_at > now() -");
    expect(params).toContain(900);
    // `not exists (a member that FAILS)`, never `exists (a member that
    // passes)`. The weaker form is the one that let 7,504 of 9,692 undead
    // incidents through, and the two differ by one word.
    expect(flat(sql)).toContain("and not exists");
    expect(flat(sql)).toContain("where bim.incident_id = bi.id and vs.vehicle_id is null");
  });

  it("requires each member to still be on the incident's own corridor", async () => {
    const { pool, calls } = recordingPool();

    await listOpenIncidents(undefined, undefined, pool, 900);

    // A bus reassigned to another route reports perfectly well and is no
    // longer part of this pair; freshness alone cannot tell those apart.
    expect(flat(calls[0]!.sql)).toContain("vs.route_direction_id = bi.route_direction_id");
  });

  it("bounds on the evidence, never on how long the incident has run", async () => {
    const { pool, calls } = recordingPool();

    await listOpenIncidents(undefined, undefined, pool, 900);

    // A genuine incident that has lasted all day is the one that matters
    // most. Ageing rows out by `started_at` would hide exactly those.
    const where = flat(calls[0]!.sql).split(" group by ")[0]!;
    expect(where).not.toMatch(/bi\.started_at\s*>/);
  });

  it("applies the identical bound to the count, so 'N of TOTAL' cannot disagree", async () => {
    const list = recordingPool();
    const count = recordingPool([{ count: "0" }]);

    await listOpenIncidents(undefined, 10, list.pool, 900);
    await countOpenIncidents(undefined, count.pool, 900);

    const clause = (sql: string) =>
      flat(sql).slice(
        flat(sql).indexOf("and not exists"),
        flat(sql).indexOf("group by") >= 0 ? flat(sql).indexOf("group by") : undefined,
      );

    expect(clause(count.calls[0]!.sql)).toContain("vs.observed_at > now() -");
    expect(clause(list.calls[0]!.sql)).toContain("vs.observed_at > now() -");
    expect(count.calls[0]!.params).toContain(900);
  });

  it("keeps the freshness parameter correctly numbered when filtering by route-direction", async () => {
    const { pool, calls } = recordingPool();

    await listOpenIncidents("rd-1", 25, pool, 600);

    // $1 route-direction, $2 freshness, $3 limit — an off-by-one here would
    // silently compare observed_at against the limit.
    expect(calls[0]!.params).toEqual(["rd-1", 600, 25]);
    expect(flat(calls[0]!.sql)).toContain("($2 || ' seconds')::interval");
    expect(flat(calls[0]!.sql)).toContain("limit $3");
  });

  it("still excludes closed incidents", async () => {
    const { pool, calls } = recordingPool();

    await listOpenIncidents(undefined, undefined, pool, 900);

    expect(flat(calls[0]!.sql)).toContain("bi.status <> 'closed'");
  });
});

describe("closeStaleOpenIncidents: the corridor stopped being computed", () => {
  function recordingPool(rowCount = 0) {
    const calls: { sql: string; params: unknown[] }[] = [];
    const query = vi.fn((sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return Promise.resolve({ rows: [], rowCount });
    });
    return { pool: { query } as unknown as Pool, calls };
  }
  const flat = (sql: string) => sql.replace(/\s+/g, " ");

  it("closes on the pair's own sample age, not on how long the incident has run", async () => {
    const { pool, calls } = recordingPool();

    await closeStaleOpenIncidents(1800, 500, pool);

    const sql = flat(calls[0]!.sql);
    expect(sql).toContain("from headway_states hs");
    expect(sql).toContain("hs.leader_vehicle_id = p.leader_vehicle_id");
    expect(sql).toContain("hs.follower_vehicle_id = p.follower_vehicle_id");
    expect(sql).toContain("hs.route_direction_id = p.route_direction_id");
    expect(sql).toContain("not exists");
    // A genuine incident that has run all day is the one that matters most.
    // Ageing rows out by started_at would close exactly those.
    expect(sql).not.toMatch(/bi\.started_at\s*</);
    expect(calls[0]!.params).toEqual([1800, 500]);
  });

  it("closes rather than deletes, and says why in the evidence", async () => {
    const { pool, calls } = recordingPool();

    await closeStaleOpenIncidents(1800, 500, pool);

    const sql = flat(calls[0]!.sql);
    expect(sql).toContain("update bunching_incidents");
    expect(sql).toContain("set status = 'closed'");
    expect(sql).toContain("ended_at = now()");
    expect(sql).toContain("'closureReason', 'evidence_went_stale'");
    // Retention deletes incidents; this must not, or an audit record's
    // ON DELETE SET NULL would quietly strip the link out of it.
    expect(sql).not.toContain("delete from bunching_incidents");
  });

  it("bounds the batch so a first run cannot hold the pool", async () => {
    const { pool, calls } = recordingPool();

    await closeStaleOpenIncidents(1800, 500, pool);

    expect(flat(calls[0]!.sql)).toContain("limit $2");
  });

  it("only ever touches incidents that are not already closed", async () => {
    const { pool, calls } = recordingPool();

    await closeStaleOpenIncidents(1800, 500, pool);

    expect(flat(calls[0]!.sql)).toContain("where bi.status <> 'closed'");
  });
});
