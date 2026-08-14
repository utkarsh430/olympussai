import 'server-only';

/**
 * Server-only read of one vehicle's arrival prediction from the control
 * service, validated against the wire schema before anything downstream sees it.
 *
 * ─── DELIBERATELY NOT CACHED, AND DELIBERATELY NOT FALLING BACK ──────────
 *
 * Every other reader in this directory (pilotData.ts, observabilityData.ts)
 * implements the fallback ladder from docs/CONTROL_SERVICE_INTEGRATION.md §2:
 * live -> last-known-good cached response, flagged stale -> unavailable. That
 * is right for a dashboard, whose job is to keep showing SOMETHING.
 *
 * It is wrong here, and this is the one design decision in this file. A cached
 * arrival prediction is a countdown computed from a bus position that was
 * already up to ten minutes old when it was computed, served again later with
 * no way for the driver to tell. The value decays to nothing within one poll
 * interval and the harm does not. So a failed read produces a NULL, and the
 * route above turns that into an explicit "arrival times are unavailable"
 * rather than into a stale number with a stale badge next to it.
 *
 * The control service already declines rather than guesses; this layer must not
 * quietly re-add a guess on top of it.
 */
import { fetchControlService } from './client';
import { arrivalPredictionResponseSchema, type ArrivalPredictionResponse } from '@/models/control';

export async function fetchVehicleArrivals(
  vehicleId: string,
  options: { limit?: number; horizonSeconds?: number } = {},
): Promise<ArrivalPredictionResponse> {
  const raw = await fetchControlService(`/v1/vehicles/${encodeURIComponent(vehicleId)}/arrivals`, {
    query: {
      limit: options.limit === undefined ? undefined : String(options.limit),
      horizonSeconds: options.horizonSeconds === undefined ? undefined : String(options.horizonSeconds),
    },
  });
  // Throws on a malformed payload rather than returning a partly-parsed object.
  // A response missing `status` would otherwise flow through as neither branch
  // of the union and render as an empty, unexplained list.
  return arrivalPredictionResponseSchema.parse(raw);
}
