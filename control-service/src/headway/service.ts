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
import { computeAggregate, computePairHeadways } from "./metrics.js";
import { evaluateBunchingRule } from "./bunching.js";
import * as repo from "./repository.js";
import type { HeadwayAggregate, HeadwayPairMetric, RouteDirectionMeta } from "./types.js";

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

export async function listOpenIncidents(routeDirectionId?: string): Promise<repo.BunchingIncidentRow[]> {
  return repo.listOpenIncidents(routeDirectionId);
}

export async function listActiveRouteDirections(): Promise<RouteDirectionMeta[]> {
  return repo.listActiveRouteDirections();
}
