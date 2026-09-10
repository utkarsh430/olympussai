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
import {
  PositionPlausibilityTracker,
  type PlausibilityVerdict,
} from "../state-estimation/positionPlausibility.js";
import type { VehicleOrderingInput } from "../state-estimation/types.js";
import { AppError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import { computeAggregate, computeGapMeters, computePairHeadways } from "./metrics.js";
import { evaluateBunchingRule, evaluatePredictiveRule } from "./bunching.js";
import { computeBunchingRisk, forecastHorizonSeconds, type BunchingRisk } from "./riskForecast.js";
import * as repo from "./repository.js";
import { loadEnv } from "../config/env.js";
import {
  SEVERITY_RANK,
  type BunchingSeverity,
  type HeadwayAggregate,
  type HeadwayPairMetric,
  type RouteDirectionListing,
  type VehicleForHeadway,
} from "./types.js";

export interface IncidentChange {
  routeDirectionId: string;
  leaderVehicleId: string;
  followerVehicleId: string;
  action: "opened" | "escalated" | "closed" | "none";
  severity: BunchingSeverity | null;
  incidentId: string | null;
  ratio: number | null;
  /**
   * Seconds until the pair is forecast to reach the bunched threshold, when
   * the predictive tier had an opinion. Null means it declined to have one -
   * NOT that the pair is safe. The two are opposite in meaning and identical
   * in a boolean, which is why this is a nullable number and never a flag.
   */
  secondsToBunching?: number | null;
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

/**
 * Open, escalate or close this pair's incident, from BOTH detection tiers.
 *
 * ─── HOW THE TWO TIERS COMBINE ───────────────────────────────────────────
 *
 * The reactive rule reports a gap that has already collapsed; the predictive
 * rule reports one that is closing fast enough to collapse soon. They share
 * one incident row per pair, on one severity ladder, because they are
 * describing the same event at different stages of it. An operator watching a
 * predicted incident escalate to `warning` and then `bunched` is watching a
 * single story; three separate rows about the same two buses would be the
 * same information made unreadable.
 *
 * Reactive evidence always wins where the two disagree. It is an observation
 * and the forecast is an extrapolation, so a measured `warning` overrides a
 * forecast that says the pair is fine, and never the other way round.
 *
 * ─── WHY CLOSING BRANCHES ON WHAT IS OPEN ────────────────────────────────
 *
 * The reactive rule's `recovered` asks: has a collapsed gap reopened above the
 * warning threshold? For a `predicted` incident that question is meaningless -
 * its gap never collapsed, so `recovered` is true from the moment it opens.
 * Closing on it would shut every predicted incident on the sweep that created
 * it, which is not a subtle bug: prediction would appear to work, write rows,
 * and leave nothing behind for anyone to act on. A predicted incident closes
 * only when the FORECAST clears.
 */
async function evaluateAndApplyBunchingRule(
  pair: HeadwayPairMetric,
  requiredSamples: number,
  bunchedThresholdRatio: number,
  warningThresholdRatio: number,
  risk: BunchingRisk | null
): Promise<IncidentChange> {
  const base = {
    routeDirectionId: pair.routeDirectionId,
    leaderVehicleId: pair.leaderVehicleId,
    followerVehicleId: pair.followerVehicleId,
  };
  const secondsToBunching = risk?.secondsToBunching ?? null;

  if (pair.hFwdSeconds == null) {
    return { ...base, action: "none", severity: null, incidentId: null, ratio: null, secondsToBunching };
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

  const openSeverity = openIncident?.severity ?? null;
  const prediction = evaluatePredictiveRule(risk, openSeverity === "predicted");

  // Reactive first: an observation outranks an extrapolation.
  const severity: BunchingSeverity | null = rule.severity ?? (prediction.predicted ? "predicted" : null);

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
    // The forecast travels with the incident so the alert surface can say WHY
    // a predicted incident was raised, and so a review after the fact can ask
    // whether the prediction was any good. `forecast: null` is recorded
    // explicitly rather than omitted: "the forecaster declined to speak" is a
    // finding about this pair, and an absent key is indistinguishable from a
    // key nobody thought to write.
    forecast: risk
      ? {
          forecastHFwdSeconds: risk.forecastHFwdSeconds,
          forecastRatio: risk.forecastRatio,
          closingRateSecondsPerSecond: risk.closingRateSecondsPerSecond,
          secondsToBunching: risk.secondsToBunching,
          riskScore: risk.riskScore,
          confidence: risk.confidence,
          sampleCount: risk.sampleCount,
          amplification: risk.amplification,
          horizonSeconds: risk.horizonSeconds,
          reason: prediction.reason,
        }
      : null,
  };

  if (severity && !openIncident) {
    const created = await repo.openIncident({
      routeDirectionId: pair.routeDirectionId,
      severity,
      leaderVehicleId: pair.leaderVehicleId,
      followerVehicleId: pair.followerVehicleId,
      evidence,
    });
    logger.warn(
      { ...base, severity, incidentId: created.id, secondsToBunching },
      severity === "predicted" ? "bunching predicted" : "bunching incident opened"
    );
    return { ...base, action: "opened", severity, incidentId: created.id, ratio: rule.ratio, secondsToBunching };
  }

  // Escalation only ever moves UP the ladder. A `warning` incident whose
  // reactive evidence has lapsed but whose forecast still fires must not be
  // rewritten as `predicted`: that would report the situation improving on
  // the strength of an extrapolation, while the measured gap that opened it
  // is still there.
  if (severity && openIncident && SEVERITY_RANK[severity] > SEVERITY_RANK[openIncident.severity]) {
    await repo.escalateIncident(openIncident.id, severity, evidence);
    return {
      ...base,
      action: "escalated",
      severity,
      incidentId: openIncident.id,
      ratio: rule.ratio,
      secondsToBunching,
    };
  }

  if (openIncident) {
    const shouldClose =
      openSeverity === "predicted"
        ? // Never closed on `rule.recovered`: see the note above the function.
          // The reactive check is here to stop a predicted incident closing on
          // a cleared forecast in the same sweep that measured a real collapse.
          prediction.riskCleared && rule.severity === null
        : rule.recovered;

    if (shouldClose) {
      await repo.closeIncident(openIncident.id, evidence);
      logger.info(
        { ...base, incidentId: openIncident.id, severity: openSeverity },
        openSeverity === "predicted" ? "predicted bunching cleared" : "bunching incident closed (recovered)"
      );
      return {
        ...base,
        action: "closed",
        severity: null,
        incidentId: openIncident.id,
        ratio: rule.ratio,
        secondsToBunching,
      };
    }
  }

  return {
    ...base,
    action: "none",
    severity: openSeverity,
    incidentId: openIncident?.id ?? null,
    ratio: rule.ratio,
    secondsToBunching,
  };
}

/**
 * This pair's bunching forecast, or null if the tier is off or has no opinion.
 *
 * One indexed query per pair on top of the two the reactive rule already
 * makes. That cost is why prediction rides on this sweep rather than getting
 * a sweep of its own: the pairs are already loaded, their policy is already
 * read, and a separate job would repeat both to answer a question about the
 * same rows.
 *
 * No dwell model is passed today. `fitDwellModel` needs a run of `stop_visits`
 * at a single stop, which the GPS feed is only now beginning to accumulate,
 * and a forecast steepened by an unfitted amplification would be a guess
 * wearing a calibration's name. The projection stays linear - the
 * conservative direction, since amplification only ever makes a closing gap
 * close faster - and the parameter is wired through so that supplying the
 * model later is a one-line change here rather than a redesign.
 */
async function computeRiskForPair(
  pair: HeadwayPairMetric,
  policy: { targetHeadwaySeconds: number; bunchedThresholdRatio: number },
  env: ReturnType<typeof loadEnv>
): Promise<BunchingRisk | null> {
  if (!env.BUNCHING_PREDICTION_ENABLED) return null;
  if (pair.hFwdSeconds == null) return null;

  const samples = await repo.loadRecentHeadwaySamples(
    pair.routeDirectionId,
    pair.leaderVehicleId,
    pair.followerVehicleId,
    env.BUNCHING_FORECAST_SAMPLE_WINDOW
  );

  return computeBunchingRisk({
    samples,
    currentHFwdSeconds: pair.hFwdSeconds,
    targetHeadwaySeconds: policy.targetHeadwaySeconds,
    bunchedThresholdRatio: policy.bunchedThresholdRatio,
    horizonSeconds: forecastHorizonSeconds(
      policy.targetHeadwaySeconds,
      env.BUNCHING_FORECAST_HORIZON_MULTIPLE
    ),
  });
}

/**
 * A pair key that cannot collide between the two roles. Leader and follower
 * are both vehicle registrations, so a plain concatenation would make
 * (AB, CD) and (ABC, D) the same pair.
 */
function pairKey(leaderVehicleId: string, followerVehicleId: string): string {
  return `${leaderVehicleId}\u0000${followerVehicleId}`;
}

/**
 * End every open incident on this corridor whose pair no longer exists.
 *
 * ─── WHY AN INCIDENT NEEDS THIS TO END AT ALL ────────────────────────────
 *
 * Detection is a standing sweep: every bus on every eligible corridor is
 * checked every cycle, and that never stops. An INCIDENT, though, is an
 * interval, and it had exactly one way to end - `rule.recovered` in
 * evaluateAndApplyBunchingRule, which is only reachable if this same
 * leader/follower pair is recomputed. Pairs stop being pairs constantly and
 * for entirely ordinary reasons: a third bus moves between the two, the
 * follower finishes its trip, one of them is reassigned to another corridor.
 * From that moment the recovery rule is never evaluated again and the row
 * stays `open` forever.
 *
 * Measured on the pilot database before this existed: 9,692 open incidents, of
 * which 172 (1.8%) had had their pair evaluated in the previous five minutes.
 * The control room drew all of them, as bunching links between buses a median
 * of 59 km apart - one of them 799 km.
 *
 * ─── WHY CLOSING HERE IS SAFE ────────────────────────────────────────────
 *
 * This runs immediately after the corridor's pairs were recomputed, so "not in
 * `livePairs`" is a fresh measurement, not an assumption. And closing costs
 * the operator nothing: both buses stay under the same sweep,
 * `findOpenIncidentForPair` only ever matches non-closed rows, and if the two
 * close up again a NEW incident opens on the next cycle. That is the honest
 * record - two intervals that each really happened, rather than one that
 * never ended.
 *
 * The corridors that stop being computed entirely are the case this cannot
 * reach; `scheduler/incidentStalenessSweep.ts` is the backstop for those.
 */
async function closeSupersededIncidents(
  routeDirectionId: string,
  pairs: readonly HeadwayPairMetric[]
): Promise<IncidentChange[]> {
  const livePairs = new Set(pairs.map((p) => pairKey(p.leaderVehicleId, p.followerVehicleId)));
  const open = await repo.listOpenIncidentPairsForRouteDirection(routeDirectionId);

  const changes: IncidentChange[] = [];
  for (const incident of open) {
    if (livePairs.has(pairKey(incident.leaderVehicleId, incident.followerVehicleId))) continue;

    await repo.closeIncident(incident.id, {
      closureReason: 'pair_no_longer_adjacent',
      closedBy: 'headwayCompute',
      // What the corridor looked like at the moment this was closed, so an
      // incident review can tell "the buses re-spaced" from "the follower left
      // the route" without re-deriving it from raw samples.
      livePairCount: pairs.length,
      severityAtClose: incident.severity,
    });
    logger.info(
      {
        routeDirectionId,
        leaderVehicleId: incident.leaderVehicleId,
        followerVehicleId: incident.followerVehicleId,
        incidentId: incident.id,
      },
      'bunching incident closed (pair no longer adjacent)'
    );
    changes.push({
      routeDirectionId,
      leaderVehicleId: incident.leaderVehicleId,
      followerVehicleId: incident.followerVehicleId,
      action: 'closed',
      severity: null,
      incidentId: incident.id,
      ratio: null,
    });
  }
  return changes;
}

/**
 * One position-plausibility tracker per route-direction, held for the life of
 * the process.
 *
 * Held rather than rebuilt because every quantity the check computes is a
 * comparison against the vehicle's OWN recent history - a tracker rebuilt per
 * sweep has no history and can therefore never have an opinion, which is the
 * quiet way to ship this flag as a no-op. In-memory and unshared, exactly like
 * the rest of this service's live state (`db/rehydrate.ts` reloads it at boot
 * and nothing else does); a restart costs one sweep of re-anchoring per
 * vehicle, and re-anchoring is the tracker's safe direction.
 *
 * Populated only while the switch is on, so off allocates nothing.
 */
const plausibilityTrackers = new Map<string, PositionPlausibilityTracker>();

function judgePositions(
  routeDirectionId: string,
  vehicles: readonly VehicleForHeadway[],
): ReadonlyMap<string, PlausibilityVerdict> | null {
  const env = loadEnv();
  if (!env.GPS_POSITION_PLAUSIBILITY_ENABLED) return null;
  let tracker = plausibilityTrackers.get(routeDirectionId);
  if (!tracker) {
    tracker = new PositionPlausibilityTracker({
      residualBoundSeconds: env.GPS_POSITION_PLAUSIBILITY_BOUND_SECONDS,
    });
    plausibilityTrackers.set(routeDirectionId, tracker);
  }
  // The sweep's own clock, not each row's `observedAt`: the tracker judges one
  // SNAPSHOT of the corridor at a time, and a snapshot assembled from rows of
  // different ages is what `mpc/safety.ts`'s staleness bound is for.
  return tracker.observe(Date.now() / 1000, vehicles.map((v) => ({
    vehicleId: v.vehicleId,
    distanceAlongRouteMeters: v.distanceAlongRouteMeters,
    speedKmph: v.speedKmph,
  })));
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

  // ─── A FRESH FIX IS NOT THE SAME THING AS A TRUE ONE ─────────────────
  //
  // Null unless GPS_POSITION_PLAUSIBILITY_ENABLED, and then everything below
  // is built from the reported positions exactly as it always has been. With
  // it on, a fix the check rejects is replaced by the dead-reckoned belief
  // for the purpose of RANKING and MEASURING - so the vehicle stays in the
  // chain and stays controllable - and its speed is withheld from
  // `corridorPaceKmph`, because a position nobody believes arrives with a
  // pace nobody should believe either.
  const plausibility = judgePositions(routeDirectionId, vehicles);
  const rejected = (vehicleId: string): boolean =>
    plausibility?.get(vehicleId)?.isImplausible === true;
  const rankedDistanceOf = (v: VehicleForHeadway): number => {
    const verdict = plausibility?.get(v.vehicleId);
    return verdict?.isImplausible
      ? verdict.believedDistanceAlongRouteMeters
      : v.distanceAlongRouteMeters;
  };

  const orderingInputs: VehicleOrderingInput[] = vehicles.map((v) => ({
    vehicleId: v.vehicleId,
    routeDirectionId,
    distanceAlongRouteMeters: rankedDistanceOf(v),
    isLowConfidence: v.isLowConfidence,
  }));

  const ordered = computeLeaderFollowerOrder(orderingInputs, {
    isLoop: meta.isLoop,
    totalDistanceMeters: meta.totalDistanceMeters,
  });

  const speedByVehicleId = new Map(
    vehicles.map((v) => [v.vehicleId, rejected(v.vehicleId) ? null : v.speedKmph]),
  );
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
  const env = loadEnv();

  for (const pair of pairs) {
    // The trend is fitted from samples written by EARLIER sweeps, before this
    // cycle's sample is appended. Including the row we are about to write
    // would be harmless arithmetically - it is the same point the forecast
    // starts from - but it would make the stored `forecast_h_fwd_seconds`
    // depend on its own row, and an audit reconstructing the forecast from
    // history would get a different answer than the one recorded.
    const risk = await computeRiskForPair(pair, policy, env);

    const saved = await repo.insertHeadwaySample({
      routeDirectionId: pair.routeDirectionId,
      leaderVehicleId: pair.leaderVehicleId,
      followerVehicleId: pair.followerVehicleId,
      hFwdSeconds: pair.hFwdSeconds,
      hBwdSeconds: pair.hBwdSeconds,
      targetHeadwaySeconds: pair.targetHeadwaySeconds,
      deviationSeconds: pair.deviationSeconds,
      confidence: pair.confidence,
      forecastHFwdSeconds: risk?.forecastHFwdSeconds ?? null,
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
      policy.warningThresholdRatio,
      risk
    );
    if (incidentChange.action !== "none") {
      incidents.push(incidentChange);
    }
  }

  // AFTER the per-pair loop, never before: the loop is what opens and
  // escalates incidents for the pairs that DO exist, and closing first would
  // race an incident this very cycle had just reopened.
  incidents.push(...(await closeSupersededIncidents(routeDirectionId, pairs)));

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

export async function listOpenIncidents(
  routeDirectionId?: string,
  limit?: number
): Promise<repo.BunchingIncidentRow[]> {
  return repo.listOpenIncidents(routeDirectionId, limit);
}

export async function countOpenIncidents(routeDirectionId?: string): Promise<number> {
  return repo.countOpenIncidents(routeDirectionId);
}

export async function getIncident(id: string): Promise<repo.BunchingIncidentRow | null> {
  return repo.getIncidentById(id);
}

export async function listActiveRouteDirections(): Promise<RouteDirectionListing[]> {
  return repo.listActiveRouteDirections();
}

export interface AlertFeed {
  alerts: repo.BunchingAlertRow[];
  /** Open incidents per severity across the whole network, ignoring `limit`. */
  countsBySeverity: Record<string, number>;
  /** Total open incidents, so a truncated list can say what it is a slice of. */
  totalOpenCount: number;
  generatedAt: string;
}

/**
 * The network-wide alert feed: what is going wrong, everywhere, worst first.
 *
 * The counts are returned alongside a LIMITED list rather than being derived
 * from it, because they answer a question the list cannot once it is
 * truncated. "23 predicted, 4 bunched" is the number an operator uses to
 * decide whether the network needs their attention at all; counting the rows
 * on screen would answer that question with the page size.
 */
export async function listAlerts(limit: number): Promise<AlertFeed> {
  const [alerts, countsBySeverity] = await Promise.all([
    repo.listOpenAlerts(limit),
    repo.countOpenAlertsBySeverity(),
  ]);
  const totalOpenCount = Object.values(countsBySeverity).reduce((sum, n) => sum + n, 0);
  return { alerts, countsBySeverity, totalOpenCount, generatedAt: new Date().toISOString() };
}
