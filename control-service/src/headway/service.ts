// Orchestrates one headway-metrics compute cycle for a route-direction:
// load live vehicle state + policy from Postgres, compute leader/follower
// order (state-estimation/ordering.ts) and time-domain headways/aggregate
// (./metrics.ts), persist an append-only sample per pair (blueprint 7.3
// "history stays in Postgres ... reactive detection tiers look back over
// recent samples"), and run the reactive bunching rule per pair, opening /
// escalating / closing bunching_incidents as needed.
//
// Deliberately never creates a `commands` row or calls the MPC solver -
// this ticket is detection and display only (no operational actions sent
// from here).
import { computeLeaderFollowerOrder } from "../state-estimation/ordering.js";
import type { VehicleOrderingInput } from "../state-estimation/types.js";
import { AppError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import { computeAggregate, computeGapMeters, computePairHeadways } from "./metrics.js";
import { evaluateBunchingRule } from "./bunching.js";
import * as repo from "./repository.js";
import type { HeadwayAggregate, HeadwayPairMetric, RouteDirectionListing } from "./types.js";

export interface IncidentChange {
  routeDirectionId: string;
  leaderVehicleId: string;
  followerVehicleId: string;
  action: "opened" | "escalated" | "closed" | "none";
  severity: "warning" | "bunched" | null;
  incidentId: string | null;
  ratio: number | null;
}

/**
 * Pair shape returned over the wire. Deliberately matches
 * `headwayStateSchema` in the web app's src/models/control.ts field for
 * field (id, ..., forecastHFwdSeconds, confidence, computedAt) so that
 * schema can validate a response from this endpoint without translation -
 * gapMeters is the one addition, which a `headwayStateSchema.parse()` call
 * silently drops rather than rejects (Zod strips unrecognised keys by
 * default).
 */
export interface HeadwayPairResult extends HeadwayPairMetric {
  id: string;
  forecastHFwdSeconds: number | null;
  computedAt: string;
}

export interface HeadwayComputeResult {
  routeDirectionId: string;
  computedAt: string;
  pairs: HeadwayPairResult[];
  aggregate: HeadwayAggregate;
  incidents: IncidentChange[];
}

async function evaluateAndApplyBunchingRule(
  pair: HeadwayPairMetric,
  requiredSamples: number,
  bunchedThresholdRatio: number,
  warningThresholdRatio: number
): Promise<IncidentChange> {
  const base = {
    routeDirectionId: pair.routeDirectionId,
    leaderVehicleId: pair.leaderVehicleId,
    followerVehicleId: pair.followerVehicleId,
  };

  if (pair.hFwdSeconds == null) {
    return { ...base, action: "none", severity: null, incidentId: null, ratio: null };
  }

  const openIncident = await repo.findOpenIncidentForPair(
    pair.routeDirectionId,
    pair.leaderVehicleId,
    pair.followerVehicleId
  );

  const ratios = await repo.loadRecentHeadwayRatios(
    pair.routeDirectionId,
    pair.leaderVehicleId,
    pair.followerVehicleId,
    requiredSamples
  );

  const rule = evaluateBunchingRule(
    ratios,
    requiredSamples,
    bunchedThresholdRatio,
    warningThresholdRatio,
    openIncident != null
  );

  const evidence = {
    ratio: rule.ratio,
    gapMeters: pair.gapMeters,
    hFwdSeconds: pair.hFwdSeconds,
    hBwdSeconds: pair.hBwdSeconds,
    targetHeadwaySeconds: pair.targetHeadwaySeconds,
    requiredSamples,
    bunchedThresholdRatio,
    warningThresholdRatio,
    sampleRatios: ratios,
  };

  if (rule.severity && !openIncident) {
    const created = await repo.openIncident({
      routeDirectionId: pair.routeDirectionId,
      severity: rule.severity,
      leaderVehicleId: pair.leaderVehicleId,
      followerVehicleId: pair.followerVehicleId,
      evidence,
    });
    logger.warn(
      { ...base, severity: rule.severity, incidentId: created.id },
      "bunching incident opened"
    );
    return { ...base, action: "opened", severity: rule.severity, incidentId: created.id, ratio: rule.ratio };
  }

  if (rule.severity && openIncident && rule.severity !== openIncident.severity) {
    await repo.escalateIncident(openIncident.id, rule.severity, evidence);
    return {
      ...base,
      action: "escalated",
      severity: rule.severity,
      incidentId: openIncident.id,
      ratio: rule.ratio,
    };
  }

  if (rule.recovered && openIncident) {
    await repo.closeIncident(openIncident.id, evidence);
    logger.info({ ...base, incidentId: openIncident.id }, "bunching incident closed (recovered)");
    return { ...base, action: "closed", severity: null, incidentId: openIncident.id, ratio: rule.ratio };
  }

  return {
    ...base,
    action: "none",
    severity: openIncident?.severity ?? null,
    incidentId: openIncident?.id ?? null,
    ratio: rule.ratio,
  };
}

async function computeRouteDirectionHeadwayInner(routeDirectionId: string): Promise<HeadwayComputeResult> {
  const [meta, policy, vehicles] = await Promise.all([
    repo.loadRouteDirectionMeta(routeDirectionId),
    repo.loadActiveRoutePolicy(routeDirectionId),
    repo.loadVehicleStatesForRouteDirection(routeDirectionId),
  ]);

  if (!meta) {
    throw new AppError("unknown_route_direction", `No active route-direction ${routeDirectionId}`, 404);
  }
  if (!policy) {
    throw new AppError("no_active_policy", `No active route policy for route-direction ${routeDirectionId}`, 404);
  }

  const orderingInputs: VehicleOrderingInput[] = vehicles.map((v) => ({
    vehicleId: v.vehicleId,
    routeDirectionId,
    distanceAlongRouteMeters: v.distanceAlongRouteMeters,
    isLowConfidence: v.isLowConfidence,
  }));

  const ordered = computeLeaderFollowerOrder(orderingInputs, {
    isLoop: meta.isLoop,
    totalDistanceMeters: meta.totalDistanceMeters,
  });

  const speedByVehicleId = new Map(vehicles.map((v) => [v.vehicleId, v.speedKmph]));
  const confidenceByVehicleId = new Map(vehicles.map((v) => [v.vehicleId, v.confidence]));

  const pairs = computePairHeadways(
    ordered,
    speedByVehicleId,
    confidenceByVehicleId,
    { totalDistanceMeters: meta.totalDistanceMeters },
    routeDirectionId,
    policy.targetHeadwaySeconds
  );

  const aggregate = computeAggregate(pairs, routeDirectionId, policy.targetHeadwaySeconds);

  const persisted: HeadwayPairResult[] = [];
  const incidents: IncidentChange[] = [];
  let computedAt = new Date().toISOString();

  // Sequential, not Promise.all: two pairs can never share a leader or
  // follower vehicle in a valid ordering, but the reactive rule for one
  // pair reads-then-writes bunching_incidents, and keeping this
  // strictly sequential avoids any possibility of two pairs racing to
  // open a duplicate incident against the same route-direction.
  for (const pair of pairs) {
    const saved = await repo.insertHeadwaySample({
      routeDirectionId: pair.routeDirectionId,
      leaderVehicleId: pair.leaderVehicleId,
      followerVehicleId: pair.followerVehicleId,
      hFwdSeconds: pair.hFwdSeconds,
      hBwdSeconds: pair.hBwdSeconds,
      targetHeadwaySeconds: pair.targetHeadwaySeconds,
      deviationSeconds: pair.deviationSeconds,
      confidence: pair.confidence,
    });
    persisted.push({
      ...pair,
      id: saved.id,
      forecastHFwdSeconds: saved.forecastHFwdSeconds,
      computedAt: saved.computedAt,
    });
    computedAt = saved.computedAt;

    const incidentChange = await evaluateAndApplyBunchingRule(
      pair,
      policy.requiredSamples,
      policy.bunchedThresholdRatio,
      policy.warningThresholdRatio
    );
    if (incidentChange.action !== "none") {
      incidents.push(incidentChange);
    }
  }

  return { routeDirectionId, computedAt, pairs: persisted, aggregate, incidents };
}

/**
 * Public entry point. Not wrapped in a Sentry span: `telemetry/sentry.ts`'s
 * `withSpan` intentionally only accepts the two span names the deployment
 * dashboards already query on (`mpc.solve`, `command.dispatch` - see
 * docs/CONTROL_SERVICE_DEPLOYMENT.md and the devops handoff note on this
 * ticket), so adding a third name here would either widen that contract
 * unilaterally or require touching a shipped, unrelated ticket's interface.
 * Structured timing is logged instead.
 */
export async function computeRouteDirectionHeadway(routeDirectionId: string): Promise<HeadwayComputeResult> {
  const startedAt = Date.now();
  try {
    const result = await computeRouteDirectionHeadwayInner(routeDirectionId);
    logger.info(
      { routeDirectionId, pairCount: result.pairs.length, incidentChanges: result.incidents.length, durationMs: Date.now() - startedAt },
      "headway metrics computed"
    );
    return result;
  } catch (error) {
    logger.error(
      { routeDirectionId, error: error instanceof Error ? error.message : String(error), durationMs: Date.now() - startedAt },
      "headway metrics computation failed"
    );
    throw error;
  }
}

/**
 * How far back GET .../headway looks for "the latest sample set". Wide
 * enough to survive a couple of missed sweeps, short enough that a
 * dashboard never shows an hour-old headway as if it were live.
 */
const LATEST_SAMPLE_WINDOW_SECONDS = 900;

/**
 * READ-ONLY view of the most recent persisted sample per pair. Same wire
 * shape as computeRouteDirectionHeadway so an existing caller can switch
 * from POST .../headway/compute to GET .../headway without changing how it
 * parses the response.
 *
 * Why this endpoint has to exist: every POST .../headway/compute APPENDS a
 * sample to headway_states, and headway_states is exactly the history the
 * reactive bunching rule reads ("k consecutive samples over threshold").
 * A dashboard polling compute therefore injects off-cadence samples into
 * the evidence for its own alerts - two dashboards open would halve the
 * effective detection window. Reads must read.
 *
 * `gapMeters` is not a persisted column, so it is recomputed from the
 * vehicles' CURRENT distance-along-route. A pair whose vehicles are no
 * longer both on this route-direction is omitted rather than reported with
 * an invented gap.
 *
 * `incidents` is always empty: an incident change is something a compute
 * cycle DOES, and this endpoint deliberately does nothing. Open incidents
 * are served by GET /v1/incidents.
 */
export async function getLatestRouteDirectionHeadway(
  routeDirectionId: string
): Promise<HeadwayComputeResult> {
  const [meta, policy, samples, vehicles] = await Promise.all([
    repo.loadRouteDirectionMeta(routeDirectionId),
    repo.loadActiveRoutePolicy(routeDirectionId),
    repo.loadLatestHeadwaySamples(routeDirectionId, LATEST_SAMPLE_WINDOW_SECONDS),
    repo.loadVehicleStatesForRouteDirection(routeDirectionId),
  ]);

  if (!meta) {
    throw new AppError("unknown_route_direction", `No active route-direction ${routeDirectionId}`, 404);
  }
  if (!policy) {
    throw new AppError("no_active_policy", `No active route policy for route-direction ${routeDirectionId}`, 404);
  }

  const distanceByVehicleId = new Map(vehicles.map((v) => [v.vehicleId, v.distanceAlongRouteMeters]));

  const pairs: HeadwayPairResult[] = [];
  for (const sample of samples) {
    const leaderDistance = distanceByVehicleId.get(sample.leaderVehicleId);
    const followerDistance = distanceByVehicleId.get(sample.followerVehicleId);
    if (leaderDistance == null || followerDistance == null) continue;

    pairs.push({
      id: sample.id,
      routeDirectionId: sample.routeDirectionId,
      leaderVehicleId: sample.leaderVehicleId,
      followerVehicleId: sample.followerVehicleId,
      gapMeters: computeGapMeters(leaderDistance, followerDistance, meta.totalDistanceMeters),
      hFwdSeconds: sample.hFwdSeconds,
      hBwdSeconds: sample.hBwdSeconds,
      targetHeadwaySeconds: sample.targetHeadwaySeconds,
      deviationSeconds: sample.deviationSeconds,
      confidence: sample.confidence,
      forecastHFwdSeconds: sample.forecastHFwdSeconds,
      computedAt: sample.computedAt,
    });
  }

  const computedAt = pairs.reduce<string | null>(
    (latest, p) => (latest === null || p.computedAt > latest ? p.computedAt : latest),
    null
  );

  return {
    routeDirectionId,
    computedAt: computedAt ?? new Date().toISOString(),
    pairs,
    aggregate: computeAggregate(pairs, routeDirectionId, policy.targetHeadwaySeconds),
    incidents: [],
  };
}

export async function listOpenIncidents(routeDirectionId?: string): Promise<repo.BunchingIncidentRow[]> {
  return repo.listOpenIncidents(routeDirectionId);
}

export async function getIncident(id: string): Promise<repo.BunchingIncidentRow | null> {
  return repo.getIncidentById(id);
}

export async function listActiveRouteDirections(): Promise<RouteDirectionListing[]> {
  return repo.listActiveRouteDirections();
}
