// Detecting that a vehicle has FINISHED occupying a stop.
//
// The estimator already knows which stop a vehicle is at and when it got
// there (`currentStopId`, `stopEnteredAt`), and overwrites both on every fix.
// This is the pure rule that spots the moment one of those occupancies ended,
// so it can be written to `stop_visits` before it is overwritten - which is
// what turns a current-state table into the arrival/departure history that
// departure-to-departure headway, dwell modelling and on-time performance all
// need and none of which existed.
//
// PURE, and separate from the estimator itself, because the estimator is
// about where a vehicle IS and this is about a transition BETWEEN two of its
// states. Keeping the rule here means it can be reasoned about against a pair
// of states directly, rather than by driving a sequence of GPS fixes through
// the whole map-matching pipeline to provoke it.
import type { PriorVehicleState, VehicleStateEstimate } from './types.js';

export interface CompletedStopVisit {
  vehicleId: string;
  routeDirectionId: string;
  stopId: string;
  tripId: string | null;
  /** First fix at which the vehicle was associated with this stop - inside its
   *  geofence, or closing on it within the approach window. See
   *  stopStateClassifier.isAtStop; the two windows must stay the same one. */
  arrivedAt: string;
  /** First fix at which that association had ended - see the migration's precision note. */
  departedAt: string;
}

/**
 * The visit that just ended, or null if none did.
 *
 * A visit ends when the vehicle was at a stop on the previous fix and is no
 * longer at THAT stop on this one - whether it has moved on to the next stop,
 * to no stop at all, or off route entirely. All three are the same event from
 * the stop's point of view: the bus left.
 *
 * ─── WHAT IS DELIBERATELY NOT TREATED AS A DEPARTURE ─────────────────────
 *
 * A vehicle still at the same stop, however its `stopState` has changed
 * within it (approaching -> dwelling -> held_by_controller). A held bus has
 * not departed, and recording a departure the moment a controller hold began
 * would make every successful hold look like a stop visit that ended early -
 * corrupting the exact measurement used to judge whether holds work.
 *
 * ─── WHY A MISSING ROUTE-DIRECTION DISCARDS THE VISIT ────────────────────
 *
 * `stop_visits.route_direction_id` is NOT NULL, and the honest reason is
 * stronger than the schema: a departure that cannot be attributed to a
 * direction cannot be differenced against the departure before it, because
 * "the previous bus at this stop" is only meaningful within one direction of
 * travel. A visit recorded without one would silently pair up northbound and
 * southbound buses and report a headway neither of them ran.
 */
export function detectCompletedStopVisit(
  prior: PriorVehicleState | null,
  estimate: VehicleStateEstimate,
): CompletedStopVisit | null {
  if (!prior?.currentStopId || !prior.stopEnteredAt) return null;

  // Still at the same stop: nothing has ended yet.
  if (estimate.currentStopId === prior.currentStopId) return null;

  const routeDirectionId = prior.routeDirectionId ?? estimate.routeDirectionId;
  if (!routeDirectionId) return null;

  const arrivedAt = prior.stopEnteredAt;
  const departedAt = estimate.observedAt;

  // An out-of-order fix can carry a timestamp older than the arrival it would
  // be closing. `saveVehicleState`'s own guard drops such fixes before the
  // cache advances, so this is a belt-and-braces check rather than the
  // primary defence - but a negative dwell written here would survive as a
  // permanently wrong row in an append-only table.
  if (new Date(departedAt).getTime() < new Date(arrivedAt).getTime()) return null;

  return {
    vehicleId: estimate.vehicleId,
    routeDirectionId,
    stopId: prior.currentStopId,
    tripId: estimate.tripId,
    arrivedAt,
    departedAt,
  };
}
