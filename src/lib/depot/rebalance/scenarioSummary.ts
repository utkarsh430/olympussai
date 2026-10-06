import { MAX_TRANSFER_KM, MIN_TRANSFER_KM } from '../optimise/config';
import type { Scenario } from '../optimise/types';
import { activeSpare, toScenario, type ScenarioFormState } from './scenarioForm';
import { signedWhole } from '@/lib/depot/format';

/*
 * Sentences describing a scenario and its effect. For display only: the
 * scenario's identity is `scenarioKey`, never these words.
 */


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

/** "Agra", "Agra and Kanpur", "Agra, Kanpur and Banda" followed by what happens to them. */
function depotNames(
  ids: readonly string[],
  what: string,
  nameOf: (depotId: string) => string,
): string {
  const names = ids.map(nameOf);
  const last = names.at(-1);
  const list = names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${last}`;
  return `${list} ${what}`;
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
  if (scenario.lockedDepotIds) parts.push(depotNames(scenario.lockedDepotIds, 'locked', nameOf));
  if (scenario.excludedDepotIds) {
    parts.push(depotNames(scenario.excludedDepotIds, 'excluded', nameOf));
  }
  for (const a of scenario.fleetAdjustments ?? []) {
    const word = Math.abs(a.deltaBuses) === 1 ? 'bus' : 'buses';
    parts.push(`${nameOf(a.depotId)} ${signedWhole(a.deltaBuses)} ${word}`);
  }
  for (const s of scenario.demandSurges ?? []) {
    parts.push(`${nameOf(s.depotId)} demand ${signedWhole(s.percent)}%`);
  }
  if (parts.length === 0) return 'Baseline: no changes.';
  const text = parts.join(', ');
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}
