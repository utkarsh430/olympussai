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

import { logger } from "../lib/logger.js";
import { LOW_CONFIDENCE_THRESHOLD } from "./confidence.js";
import { estimateVehicleState } from "./estimator.js";
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

  async processPositionEvent(event: PositionEvent): Promise<VehicleStateEstimate> {
    const shapes = await this.repository.loadActiveRouteDirectionShapes();
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

    try {
      await this.repository.saveVehicleState(estimate);
    } catch (error) {
      // Persistence failure must not silently drop the observation from the
      // in-memory cache used for live ordering, but it also must not be
      // hidden - surfaced via structured logging (OWASP A09), and rethrown
      // so the caller (ingestion endpoint) can retry/ack appropriately
      // rather than acting on a state it believes was durably saved.
      logger.error(
        {
          vehicleId: event.vehicleId,
          error: error instanceof Error ? error.message : String(error),
        },
        'processPositionEvent: persistence failed, in-memory cache still updated'
      );
      this.updateCache(event.vehicleId, estimate);
      throw error;
    }

    this.updateCache(event.vehicleId, estimate);
    return estimate;
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
