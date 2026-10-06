import {
  DEFAULT_REBALANCE_PARAMS,
  DEFAULT_SPARE_RATIO,
  MAX_TRANSFER_KM,
  MIN_TRANSFER_KM,
} from '../optimise/config';
import type { Scenario } from '../optimise/types';

/**
 * The maximum distance the engine plans with for this scenario, so sentences
 * quote the limit actually used. Mirrors `runScenario`'s bounds; the form
 * itself keeps what the user typed, and the engine's note says what it changed.
 */
export function effectiveMaxTransferKm(scenario: Scenario, baselineKm: number): number {
  const typed = scenario.maxTransferKm;
  if (typed === undefined || !Number.isFinite(typed)) return baselineKm;
  return Math.min(MAX_TRANSFER_KM, Math.max(MIN_TRANSFER_KM, typed));
}

/** A signed difference in words: "12 fewer buses moved", "No change in buses moved". */
export function describeDelta(
  delta: number,
  singular: string,
  plural: string,
  suffix: string,
): string {
  const tail = suffix ? ` ${suffix}` : '';
  const size = Math.round(Math.abs(delta) * 10) / 10;
  if (size === 0) return `No change in ${plural}${tail}`;
  const unit = size === 1 ? singular : plural;
  return `${size} ${delta > 0 ? 'more' : 'fewer'} ${unit}${tail}`;
}

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

export type ParseResult =
  | { readonly ok: true; readonly value: number }
  | {
      readonly ok: false;
      readonly error: string;
    };

export const BASELINE_FORM: ScenarioFormState = {
  sparePercent: null,
  maxTransferKm: null,
  lockedDepotIds: [],
  excludedDepotIds: [],
  fleetAdjustments: [],
  demandSurges: [],
};

const PERCENT = 100;
const MINUS = '−';
const DECIMAL_PATTERN = /^[+-]?(\d+(\.\d+)?|\.\d+)$/;
const WHOLE_PATTERN = /^[+-]?\d+$/;

/** Spare ratio as a percentage, or null when it is the default. */
function activeSpare(state: ScenarioFormState): number | null {
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

function signed(n: number): string {
  return n < 0 ? `${MINUS}${Math.abs(n)}` : `+${n}`;
}

function depotCount(n: number, what: string): string {
  return `${n} ${n === 1 ? 'depot' : 'depots'} ${what}`;
}

/** The active changes in plain words, e.g. "Spare ratio 10%, 2 depots locked, AGRA +12 buses." */
export function summariseScenario(
  state: ScenarioFormState,
  nameOf: (depotId: string) => string,
): string {
  const scenario = toScenario(state);
  const parts: string[] = [];
  if (scenario.spareRatio !== undefined) parts.push(`Spare ratio ${activeSpare(state)}%`);
  if (scenario.maxTransferKm !== undefined) {
    parts.push(`maximum distance ${scenario.maxTransferKm} km`);
  }
  if (scenario.lockedDepotIds) parts.push(depotCount(scenario.lockedDepotIds.length, 'locked'));
  if (scenario.excludedDepotIds) {
    parts.push(depotCount(scenario.excludedDepotIds.length, 'excluded'));
  }
  for (const a of scenario.fleetAdjustments ?? []) {
    const word = Math.abs(a.deltaBuses) === 1 ? 'bus' : 'buses';
    parts.push(`${nameOf(a.depotId)} ${signed(a.deltaBuses)} ${word}`);
  }
  for (const s of scenario.demandSurges ?? []) {
    parts.push(`${nameOf(s.depotId)} demand ${signed(s.percent)}%`);
  }
  if (parts.length === 0) return 'Baseline: no changes.';
  const text = parts.join(', ');
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

function parseDecimal(raw: string, unit: RegExp, what: string): ParseResult {
  const text = raw.trim().replace(unit, '').trim();
  if (text === '') return { ok: false, error: `Enter ${what}.` };
  if (!DECIMAL_PATTERN.test(text))
    return { ok: false, error: `${capital(what)} must be a number.` };
  return { ok: true, value: Number(text) };
}

function capital(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

export function parseSparePercent(raw: string): ParseResult {
  return parseDecimal(raw, /%$/, 'a spare ratio as a percentage');
}

export function parseDistanceKm(raw: string): ParseResult {
  return parseDecimal(raw, /km$/i, 'a distance in kilometres');
}

export function parseSurgePercent(raw: string): ParseResult {
  return parseDecimal(raw, /%$/, 'a demand change as a percentage');
}

/** Buses are whole: a fraction is refused here rather than truncated out of sight. */
export function parseBusDelta(raw: string): ParseResult {
  const text = raw.trim();
  if (text === '') return { ok: false, error: 'Enter a change in buses, such as +12 or -5.' };
  if (!WHOLE_PATTERN.test(text)) {
    return { ok: false, error: 'A change in buses must be a whole number, such as +12 or -5.' };
  }
  const value = Number(text);
  if (value === 0) return { ok: false, error: 'Enter a change other than zero.' };
  return { ok: true, value };
}
