import type { RebalanceParams } from './types';

/** Longest single transfer worth a planner's attention without a dispatch decision. */
const DEFAULT_MAX_TRANSFER_KM = 250;
/** Road distance runs longer than the straight line; 1.3 is a common regional estimate. */
const DEFAULT_DETOUR_FACTOR = 1.3;

export const DEFAULT_REBALANCE_PARAMS: RebalanceParams = {
  maxTransferKm: DEFAULT_MAX_TRANSFER_KM,
  detourFactor: DEFAULT_DETOUR_FACTOR,
  lockedDepotIds: [],
  excludedDepotIds: [],
};

/** Spare buses held back per peak bus when a scenario does not choose a ratio. */
export const DEFAULT_SPARE_RATIO = 0.08;

/** A negative spare ratio is meaningless. */
export const MIN_SPARE_RATIO = 0;
/** Above 30% spare the network is carrying idle fleet, not a planning choice. */
export const MAX_SPARE_RATIO = 0.3;

/** Below 25 km a "transfer" is within one city and not an inter-depot move. */
export const MIN_TRANSFER_KM = 25;
/** Beyond 600 km a bus is better replaced than driven empty. */
export const MAX_TRANSFER_KM = 600;

/** A demand cut beyond half the peak is not a credible what-if. */
export const MIN_SURGE_PERCENT = -50;
/** Demand more than doubling is outside what this model can speak to. */
export const MAX_SURGE_PERCENT = 100;

/** Largest bus change a single fleet adjustment may make; beyond it the input is a typo. */
export const MAX_FLEET_ADJUSTMENT = 500;
