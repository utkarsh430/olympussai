// Independent reference KPI computation for historical-replay validation.
// Deliberately NOT the mesoscopic engine (`engine.ts`): no no-overtake
// clamping, no capacity-driven denied boarding, no controller. It is a
// direct cumulative-time walk over the recorded per-vehicle, per-stop
// travel times and boarding/alighting counts - "what the numbers say
// happened," arithmetically. `replay.ts` runs the full engine over the
// SAME recorded inputs (with `noControlController`, since a historical
// day predates any control system) and asserts the two independent code
// paths agree within `docs/CONTROL_SERVICE_SIMULATOR.md`'s documented
// tolerance. Reusing `summarizeKpis` here (not the engine) is fine: that
// function is generic aggregation math (mean/CV/etc. over a visit list),
// not part of the engine behaviour under test.
import { summarizeKpis } from './kpi.js';
import type {
  KpiSummary,
  RecordedInputs,
  RouteDirectionDefinition,
  StopVisitRecord,
  TerminalDispatchPlan,
} from './types.js';

export function computeReferenceKpisFromRecordedInputs(
  routeDirection: RouteDirectionDefinition,
  dispatches: TerminalDispatchPlan[],
  recordedInputs: RecordedInputs,
): KpiSummary {
  const visits: StopVisitRecord[] = [];
  const sorted = [...dispatches].sort((a, b) => a.scheduledDispatchSeconds - b.scheduledDispatchSeconds);

  for (const dispatch of sorted) {
    let t = dispatch.scheduledDispatchSeconds;
    let onboard = 0;
    const travel = recordedInputs.linkTravelSeconds[dispatch.vehicleId] ?? [];
    const boardings = recordedInputs.boardings[dispatch.vehicleId] ?? [];
    const alightings = recordedInputs.alightings[dispatch.vehicleId] ?? [];

    for (let stopIndex = 0; stopIndex < routeDirection.stops.length; stopIndex++) {
      const stop = routeDirection.stops[stopIndex];
      if (!stop) continue;
      const travelSeconds = travel[stopIndex] ?? 0;
      const board = boardings[stopIndex] ?? 0;
      const alight = alightings[stopIndex] ?? 0;

      const arrivalSeconds = t + travelSeconds;
      const dwellSeconds =
        stop.demand.baseDwellSeconds +
        stop.demand.secondsPerBoarding * board +
        stop.demand.secondsPerAlighting * alight;
      const departureSeconds = arrivalSeconds + dwellSeconds;
      onboard = Math.max(0, onboard - alight + board);

      visits.push({
        vehicleId: dispatch.vehicleId,
        stopId: stop.stopId,
        stopIndex,
        arrivalSeconds,
        // The reference calculation replays RECORDED boardings, so there is no
        // modelled queue behind them and no alighting-only decision to make.
        waitWindowSeconds: 0,
        boardings: board,
        boardingLimitedPassengers: 0,
        boardingWaitPassengerSeconds: 0,
        // No holds in a reference replay, so no onboard delay to charge.
        onboardDelayPassengerSeconds: 0,
        dwellPassengerSeconds: 0,
        alightings: alight,
        deniedBoardings: 0,
        firstTimeDeniedBoardings: 0,
        onboardAfter: onboard,
        dwellSeconds,
        intendedHoldSeconds: 0,
        appliedHoldSeconds: 0,
        compliant: true,
        departureSeconds,
        leaderHeadwaySeconds: null,
        isStateStale: false,
      });
      t = departureSeconds;
    }
  }

  const controlPointStopIds = new Set(
    routeDirection.stops.filter((s) => s.isControlPoint).map((s) => s.stopId),
  );
  return summarizeKpis(
    visits,
    controlPointStopIds,
    routeDirection.targetHeadwaySeconds,
    routeDirection.bunchedThresholdRatio,
  );
}
