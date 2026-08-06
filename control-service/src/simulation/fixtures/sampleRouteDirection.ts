// Small, hand-authored route-direction fixture shared by the regression
// scenario library (`../scenarios/*`) and the engine/controller test
// suites. Not tied to any real UPSRTC route - a synthetic 6-stop corridor
// with two control points, sized so the full regression suite (multiple
// scenarios x two controllers) runs in well under a second.
import type { RouteDirectionDefinition, TerminalDispatchPlan } from '../types.js';

export const SAMPLE_ROUTE_DIRECTION: RouteDirectionDefinition = {
  routeDirectionId: 'rd-sim-sample',
  vehicleCapacity: 60,
  targetHeadwaySeconds: 600, // 10 minutes
  bunchedThresholdRatio: 0.4,
  maxHoldSeconds: 90,
  minSeparationSeconds: 5,
  stops: [
    {
      stopId: 'stop-1',
      sequence: 0,
      isControlPoint: true,
      demand: { boardingRatePerMinute: 4, alightingFraction: 0.05, baseDwellSeconds: 15, secondsPerBoarding: 2.5, secondsPerAlighting: 1.5 },
    },
    {
      stopId: 'stop-2',
      sequence: 1,
      isControlPoint: false,
      demand: { boardingRatePerMinute: 3, alightingFraction: 0.15, baseDwellSeconds: 12, secondsPerBoarding: 2.5, secondsPerAlighting: 1.5 },
    },
    {
      stopId: 'stop-3',
      sequence: 2,
      isControlPoint: false,
      demand: { boardingRatePerMinute: 5, alightingFraction: 0.2, baseDwellSeconds: 12, secondsPerBoarding: 2.5, secondsPerAlighting: 1.5 },
    },
    {
      stopId: 'stop-4',
      sequence: 3,
      isControlPoint: true,
      demand: { boardingRatePerMinute: 2, alightingFraction: 0.3, baseDwellSeconds: 12, secondsPerBoarding: 2.5, secondsPerAlighting: 1.5 },
    },
    {
      stopId: 'stop-5',
      sequence: 4,
      isControlPoint: false,
      demand: { boardingRatePerMinute: 2, alightingFraction: 0.35, baseDwellSeconds: 12, secondsPerBoarding: 2.5, secondsPerAlighting: 1.5 },
    },
    {
      stopId: 'stop-6',
      sequence: 5,
      isControlPoint: false,
      demand: { boardingRatePerMinute: 1, alightingFraction: 1, baseDwellSeconds: 15, secondsPerBoarding: 2.5, secondsPerAlighting: 1.5 },
    },
  ],
  links: [
    { meanSeconds: 240, stddevSeconds: 25 },
    { meanSeconds: 180, stddevSeconds: 20 },
    { meanSeconds: 200, stddevSeconds: 20 },
    { meanSeconds: 220, stddevSeconds: 30 },
    { meanSeconds: 190, stddevSeconds: 20 },
    { meanSeconds: 210, stddevSeconds: 25 },
  ],
};

/** Four vehicles dispatched on the fixture's 600s target headway, one operating hour. */
export const SAMPLE_DISPATCHES: TerminalDispatchPlan[] = [
  { vehicleId: 'veh-1', scheduledDispatchSeconds: 0 },
  { vehicleId: 'veh-2', scheduledDispatchSeconds: 600 },
  { vehicleId: 'veh-3', scheduledDispatchSeconds: 1200 },
  { vehicleId: 'veh-4', scheduledDispatchSeconds: 1800 },
];
