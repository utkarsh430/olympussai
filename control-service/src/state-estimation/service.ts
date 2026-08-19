// StateEstimationService wires the pure estimator (estimator.ts) to a
// StateEstimationRepository, and keeps an in-memory cache of each
// vehicle's prior state so hot-path updates don't need a DB round trip
// before every estimate.
//
// rehydrate() must be called once at process startup (before the process
// is marked ready to receive position events) so the cache is rebuilt from
// persisted state rather than starting cold - this is the mechanism behind
// AC: "State persists so a restart rebuilds current state without a full
// new observation cycle". The eventual HTTP entrypoint (control-service
// application runtime ticket) is expected to gate its /readyz handler on
// this having completed, per the devops interface note that /readyz must
// return 503 until rehydration is done.

import { AppError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import { CANDIDATE_RADIUS_METERS } from "./cache.js";
import { LOW_CONFIDENCE_THRESHOLD } from "./confidence.js";
import { estimateVehicleState } from "./estimator.js";
import { detectCompletedStopVisit } from "./stopVisit.js";
import { computeLeaderFollowerOrder, computeCorridorOrder } from "./ordering.js";
import type { StateEstimationRepository } from "./repository.js";
import type {
  CorridorOrderedVehicle,
  OrderedVehicle,
  PositionEvent,
  PriorVehicleState,
  RouteDirectionShape,
  VehicleStateEstimate,
} from "./types.js";

export interface PositionEventOutcome {
  estimate: VehicleStateEstimate;
  /** false = the out-of-order guard suppressed the write; nothing downstream should advance. */
  persisted: boolean;
}

export class StateEstimationService {
  private cache = new Map<string, PriorVehicleState>();
  private rehydrated = false;

  constructor(private readonly repository: StateEstimationRepository) {}

  get isRehydrated(): boolean {
    return this.rehydrated;
  }

  async rehydrate(): Promise<void> {
    this.cache = await this.repository.rehydrateAll();
    this.rehydrated = true;
  }

  /**
   * Processes one fix and returns the estimate. Convenience wrapper over
   * processPositionEventWithOutcome for callers that don't care whether
   * the write actually landed.
   */
  async processPositionEvent(event: PositionEvent): Promise<VehicleStateEstimate> {
    return (await this.processPositionEventWithOutcome(event)).estimate;
  }

  /**
   * Processes one fix, reporting whether the row was actually written.
   * `persisted: false` means the out-of-order guard suppressed the write
   * because a newer fix for this vehicle is already durable - the caller
   * must not mirror this estimate into any other cache either.
   */
  async processPositionEventWithOutcome(event: PositionEvent): Promise<PositionEventOutcome> {
    // Before rehydration the prior-state cache is empty, so every vehicle
    // would be map-matched as if it had just appeared from nowhere: no
    // direction hysteresis, a cold Kalman filter, and a confidence score
    // that has no continuity bonus to draw on. Persisting that would
    // corrupt good state with worse state. Fail closed instead - 503 is
    // honest and retryable, and /readyz is already 503 at this point so a
    // load balancer should not be sending traffic here anyway.
    if (!this.rehydrated) {
      throw new AppError(
        "state_not_rehydrated",
        "state estimation has not finished rehydrating from the database",
        503
      );
    }

    // Prefer the spatial prefilter when the repository offers one. The
    // radius is far wider than the estimator's own off-route threshold, so
    // this narrows work without ever narrowing the decision (see
    // CANDIDATE_RADIUS_METERS).
    const shapes = this.repository.loadCandidateShapesNear
      ? await this.repository.loadCandidateShapesNear(
          { lat: event.lat, lon: event.lon },
          CANDIDATE_RADIUS_METERS
        )
      : await this.repository.loadActiveRouteDirectionShapes();
    const stopsByDirection = await this.repository.loadRouteDirectionStops(
      shapes.map((s) => s.routeDirectionId)
    );
    const priorState =
      this.cache.get(event.vehicleId) ?? (await this.repository.loadPriorVehicleState(event.vehicleId));
    const isHeldByController = await this.repository.loadActiveHold(event.vehicleId);
    const tripId = priorState?.routeDirectionId
      ? await this.repository.resolveCurrentTrip(
          event.vehicleId,
          priorState.routeDirectionId,
          new Date(event.observedAt)
        )
      : null;

    const estimate = estimateVehicleState({
      vehicleId: event.vehicleId,
      event,
      candidateShapes: shapes,
      nearestStopsByRouteDirection: stopsByDirection,
      priorState: priorState ?? null,
      isHeldByController,
      tripId,
    });

    let persisted: boolean;
    try {
      persisted = await this.repository.saveVehicleState(estimate);
    } catch (error) {
      // Persistence failed. The in-memory cache is deliberately NOT
      // advanced: it feeds live leader/follower ordering, and letting it
      // run ahead of the table means a restart silently rewinds every
      // vehicle to a state the rest of the system never agreed with.
      // Surfaced via structured logging (OWASP A09) and rethrown so the
      // ingestion boundary can classify it (state-estimation/errors.ts)
      // instead of acting on a state it believes was durably saved.
      logger.error(
        {
          vehicleId: event.vehicleId,
          error: error instanceof Error ? error.message : String(error),
        },
        'processPositionEvent: persistence failed, in-memory cache left unchanged'
      );
      throw error;
    }

    // A suppressed write means an out-of-order fix lost to a newer one
    // already in the table. Advancing the cache anyway is exactly how
    // cache and table diverge, so mirror the table's decision.
    if (persisted) {
      // Before the cache is overwritten, capture the stop occupancy this fix
      // just ended. `stopEnteredAt` lives only in the current-state row, so
      // this is the one moment the arrival time and the departure time are
      // both in hand - the next fix has already lost the arrival.
      await this.recordStopVisitIfCompleted(priorState ?? null, estimate);
      this.updateCache(event.vehicleId, estimate);
    }
    return { estimate, persisted };
  }

  /**
   * Writes the stop occupancy that just ended, if one did.
   *
   * NEVER THROWS. Position estimation is the hot ingestion path and its
   * contract is that a fix either updates the vehicle's state or fails
   * loudly; losing one row of stop history is not a reason to fail a fix
   * that was already durably saved, and a stop_visits outage must not become
   * a live-tracking outage. The failure is logged, and the gap it leaves is
   * a missing visit rather than a wrong one.
   */
  private async recordStopVisitIfCompleted(
    prior: PriorVehicleState | null,
    estimate: VehicleStateEstimate
  ): Promise<void> {
    if (!this.repository.recordStopVisit) return;
    const visit = detectCompletedStopVisit(prior, estimate);
    if (!visit) return;

    try {
      await this.repository.recordStopVisit(visit);
    } catch (error) {
      logger.warn(
        {
          vehicleId: visit.vehicleId,
          stopId: visit.stopId,
          error: error instanceof Error ? error.message : String(error),
        },
        "processPositionEvent: stop visit not recorded; live state is unaffected"
      );
    }
  }

  private updateCache(vehicleId: string, estimate: VehicleStateEstimate): void {
    this.cache.set(vehicleId, {
      routeDirectionId: estimate.routeDirectionId,
      kalmanState: estimate.kalmanState,
      confidence: estimate.confidence,
      currentStopId: estimate.currentStopId,
      stopEnteredAt: estimate.stopEnteredAt,
    });
  }

  /** Leader-follower order for one route-direction, computed from the current in-memory cache. */
  computeOrderForRouteDirection(shape: RouteDirectionShape): OrderedVehicle[] {
    const vehicles = [...this.cache.entries()]
      .filter(([, state]) => state.routeDirectionId === shape.routeDirectionId)
      .map(([vehicleId, state]) => ({
        vehicleId,
        routeDirectionId: shape.routeDirectionId,
        distanceAlongRouteMeters: state.kalmanState?.s ?? 0,
        isLowConfidence: (state.confidence ?? 0) < LOW_CONFIDENCE_THRESHOLD,
      }));

    return computeLeaderFollowerOrder(vehicles, {
      isLoop: shape.isLoop,
      totalDistanceMeters: shape.totalDistanceMeters,
    });
  }

  /** Corridor-wide order across every route-direction sharing shape.corridorId. */
  computeCorridorOrderFor(shapesInCorridor: readonly RouteDirectionShape[]): CorridorOrderedVehicle[] {
    const shapeById = new Map(shapesInCorridor.map((s) => [s.routeDirectionId, s]));
    const vehicles = [...this.cache.entries()]
      .filter(([, state]) => state.routeDirectionId != null && shapeById.has(state.routeDirectionId))
      .map(([vehicleId, state]) => {
        const shape = shapeById.get(state.routeDirectionId!)!;
        return {
          vehicleId,
          routeDirectionId: shape.routeDirectionId,
          distanceAlongRouteMeters: state.kalmanState?.s ?? 0,
          isLowConfidence: (state.confidence ?? 0) < LOW_CONFIDENCE_THRESHOLD,
          corridorOffsetMeters: shape.corridorOffsetMeters,
          corridorDirectionSign: shape.corridorDirectionSign,
        };
      });

    return computeCorridorOrder(vehicles);
  }
}
