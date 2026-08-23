// The shape a fleet trial reports its results in.
//
// This is a WIRE type: the control service returns it, the web app parses it
// with a mirrored Zod schema (`src/models/fleetTrial.ts`), and the control
// room renders it. Two consequences the fields below are designed around.
//
// BOUNDED. A trial simulates a thousand buses over twenty runs and produces
// millions of numbers. What crosses the wire is a summary plus deliberately
// bounded evidence - a downsampled sweep series, a capped set of vehicle
// trajectories, the worst incidents rather than all of them. Every cap is a
// named constant in `run.ts` so a reader can see what was left out.
//
// PAIRED. Nearly everything here comes in twos: what the deployed controller
// did, and what would have happened on the same corridor, the same day and
// the same seed with nobody intervening. The uncontrolled arm is not an
// option a caller may skip - it is the only thing that makes the controlled
// arm's numbers mean anything.
import type { BunchingScenarioId } from './scenarios.js';
import type { DetectedIncident, SweepSample } from './detection.js';
import type { ControlLaw, DeclineReason } from '../rehearsal/deployedControlLaws.js';

export type PhaseId = 'occupancy_blind' | 'occupancy_aware';

/** The control-quality half of the answer: are buses evenly spaced. */
export interface SpacingKpis {
  /** Headway samples the figures below rest on. A null KPI on a zero count is an absence, not a zero. */
  headwaySampleCount: number;
  meanHeadwaySeconds: number | null;
  /**
   * Excess Wait Time, seconds per passenger. THE HEADLINE.
   *
   * The second-moment `E[h^2]/(2 E[h])` less the scheduled half-headway, the
   * same arithmetic the live network is measured with (`lib/dispersion.ts`).
   */
  ewtSeconds: number | null;
  /**
   * Coefficient of variation. DIAGNOSTIC, never the headline: CV is
   * scale-free, so lengthening every headway uniformly "improves" it.
   */
  headwayCv: number | null;
  /** Share of headway samples under `bunchedThresholdRatio x H*`. */
  bunchingRate: number;
  /** Passengers refused because the bus was full. Rises if spacing was bought by stranding people. */
  deniedBoardings: number;
  totalBoardings: number;
  /**
   * True when more than a fifth of offered passengers were refused a seat.
   *
   * A SATURATION WARNING, and the reason it travels with the KPIs rather than
   * being left for a reader to derive: past this line waiting time is bounded
   * by how many seats exist rather than by how they are spaced, so the
   * headline metric cannot respond to control and a working controller
   * correctly reports "no effect". Every number in this block should be read
   * with that in mind when it is true.
   */
  saturated: boolean;
}

/**
 * The punctuality half: what the spacing cost in journey time.
 *
 * Measured end to end from the terminal, because that is the number a
 * passenger and a schedule both experience. The engine models no timetable,
 * so this is NOT lateness against a published departure - it is how long the
 * trip took, and the difference between the two arms is what holding added.
 */
export interface PunctualityKpis {
  vehiclesCompleted: number;
  meanJourneySeconds: number | null;
  p95JourneySeconds: number | null;
  maxJourneySeconds: number | null;
  /** Seconds of hold actually served, summed over the arm. Zero on the uncontrolled arm by construction. */
  totalHoldSeconds: number;
  /** Mean hold served per bus that completed a trip - the typical punctuality cost of being controlled. */
  meanHoldSecondsPerVehicle: number;
  /** The worst-affected single bus. The user-visible bound on "a little delay is fine, but not very large". */
  maxHoldSecondsOnAnyVehicle: number;
  /** Holds the laws asked for that a driver did not take. */
  refusedHoldSeconds: number;
  /**
   * Times a bus was told to let people off and take nobody on, and how many
   * people that left standing.
   *
   * The one lever here whose cost falls on people at the roadside rather than
   * on the timetable, so the passenger count travels with the action count and
   * neither is shown without the other.
   */
  alightingOnlyActions: number;
  alightingOnlyPassengersPassed: number;
  /**
   * Lateness against the booked timetable at the terminus, in seconds
   * (negative = arrived early). Null when the scenario booked no timetable.
   *
   * This is punctuality in the sense an operator means it, as distinct from
   * `meanJourneySeconds`, which is how long the trip took. A corridor can hold
   * its journey time and still be late everywhere if it left late.
   */
  meanScheduleDeviationSeconds: number | null;
  p95ScheduleDeviationSeconds: number | null;
  /** Share of buses arriving within `ON_TIME_WINDOW_SECONDS` of their booked time. */
  onTimeRate: number | null;
}

export interface IncidentSummary {
  detected: number;
  byOpeningSeverity: Record<string, number>;
  byPeakSeverity: Record<string, number>;
  /** Opened as a forecast and later measured to be real. The predictive tier earning its place. */
  escalatedFromPrediction: number;
  /**
   * Closed because the gap actually reopened, or because a forecast cleared.
   * The only two closures that are RESOLUTIONS.
   */
  resolved: number;
  /** Closed because a bus left the corridor, so the pair stopped existing. Not a resolution. */
  closedPairGone: number;
  /** Still open when the simulated day ended. Not a resolution either, and never counted as one. */
  unresolvedAtEnd: number;
  /** Median and mean seconds from opening to a real resolution. Null when nothing resolved. */
  medianResolutionSeconds: number | null;
  meanResolutionSeconds: number | null;
  /** Worst h_fwd/H* reached across all incidents. How deep the worst bunch got. */
  worstRatio: number | null;
  /** Incidents where at least one hold was served on the follower while open. */
  withIntervention: number;
  totalHoldSecondsServed: number;
}

/**
 * The whole trade, in one currency: passenger-seconds.
 *
 * ─── WHY THIS AND NOT EXCESS WAIT TIME ───────────────────────────────────
 *
 * EWT measures only the people standing at stops. Holding a bus to fix their
 * spacing is paid for by everyone already ON it, and on a corridor where a bus
 * carries forty-five people and eleven are waiting at the next station, that
 * bill is four times the size of the saving. A controller can therefore improve
 * the headline metric substantially while making passengers collectively worse
 * off, which is not a hypothetical: the first 1,000-bus trial of this corridor
 * cut EWT 44% and raised total passenger time 13%.
 *
 * Both halves are MEASURED from the simulated day rather than estimated from
 * the objective's closed form:
 *
 *   waiting   passengers who boarded arrived uniformly across the gap since
 *             the previous bus, so their mean wait is half that gap. Summed as
 *             `boardings x leaderHeadway / 2` over every stop visit.
 *   onboard   `applied hold x passengers aboard`, over every visit where a
 *             hold was actually served.
 *
 * This is the same quantity `mpc/objective.ts` claims to minimise
 * (`netPassengerSeconds`), computed from the outcome instead of predicted from
 * one decision - so a gap between them is a statement about the objective.
 */
export interface PassengerOutcome {
  boardings: number;
  deniedBoardings: number;
  /** Passenger-seconds spent waiting at stations. */
  waitPassengerSeconds: number;
  /** Passenger-seconds added to people already aboard by holding their bus. Zero on the uncontrolled arm by construction. */
  onboardDelayPassengerSeconds: number;
  /** The sum. Lower is better, and it is the number that decides whether control helped at all. */
  totalPassengerSeconds: number;
}

export interface ArmReport {
  spacing: SpacingKpis;
  punctuality: PunctualityKpis;
  passengers: PassengerOutcome;
  incidents: IncidentSummary;
}

/** How the controlled arm compares with the same day left alone. Positive `Improvement` fields are better. */
export interface ArmContrast {
  /** Seconds per passenger removed from the wait. The headline number. */
  ewtImprovementSeconds: number | null;
  ewtImprovementPercent: number | null;
  cvImprovementPercent: number | null;
  bunchingRateImprovementPercent: number | null;
  /** Incidents that never opened at all because the corridor was controlled. Negative means the controller opened MORE. */
  incidentsAvoided: number;
  /** Seconds of end-to-end journey time added per bus. The price paid, and it should be small. */
  addedJourneySecondsPerVehicle: number | null;
  /** Extra passengers refused a seat under control. Positive is WORSE, and is the number that vetoes a win. */
  additionalDeniedBoardings: number;
  /**
   * Passenger-seconds removed from the network in total: waiting saved less
   * onboard delay imposed. NEGATIVE means the controller cost passengers more
   * time than it saved them, whatever the excess-wait figure says.
   */
  passengerSecondsSaved: number;
  passengerSecondsSavedPercent: number | null;
  /** Passenger-seconds of waiting removed, before the onboard bill is deducted. */
  waitSecondsSaved: number;
  /** Passenger-seconds of onboard delay the holds cost. Always >= 0. */
  onboardDelayImposed: number;
}

export interface TrajectoryPoint {
  /** Simulated seconds since the start of the day. */
  t: number;
  /** Distance along the route, metres. */
  d: number;
  /** Seconds of hold served at this station, if any. */
  hold: number;
}

export interface VehicleTrajectory {
  vehicleId: string;
  points: TrajectoryPoint[];
}

/** One scenario, run in one phase: both arms, their contrast, and bounded evidence. */
export interface ScenarioReport {
  id: BunchingScenarioId;
  title: string;
  mechanism: string;
  whatItTests: string;
  vehicleCount: number;
  seed: number;
  /** Simulated seconds the run covered, end to end. */
  horizonSeconds: number;
  controlled: ArmReport;
  uncontrolled: ArmReport;
  contrast: ArmContrast;
  /** Downsampled corridor-wide headway series, for the day's shape. */
  sweeps: { controlled: SweepSample[]; uncontrolled: SweepSample[] };
  /** A bounded set of buses, as time/distance traces. The picture bunching is actually visible in. */
  trajectories: { controlled: VehicleTrajectory[]; uncontrolled: VehicleTrajectory[] };
  /** The worst incidents this scenario produced under control, deepest first. */
  worstIncidents: DetectedIncident[];
  /** The same, on the arm where nobody intervened. */
  worstIncidentsUncontrolled: DetectedIncident[];
}

/** Whether each deployed law ever ran, and the commonest reason it declined. Coverage is a finding, not a footnote. */
export interface LawCoverage {
  law: ControlLaw;
  decisionsGenerating: number;
  decisionsTotal: number;
  /** The reason that accounted for most of its declines, or null when it never declined. */
  commonestDecline: DeclineReason | null;
  commonestDeclineShare: number | null;
}

export interface PhaseReport {
  id: PhaseId;
  title: string;
  /** What the objective weighed. This IS the difference between the two phases. */
  weighOccupancy: boolean;
  vehicleCount: number;
  scenarios: ScenarioReport[];
  /** Pooled across every scenario in the phase: all headway samples reduced once, never a mean of means. */
  controlled: ArmReport;
  uncontrolled: ArmReport;
  contrast: ArmContrast;
  lawCoverage: LawCoverage[];
  /** Holds served, split by the station they were served at. Where on the route the work happens. */
  holdSecondsByStation: { stopId: string; name: string; sequence: number; holdSeconds: number; holdCount: number }[];
  /** Holds served, split by the law that produced them. */
  holdCountByActionType: { actionType: string; count: number; holdSeconds: number }[];
}

/**
 * What weighing occupancy actually changed, computed rather than asserted.
 *
 * The two phases differ in exactly one input, so a difference between them is
 * attributable to it - and so is the ABSENCE of one, which is the outcome a
 * reader most needs to be told about plainly rather than left to infer from
 * two identical tables.
 */
export interface OccupancyContrast {
  /** Decisions where the two phases selected a different action or a different hold length. */
  decisionsChanged: number;
  decisionsCompared: number;
  /** Mean objective cost the objective charged for a hold, under each setting. */
  meanObjectiveCostBlind: number | null;
  meanObjectiveCostAware: number | null;
  /**
   * Whether the ranking could bite at all: true only if some decision offered
   * the solver more than one SELECTABLE candidate. On this corridor the
   * mid-route laws are mutually exclusive by construction, so a zero here is
   * a structural fact and not evidence that occupancy does not matter.
   */
  rankingComparable: boolean;
  /** One sentence stating what the comparison found, in the terms it was made in. */
  verdict: string;
}

/**
 * One holding-point placement, scored.
 *
 * The corridor's stations are all ELIGIBLE for holding; which of them are
 * DESIGNATED is an operational choice, and it turns out to be the single
 * largest lever in the trial. `mpc/eligibility.ts` already records why -
 * holding at three stops early in a 47-stop route produced route-long benefit
 * in the CTA pilot, while holding everywhere spends driver goodwill where it
 * achieves nothing - and this measures it on this corridor.
 */
export interface HoldingPointStudyRow {
  holdingPointCount: number;
  /** Mean improvement in excess wait across the study's seeds, as a percentage. Higher is better. */
  ewtImprovementPercent: number | null;
  /** Mean effect on TOTAL passenger time. Negative means the controller cost more than it saved. */
  passengerSecondsSavedPercent: number | null;
  meanHoldSecondsPerVehicle: number;
  holdCount: number;
  deniedBoardings: number;
  incidentsDetected: number;
  incidentsResolved: number;
  /**
   * How many seeds this row was averaged over, and how many of them agreed with
   * the sign of the mean.
   *
   * NOT decoration. MEASURED on this corridor, one seed's net passenger-time
   * figure ranges from -6.0% to +3.9% - so a single run's number is nearly
   * meaningless on its own, and a difference between two placements can be
   * entirely seed noise. A gain-tuning result that looked convincing over three
   * seeds (Kb 0.2 -> 0.4, apparently better on both metrics) reversed to a coin
   * flip over ten. Any row whose seeds do not agree should be read as "no
   * effect measured", however large its mean.
   */
  seedCount: number;
  seedsAgreeingWithSign: number;
}

export interface HoldingPointStudy {
  /** Every placement tried, fewest holding points first. */
  rows: HoldingPointStudyRow[];
  /**
   * The placement with the best excess-wait gain among those that did not cost
   * passengers time overall. Null when every placement was net-negative, which
   * is a finding and not a missing value.
   */
  recommendedCount: number | null;
  verdict: string;
  /** Seeds each row was averaged over. One would not be enough - see `seedCount`. */
  seedsPerRow: number;
}

export interface TrialProvenanceEntry {
  field: string;
  source: 'deployed' | 'configured' | 'modelled';
  value: string;
  note: string;
}

export interface FleetTrialReport {
  generatedAt: string;
  durationMs: number;
  /** Which shape this trial ran on. Almost every conclusion depends on it - see `fleetTrial/presets.ts`. */
  corridorPreset: { id: string; title: string; description: string };
  /** Whether an alighting-only proposal was allowed to be ACTED on, or only generated. */
  alightingOnlySelectable: boolean;
  corridor: {
    routeDirectionId: string;
    routeName: string;
    totalDistanceMeters: number;
    stationCount: number;
    /** Every station is a holding point. Stated, because it is the trial's central constraint. */
    holdingPointCount: number;
    targetHeadwaySeconds: number;
    bunchedThresholdRatio: number;
    warningThresholdRatio: number;
    maxHoldSeconds: number;
    kf: number | null;
    kb: number | null;
    selfEqualizingK: number | null;
    stations: { stopId: string; name: string; sequence: number; cumulativeDistanceMeters: number; latitude: number; longitude: number }[];
  };
  /** Total buses simulated across both phases - the trial's headline scale. */
  vehiclesSimulated: number;
  sweepIntervalSeconds: number;
  requiredSamples: number;
  phases: PhaseReport[];
  /** What designating fewer, earlier holding points would do. Measured, not argued. */
  holdingPointStudy: HoldingPointStudy;
  occupancyContrast: OccupancyContrast;
  provenance: TrialProvenanceEntry[];
  /** Parts of the live system this trial does NOT exercise, in words, for the surface to print verbatim. */
  notExercised: string[];
}
