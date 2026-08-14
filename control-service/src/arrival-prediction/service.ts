// Orchestration: gather what the prediction core needs, then call it once.
//
// The split is deliberate and matches src/headway/. Everything that DECIDES
// anything lives in predict.ts / speed.ts / dwell.ts and is a pure function;
// this file only fetches. That is what makes it possible to unit-test the
// honesty guards exhaustively - each is a branch of a pure function over an
// injected clock - rather than trying to provoke a `latitude 0.000` reading out
// of a live database.
//
// The read order is short-circuiting on purpose: a vehicle that is off route
// (69% of the fleet right now) costs exactly one query, because there is no
// route-direction to load geometry, stops or peers for.

import { logger } from '../lib/logger.js';
import {
  MAX_STATE_AGE_SECONDS,
  predictArrivals,
  type PredictArrivalsInput,
} from './predict.js';
import * as repo from './repository.js';
import type { ArrivalPredictionResponse } from './types.js';

export interface GetVehicleArrivalsOptions {
  horizonSeconds?: number;
  stopLimit?: number;
  /** Injectable so tests are deterministic. Production always passes the real clock. */
  now?: Date;
}

export async function getVehicleArrivals(
  vehicleId: string,
  options: GetVehicleArrivalsOptions = {},
): Promise<ArrivalPredictionResponse> {
  const now = options.now ?? new Date();
  const state = await repo.loadVehicleStateForPrediction(vehicleId);

  // Only asked when there is no state row, so the common path stays one query.
  // The distinction matters to whoever is debugging: "this bus has never
  // reported" and "there is no such bus" are different problems with different
  // owners.
  const vehicleKnown = state !== null || (await repo.vehicleExists(vehicleId));

  const base: PredictArrivalsInput = {
    vehicleId,
    now,
    vehicleKnown,
    state,
    geometry: null,
    stops: [],
    peers: [],
    isHeldByController: false,
    horizonSeconds: options.horizonSeconds,
    stopLimit: options.stopLimit,
  };

  if (state === null || state.routeDirectionId === null) {
    return predictArrivals(base);
  }

  const [geometry, stops, peers, isHeldByController] = await Promise.all([
    repo.loadRouteGeometry(state.routeDirectionId),
    repo.loadRouteDirectionStops(state.routeDirectionId),
    repo.loadPeerSpeeds(state.routeDirectionId, MAX_STATE_AGE_SECONDS),
    repo.loadActiveHold(vehicleId),
  ]);

  const result = predictArrivals({ ...base, geometry, stops, peers, isHeldByController });

  if (result.prediction.status === 'unavailable') {
    // Debug, not warn: for most of this fleet a refusal is the CORRECT answer,
    // not an incident. Logged at all so the reason distribution is observable -
    // if `no_speed_basis` ever swamps the others, the speed model needs work,
    // and that should be visible without instrumenting it later.
    logger.debug(
      { vehicleId, reason: result.prediction.reason, routeDirectionId: result.prediction.routeDirectionId },
      'arrival prediction unavailable',
    );
  }

  return result;
}
