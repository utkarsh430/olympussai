/**
 * THE ONE FILE TO EDIT WHEN A NUMBER ON /trial SHOULD CHANGE.
 *
 * Every headline figure the showcase states is authored here. Anything not
 * authored (a null, or a scenario with no override) is read from the real
 * trial data in `generated/trialData.json` by `resolve.ts`. The scenes never
 * carry a literal of their own, so a change here reaches every surface that
 * quotes it - the hero, the verdict, the corridor tiles, the balance and the
 * scale projection - in one edit.
 *
 * No `'use client'`: the server page reads this.
 */
import type { BunchingScenarioId, CorridorPresetId } from '@/models/fleetTrial';

export type ControllabilityBand = 'too_regular' | 'controllable' | 'too_disturbed';

export interface CorridorFigure {
  presetId: CorridorPresetId;
  name: string;
  shape: string;
  lengthKm: number;
  stops: number;
  headwayMinutes: number;
  /** Net total passenger time saved, percent of what passengers spend. */
  netPassengerTimeSavedPercent: number;
  /** Excess waiting removed, percent. */
  excessWaitCutPercent: number;
  seedsAgreeing: number;
  seedsTotal: number;
  band: ControllabilityBand;
}

export interface LawFigure {
  id: string;
  name: string;
  oneLiner: string;
}