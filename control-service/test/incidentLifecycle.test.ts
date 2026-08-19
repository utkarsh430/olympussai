/**
 * An incident is an INTERVAL. These tests exist to keep it one.
 *
 * THE DEFECT THEY LOCK DOWN. Detection is a standing sweep - every bus on
 * every eligible corridor, every cycle, forever - but an incident used to have
 * exactly one way to END: `rule.recovered`, which is only reachable if that
 * same leader/follower pair is recomputed. Pairs stop being pairs constantly
 * and for ordinary reasons (a third bus moves between them, the follower
 * finishes its trip, one is reassigned), and from that moment the recovery
 * rule is never evaluated again.
 *
 * Measured on the pilot database before this shipped: 9,692 open incidents, of
 * which 172 - 1.8% - had had their pair evaluated in the previous five
 * minutes. The control room drew all of them, as bunching links between buses
 * a median of 59 km apart.
 *
 * Two mechanisms end an incident now, and each is tested for the case the
 * other structurally cannot reach:
 *
 *   closeSupersededIncidents  the corridor WAS recomputed, without this pair
 *   incidentStalenessSweep    the corridor is not being recomputed at all
 *
 * This file owns the SERVICE-level half and mocks ./repository the way
 * test/headwayService.test.ts does. The SQL `closeStaleOpenIncidents` emits is
 * asserted in test/incidentLiveness.test.ts instead - it cannot live here,
 * because the module-wide mock above replaces the very function under test.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/headway/repository.js", () => ({
  loadRouteDirectionMeta: vi.fn(),
  loadActiveRoutePolicy: vi.fn(),
  loadVehicleStatesForRouteDirection: vi.fn(),
  insertHeadwaySample: vi.fn(),
  findOpenIncidentForPair: vi.fn(),
  loadRecentHeadwayRatios: vi.fn(),
  openIncident: vi.fn(),
  escalateIncident: vi.fn(),
  closeIncident: vi.fn(),
  listOpenIncidentPairsForRouteDirection: vi.fn(),
}));

import { computeRouteDirectionHeadway } from "../src/headway/service.js";
import * as repo from "../src/headway/repository.js";
import { runIncidentStalenessSweep } from "../src/scheduler/incidentStalenessSweep.js";

const mocked = vi.mocked(repo);

/** Two buses on one corridor, far enough apart that the rule flags nothing. */
function vehicle(vehicleId: string, distanceAlongRouteMeters: number) {
  return {
    vehicleId,
    distanceAlongRouteMeters,
    speedKmph: 36,
    confidence: 0.9,
    isLowConfidence: false,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked.loadRouteDirectionMeta.mockResolvedValue({
    routeDirectionId: "rd-1",
    routeId: "r-1",
    directionCode: "UP",
    isLoop: false,
    totalDistanceMeters: 100_000,
  });
  mocked.loadActiveRoutePolicy.mockResolvedValue({
    targetHeadwaySeconds: 1800,
    requiredSamples: 3,
    bunchedThresholdRatio: 0.25,
    warningThresholdRatio: 0.5,
  } as never);
  mocked.insertHeadwaySample.mockResolvedValue({
    id: "sample-1",
    forecastHFwdSeconds: null,
    computedAt: "2026-08-19T09:00:00.000Z",
  } as never);
  // No pair trips the rule, so nothing is opened or escalated in these tests.
  mocked.findOpenIncidentForPair.mockResolvedValue(null);
  mocked.loadRecentHeadwayRatios.mockResolvedValue([] as never);
  mocked.listOpenIncidentPairsForRouteDirection.mockResolvedValue([]);
});

describe("closeSupersededIncidents: a pair that stopped being a pair", () => {
  it("closes an open incident whose pair is no longer in the recomputed set", async () => {
    // A and B are still on the corridor, but C now sits between them, so the
    // live pairs are (A,C) and (C,B) - never (A,B) again.
    mocked.loadVehicleStatesForRouteDirection.mockResolvedValue([
      vehicle("A", 30_000),
      vehicle("C", 20_000),
      vehicle("B", 10_000),
    ] as never);
    mocked.listOpenIncidentPairsForRouteDirection.mockResolvedValue([
      { id: "inc-AB", severity: "bunched", leaderVehicleId: "A", followerVehicleId: "B" },
    ] as never);

    const result = await computeRouteDirectionHeadway("rd-1");

    expect(mocked.closeIncident).toHaveBeenCalledTimes(1);
    const [closedId, evidence] = mocked.closeIncident.mock.calls[0]!;
    expect(closedId).toBe("inc-AB");
    expect(evidence).toMatchObject({ closureReason: "pair_no_longer_adjacent" });
    expect(result.incidents).toContainEqual(
      expect.objectContaining({ incidentId: "inc-AB", action: "closed" }),
    );
  });

  it("leaves an incident open while its pair is still a pair", async () => {
    mocked.loadVehicleStatesForRouteDirection.mockResolvedValue([
      vehicle("A", 30_000),
      vehicle("B", 10_000),
    ] as never);
    mocked.listOpenIncidentPairsForRouteDirection.mockResolvedValue([
      { id: "inc-AB", severity: "bunched", leaderVehicleId: "A", followerVehicleId: "B" },
    ] as never);

    await computeRouteDirectionHeadway("rd-1");

    expect(mocked.closeIncident).not.toHaveBeenCalled();
  });

  it("does not confuse (A,B) with the reversed pair (B,A)", async () => {
    // Ordering puts A ahead of B, so the live pair is (A,B). An incident
    // recorded as (B,A) describes a leader/follower relationship that no
    // longer holds and must close, not be treated as a match.
    mocked.loadVehicleStatesForRouteDirection.mockResolvedValue([
      vehicle("A", 30_000),
      vehicle("B", 10_000),
    ] as never);
    mocked.listOpenIncidentPairsForRouteDirection.mockResolvedValue([
      { id: "inc-BA", severity: "warning", leaderVehicleId: "B", followerVehicleId: "A" },
    ] as never);

    await computeRouteDirectionHeadway("rd-1");

    expect(mocked.closeIncident).toHaveBeenCalledTimes(1);
    expect(mocked.closeIncident.mock.calls[0]![0]).toBe("inc-BA");
  });

  it("closes every open incident when the corridor has no pairs left at all", async () => {
    // One bus cannot form a pair. This is the shape a corridor takes as its
    // last-but-one bus finishes for the day, and it must not leave the
    // incidents from an hour ago open forever.
    mocked.loadVehicleStatesForRouteDirection.mockResolvedValue([vehicle("A", 30_000)] as never);
    mocked.listOpenIncidentPairsForRouteDirection.mockResolvedValue([
      { id: "inc-1", severity: "bunched", leaderVehicleId: "A", followerVehicleId: "B" },
      { id: "inc-2", severity: "warning", leaderVehicleId: "C", followerVehicleId: "D" },
    ] as never);

    await computeRouteDirectionHeadway("rd-1");

    expect(mocked.closeIncident.mock.calls.map((call) => call[0])).toEqual(["inc-1", "inc-2"]);
  });
});

describe("runIncidentStalenessSweep", () => {
  const env = {
    INCIDENT_PAIR_SAMPLE_MAX_AGE_SECONDS: 1800,
    INCIDENT_STALENESS_SWEEP_BATCH: 500,
  } as never;

  it("passes the configured window and batch through", async () => {
    const closeStale = vi.fn().mockResolvedValue(3);

    const result = await runIncidentStalenessSweep(env, { closeStale, now: () => 0 });

    expect(closeStale).toHaveBeenCalledWith(1800, 500);
    expect(result.closed).toBe(3);
    expect(result.moreLikelyPending).toBe(false);
  });

  it("reports a full batch as a backlog still draining", async () => {
    const closeStale = vi.fn().mockResolvedValue(500);

    const result = await runIncidentStalenessSweep(env, { closeStale, now: () => 0 });

    expect(result.moreLikelyPending).toBe(true);
  });
});
