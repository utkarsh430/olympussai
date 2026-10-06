import type { Yard } from '../infer/types';
import type { DepotBalance } from '../optimise/types';
import { DEFAULT_REQUIREMENT_PARAMS } from '../sim/config';
import { modelBalances, type PeakFloors, type WindowedOnRoadShares } from '../sim/requirement';
import type { DepotSummary } from '../types';
import type { SnapshotAnalysis } from './analysis';
import { holdPeakRequirements, type PeakRequirementStore } from './peakRequirementHold';

/*
 * The modelled requirement of one snapshot, for its own operating date, built
 * once when the snapshot is first analysed: each depot's peak floored by the
 * highest peak computed for it earlier in the date (`peakRequirementHold.ts`).
 * The operating day and the distribution view both read these balances, so
 * they rest on one requirement and the holder is offered each snapshot once.
 */

export interface HeldRequirement {
  /** The operating date the balances were modelled for: the snapshot's feed date. */
  readonly operatingDate: string;
  readonly balances: readonly DepotBalance[];
}

export interface HeldRequirementInput {
  readonly depots: readonly DepotSummary[];
  readonly yards: ReadonlyMap<string, Yard>;
  readonly shares: WindowedOnRoadShares;
  /** The snapshot's operating date; null when it has none. */
  readonly operatingDate: string | null;
  /** Absent (the recorded fixture, or a caller with no holder): no floors are read or kept. */
  readonly store: PeakRequirementStore | undefined;
}

function computedPeaks(balances: readonly DepotBalance[]): ReadonlyMap<string, number> {
  // Only a modelled peak is held: a unit that is not a depot "needs" what it has.
  return new Map(
    balances.flatMap((b) =>
      b.kind === 'depot' && b.available > 0 ? [[b.depotId, b.peakRequirement] as const] : [],
    ),
  );
}

/** Offers this snapshot's computed peaks to the holder, once; null when the snapshot has no date. */
export function holdRequirement(input: HeldRequirementInput): HeldRequirement | null {
  const { depots, yards, shares, operatingDate, store } = input;
  if (operatingDate === null) return null;
  const model = (floors?: PeakFloors): DepotBalance[] =>
    modelBalances(depots, yards, operatingDate, DEFAULT_REQUIREMENT_PARAMS, shares, floors);
  const computed = model();
  if (store === undefined) return { operatingDate, balances: computed };
  const floors = holdPeakRequirements(store, computedPeaks(computed), operatingDate);
  return { operatingDate, balances: model(floors) };
}

/**
 * The balances a reader shows for `operatingDate`: the snapshot's held ones for
 * its own date; for any other date (the parking order's later day) the model
 * for that date alone, which nothing earlier in that date can floor.
 */
export function requirementBalances(
  analysis: Pick<SnapshotAnalysis, 'requirement' | 'depots' | 'yards' | 'requirementShares'>,
  operatingDate: string,
): readonly DepotBalance[] {
  const held = analysis.requirement;
  if (held !== null && held.operatingDate === operatingDate) return held.balances;
  return modelBalances(
    analysis.depots,
    analysis.yards,
    operatingDate,
    DEFAULT_REQUIREMENT_PARAMS,
    analysis.requirementShares,
  );
}
