import type { DeiComponentKey } from './types';

/** Below this fleet a depot is too small for its rates to mean anything. */
export const MIN_FLEET_FOR_RANK = 10;

/** A tercile smaller than this is too thin a peer group; all depots merge into one. */
export const MIN_PEER_GROUP = 5;

/** Robust z-scores are clamped to this, so no single measure can swamp the index. */
export const Z_CLAMP = 3;

export interface DeiComponentConfig {
  readonly key: DeiComponentKey;
  readonly label: string;
  /** Weights sum to 1; a test asserts it. */
  readonly weight: number;
  readonly higherIsBetter: boolean;
}

export const DEI_COMPONENTS: readonly DeiComponentConfig[] = [
  { key: 'onRoad', label: 'On-road share', weight: 0.35, higherIsBetter: true },
  { key: 'offRoad', label: 'Off-road rate', weight: 0.2, higherIsBetter: false },
  { key: 'dark', label: 'Dark rate', weight: 0.2, higherIsBetter: false },
  { key: 'scheduled', label: 'Schedule coverage', weight: 0.15, higherIsBetter: true },
  { key: 'deviceHealth', label: 'Device integrity', weight: 0.1, higherIsBetter: true },
];
