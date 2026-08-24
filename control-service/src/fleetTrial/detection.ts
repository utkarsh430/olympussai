// Running the DEPLOYED bunching detector over a simulated day.
//
// ─── WHY THE DETECTOR IS REPLAYED AND NOT REIMPLEMENTED ──────────────────
//
// The trial's headline claim is "this many incidents were detected, and this
// is what happened to them". A detector written for the trial would make that
// claim about itself. Every rule below is therefore imported from the module
// the live sweep imports it from:
//
//   state-estimation/ordering.ts#computeLeaderFollowerOrder  the chain
//   headway/metrics.ts#computePairHeadways                   h_fwd / h_bwd
//   headway/riskForecast.ts#computeBunchingRisk              the trend fit
//   headway/bunching.ts#evaluateBunchingRule                 the reactive tier
//   headway/bunching.ts#evaluatePredictiveRule               the predictive tier
//   headway/types.ts#SEVERITY_RANK                           the ladder
//
// What IS restated here is the sequencing that `headway/service.ts` performs
// against Postgres - open, escalate, close, close-superseded - because that
// function is async, writes rows, and reads them back through a repository.
// The order it performs those steps in is load-bearing and is reproduced
// exactly; see the comments at each step for which one and why.
//
// ─── THE SWEEP IS A SWEEP, NOT A PER-STOP CHECK ──────────────────────────
//
// Production computes headways on a TIMER (HEADWAY_COMPUTE_INTERVAL_MS,
// 60 s by default) over every vehicle then on the corridor, not when a bus
// reaches a stop. That distinction is not cosmetic: the reactive rule needs
// `required_samples` CONSECUTIVE samples and the predictive tier needs a
// trend fitted over at least `MIN_TREND_WINDOW_SECONDS` of clock, so a
// detector that sampled once per stop visit - ten times per bus over 400 km -
// would never accumulate a window either tier could speak about, and the
// predictive tier would report zero incidents for a reason that belonged to
// the sampling and not to the corridor.
//
// Reads nothing and writes nothing: it is handed a finished simulation and
// returns plain data.
import { computeLeaderFollowerOrder } from '../state-estimation/ordering.js';
import { computePairHeadways } from '../headway/metrics.js';
import { evaluateBunchingRule, evaluatePredictiveRule } from '../headway/bunching.js';
import { computeBunchingRisk, forecastHorizonSeconds } from '../headway/riskForecast.js';
import { SEVERITY_RANK } from '../headway/types.js';
import { corridorStateAt } from '../simulation/kinematics.js';
import type { BunchingSeverity } from '../headway/types.js';
import type { HeadwaySampleObservation } from '../headway/riskForecast.js';
import type { VehicleOrderingInput } from '../state-estimation/types.js';
import type {
  Disturbance,
  StopVisitRecord,
  TerminalDispatchPlan,
} from '../simulation/types.js';
import type { CorridorInputs } from '../rehearsal/corridor.js';
import type { RehearsalDecisionRecord } from '../rehearsal/deployedControlLaws.js';

/** Deployed sweep cadence (`HEADWAY_COMPUTE_INTERVAL_MS`, 60 000 ms). */
export const DEFAULT_SWEEP_INTERVAL_SECONDS = 60;
/** Deployed forecast sample window (`BUNCHING_FORECAST_SAMPLE_WINDOW`, 10). */
export const DEFAULT_FORECAST_SAMPLE_WINDOW = 10;

export type IncidentCloseReason =
  /** The measured gap reopened above the warning threshold - the reactive rule's own `recovered`. */
  | 'recovered'
  /** The forecast that opened a `predicted` incident cleared. Only ever closes a predicted incident. */
  | 'risk_cleared'
  /** Leader or follower left the corridor, so the pair this incident was about no longer exists. */
  | 'pair_no_longer_adjacent'
  /** Still open when the simulated day ended. NOT a resolution, and counted separately everywhere. */
  | 'run_ended';

export interface DetectedIncident {
  incidentId: string;
  leaderVehicleId: string;
  followerVehicleId: string;
  openedAtSeconds: number;
  openedSeverity: BunchingSeverity;
  /** Highest rung reached. Severity only ever moves UP, exactly as `headway/service.ts` enforces. */
  peakSeverity: BunchingSeverity;
  escalations: number;
  closedAtSeconds: number | null;
  closeReason: IncidentCloseReason;
  durationSeconds: number | null;
  /** Worst h_fwd/H* observed while open. The depth of the bunch, not just its existence. */
  minRatio: number;
  minHFwdSeconds: number | null;
  /** How far along the route the follower was when this opened, metres. */
  openedAtDistanceMeters: number;
  /** Seconds of hold the follower actually served while this was open. Zero on an uncontrolled arm by construction. */
  holdSecondsApplied: number;
  holdCount: number;
  /** Which deployed laws produced the holds served during this incident. */
  holdActionTypes: string[];
  /** Seconds of hold the laws asked for that the driver did not take. */
  holdSecondsRefused: number;
  /**
   * True when a bus the estimator could not vouch for was sitting INSIDE this
   * pair's gap while the incident was open.
   *
   * A dark vehicle is excluded from the leader/follower chain entirely - that
   * is what `state-estimation/ordering.ts` does with a low-confidence estimate,
   * and this replays it. The consequence is easy to miss and worth flagging:
   * the buses either side of it are then linked to each other, so the pair
   * spans TWO headways and reads as comfortably spaced. Whatever is happening
   * around the invisible bus is invisible too.
   *
   * This flag is therefore not "one of these two buses was dark" - that can
   * never happen, because a dark bus is in no pair at all. It is "this
   * measurement has a hole in it".
   */
  observationLost: boolean;
}

/** One sweep, reduced to what a chart of the day needs. */
export interface SweepSample {
  atSeconds: number;
  liveVehicles: number;
  pairCount: number;
  /** Tightest h_fwd/H* across the corridor at this instant. Null when no pair had a measurable headway. */
  minRatio: number | null;
  meanRatio: number | null;
  bunchedPairs: number;
  warningPairs: number;
  openIncidents: number;
}

export interface DetectionResult {
  incidents: DetectedIncident[];
  sweeps: SweepSample[];
  sweepCount: number;
  headwaySampleCount: number;
}

export interface DetectionInputs {
  corridor: CorridorInputs;
  visits: readonly StopVisitRecord[];
  dispatches: readonly TerminalDispatchPlan[];
  disturbances: readonly Disturbance[];
  /** `route_policies.required_samples`. Three consecutive breaches at 60 s is a three-minute confirmation. */
  requiredSamples: number;
  /** Decisions the controlled arm's laws made, for attributing a hold to the incident it was serving. Empty on the uncontrolled arm. */
  decisions?: readonly RehearsalDecisionRecord[];
  sweepIntervalSeconds?: number;
  forecastSampleWindow?: number;
  /** Vehicles excluded from every result. The warm-up run is machinery, not a bus. */
  excludeVehicleIds?: ReadonlySet<string>;
  /**
   * When to stop sweeping, overriding this arm's own last departure.
   *
   * The two arms of a trial must be swept over the SAME window or their
   * incident counts are not comparable. Holding makes buses finish later, so
   * the controlled arm's own horizon is about half a percent further out -
   * half a percent more sweeps, and so more chances to open, escalate and
   * close an incident - and `ArmContrast.incidentsAvoided` is a difference of
   * the two counts.
   */
  sweepUntilSeconds?: number;
}

function pairKey(leaderVehicleId: string, followerVehicleId: string): string {
  return `${leaderVehicleId}->${followerVehicleId}`;
}

interface OpenIncident {
  incidentId: string;
  leaderVehicleId: string;
  followerVehicleId: string;
  severity: BunchingSeverity;
  openedSeverity: BunchingSeverity;
  openedAtSeconds: number;
  openedAtDistanceMeters: number;
  escalations: number;
  minRatio: number;
  minHFwdSeconds: number | null;
  observationLost: boolean;
}

interface VehicleTrack {
  vehicleId: string;
  dispatchSeconds: number;
  timeline: StopVisitRecord[];
}

/** True when this vehicle's feed is dark at `atSeconds` - the same condition the engine reports as `isStateStale`. */
function isDark(
  disturbances: readonly Disturbance[],
  vehicleId: string,
  atSeconds: number,
): boolean {
  return disturbances.some(
    (d) =>
      d.type === 'gps_dropout' &&
      d.vehicleId === vehicleId &&
      atSeconds >= d.startSeconds &&
      atSeconds <= d.endSeconds,
  );
}

/**
 * The instant the last bus finishes, so the sweep stops when the corridor
 * empties rather than at an arbitrary clock time.
 */
function runHorizonSeconds(visits: readonly StopVisitRecord[]): number {
  let latest = 0;
  for (const visit of visits) {
    if (visit.departureSeconds > latest) latest = visit.departureSeconds;
  }
  return latest;
}

export function detectIncidents(inputs: DetectionInputs): DetectionResult {
  const {
    corridor,
    visits,
    dispatches,
    disturbances,
    requiredSamples,
    decisions = [],
    sweepIntervalSeconds = DEFAULT_SWEEP_INTERVAL_SECONDS,
    sweepUntilSeconds,
    forecastSampleWindow = DEFAULT_FORECAST_SAMPLE_WINDOW,
    excludeVehicleIds = new Set<string>(),
  } = inputs;

  const policy = corridor.policy;
  const targetHeadwaySeconds = policy.targetHeadwaySeconds;
  const cumulativeDistanceMeters = corridor.stops.map((s) => s.cumulativeDistanceMeters);
  const horizonSeconds = forecastHorizonSeconds(targetHeadwaySeconds);

  // ── Per-vehicle timelines, built once ──
  const dispatchByVehicle = new Map(dispatches.map((d) => [d.vehicleId, d.scheduledDispatchSeconds]));
  const trackByVehicle = new Map<string, VehicleTrack>();
  for (const visit of visits) {
    if (excludeVehicleIds.has(visit.vehicleId)) continue;
    const dispatchSeconds = dispatchByVehicle.get(visit.vehicleId);
    if (dispatchSeconds === undefined) continue;
    let track = trackByVehicle.get(visit.vehicleId);
    if (!track) {
      track = { vehicleId: visit.vehicleId, dispatchSeconds, timeline: [] };
      trackByVehicle.set(visit.vehicleId, track);
    }
    track.timeline.push(visit);
  }
  for (const track of trackByVehicle.values()) {
    track.timeline.sort((a, b) => a.stopIndex - b.stopIndex);
  }
  const tracks = [...trackByVehicle.values()].sort((a, b) => a.dispatchSeconds - b.dispatchSeconds);

  // ── Detector state, one entry per pair, exactly as the live sweep keys it ──
  const ratiosByPair = new Map<string, number[]>();
  const samplesByPair = new Map<string, HeadwaySampleObservation[]>();
  const openByPair = new Map<string, OpenIncident>();

  const closed: DetectedIncident[] = [];
  const sweeps: SweepSample[] = [];
  let headwaySampleCount = 0;
  let incidentSequence = 0;

  const finish = (
    open: OpenIncident,
    atSeconds: number | null,
    closeReason: IncidentCloseReason,
  ): void => {
    closed.push({
      incidentId: open.incidentId,
      leaderVehicleId: open.leaderVehicleId,
      followerVehicleId: open.followerVehicleId,
      openedAtSeconds: open.openedAtSeconds,
      openedSeverity: open.openedSeverity,
      peakSeverity: open.severity,
      escalations: open.escalations,
      closedAtSeconds: atSeconds,
      closeReason,
      durationSeconds: atSeconds === null ? null : atSeconds - open.openedAtSeconds,
      minRatio: open.minRatio,
      minHFwdSeconds: open.minHFwdSeconds,
      openedAtDistanceMeters: open.openedAtDistanceMeters,
      // Filled in below, once every incident window is known.
      holdSecondsApplied: 0,
      holdCount: 0,
      holdActionTypes: [],
      holdSecondsRefused: 0,
      observationLost: open.observationLost,
    });
  };

  const endOfRun = sweepUntilSeconds ?? runHorizonSeconds(visits);

  for (let atSeconds = 0; atSeconds <= endOfRun; atSeconds += sweepIntervalSeconds) {
    // ── The corridor as the state estimator would report it at this instant ──
    const ordering: VehicleOrderingInput[] = [];
    const speedByVehicleId = new Map<string, number | null>();
    const confidenceByVehicleId = new Map<string, number>();
    const distanceByVehicleId = new Map<string, number>();
    const darkVehicleIds = new Set<string>();

    for (const track of tracks) {
      const state = corridorStateAt(
        track.timeline,
        track.dispatchSeconds,
        cumulativeDistanceMeters,
        atSeconds,
      );
      if (!state) continue;
      const dark = isDark(disturbances, track.vehicleId, atSeconds);
      if (dark) darkVehicleIds.add(track.vehicleId);
      ordering.push({
        vehicleId: track.vehicleId,
        routeDirectionId: corridor.routeDirectionId,
        distanceAlongRouteMeters: state.distanceAlongRouteMeters,
        // A dark vehicle is EXCLUDED from the leader/follower chain, which is
        // what production does with a low-confidence estimate - the bus
        // behind it is then linked to the bus in front of it, and the pair
        // that spans the gap is measured rather than a pair that includes a
        // position nobody can vouch for.
        isLowConfidence: dark,
      });
      speedByVehicleId.set(track.vehicleId, state.speedKmph);
      confidenceByVehicleId.set(track.vehicleId, dark ? 0 : 1);
      distanceByVehicleId.set(track.vehicleId, state.distanceAlongRouteMeters);
    }

    const ordered = computeLeaderFollowerOrder(ordering, {
      isLoop: corridor.isLoop,
      totalDistanceMeters: corridor.totalDistanceMeters,
    });
    // Where the vehicles nobody can vouch for are, so a pair that spans one can
    // say so. They are excluded from `ordered` (rank -1) and thus from every
    // pair, which is exactly why their positions have to be kept separately.
    const hiddenDistances = [...darkVehicleIds]
      .map((vehicleId) => distanceByVehicleId.get(vehicleId))
      .filter((distance): distance is number => distance !== undefined);
    const pairs = computePairHeadways(
      ordered,
      speedByVehicleId,
      confidenceByVehicleId,
      { totalDistanceMeters: corridor.totalDistanceMeters },
      corridor.routeDirectionId,
      targetHeadwaySeconds,
    );

    /** Whether an unvouched-for vehicle sits between these two, hiding whatever it is doing. */
    const spansHiddenVehicle = (leaderVehicleId: string, followerVehicleId: string): boolean => {
      if (hiddenDistances.length === 0) return false;
      const leader = distanceByVehicleId.get(leaderVehicleId);
      const follower = distanceByVehicleId.get(followerVehicleId);
      if (leader === undefined || follower === undefined) return false;
      const low = Math.min(leader, follower);
      const high = Math.max(leader, follower);
      return hiddenDistances.some((distance) => distance > low && distance < high);
    };

    let bunchedPairs = 0;
    let warningPairs = 0;
    let minRatio: number | null = null;
    let ratioSum = 0;
    let ratioCount = 0;

    for (const pair of pairs) {
      const key = pairKey(pair.leaderVehicleId, pair.followerVehicleId);
      const open = openByPair.get(key) ?? null;

      if (pair.hFwdSeconds === null) {
        // No measurable forward headway. The live rule returns "none" here
        // without touching an open incident, and so does this.
        continue;
      }
      headwaySampleCount++;

      const ratio = pair.hFwdSeconds / targetHeadwaySeconds;
      ratioSum += ratio;
      ratioCount++;
      if (minRatio === null || ratio < minRatio) minRatio = ratio;
      if (ratio <= policy.bunchedThresholdRatio) bunchedPairs++;
      else if (ratio <= policy.warningThresholdRatio) warningPairs++;

      // The trend is fitted from samples written by EARLIER sweeps, before
      // this cycle's sample is appended - see `headway/service.ts`, which
      // orders it this way so a stored forecast never depends on its own row.
      const history = samplesByPair.get(key) ?? [];
      const risk = computeBunchingRisk({
        samples: history,
        currentHFwdSeconds: pair.hFwdSeconds,
        targetHeadwaySeconds,
        bunchedThresholdRatio: policy.bunchedThresholdRatio,
        horizonSeconds,
        // No dwell model, matching production: `fitDwellModel` needs a run of
        // stop visits at one stop and the corridor has never had one, so the
        // projection stays linear - the conservative direction.
        dwellModel: null,
      });

      history.push({ hFwdSeconds: pair.hFwdSeconds, computedAt: new Date(atSeconds * 1000).toISOString() });
      if (history.length > forecastSampleWindow) history.shift();
      samplesByPair.set(key, history);

      // The reactive rule reads the ratio history INCLUDING this sweep's
      // sample, because the live rule loads it back after the insert.
      const ratios = ratiosByPair.get(key) ?? [];
      ratios.unshift(ratio);
      if (ratios.length > requiredSamples) ratios.length = requiredSamples;
      ratiosByPair.set(key, ratios);

      const rule = evaluateBunchingRule(
        ratios,
        requiredSamples,
        policy.bunchedThresholdRatio,
        policy.warningThresholdRatio,
        open !== null,
      );
      const openSeverity = open?.severity ?? null;
      const prediction = evaluatePredictiveRule(risk, openSeverity === 'predicted');

      // Reactive first: an observation outranks an extrapolation.
      const severity: BunchingSeverity | null =
        rule.severity ?? (prediction.predicted ? 'predicted' : null);

      if (open) {
        if (ratio < open.minRatio) {
          open.minRatio = ratio;
          open.minHFwdSeconds = pair.hFwdSeconds;
        }
        if (spansHiddenVehicle(pair.leaderVehicleId, pair.followerVehicleId)) {
          open.observationLost = true;
        }
      }

      if (severity && !open) {
        incidentSequence++;
        openByPair.set(key, {
          incidentId: `INC-${String(incidentSequence).padStart(5, '0')}`,
          leaderVehicleId: pair.leaderVehicleId,
          followerVehicleId: pair.followerVehicleId,
          severity,
          openedSeverity: severity,
          openedAtSeconds: atSeconds,
          openedAtDistanceMeters: distanceByVehicleId.get(pair.followerVehicleId) ?? 0,
          escalations: 0,
          minRatio: ratio,
          minHFwdSeconds: pair.hFwdSeconds,
          observationLost: spansHiddenVehicle(pair.leaderVehicleId, pair.followerVehicleId),
        });
        continue;
      }

      if (open && severity && SEVERITY_RANK[severity] > SEVERITY_RANK[open.severity]) {
        // Escalation only ever moves UP. A `warning` whose reactive evidence
        // lapsed but whose forecast still fires must not be rewritten as
        // `predicted` - that reports the situation improving on the strength
        // of an extrapolation while the measured gap is still collapsed.
        open.severity = severity;
        open.escalations++;
        continue;
      }

      if (open) {
        const shouldClose =
          open.severity === 'predicted'
            ? // NEVER `rule.recovered`. A predicted incident's gap never
              // collapsed, so `recovered` is true from the sweep that opened
              // it, and closing on it would shut every prediction the instant
              // it was made. The reactive check alongside stops a prediction
              // clearing in the same sweep that measured a real collapse.
              prediction.riskCleared && rule.severity === null
            : rule.recovered;
        if (shouldClose) {
          finish(open, atSeconds, open.severity === 'predicted' ? 'risk_cleared' : 'recovered');
          openByPair.delete(key);
        }
      }
    }

    // AFTER the per-pair loop, never before - the loop is what opens and
    // escalates incidents for the pairs that DO exist, and closing first
    // would race an incident this very sweep had just reopened.
    const livePairs = new Set(pairs.map((p) => pairKey(p.leaderVehicleId, p.followerVehicleId)));
    for (const [key, open] of [...openByPair]) {
      if (livePairs.has(key)) continue;
      finish(open, atSeconds, 'pair_no_longer_adjacent');
      openByPair.delete(key);
    }

    sweeps.push({
      atSeconds,
      liveVehicles: ordering.length,
      pairCount: pairs.length,
      minRatio,
      meanRatio: ratioCount > 0 ? ratioSum / ratioCount : null,
      bunchedPairs,
      warningPairs,
      openIncidents: openByPair.size,
    });
  }

  // Anything still open when the corridor emptied. NOT a resolution: it is
  // reported with its own close reason and excluded from every "resolved"
  // count, because a run that ends is not a bunch that cleared.
  for (const open of openByPair.values()) finish(open, null, 'run_ended');

  attributeHolds(closed, visits, decisions, endOfRun);

  closed.sort((a, b) => a.openedAtSeconds - b.openedAtSeconds);
  return {
    incidents: closed,
    sweeps,
    sweepCount: sweeps.length,
    headwaySampleCount,
  };
}

/**
 * Which holds were served while each incident was open.
 *
 * Attribution is to the FOLLOWER, which is the vehicle every mid-route law
 * issues its hold to and the one an incident is about. A hold is counted when
 * the interval it was actually served over - `departureSeconds` back by the
 * applied hold - overlaps the incident's open window at all, so a hold that
 * begins before a bunch is confirmed and runs into it still counts as work
 * done on it.
 *
 * `boarding_limit` is the deliberate exception in the other direction: it
 * acts on the LEADER of a bunched pair. It carries no hold seconds, so it
 * appears in `holdActionTypes` through the leader match without inflating
 * `holdSecondsApplied`.
 */
function attributeHolds(
  incidents: DetectedIncident[],
  visits: readonly StopVisitRecord[],
  decisions: readonly RehearsalDecisionRecord[],
  endOfRun: number,
): void {
  if (incidents.length === 0) return;

  const visitsByVehicle = new Map<string, StopVisitRecord[]>();
  for (const visit of visits) {
    if (visit.intendedHoldSeconds <= 0) continue;
    const bucket = visitsByVehicle.get(visit.vehicleId) ?? [];
    bucket.push(visit);
    visitsByVehicle.set(visit.vehicleId, bucket);
  }

  // Decisions are keyed by the instant the engine asked for them, which is the
  // visit's own arrival time - the same number on both sides, so an exact
  // match is correct and a tolerance would only let one visit claim another's.
  const actionByVehicleAndArrival = new Map<string, string>();
  for (const decision of decisions) {
    actionByVehicleAndArrival.set(`${decision.vehicleId}|${decision.atSeconds}`, decision.selectedActionType);
  }

  for (const incident of incidents) {
    const from = incident.openedAtSeconds;
    const to = incident.closedAtSeconds ?? endOfRun;
    const actionTypes = new Set<string>();

    for (const visit of visitsByVehicle.get(incident.followerVehicleId) ?? []) {
      const servedFrom = visit.departureSeconds - visit.appliedHoldSeconds;
      const servedTo = visit.departureSeconds;
      if (servedTo < from || servedFrom > to) continue;
      if (visit.compliant) {
        incident.holdSecondsApplied += visit.appliedHoldSeconds;
        if (visit.appliedHoldSeconds > 0) incident.holdCount++;
      } else {
        incident.holdSecondsRefused += visit.intendedHoldSeconds;
      }
      const action = actionByVehicleAndArrival.get(`${visit.vehicleId}|${visit.arrivalSeconds}`);
      if (action && action !== 'no_control') actionTypes.add(action);
    }

    incident.holdActionTypes = [...actionTypes].sort();
  }
}
