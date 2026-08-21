// Domain types for time-domain headway/EWT/CV computation and reactive
// bunching detection (blueprint 7.1 forward/backward headway definitions,
// 7.3 reactive detection tier). Wire-shape fields (camelCase) mirror
// headway_states / bunching_incidents columns and, one level up, the
// headwayStateSchema / bunchingIncidentSchema Zod contracts already shipped
// in the web app at src/models/control.ts, so a response here round-trips
// through that schema without translation.

import type { VehicleOrderingInput } from "../state-estimation/types.js";

/** A vehicle_states row projected down to what headway computation needs. */
export interface VehicleForHeadway extends VehicleOrderingInput {
  speedKmph: number | null;
  confidence: number | null;
  observedAt: string;
}

export interface RouteDirectionMeta {
  routeDirectionId: string;
  routeId: string;
  directionCode: string;
  isLoop: boolean;
  totalDistanceMeters: number;
}

/**
 * A route-direction as it appears in the corridor list a dashboard picks from.
 *
 * Separate from `RouteDirectionMeta` on purpose. The extra field answers a
 * question only a LIST has — "which of these can tell me anything?" — and the
 * headway compute path, which loads one route-direction's geometry and then
 * loads its policy properly a line later, has no use for a second, weaker
 * answer to a question it is already asking. Keeping it out of the shared
 * shape means the two can never drift into disagreeing about the same
 * corridor.
 */
export interface RouteDirectionListing extends RouteDirectionMeta {
  /**
   * Whether this corridor has an active headway policy, and therefore whether
   * bunching detection runs on it at all.
   *
   * Geometry is what puts a corridor in the list; a policy is what lets it
   * report. The two are far apart in practice — 47 shaped corridors against 14
   * policied ones when this was added — so a list carrying only the former
   * offered an operator corridors that can never show them a reading. See
   * `listActiveRouteDirections` for the predicate, which is deliberately the
   * same one `loadActiveRoutePolicy` uses.
   */
  hasActivePolicy: boolean;
}

export interface RoutePolicyForHeadway {
  routeDirectionId: string;
  targetHeadwaySeconds: number;
  bunchedThresholdRatio: number;
  warningThresholdRatio: number;
  requiredSamples: number;
}

/** One leader/follower pair's time-domain headway at a point in time. */
export interface HeadwayPairMetric {
  routeDirectionId: string;
  leaderVehicleId: string;
  followerVehicleId: string;
  gapMeters: number;
  /** Time for the follower to close the gap at its own current speed. */
  hFwdSeconds: number | null;
  /**
   * Backward headway of `followerVehicleId`: the time the bus BEHIND it
   * would take to reach its current position, at that bus's own speed.
   * Null when nothing is behind it (back-most vehicle on a linear
   * route-direction), which is what routes the pair to self-equalizing
   * control instead of two-way. See metrics.ts's header.
   */
  hBwdSeconds: number | null;
  targetHeadwaySeconds: number;
  /** hFwdSeconds - targetHeadwaySeconds. Negative = running tighter than target (bunching direction). */
  deviationSeconds: number | null;
  /** min(leader.confidence, follower.confidence), when both are known. */
  confidence: number | null;
}

/** Route-direction-wide dispersion metrics derived from one snapshot of pair headways. */
export interface HeadwayAggregate {
  routeDirectionId: string;
  sampleCount: number;
  meanHeadwaySeconds: number | null;
  stddevHeadwaySeconds: number | null;
  /** Coefficient of variation of forward headways (stddev / mean); higher = more irregular/bunched. */
  cv: number | null;
  /** Excess Wait Time in seconds: passenger-weighted actual wait minus scheduled wait. */
  ewtSeconds: number | null;
  targetHeadwaySeconds: number;
}

/**
 * Severities the REACTIVE rule can reach: both describe a gap that has
 * already collapsed, and both are observations.
 */
export type ReactiveBunchingSeverity = "warning" | "bunched";

/**
 * Every severity a `bunching_incidents` row can carry.
 *
 * `predicted` is the rung below `warning` and is a different KIND of claim
 * from the other two. Those report a gap measured to be under threshold now;
 * `predicted` reports a gap that is still acceptable but closing fast enough
 * to breach inside the forecast horizon (src/headway/riskForecast.ts). It
 * exists because the cheap correction - a short hold, early, at a stop the
 * bus was stopping at anyway - is only available BEFORE the collapse, and by
 * the time `warning` fires it has been spent.
 *
 * The ordering matters and is expressed once, in SEVERITY_RANK: an incident
 * may escalate up the ladder as evidence hardens, and a predicted incident
 * that becomes real must escalate rather than open a second incident about
 * the same pair.
 */
export type BunchingSeverity = "predicted" | ReactiveBunchingSeverity;

/**
 * Ladder position, low to high. Used to decide whether a fresh verdict on a
 * pair is an escalation of the open incident or merely a restatement of it.
 */
export const SEVERITY_RANK: Record<BunchingSeverity, number> = {
  predicted: 0,
  warning: 1,
  bunched: 2,
};

export interface BunchingRuleResult {
  /** null = rule condition not met (not enough samples, or headway within tolerance). */
  severity: ReactiveBunchingSeverity | null;
  /** true when an already-open incident's window has fully recovered above the warning threshold. */
  recovered: boolean;
  /** Most recent hFwd/target ratio, for evidence/logging. */
  ratio: number | null;
}
