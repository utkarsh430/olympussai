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
  /** Refusal EVENTS: a passenger turned away by three buses in a row is three of these. */
  deniedBoardings: number;
  /** People refused for the first time - a headcount, and what `saturated` is drawn on. */
  firstTimeDeniedBoardings: number;
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
  /**
   * Share of buses already later than `max_lateness_seconds` against their
   * booked time, before any hold. Null when the corridor sets no bound.
   *
   * This is what `scheduleFit` is actually asking. A bound that bites on a few
   * genuinely late buses is the guardrail working; one that has already
   * refused most of the fleet before the controller has done anything has
   * switched the controller off for a reason about the timetable.
   */
  shareBeyondLatenessBound: number | null;
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
 * ─── AND WHY IT IS THE WHOLE JOURNEY, NOT WAIT PLUS HOLD ─────────────────
 *
 * This counted waiting time plus the seconds a HOLD added, and nothing else -
 * so the only in-vehicle time in it was the part control makes worse. Every
 * second a passenger spent riding or standing at a door was outside the
 * metric, and those move too: passenger-weighted dwell is worst in a bunch
 * (one full bus doing a long door cycle beside one empty bus doing a short
 * one) and falls when spacing evens out, and a bus clamped behind the one in
 * front rides slower than one that is not. MEASURED on the urban corridor at
 * six seeds, control added 18.0 s of hold per boarding and gave back 11.3 s
 * of dwell and running time - 63% of the bill, in a term the headline could
 * not see. A metric named "total passenger time" that a controller could
 * improve by making every bus slower between stops is not measuring what its
 * name says.
 *
 * Every second from arriving at a stop to alighting is counted exactly once:
 *
 *   waiting   kerb time before the bus arrives, plus - for somebody who walks
 *             on while it is standing there - the time from walking on until
 *             it leaves. From the engine, which is the only thing that knows
 *             those two populations apart.
 *   dwell     the ordinary door cycle, charged to everybody aboard when the
 *             doors opened plus whoever boarded from the queue.
 *   onboard   the same population through a HOLD. Zero on the uncontrolled
 *             arm by construction, which is why it is kept separate: it is
 *             the price of control, reported as such.
 *   riding    between stops, at the load the bus pulled away with.
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
  /** Passenger-seconds spent aboard through ordinary door cycles. */
  dwellPassengerSeconds: number;
  /** Passenger-seconds spent riding between stations. */
  ridePassengerSeconds: number;
  /** Dwell plus hold plus riding: everything spent aboard. */
  inVehiclePassengerSeconds: number;
  /** Waiting plus in-vehicle. Lower is better, and it is the number that decides whether control helped at all. */
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
   * Passenger-seconds removed from the network in total: waiting saved plus
   * in-vehicle time saved. NEGATIVE means the controller cost passengers more
   * time than it saved them, whatever the excess-wait figure says.
   */
  passengerSecondsSaved: number;
  /**
   * The same figure as a share of the uncontrolled arm's WHOLE passenger-time
   * bill - waiting plus every second spent aboard.
   *
   * The denominator used to be waiting time plus holds, which on the
   * uncontrolled arm (no holds) is waiting time alone. So a saving worth 3% of
   * what passengers actually spend was reported as 12%, and the same
   * inflation - between four and seven times, depending on the corridor -
   * applied to every negative result too.
   */
  passengerSecondsSavedPercent: number | null;
  /** Passenger-seconds of waiting removed, before the in-vehicle bill is settled. */
  waitSecondsSaved: number;
  /** Passenger-seconds of onboard delay the holds cost. Always >= 0. */
  onboardDelayImposed: number;
  /**
   * Total passenger time per BOARDING, saved, as a percentage.
   *
   * ─── WHY A SECOND DENOMINATOR ────────────────────────────────────────
   *
   * The two arms do not serve the same passengers. Demand is not an exogenous
   * stream here: a stop's queue is drawn from the clock its buses actually
   * sweep, so the arm whose buses stand longer and finish later has more
   * passengers created for it. MEASURED: the controlled arm sweeps ~0.8% more
   * stop-clock and serves 0.4-1.3% more people, and `passengerSecondsSaved`
   * is an absolute sum - so part of what reads as a cost of control is simply
   * control carrying more passengers.
   *
   * That is worth something and worth reporting, which is why the absolute
   * figure stays. But it is not the same question as "is a passenger better
   * off", and on the corridors where the totals are close the two answers can
   * differ in SIGN. Per boarding is the population-controlled comparison and
   * belongs beside the total, not instead of it.
   */
  passengerSecondsPerBoardingSavedPercent: number | null;
  /**
   * Net passenger-seconds of IN-VEHICLE time removed: dwell, riding and holds
   * together. Positive means control gave time back to the people aboard.
   *
   * Not the same thing as `-onboardDelayImposed`, and the difference is the
   * point. A hold is the only in-vehicle term that gets worse; the other two
   * get better, because passenger-weighted dwell is worst in a bunch and a bus
   * clamped behind another rides slower than one that is not. Reporting the
   * hold alone reports one side of a trade whose other side is comparable in
   * size and sometimes larger.
   */
  inVehicleSecondsSaved: number;
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
  /**
   * Every time the hard safety filter threw a candidate out, and why.
   *
   * The guardrails doing their job is half the story of what the controller
   * did, and it was the invisible half. MEASURED on the urban corridor:
   * `max_lateness_breach` refuses about three quarters as many holds as are
   * issued - the punctuality bound is not a rare backstop, it is a continuous
   * part of the control loop, and a reader who cannot see it cannot tell a
   * controller that declined to act from one that was stopped.
   */
  safetyRejections: { reason: string; count: number }[];
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
 * One setting of one policy knob, scored against the same seeded days as the
 * others in its study.
 *
 * ─── WHY THESE ARE MEASURED PER CORRIDOR AND NOT FIXED ───────────────────
 *
 * Every one of these is a `route_policies` column, and the trial found the hard
 * way that a value fitted on one corridor can be actively harmful on another.
 * `max_lateness_seconds` at 300 s improved the inter-city corridor on eight
 * seeds out of eight; the same guardrail at 120 s on the urban corridor cost
 * SIXTEEN POINTS of total passenger time and nearly tripled the number of
 * passengers denied a seat. Holding points run the opposite way too: fewer is
 * better inter-city, more is better urban.
 *
 * So the trial reports the sweep rather than baking in a winner, and each
 * corridor's own configuration is set from its own row.
 */
export interface PolicyStudyRow {
  /** The setting, as it would be written in configuration. */
  label: string;
  /** Mean improvement in excess wait across the study's seeds. Higher is better. */
  ewtImprovementPercent: number | null;
  /** Mean effect on TOTAL passenger time. Negative means the controller cost more than it saved. */
  passengerSecondsSavedPercent: number | null;
  meanHoldSecondsPerVehicle: number;
  /** The worst-affected single bus, seconds of hold. The user-visible bound on "not very large". */
  worstBusHoldSeconds: number;
  holdCount: number;
  deniedBoardings: number;
  incidentsDetected: number;
  incidentsResolved: number;
  /** See `seedsAgreeingWithSign` - a mean whose seeds disagree is no measured effect. */
  seedCount: number;
  seedsAgreeingWithSign: number;
  /** True when this row is the corridor's currently-configured value. */
  isCurrent: boolean;
}

export interface PolicyStudy {
  /** Which `route_policies` column this sweeps. */
  knob: string;
  title: string;
  description: string;
  rows: PolicyStudyRow[];
  /**
   * The setting with the best excess-wait gain among those that did not cost
   * passengers time overall and whose seeds agreed. Null when none qualified,
   * which is a finding rather than a missing value.
   */
  recommended: string | null;
  verdict: string;
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
  /**
   * How disturbed this corridor is between chances to correct it, and what
   * that implies for how much good control can do.
   *
   * ─── THE ONE NUMBER THAT PREDICTS THE RESULT ─────────────────────────
   *
   * MEASURED by varying one corridor property at a time from the urban shape -
   * headway, stop count, and route length independently - and it is neither
   * headway nor fleet size nor the ratio of passengers aboard to passengers
   * waiting. Those three sweeps collapse onto a single quantity: the standard
   * deviation of ONE LEG's running time, as a fraction of the target headway.
   *
   *   sigma / H*    0.02   0.03   0.05   0.10   0.16   0.24   0.30   0.48
   *   EWT gain       14%    41%    59%    59%    40%    22%    13%     7%
   *
   * An inverted U peaking around 0.05-0.10. Below the band the corridor barely
   * comes apart and there is little for a controller to recover; above it, more
   * deviation accumulates between two stops than a hold at either can remove,
   * and both arms come apart together. This is the same effect that made the
   * inter-city corridor unusable at a 900 s headway - see `corridor.ts`.
   */
  controllability: {
    /** Standard deviation of one leg's running time, seconds. */
    legTimeSigmaSeconds: number;
    /** That sigma as a fraction of the target headway. The predictor. */
    disturbanceRatio: number;
    /** Where this corridor sits: below the band, in it, or above it. */
    band: 'too_regular' | 'controllable' | 'too_disturbed';
    /** One sentence saying what the band implies, for the surface to print. */
    note: string;
  };
  /**
   * Whether the corridor's timetable is one its buses can actually keep, and
   * what that does to the controller.
   *
   * ─── AN UNACHIEVABLE SCHEDULE SWITCHES THE CONTROLLER OFF ────────────
   *
   * `mpc/safety.ts` refuses a hold that would push a bus past
   * `route_policies.max_lateness_seconds`. If the published schedule is tighter
   * than the corridor can run, EVERY bus is already late and therefore EVERY
   * hold breaches the bound - silently, with no rejection an operator would
   * think to look at, because "the bus is late" is not obviously a reason the
   * controller has stopped working.
   *
   * MEASURED on the urban corridor by tightening the booked running time 15%:
   * the excess-wait improvement fell from 52.9% to 19.4% and holding from 183 s
   * per bus to 31 s. The control laws were unchanged; the timetable had turned
   * them off.
   *
   * The deviation reported here is from the UNCONTROLLED arm, which is the only
   * one that measures the schedule rather than the schedule plus the holds.
   */
  scheduleFit: {
    /** Mean lateness at the terminus with no control at all, seconds. Negative = early. */
    meanUncontrolledDeviationSeconds: number | null;
    /** As a fraction of the target headway, which is the scale that decides whether the bound bites. */
    deviationRatio: number | null;
    /**
     * Share of uncontrolled buses already past `max_lateness_seconds`, which
     * is what the band is actually decided on. Null when no bound is set.
     *
     * The mean above cannot decide it: the trial books the timetable from the
     * uncontrolled arm's own mean arrival, so that arm's mean deviation
     * against it is exactly zero and always was.
     */
    shareBeyondLatenessBound: number | null;
    band: 'tight' | 'achievable' | 'slack';
    note: string;
  };
  /** Total buses simulated across both phases - the trial's headline scale. */
  vehiclesSimulated: number;
  sweepIntervalSeconds: number;
  requiredSamples: number;
  phases: PhaseReport[];
  /**
   * What the corridor's own policy knobs are worth, swept on this corridor.
   * Never a value carried over from another shape - see `PolicyStudyRow`.
   */
  policyStudies: PolicyStudy[];
  occupancyContrast: OccupancyContrast;
  provenance: TrialProvenanceEntry[];
  /** Parts of the live system this trial does NOT exercise, in words, for the surface to print verbatim. */
  notExercised: string[];
}
