// In-memory StateEstimationRepository used by tests (estimator/service
// integration, rehydration-on-restart) so they exercise the same interface
// the real Postgres-backed repository implements, without needing a live
// database in CI. Not used by production code.

import type { StateEstimationRepository } from "../repository.js";
import type {
  PriorVehicleState,
  RouteDirectionShape,
  RouteDirectionStopPoint,
  VehicleStateEstimate,
} from "../types.js";

export class InMemoryStateEstimationRepository implements StateEstimationRepository {
  readonly savedStates = new Map<string, VehicleStateEstimate>();
  activeHolds = new Set<string>();
  tripsByVehicleAndDirection = new Map<string, string>();

  constructor(
    private readonly shapes: RouteDirectionShape[],
    private readonly stopsByDirection: Map<string, RouteDirectionStopPoint[]> = new Map()
  ) {}

  async loadActiveRouteDirectionShapes(): Promise<RouteDirectionShape[]> {
    return Promise.resolve(this.shapes);
  }

  async loadRouteDirectionStops(
    routeDirectionIds: readonly string[]
  ): Promise<Map<string, RouteDirectionStopPoint[]>> {
    const result = new Map<string, RouteDirectionStopPoint[]>();
    for (const id of routeDirectionIds) {
      const stops = this.stopsByDirection.get(id);
      if (stops) result.set(id, stops);
    }
    return Promise.resolve(result);
  }

  async loadPriorVehicleState(vehicleId: string): Promise<PriorVehicleState | null> {
    const saved = this.savedStates.get(vehicleId);
    if (!saved) return Promise.resolve(null);
    return Promise.resolve(toPriorState(saved));
  }

  async loadActiveHold(vehicleId: string): Promise<boolean> {
    return Promise.resolve(this.activeHolds.has(vehicleId));
  }

  async resolveCurrentTrip(vehicleId: string, routeDirectionId: string): Promise<string | null> {
    return Promise.resolve(this.tripsByVehicleAndDirection.get(`${vehicleId}:${routeDirectionId}`) ?? null);
  }

  async saveVehicleState(estimate: VehicleStateEstimate): Promise<void> {
    this.savedStates.set(estimate.vehicleId, estimate);
    return Promise.resolve();
  }

  async rehydrateAll(): Promise<Map<string, PriorVehicleState>> {
    const result = new Map<string, PriorVehicleState>();
    for (const [vehicleId, estimate] of this.savedStates) {
      if (estimate.kalmanState) {
        result.set(vehicleId, toPriorState(estimate));
      }
    }
    return Promise.resolve(result);
  }
}

function toPriorState(estimate: VehicleStateEstimate): PriorVehicleState {
  return {
    routeDirectionId: estimate.routeDirectionId,
    kalmanState: estimate.kalmanState,
    confidence: estimate.confidence,
    currentStopId: estimate.currentStopId,
    stopEnteredAt: estimate.stopEnteredAt,
  };
}
