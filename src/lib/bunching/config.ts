/**
 * Bus-bunching simulator — every tunable constant in one place.
 *
 * These are demonstration parameters, not UPSRTC operating standards. They live
 * here (rather than scattered through components) precisely so the behaviour of
 * the demo can be adjusted without hunting for magic numbers.
 */

import type { BunchingStatus, BusId } from './types';

// ── Service design ─────────────────────────────────────────────────────────

/** Demo target headway, in minutes. The whole page is scored against this. */
export const TARGET_HEADWAY_MINUTES = 10;

/** Simulated minutes advanced per iteration — one control cycle. */
export const SIM_MINUTES_PER_ITERATION = 5;

/** Nominal end-to-end running time of the simulated corridor, in minutes. */
export const ROUTE_NOMINAL_DURATION_MINUTES = 60;

/**
 * Where the lead bus sits along the route at iteration 0. Chosen so that even
 * the widest scenario (a 24-minute trailing gap) keeps all four buses on the
 * drawn polyline for the full run.
 */
export const LEAD_START_PROGRESS = 0.48;

// ── Playback ───────────────────────────────────────────────────────────────

/** Automatic advance interval. Slow enough to read each control action. */
export const ITERATION_PLAYBACK_MS = 1800;

/** Marker travel time between two iterations' positions. */
export const MARKER_TRANSITION_MS = 900;

// ── Natural corridor dynamics ──────────────────────────────────────────────

/**
 * Dwell-time feedback gain, the mechanism that makes bunching self-reinforcing.
 *
 * A bus with a larger-than-target gap ahead of it collects more waiting
 * passengers, dwells longer and loses time; a bus running close behind its
 * leader finds fewer passengers, dwells less and closes the gap further. So the
 * time a bus loses in one iteration is proportional to the deviation of the
 * headway *ahead* of it from target:
 *
 *     delta_i = FEEDBACK_GAIN × (H_ahead(i) − TARGET)
 */
export const HEADWAY_FEEDBACK_GAIN = 0.35;

/** Cap on the feedback term per bus per iteration, so it stays plausible. */
export const FEEDBACK_MAX_DELTA_MINUTES = 0.8;

/**
 * Buses cannot overtake each other on a shared corridor, so a headway can never
 * collapse past this floor — it is what makes a bunch persist rather than invert.
 */
export const MIN_PHYSICAL_HEADWAY_MINUTES = 0.4;

// ── Controller ─────────────────────────────────────────────────────────────

/**
 * Fraction of the remaining headway error the controller aims to remove in one
 * iteration. Below 1 by design: recovery must be visibly progressive, never a
 * single corrective jump.
 */
export const CONTROL_GAIN = 0.55;

/**
 * Weight on total intervention effort in the controller's objective. Larger
 * values make the controller more reluctant to hold buses that are not yet in
 * trouble, which is what produces the temporary B–C compression the demo
 * explains rather than hides.
 */
export const CONTROL_EFFORT_WEIGHT = 0.1;

/** Largest hold the controller will recommend for one bus in one iteration. */
export const MAX_HOLD_MINUTES = 5;

/**
 * Largest pacing advisory (time a bus may recover) per iteration. Small: this
 * is a "maintain progression" instruction, not a licence to speed.
 */
export const MAX_PACING_MINUTES = 1;

/** Recommendations are quantised to 15-second steps for realistic instructions. */
export const CONTROL_QUANTUM_MINUTES = 0.25;

/**
 * A recommendation must never drive a projected headway below this floor —
 * doing so would simply move the bunch one position down the chain.
 */
export const MIN_SAFE_HEADWAY_MINUTES = 4;

/** Coordinate-descent sweeps for the constrained least-squares solve. */
export const SOLVER_SWEEPS = 120;

/** Consecutive stalled iterations before incident escalation is recommended. */
export const INCIDENT_ESCALATION_ITERATIONS = 2;

/** Exogenous delay above which a bus counts as abnormally stalled, in minutes. */
export const STALLED_DELAY_THRESHOLD_MINUTES = 1;

// ── Passenger load model ───────────────────────────────────────────────────

/**
 * Occupancy tracks the headway in front of a bus: a bus with a larger gap ahead
 * of it sweeps up more waiting passengers. Percentage points per minute of
 * headway deviation.
 */
export const OCCUPANCY_HEADWAY_SLOPE = 1;

/** Percentage points the lead bus gains per minute of accumulated lateness. */
export const OCCUPANCY_DELAY_SLOPE = 8;

// ── Status classification ──────────────────────────────────────────────────

/**
 * Demo thresholds for the corridor status badge, evaluated in order:
 * bunched → bunching risk → (recovering) → watch → stable.
 *
 * Classification is driven primarily by the minimum headway (how close the
 * nearest pair of buses is) and secondarily by mean absolute headway error.
 */
export const STATUS_THRESHOLDS = {
  /** Minimum headway at or below which the corridor counts as bunched. */
  bunchedMinHeadway: 3,
  /** Minimum headway at or below which bunching is imminent. */
  riskMinHeadway: 6,
  /** Mean absolute error at or below which the corridor counts as stable. */
  stableMae: 0.6,
  /** Minimum headway required to count as stable. */
  stableMinHeadway: 8.5,
  /** MAE improvement per iteration that counts as active recovery. */
  recoveringMaeDelta: 0.05,
} as const;

export const STATUS_META: Record<
  BunchingStatus,
  { label: string; tone: 'green' | 'teal' | 'amber' | 'crimson'; description: string }
> = {
  stable: {
    label: 'STABLE',
    tone: 'green',
    description: 'Headways are close to the demo target across the corridor.',
  },
  watch: {
    label: 'WATCH',
    tone: 'amber',
    description: 'Moderate deviation from target headway — monitor the corridor.',
  },
  'bunching-risk': {
    label: 'BUNCHING RISK',
    tone: 'amber',
    description: 'Minimum headway is approaching the bunching threshold.',
  },
  bunched: {
    label: 'BUNCHED',
    tone: 'crimson',
    description: 'Services are clustered — effective frequency has collapsed.',
  },
  recovering: {
    label: 'RECOVERING',
    tone: 'teal',
    description: 'Coordinated control is active and headway error is falling.',
  },
};

// ── Presentation ───────────────────────────────────────────────────────────

/** Marker colours per bus. Distinct, but drawn from the dashboard HUD palette. */
export const BUS_COLORS: Readonly<Record<BusId, string>> = {
  A: '#3ff0ff',
  B: '#2ef2c4',
  C: '#ffb020',
  D: '#c69bff',
};

/** Narrative phases for the uncontrolled corridor (Section 40). */
export const PHASES_WITHOUT_AI = [
  'Disturbance',
  'Propagation',
  'Headway Compression',
  'Bunching',
  'Large Gap',
  'Persistent Instability',
] as const;

/** Narrative phases for the controlled corridor (Section 40). */
export const PHASES_WITH_AI = [
  'Disturbance',
  'Detection',
  'Prediction',
  'Intervention',
  'Recovery',
  'Stable',
] as const;

/** The decision pipeline strip at the foot of the page (Section 50). */
export const AI_PIPELINE_STAGES = [
  'GPS / Bus State',
  'Headway Calculation',
  'Bunching Prediction',
  'Intervention Simulation',
  'Coordinated Recommendation',
  'Recalculate',
  'Recovery',
] as const;
