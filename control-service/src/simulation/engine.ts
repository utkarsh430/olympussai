// Event-based mesoscopic simulator core (blueprint 11.1). Simulates one
// route-direction's vehicles through their stop sequence, sampling
// link-level travel times and stop-level boarding/alighting demand (or
// replaying exact recorded values - see `replay.ts`), applying a
// pluggable `Controller` at control-point stops, and returning the full
// stop-visit timeline plus KPI summary.
//
// Modeling simplifications (documented, not hidden - see
// docs/CONTROL_SERVICE_SIMULATOR.md "Scope and simplifications"):
//   - Vehicles are processed in terminal-dispatch order and keep that
//     relative order for the whole trip (single-lane / no-overtake-segment
//     assumption, generalized to the full route-direction rather than
//     modeled per-segment).
//   - One route-direction per run; corridor/shared-trunk interaction
//     across route-directions is out of scope for this engine.
//   - Headway is measured stop-arrival-to-stop-arrival at control points,
//     the standard bunching metric (blueprint 11.1, "Replay mode" /
//     KPI tables).
//
// Isolation: no imports from ../db, ../state, ../routes, ../webhooks, or
// ../mpc - see the header comment in types.ts.
import { Rng } from './rng.js';
import { summarizeKpis } from './kpi.js';
import type {
  Controller,
  Disturbance,
  KpiSummary,
  RouteDirectionDefinition,
  ScenarioConfig,
  StopVisitRecord,
  SimulationResult,
} from './types.js';

function activeDemandBurst(
  disturbances: Disturbance[],
  stopId: string,
  atSeconds: number,
): number {
  let multiplier = 1;
  for (const d of disturbances) {
    if (d.type === 'demand_burst' && d.stopId === stopId && atSeconds >= d.startSeconds && atSeconds <= d.endSeconds) {
      multiplier *= d.multiplier;
    }
  }
  return multiplier;
}

function isMissedTrip(disturbances: Disturbance[], vehicleId: string): boolean {
  return disturbances.some((d) => d.type === 'missed_trip' && d.vehicleId === vehicleId);
}

function isGpsDropout(disturbances: Disturbance[], vehicleId: string, atSeconds: number): boolean {
  return disturbances.some(
    (d) =>
      d.type === 'gps_dropout' &&
      d.vehicleId === vehicleId &&
      atSeconds >= d.startSeconds &&
      atSeconds <= d.endSeconds,
  );
}

function complianceProbabilityFor(disturbances: Disturbance[], vehicleId: string): number | null {
  const match = disturbances.find((d) => d.type === 'non_compliance' && d.vehicleId === vehicleId);
  return match && match.type === 'non_compliance' ? match.complianceProbability : null;
}

/** Runs one scenario against one controller. Deterministic for a given (config, controller) pair - see rng.ts. */
export function simulate(config: ScenarioConfig, controller: Controller): SimulationResult {
  const { routeDirection, disturbances, recordedInputs } = config;
  validateRouteDirection(routeDirection);
  const rng = new Rng(config.seed);

  const dispatches = [...config.dispatches]
    .filter((d) => !isMissedTrip(disturbances, d.vehicleId))
    .sort((a, b) => a.scheduledDispatchSeconds - b.scheduledDispatchSeconds);

  const previousArrivalAtStop: Array<number | null> = routeDirection.stops.map(() => null);
  const lastDepartureAtStop: number[] = routeDirection.stops.map(() => 0);

  const visits: StopVisitRecord[] = [];

  for (const dispatch of dispatches) {
    let t = dispatch.scheduledDispatchSeconds;
    let onboard = 0;

    for (let stopIndex = 0; stopIndex < routeDirection.stops.length; stopIndex++) {
      const stop = routeDirection.stops[stopIndex];
      const link = routeDirection.links[stopIndex];
      if (!stop || !link) continue;

      const recordedTravel = recordedInputs?.linkTravelSeconds[dispatch.vehicleId]?.[stopIndex];
      const travelSeconds =
        recordedTravel ?? rng.nextNonNegativeGaussian(link.meanSeconds, link.stddevSeconds);

      let arrivalSeconds = t + travelSeconds;
      const prevArrival = previousArrivalAtStop[stopIndex] ?? null;
      if (prevArrival !== null) {
        arrivalSeconds = Math.max(arrivalSeconds, prevArrival + routeDirection.minSeparationSeconds);
      }

      const recordedBoardings = recordedInputs?.boardings[dispatch.vehicleId]?.[stopIndex];
      const recordedAlightings = recordedInputs?.alightings[dispatch.vehicleId]?.[stopIndex];

      let rawBoardings: number;
      let alightings: number;
      if (recordedBoardings !== undefined && recordedAlightings !== undefined) {
        rawBoardings = recordedBoardings;
        alightings = recordedAlightings;
      } else {
        const waitWindowSeconds = Math.max(0, arrivalSeconds - (lastDepartureAtStop[stopIndex] ?? 0));
        const burstMultiplier = activeDemandBurst(disturbances, stop.stopId, arrivalSeconds);
        rawBoardings = rng.nextNonNegativeCount(
          (stop.demand.boardingRatePerMinute / 60) * waitWindowSeconds * burstMultiplier,
        );
        alightings = Math.min(onboard, rng.nextNonNegativeCount(stop.demand.alightingFraction * onboard));
      }

      const capacityAfterAlighting = Math.max(0, routeDirection.vehicleCapacity - (onboard - alightings));
      const actualBoardings = Math.min(rawBoardings, capacityAfterAlighting);
      const deniedBoardings = rawBoardings - actualBoardings;
      const onboardAfter = Math.max(0, onboard - alightings + actualBoardings);

      const dwellSeconds =
        stop.demand.baseDwellSeconds +
        stop.demand.secondsPerBoarding * actualBoardings +
        stop.demand.secondsPerAlighting * alightings;

      const rawLeaderHeadway = prevArrival !== null ? arrivalSeconds - prevArrival : null;
      const isStateStale = isGpsDropout(disturbances, dispatch.vehicleId, arrivalSeconds);

      let intendedHoldSeconds = 0;
      let appliedHoldSeconds = 0;
      let compliant = true;

      if (stop.isControlPoint) {
        const decision = controller.decide({
          routeDirectionId: routeDirection.routeDirectionId,
          stopId: stop.stopId,
          vehicleId: dispatch.vehicleId,
          now: arrivalSeconds,
          leaderHeadwaySeconds: isStateStale ? null : rawLeaderHeadway,
          targetHeadwaySeconds: routeDirection.targetHeadwaySeconds,
          maxHoldSeconds: routeDirection.maxHoldSeconds,
          isStateStale,
        });
        intendedHoldSeconds = Math.max(0, Math.min(decision.holdSeconds, routeDirection.maxHoldSeconds));

        if (intendedHoldSeconds > 0) {
          const complianceProbability = complianceProbabilityFor(disturbances, dispatch.vehicleId);
          if (complianceProbability !== null && !rng.nextBoolean(complianceProbability)) {
            compliant = false;
            appliedHoldSeconds = 0;
          } else {
            appliedHoldSeconds = intendedHoldSeconds;
          }
        }
      }

      const departureSeconds = arrivalSeconds + dwellSeconds + appliedHoldSeconds;

      visits.push({
        vehicleId: dispatch.vehicleId,
        stopId: stop.stopId,
        stopIndex,
        arrivalSeconds,
        boardings: actualBoardings,
        alightings,
        deniedBoardings,
        onboardAfter,
        dwellSeconds,
        intendedHoldSeconds,
        appliedHoldSeconds,
        compliant,
        departureSeconds,
        leaderHeadwaySeconds: rawLeaderHeadway,
        isStateStale,
      });

      previousArrivalAtStop[stopIndex] = arrivalSeconds;
      lastDepartureAtStop[stopIndex] = departureSeconds;
      onboard = onboardAfter;
      t = departureSeconds;
    }
  }

  const controlPointStopIds = new Set(
    routeDirection.stops.filter((s) => s.isControlPoint).map((s) => s.stopId),
  );
  const kpis: KpiSummary = summarizeKpis(
    visits,
    controlPointStopIds,
    routeDirection.targetHeadwaySeconds,
    routeDirection.bunchedThresholdRatio,
  );

  return { scenarioName: config.name, controllerName: controller.name, visits, kpis };
}

function validateRouteDirection(routeDirection: RouteDirectionDefinition): void {
  if (routeDirection.stops.length !== routeDirection.links.length) {
    throw new Error(
      `route-direction ${routeDirection.routeDirectionId}: stops.length (${routeDirection.stops.length}) must equal links.length (${routeDirection.links.length})`,
    );
  }
  if (routeDirection.stops.length === 0) {
    throw new Error(`route-direction ${routeDirection.routeDirectionId}: must have at least one stop`);
  }
}
