// In-memory StateEstimationRepository used by tests (estimator/service
// integration, rehydration-on-restart) so they exercise the same interface
// the real Postgres-backed repository implements, without needing a live
// database in CI. Not used by production code.

import type { StateEstimationRepository } from "../repository.js";
import type { CompletedStopVisit } from "../stopVisit.js";
import type {
  PriorVehicleState,
  RouteDirectionShape,
  RouteDirectionStopPoint,
  VehicleStateEstimate,
} from "../types.js";

export class InMemoryStateEstimationRepository implements StateEstimationRepository {
  readonly savedStates = new Map<string, VehicleStateEstimate>();
  /** Completed stop occupancies the service recorded, in the order it recorded them. */
  readonly stopVisits: CompletedStopVisit[] = [];
  activeHolds = new Set<string>();
  tripsByVehicleAndDirection = new Map<string, string>();
  /** When set, `recordStopVisit` throws it - covers the "stop history must never break live tracking" path. */
  stopVisitError: unknown = null;

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

  async recordStopVisit(visit: CompletedStopVisit): Promise<void> {
    // Cast for the same reason `saveVehicleState` does: the field is
    // deliberately `unknown` so a test can inject a non-Error rejection.
    if (this.stopVisitError !== null) throw this.stopVisitError as Error;
    this.stopVisits.push(visit);
    return Promise.resolve();
  }

  async loadActiveHold(vehicleId: string): Promise<boolean> {
    return Promise.resolve(this.activeHolds.has(vehicleId));
  }

  async resolveCurrentTrip(vehicleId: string, routeDirectionId: string): Promise<string | null> {
    return Promise.resolve(this.tripsByVehicleAndDirection.get(`${vehicleId}:${routeDirectionId}`) ?? null);
  }

  /**
   * Mirrors PgStateEstimationRepository's `where observed_at <= excluded`
   * guard, including its return value, so a test that exercises
   * out-of-order redelivery sees the same behaviour it would against
   * Postgres. `saveError`, when set, is thrown instead - used to cover the
   * persistence-failure path without a live database.
   */
  saveError: unknown = null;

  async saveVehicleState(estimate: VehicleStateEstimate): Promise<boolean> {
    if (this.saveError !== null) {
      // Rethrown verbatim, cast only to satisfy only-throw-error: tests
      // set a pg-shaped object carrying a SQLSTATE `code`, and wrapping it
      // in a real Error would erase the exact field under test.
      throw this.saveError as Error;
    }
    const existing = this.savedStates.get(estimate.vehicleId);
    if (existing && existing.observedAt > estimate.observedAt) {
      return Promise.resolve(false);
    }
    this.savedStates.set(estimate.vehicleId, estimate);
    return Promise.resolve(true);
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
