// GET /v1/vehicle-states - web -> control-service, service-token
// authenticated. Reads the in-memory state store (rehydrated on boot, kept
// current by the state estimator - out of scope for this ticket) rather
// than hitting Postgres on every poll, since this is the same data path
// /readyz already guarantees is populated before the instance takes
// traffic.
import { Router } from 'express';
import { AppError, sendError } from '../lib/errors.js';
import { listVehicleStatesQuerySchema } from '../models/schemas.js';
import { stateStore, type VehicleStateRow } from '../state/store.js';

export const vehicleStatesRouter = Router();

/**
 * Maps the in-memory row to the full `vehicleStateSchema` wire shape
 * (src/models/control.ts in the web app). `position` / `headingDegrees` /
 * `occupancyCount` / `occupancyLoadBand` are reported null rather than
 * omitted: the in-memory store doesn't carry them yet (a separate,
 * not-yet-built piece of work - see control-service/README.md), and the
 * schema's callers (this ticket's observability dashboard) must be able to
 * tell "not tracked" apart from a malformed response instead of getting a
 * response that fails validation outright.
 */
function toWireVehicleState(row: VehicleStateRow) {
  return {
    vehicleId: row.vehicleId,
    tripId: row.tripId,
    routeDirectionId: row.routeDirectionId,
    position: null,
    distanceAlongRouteMeters: row.distanceAlongRouteMeters,
    speedKmph: row.speedKmph,
    headingDegrees: null,
    stopState: row.stopState,
    currentStopId: row.currentStopId,
    occupancyCount: null,
    occupancyLoadBand: null,
    confidence: row.confidence,
    observedAt: row.observedAt,
  };
}

// Synchronous handler (in-memory read, no I/O): Express 4 catches a
// synchronous throw from a route handler and forwards it to errorHandler
// on its own, so this deliberately skips asyncHandler rather than wrapping
// a function with no await in one.
vehicleStatesRouter.get('/v1/vehicle-states', (req, res) => {
  const parsed = listVehicleStatesQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    sendError(res, new AppError('invalid_request', 'Invalid query parameters', 400, parsed.error.flatten()));
    return;
  }
  const vehicleStates = stateStore.listVehicleStates(parsed.data.routeDirectionId).map(toWireVehicleState);
  res.status(200).json({ vehicleStates });
});
