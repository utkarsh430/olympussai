import { ratio } from '../stats/robust';
import type { DepotSummary } from '../types';
import type { DeiComponentKey, ScoreWindow } from './types';
import { MS_PER_MINUTE } from '@/lib/depot/units';

/*
 * The pure half of the rolling score window. One snapshot of a
 * live feed is a noisy sample of a depot's rates: over seven snapshots 40 s
 * apart the index moved by a median of 2.8 points and ranks by 3 places. The
 * index is therefore scored on each depot's counts SUMMED over the snapshots
 * of the last SCORE_WINDOW_MIN minutes, as ratios of sums. Nothing here holds
 * state or reads a clock: every age is measured against the feed time passed in.
 */

/** How far back, by the feed's own clock, a sample still counts. */
export const SCORE_WINDOW_MIN = 20;
/** Hard bound on a depot's samples, whatever the feed's cadence (15 s gives 80). */
export const SCORE_WINDOW_MAX_SAMPLES = 120;

const WINDOW_MS = SCORE_WINDOW_MIN * MS_PER_MINUTE;

/** The raw counts the five components are ratios of. */
export interface ComponentCounts {
  readonly fleet: number;
  /** In service or on the road. */
  readonly onRoad: number;
  readonly offRoad: number;
  readonly dark: number;
  /** Carrying a route name. */
  readonly assigned: number;
  /** Main power off, plus tamper flagged. */
  readonly deviceFaults: number;
}

/** One depot on one snapshot. */
export interface DepotSample {
  readonly feedNow: string;
  readonly feedMs: number;
  readonly counts: ComponentCounts;
}

export type ComponentValues = Record<DeiComponentKey, number | null>;

const NO_COUNTS: ComponentCounts = {
  fleet: 0,
  onRoad: 0,
  offRoad: 0,
  dark: 0,
  assigned: 0,
  deviceFaults: 0,
};

export function countsOf(depot: DepotSummary): ComponentCounts {
  const { fleet, states } = depot;
  return {
    fleet,
    onRoad: states.inService + states.onRoad,
    offRoad: states.offRoad,
    dark: states.dark,
    assigned: depot.assigned,
    deviceFaults: depot.powerCut + depot.tamperFlagged,
  };
}

/** Rates in 0..1. A null means the denominator was zero, not that the rate is bad. */
export function valuesOfCounts(counts: ComponentCounts): ComponentValues {
  const health = ratio(counts.deviceFaults, counts.fleet);
  return {
    onRoad: ratio(counts.onRoad, counts.fleet - counts.offRoad),
    offRoad: ratio(counts.offRoad, counts.fleet),
    dark: ratio(counts.dark, counts.fleet),
    scheduled: ratio(counts.assigned, counts.fleet),
    deviceHealth: health === null ? null : Math.max(0, 1 - health),
  };
}

export function sumCounts(samples: readonly DepotSample[]): ComponentCounts {
  return samples.reduce<ComponentCounts>(
    (sum, { counts }) => ({
      fleet: sum.fleet + counts.fleet,
      onRoad: sum.onRoad + counts.onRoad,
      offRoad: sum.offRoad + counts.offRoad,
      dark: sum.dark + counts.dark,
      assigned: sum.assigned + counts.assigned,
      deviceFaults: sum.deviceFaults + counts.deviceFaults,
    }),
    NO_COUNTS,
  );
}

/**
 * The samples still inside the window at `feedMs`: no older than the window,
 * none from after `feedMs`, and at most the newest SCORE_WINDOW_MAX_SAMPLES.
 */
export function pruneSamples(
  samples: readonly DepotSample[],
  feedMs: number,
): readonly DepotSample[] {
  const kept = samples.filter((s) => s.feedMs <= feedMs && feedMs - s.feedMs <= WINDOW_MS);
  return kept.slice(Math.max(0, kept.length - SCORE_WINDOW_MAX_SAMPLES));
}

/**
 * The list after seeing `sample`: inserted in feed-time order,
 * replacing a sample with the same feed time (a re-fetch with new rows), then
 * pruned at the newest feed time held. For samples within one window of one
 * another the result depends only on which were seen, not on their order;
 * the holder (windowStore.ts) states what is not order-free across that.
 */
export function insertSample(
  samples: readonly DepotSample[],
  sample: DepotSample,
): readonly DepotSample[] {
  const others = samples.filter((s) => s.feedMs !== sample.feedMs);
  const ordered = [...others, sample].sort((a, b) => a.feedMs - b.feedMs);
  const newestMs = ordered[ordered.length - 1]?.feedMs ?? sample.feedMs;
  return pruneSamples(ordered, newestMs);
}

/** A depot's component values over its samples: ratios of summed counts. */
export function windowedValues(samples: readonly DepotSample[]): ComponentValues {
  return valuesOfCounts(sumCounts(samples));
}

/**
 * The window a figure was computed over, for the screen to state. `coveredMin`
 * is the whole minutes from the first sample to the last: what the figure
 * actually spans, where `lengthMin` is only the configured length.
 */
export function windowOf(samples: readonly DepotSample[]): ScoreWindow {
  const first = samples[0];
  const last = samples[samples.length - 1];
  return {
    lengthMin: SCORE_WINDOW_MIN,
    since: first?.feedNow ?? null,
    samples: samples.length,
    coveredMin: first && last ? Math.floor((last.feedMs - first.feedMs) / MS_PER_MINUTE) : 0,
  };
}
