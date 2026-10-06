import type { DepotFeedEnvelope } from '../api';

/**
 * Route catalogue contract: a route's real stop list, read on demand from the
 * upstream route-details API through one bus that is running it.
 */

export interface RouteStop {
  readonly name: string;
  readonly sequence: number;
  readonly lat: number | null;
  readonly lng: number | null;
  /** Scheduled wall-clock time, `HH:MM:SS`. */
  readonly scheduled: string | null;
}

export interface RouteProfile {
  /** The schedule's own route name; empty when the schedule carried none. */
  readonly routeName: string;
  /** True only when the schedule's own route name equalled the requested one. */
  readonly routeNameConfirmed: boolean;
  readonly routeId: string | null;
  readonly description: string | null;
  readonly direction: string | null;
  /** First and last stop by sequence, located or not. */
  readonly origin: RouteStop | null;
  readonly destination: RouteStop | null;
  readonly stops: readonly RouteStop[];
  /** Stops the upstream gave no usable coordinates for. */
  readonly unlocatedStops: number;
  readonly scheduledDurationMin: number | null;
  /** Straight-line sum over located stops; null with fewer than two of them. */
  readonly lengthKm: number | null;
  /** Registration the profile was read from. */
  readonly sampledFrom: string;
  readonly operatingDate: string;
}

export type RouteProfileResult =
  | { readonly status: 'ok'; readonly profile: RouteProfile }
  | {
      readonly status: 'unavailable';
      readonly reason: 'no_bus_on_route' | 'no_schedule' | 'upstream_error';
    };

/**
 * Body of `GET /api/upsrtc/depot/route/[routeName]`: the result and the envelope of
 * the snapshot the route read (`fetchedAt` is that snapshot's fetch time, `stale`
 * the depot pages' own freshness rule), like every other depot response.
 */
export type RouteProfileResponse = RouteProfileResult & DepotFeedEnvelope;
