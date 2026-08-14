/**
 * Reading a rehearsal: the two arms, side by side, in the direction a
 * planner cares about.
 *
 * Pure so the judgement "did control help" is testable without a browser,
 * and so it has exactly one owner. Every metric here declares which
 * DIRECTION is an improvement, because four of the six get better by going
 * down and reading a table of raw deltas is how a strategy that made things
 * worse gets presented as a win.
 */
import type { RehearsalKpis, RehearsalResult } from '@/models/rehearsal';

export type MetricDirection = 'lower-is-better' | 'higher-is-better';

export interface ComparedMetric {
  key: string;
  label: string;
  /** What the number means, in a planner's words. Rendered beside it, not in a tooltip. */
  meaning: string;
  direction: MetricDirection;
  uncontrolled: number | null;
  controlled: number | null;
  /** controlled - uncontrolled. Null when either arm could not produce the metric. */
  delta: number | null;
  /** Whether `delta` is an improvement, given `direction`. Null when there is no delta, or the delta is exactly zero. */
  improved: boolean | null;
  format: 'seconds' | 'minutes' | 'count' | 'ratio' | 'percent';
}

function delta(controlled: number | null, uncontrolled: number | null): number | null {
  if (controlled === null || uncontrolled === null) return null;
  return controlled - uncontrolled;
}

function improved(value: number | null, direction: MetricDirection): boolean | null {
  if (value === null || value === 0) return null;
  return direction === 'lower-is-better' ? value < 0 : value > 0;
}

function metric(
  key: string,
  label: string,
  meaning: string,
  direction: MetricDirection,
  format: ComparedMetric['format'],
  pick: (kpis: RehearsalKpis) => number | null,
  uncontrolledKpis: RehearsalKpis,
  controlledKpis: RehearsalKpis,
): ComparedMetric {
  const uncontrolled = pick(uncontrolledKpis);
  const controlled = pick(controlledKpis);
  const d = delta(controlled, uncontrolled);
  return {
    key,
    label,
    meaning,
    direction,
    uncontrolled,
    controlled,
    delta: d,
    improved: improved(d, direction),
    format,
  };
}

export function compareArms(result: RehearsalResult): ComparedMetric[] {
  const a = result.arms.uncontrolled.kpis;
  const b = result.arms.controlled.kpis;

  return [
    metric(
      'headwayCv',
      'Headway irregularity',
      'How unevenly the buses are spaced at the control points. Zero would be a perfect interval; bunching drives it up.',
      'lower-is-better',
      'ratio',
      (k) => k.headwayCv,
      a,
      b,
    ),
    metric(
      'bunchingIncidents',
      'Bunching incidents',
      `Gaps that fell below ${result.policy.bunchedThresholdRatio} of the corridor's own target headway.`,
      'lower-is-better',
      'count',
      (k) => k.bunchingIncidents,
      a,
      b,
    ),
    metric(
      'excessWaitSeconds',
      'Excess passenger wait',
      'Waiting beyond what an even service would have cost, summed across the run.',
      'lower-is-better',
      'minutes',
      (k) => k.excessWaitSeconds,
      a,
      b,
    ),
    metric(
      'deniedBoardings',
      'Passengers left behind',
      'Modelled passengers who could not board because the bus was already full.',
      'lower-is-better',
      'count',
      (k) => k.deniedBoardings,
      a,
      b,
    ),
    metric(
      'meanHeadwaySeconds',
      'Average gap between buses',
      `The corridor's measured target is ${Math.round(result.policy.targetHeadwaySeconds / 60)} minutes.`,
      'lower-is-better',
      'minutes',
      (k) => k.meanHeadwaySeconds,
      a,
      b,
    ),
    metric(
      'totalBoardings',
      'Passengers carried',
      'Modelled boardings across the whole run.',
      'higher-is-better',
      'count',
      (k) => k.totalBoardings,
      a,
      b,
    ),
  ];
}

export type RehearsalVerdict = 'improved' | 'mixed' | 'no-change' | 'worse';

/**
 * One sentence about whether the strategy helped.
 *
 * Deliberately blunt about a null result. A rehearsal whose control arm
 * changed nothing, or made things worse, is a useful answer and the surface
 * must be able to say so - a simulator that can only report success is a
 * demonstration, not a tool.
 */
export function verdict(metrics: readonly ComparedMetric[]): RehearsalVerdict {
  const decided = metrics.filter((m) => m.improved !== null);
  if (decided.length === 0) return 'no-change';
  const better = decided.filter((m) => m.improved === true).length;
  const worse = decided.length - better;
  if (worse === 0) return 'improved';
  if (better === 0) return 'worse';
  return 'mixed';
}

export const VERDICT_SENTENCE: Record<RehearsalVerdict, string> = {
  improved:
    'On this corridor, with these made-up conditions, the automatic spacing rules improved every measure.',
  mixed:
    'On this corridor, with these made-up conditions, the automatic spacing rules improved some measures and worsened others.',
  'no-change':
    'On this corridor, with these made-up conditions, the automatic spacing rules changed nothing measurable.',
  worse:
    'On this corridor, with these made-up conditions, the automatic spacing rules made every measure worse.',
};

/** How each action type reads in a decision log. */
export const ACTION_TYPE_LABEL: Record<string, string> = {
  no_control: 'No action',
  two_way_hold: 'Two-way hold',
  self_equalizing_hold: 'Self-equalizing hold',
  terminal_dispatch_hold: 'Terminal dispatch hold',
};

/** Why the hard safety filter refused a proposed hold, in words. */
export const REJECTION_REASON_LABEL: Record<string, string> = {
  stale_state: 'the bus’s position was too old to act on',
  max_hold_cap_breach: 'the hold exceeded the corridor’s maximum',
  conflicting_active_command: 'that bus already had an instruction outstanding',
};

/** Counts of what the control law decided, for a one-line summary above the log. */
export function summariseDecisions(
  result: RehearsalResult,
): { actionType: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const decision of result.decisions) {
    counts.set(decision.selectedActionType, (counts.get(decision.selectedActionType) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([actionType, count]) => ({ actionType, count }))
    .sort((x, y) => y.count - x.count || x.actionType.localeCompare(y.actionType));
}
