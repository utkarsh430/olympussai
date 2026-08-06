// A stored "historical day" fixture for replay-mode reproduction testing
// (blueprint 11.1 "Replay mode": "Reconstruct an actual day and compare
// 'no control' versus proposed control using the same disturbances").
//
// This is a synthetic-but-fixed stand-in for a real AVL/APC extract (no
// real UPSRTC data is available in this repo) - three vehicles' recorded
// per-stop travel times and boarding/alighting counts on a 6-stop
// route-direction, hand-authored to be internally consistent (onboard
// load never goes negative, nobody alights more than boarded earlier).
// High capacity and a near-zero minimum separation mean the full engine's
// capacity-denial and no-overtake clamps never bind, so a `noControlController`
// replay run should reproduce `recordedKpis` almost exactly - see
// `replay.ts` and `test/simulation/replay.test.ts` for the actual
// tolerance check. When real AVL/APC extracts become available, replace
// `recordedInputs` below with an ingested extract and recompute
// `recordedKpis`; the rest of this module's contract is unchanged.
import { computeReferenceKpisFromRecordedInputs } from '../referenceKpi.js';
import type { HistoricalDayFixture, RouteDirectionDefinition, TerminalDispatchPlan } from '../types.js';

export const HISTORICAL_ROUTE_DIRECTION: RouteDirectionDefinition = {
  routeDirectionId: 'rd-historical-day-1',
  vehicleCapacity: 200, // generous on purpose: this fixture isolates travel/dwell/headway reproduction, not capacity effects
  targetHeadwaySeconds: 600,
  bunchedThresholdRatio: 0.4,
  maxHoldSeconds: 90,
  minSeparationSeconds: 1, // generous on purpose: recorded gaps are already realistic, this fixture isn't exercising the no-overtake clamp
  stops: [
    { stopId: 'hstop-1', sequence: 0, isControlPoint: true, demand: { boardingRatePerMinute: 4, alightingFraction: 0.05, baseDwellSeconds: 15, secondsPerBoarding: 2.5, secondsPerAlighting: 1.5 } },
    { stopId: 'hstop-2', sequence: 1, isControlPoint: false, demand: { boardingRatePerMinute: 3, alightingFraction: 0.15, baseDwellSeconds: 12, secondsPerBoarding: 2.5, secondsPerAlighting: 1.5 } },
    { stopId: 'hstop-3', sequence: 2, isControlPoint: false, demand: { boardingRatePerMinute: 5, alightingFraction: 0.2, baseDwellSeconds: 12, secondsPerBoarding: 2.5, secondsPerAlighting: 1.5 } },
    { stopId: 'hstop-4', sequence: 3, isControlPoint: true, demand: { boardingRatePerMinute: 2, alightingFraction: 0.3, baseDwellSeconds: 12, secondsPerBoarding: 2.5, secondsPerAlighting: 1.5 } },
    { stopId: 'hstop-5', sequence: 4, isControlPoint: false, demand: { boardingRatePerMinute: 2, alightingFraction: 0.35, baseDwellSeconds: 12, secondsPerBoarding: 2.5, secondsPerAlighting: 1.5 } },
    { stopId: 'hstop-6', sequence: 5, isControlPoint: false, demand: { boardingRatePerMinute: 1, alightingFraction: 1, baseDwellSeconds: 15, secondsPerBoarding: 2.5, secondsPerAlighting: 1.5 } },
  ],
  links: [
    { meanSeconds: 240, stddevSeconds: 0 },
    { meanSeconds: 180, stddevSeconds: 0 },
    { meanSeconds: 200, stddevSeconds: 0 },
    { meanSeconds: 220, stddevSeconds: 0 },
    { meanSeconds: 190, stddevSeconds: 0 },
    { meanSeconds: 210, stddevSeconds: 0 },
  ],
};

export const HISTORICAL_DISPATCHES: TerminalDispatchPlan[] = [
  { vehicleId: 'veh-h1', scheduledDispatchSeconds: 0 },
  { vehicleId: 'veh-h2', scheduledDispatchSeconds: 600 },
  { vehicleId: 'veh-h3', scheduledDispatchSeconds: 1200 },
];

export const HISTORICAL_RECORDED_INPUTS = {
  linkTravelSeconds: {
    'veh-h1': [235, 175, 205, 215, 195, 205],
    'veh-h2': [260, 190, 195, 230, 185, 220],
    'veh-h3': [225, 180, 210, 210, 200, 210],
  },
  boardings: {
    'veh-h1': [10, 6, 8, 3, 2, 0],
    'veh-h2': [9, 7, 9, 2, 3, 0],
    'veh-h3': [8, 6, 7, 2, 2, 0],
  },
  alightings: {
    'veh-h1': [0, 1, 2, 5, 6, 15],
    'veh-h2': [0, 1, 3, 6, 5, 15],
    'veh-h3': [0, 1, 2, 5, 6, 11],
  },
};

const recordedKpis = computeReferenceKpisFromRecordedInputs(
  HISTORICAL_ROUTE_DIRECTION,
  HISTORICAL_DISPATCHES,
  HISTORICAL_RECORDED_INPUTS,
);

export const HISTORICAL_DAY_FIXTURE: HistoricalDayFixture = {
  routeDirection: HISTORICAL_ROUTE_DIRECTION,
  dispatches: HISTORICAL_DISPATCHES,
  recordedInputs: HISTORICAL_RECORDED_INPUTS,
  recordedKpis,
};
