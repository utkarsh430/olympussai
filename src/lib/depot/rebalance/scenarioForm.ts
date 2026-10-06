import { DEFAULT_REBALANCE_PARAMS, DEFAULT_SPARE_RATIO } from '../optimise/config';
import type { Scenario } from '../optimise/types';

/*
 * The what-if sandbox's form state. Values are kept as the user typed them
 * (spare ratio as a percentage, distance in km) and are never clamped here:
 * clamping is `runScenario`'s job, and its notes are shown verbatim, so a
 * planner always sees what the engine did with an out-of-range value.
 */

export interface FleetAdjustment {
  readonly depotId: string;
  readonly deltaBuses: number;
}

export interface DemandSurge {
  readonly depotId: string;
  readonly percent: number;
}

export interface ScenarioFormState {
  /** Null keeps the modelled default. */
  readonly sparePercent: number | null;
  /** Null keeps the configured maximum. */
  readonly maxTransferKm: number | null;
  readonly lockedDepotIds: readonly string[];
  readonly excludedDepotIds: readonly string[];
  readonly fleetAdjustments: readonly FleetAdjustment[];
  readonly demandSurges: readonly DemandSurge[];
}

export const BASELINE_FORM: ScenarioFormState = {
  sparePercent: null,
  maxTransferKm: null,
  lockedDepotIds: [],
  excludedDepotIds: [],
  fleetAdjustments: [],
  demandSurges: [],
};

const PERCENT = 100;

/** Spare ratio as a percentage, or null when it is the default. */
export function activeSpare(state: ScenarioFormState): number | null {
  const { sparePercent } = state;
  if (sparePercent === null) return null;
  return sparePercent === DEFAULT_SPARE_RATIO * PERCENT ? null : sparePercent;
}

function activeMaxKm(state: ScenarioFormState): number | null {
  const { maxTransferKm } = state;
  if (maxTransferKm === null) return null;
  return maxTransferKm === DEFAULT_REBALANCE_PARAMS.maxTransferKm ? null : maxTransferKm;
}

/** Only the changes that differ from the baseline reach the engine. */
export function toScenario(state: ScenarioFormState): Scenario {
  const spare = activeSpare(state);
  const maxKm = activeMaxKm(state);
  const adjustments = state.fleetAdjustments.filter((a) => a.deltaBuses !== 0);
  const surges = state.demandSurges.filter((s) => s.percent !== 0);
  return {
    ...(spare === null ? {} : { spareRatio: spare / PERCENT }),
    ...(maxKm === null ? {} : { maxTransferKm: maxKm }),
    ...(state.lockedDepotIds.length ? { lockedDepotIds: [...state.lockedDepotIds] } : {}),
    ...(state.excludedDepotIds.length ? { excludedDepotIds: [...state.excludedDepotIds] } : {}),
    ...(adjustments.length ? { fleetAdjustments: adjustments.map((a) => ({ ...a })) } : {}),
    ...(surges.length ? { demandSurges: surges.map((s) => ({ ...s })) } : {}),
  };
}

export function isBaseline(state: ScenarioFormState): boolean {
  return Object.keys(toScenario(state)).length === 0;
}

export function withSparePercent(
  state: ScenarioFormState,
  value: number | null,
): ScenarioFormState {
  return { ...state, sparePercent: value };
}

export function withMaxTransferKm(
  state: ScenarioFormState,
  value: number | null,
): ScenarioFormState {
  return { ...state, maxTransferKm: value };
}

function toggled(ids: readonly string[], id: string, on: boolean): readonly string[] {
  const without = ids.filter((x) => x !== id);
  return on ? [...without, id] : without;
}

/** Locking and excluding are exclusive: an excluded depot cannot also be locked. */
export function withLocked(state: ScenarioFormState, id: string, on: boolean): ScenarioFormState {
  return {
    ...state,
    lockedDepotIds: toggled(state.lockedDepotIds, id, on),
    excludedDepotIds: on ? toggled(state.excludedDepotIds, id, false) : state.excludedDepotIds,
  };
}

export function withExcluded(state: ScenarioFormState, id: string, on: boolean): ScenarioFormState {
  return {
    ...state,
    excludedDepotIds: toggled(state.excludedDepotIds, id, on),
    lockedDepotIds: on ? toggled(state.lockedDepotIds, id, false) : state.lockedDepotIds,
  };
}

/** One adjustment per depot: a new value replaces the old one. */
export function withFleetAdjustment(
  state: ScenarioFormState,
  depotId: string,
  deltaBuses: number,
): ScenarioFormState {
  const rest = state.fleetAdjustments.filter((a) => a.depotId !== depotId);
  return { ...state, fleetAdjustments: [...rest, { depotId, deltaBuses }] };
}

export function withoutFleetAdjustment(
  state: ScenarioFormState,
  depotId: string,
): ScenarioFormState {
  return {
    ...state,
    fleetAdjustments: state.fleetAdjustments.filter((a) => a.depotId !== depotId),
  };
}

export function withSurge(
  state: ScenarioFormState,
  depotId: string,
  percent: number,
): ScenarioFormState {
  const rest = state.demandSurges.filter((s) => s.depotId !== depotId);
  return { ...state, demandSurges: [...rest, { depotId, percent }] };
}

export function withoutSurge(state: ScenarioFormState, depotId: string): ScenarioFormState {
  return { ...state, demandSurges: state.demandSurges.filter((s) => s.depotId !== depotId) };
}

function byDepotId(a: { readonly depotId: string }, b: { readonly depotId: string }): number {
  if (a.depotId === b.depotId) return 0;
  return a.depotId < b.depotId ? -1 : 1;
}

/**
 * The scenario's identity: a canonical string of sorted depot ids and values,
 * null at the baseline. Decisions are filed under it, so it must not change
 * with the order changes were made in, and never uses names or the sentence.
 */
export function scenarioKey(state: ScenarioFormState): string | null {
  const scenario = toScenario(state);
  if (Object.keys(scenario).length === 0) return null;
  const fleet = [...(scenario.fleetAdjustments ?? [])].sort(byDepotId);
  const surge = [...(scenario.demandSurges ?? [])].sort(byDepotId);
  return JSON.stringify({
    sparePercent: activeSpare(state),
    maxTransferKm: scenario.maxTransferKm ?? null,
    locked: [...(scenario.lockedDepotIds ?? [])].sort(),
    excluded: [...(scenario.excludedDepotIds ?? [])].sort(),
    fleet: fleet.map((a) => [a.depotId, a.deltaBuses]),
    surge: surge.map((s) => [s.depotId, s.percent]),
  });
}
