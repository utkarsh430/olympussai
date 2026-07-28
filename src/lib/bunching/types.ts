/**
 * Bus-bunching simulator — domain types.
 *
 * The corridor is modelled as a chain of four services:
 *
 *     A → B → C → D          (A is the leading bus)
 *
 * with three headways between them: H_AB, H_BC, H_CD. Everything the page
 * displays is derived from that three-number state vector plus the per-bus time
 * perturbations applied to it, so a single source of truth drives the maps, the
 * metrics, the AI panel and the calculation drawer.
 *
 * Nothing here touches live UPSRTC data. The shape of `LiveBusSample` documents
 * the interface a future GPS ingestion layer would satisfy (Section 52).
 */

export const BUS_IDS = ['A', 'B', 'C', 'D'] as const;
export type BusId = (typeof BUS_IDS)[number];

/** `[H_AB, H_BC, H_CD]` in minutes. Index 0 is the gap behind the lead bus. */
export type HeadwayVector = readonly [number, number, number];

/** Display labels for the three headways, in vector order. */
export const HEADWAY_LABELS = ['A–B', 'B–C', 'C–D'] as const;

/**
 * Minutes added to (or removed from) each bus's running time during one
 * iteration. Positive = the bus loses time (dwells longer / is held);
 * negative = the bus gains time (runs light, or is paced forward).
 *
 * Both natural dynamics and control actions are expressed in these units,
 * which is what lets a single update equation cover both.
 */
export type BusDeltas = Readonly<Record<BusId, number>>;

/** Fractional progress along the route polyline, 0 = origin, 1 = destination. */
export type BusProgress = Readonly<Record<BusId, number>>;

/** The two simulations compared side by side. Only the control policy differs. */
export type Policy = 'withoutAI' | 'withAI';

/** What a recommendation asks a driver to do. */
export type ControlKind = 'none' | 'hold' | 'pace';

export type BunchingStatus = 'stable' | 'watch' | 'bunching-risk' | 'bunched' | 'recovering';

export type HeadwayTrend = 'improving' | 'deteriorating' | 'flat';

/** Every metric shown for a policy at a given iteration. All derived. */
export interface HeadwayMetrics {
  headways: HeadwayVector;
  /** Arithmetic mean of the three headways. */
  mean: number;
  /** Mean absolute deviation from the target headway. */
  mae: number;
  /** Demo regularity score, 0–100. */
  regularity: number;
  /** Population variance of the three headways. */
  variance: number;
  /** Random-arrival passenger waiting proxy, Σh² / 2Σh. */
  waitProxy: number;
  minHeadway: number;
  maxHeadway: number;
}

/** One recommendation line in the AI decision panel. */
export interface BusControl {
  bus: BusId;
  /** Signed minutes: positive holds the bus, negative is a pacing advisory. */
  minutes: number;
  kind: ControlKind;
  /** False when the scenario says UPSRTC cannot influence this bus. */
  controllable: boolean;
  /** True when the solver's preferred value hit the per-iteration cap. */
  capped: boolean;
}

/**
 * The counterfactual that justifies coordinated control: what a single,
 * isolated hold on one bus would do to the headway *behind* it.
 */
export interface IsolatedHoldCheck {
  /** The bus that would be held. */
  bus: BusId;
  /** Hold needed to bring its forward headway to target on its own. */
  holdMinutes: number;
  forwardHeadwayIndex: number;
  forwardAfter: number;
  /** Null when the held bus is the last in the chain (no backward headway). */
  backwardBefore: number | null;
  backwardAfter: number | null;
  breachesSafety: boolean;
}

/** The full output of one controller pass. */
export interface InterventionPlan {
  /** Where the controller is steering this iteration (partial correction). */
  aim: HeadwayVector;
  /** Headways next iteration if nothing is done. */
  predictedFree: HeadwayVector;
  /** Headways next iteration with the recommendation applied. */
  predictedControlled: HeadwayVector;
  controls: BusDeltas;
  controlList: readonly BusControl[];
  totalHoldMinutes: number;
  isolated: IsolatedHoldCheck | null;
  /** True when every projected headway clears the safety floor. */
  safetyFloorRespected: boolean;
  /** True when the plan was scaled back to clear the safety floor. */
  scaledForSafety: boolean;
  /** Generated explanation lines — derived from the numbers above. */
  reasons: readonly string[];
}

/** The "SYSTEM OBSERVATION" card on the uncontrolled side. */
export interface ObservationInsight {
  trends: readonly [HeadwayTrend, HeadwayTrend, HeadwayTrend];
  /** Index of the tightest headway — the one that will bunch first. */
  worstIndex: number;
  /** Change per iteration of the tightest headway (negative = closing). */
  closingRatePerIteration: number;
  /** Iterations until the corridor is classified bunched; null if not heading there. */
  iterationsToBunching: number | null;
  predictedFree: HeadwayVector;
  headline: string;
  result: string;
}

export type IncidentKind =
  | 'congestion'
  | 'surge'
  | 'fast-follower'
  | 'terminal'
  | 'stationary'
  | 'cluster';

/** Scenario overlay drawn on both maps. */
export interface ScenarioIncident {
  kind: IncidentKind;
  /** Short label rendered on the map marker. */
  mapLabel: string;
  /** Bus the incident is attached to, if any. */
  anchorBus: BusId | null;
  /** Route stop index the incident is attached to, if any. */
  anchorStopIndex: number | null;
  /** Last iteration at which the disturbance is still active. */
  activeUntilIteration: number;
}

/** Per-iteration incident state, derived from the scenario + iteration index. */
export interface IncidentState {
  kind: IncidentKind;
  label: string;
  /** Bus the overlay is attached to, carried through from the scenario. */
  anchorBus: BusId | null;
  /** Route stop index the overlay is attached to, carried through likewise. */
  anchorStopIndex: number | null;
  active: boolean;
  /** True once the original cause has gone away. */
  cleared: boolean;
  /** True while an unresolved stationary event exceeds the escalation threshold. */
  escalated: boolean;
  /** Consecutive iterations the anchor bus has been abnormally delayed. */
  stalledIterations: number;
}

/** One fully-resolved simulation step for one policy. */
export interface SimulationIteration {
  index: number;
  /** Simulated minutes since the comparison started. */
  simMinutes: number;
  headways: HeadwayVector;
  metrics: HeadwayMetrics;
  status: BunchingStatus;
  /** Narrative phase label for the timeline. */
  phase: string;
  /** Exogenous + feedback minutes applied to reach the next iteration. */
  natural: BusDeltas;
  /** Control minutes applied to reach the next iteration (zero without AI). */
  controls: BusDeltas;
  /** Next headways with no control — the "if nothing is done" projection. */
  predictedFree: HeadwayVector;
  /** Next headways actually reached; null on the final iteration. */
  nextHeadways: HeadwayVector | null;
  /** True when the overtaking floor had to be applied to reach this state. */
  clampApplied: boolean;
  progress: BusProgress;
  occupancy: Readonly<Record<BusId, number>> | null;
  plan: InterventionPlan | null;
  observation: ObservationInsight | null;
  /** Percentage of the initial headway error recovered; AI side only. */
  recoveryProgress: number | null;
  incident: IncidentState;
  /** Terminal release times, for the late-departure scenario. */
  dispatch: readonly TerminalDispatch[] | null;
}

export interface TerminalDispatch {
  bus: BusId;
  scheduled: string;
  actual: string;
  offsetMinutes: number;
}

export interface PolicyRun {
  policy: Policy;
  iterations: readonly SimulationIteration[];
}

export interface SimulationRun {
  scenarioId: ScenarioId;
  withoutAI: PolicyRun;
  withAI: PolicyRun;
}

export type ScenarioId =
  | 'traffic-shock'
  | 'passenger-surge'
  | 'fast-follower'
  | 'late-departure'
  | 'temporary-stoppage'
  | 'multi-bus-bunch';

/** A labelled figure shown alongside a scenario (expected vs observed). */
export interface ScenarioFigure {
  label: string;
  expected?: string;
  observed: string;
}

/**
 * Declarative scenario configuration. A scenario supplies the initial state,
 * the exogenous disturbance and the narrative — never the resulting headway
 * numbers, which are always computed by the engine.
 */
export interface ScenarioDefinition {
  id: ScenarioId;
  /** Two-digit selector number, e.g. "01". */
  number: string;
  /** Short selector title, e.g. "Traffic Shock". */
  name: string;
  /** One-line cause description for the selector card. */
  cause: string;
  /** Full simulator title, e.g. "Traffic Shock → Headway Compression". */
  title: string;
  description: string;
  /** Number of iterations, including iteration 0. */
  iterations: number;
  initialHeadways: HeadwayVector;
  /**
   * Exogenous per-bus minutes for each iteration, indexed by iteration. This is
   * the disturbance itself — identical on both sides of the comparison.
   */
  disturbance: readonly BusDeltas[];
  /** Buses UPSRTC can influence in this scenario. */
  controllable: Readonly<Record<BusId, boolean>>;
  incident: ScenarioIncident;
  /** Per-iteration passenger-load display, when relevant to the narrative. */
  occupancyBase: Readonly<Record<BusId, number>> | null;
  /** Scheduled terminal departures, when relevant to the narrative. */
  terminalSchedule: Readonly<Record<BusId, string>> | null;
  figures: readonly ScenarioFigure[];
  narrative: {
    whatHappened: string;
    whyAmplifies: string;
    whatAiDoes: string;
  };
}

/**
 * Shape a live GPS ingestion layer would provide per vehicle (Section 52).
 * Documented now, deliberately unused: this page runs entirely on local
 * scenario data and makes no backend calls.
 */
export interface LiveBusSample {
  busId: string;
  latitude: number;
  longitude: number;
  speed: number;
  occupancy: number;
  dwellTime: number;
  routeProgress: number;
  timestamp: string;
}
