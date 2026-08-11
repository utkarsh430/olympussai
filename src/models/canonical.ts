import { z } from 'zod';

/**
 * Canonical models for LIVE UPSRTC data only.
 * Everything in these models originates from the real UPSRTC upstream API.
 * Simulated scenario data uses separate types under src/lib/demo-scenarios.
 * Persistent control service entities (route/control-point, trip/block,
 * vehicle/headway state, incident, recommendation, command, outcome) use
 * separate types under ./control.ts — see control-service/README.md for
 * why that datastore is not this app's own.
 */

export const dataQualitySchema = z.enum(['good', 'degraded', 'stale']);
export type DataQuality = z.infer<typeof dataQualitySchema>;

export const canonicalLiveBusSchema = z.object({
  id: z.string(),
  registrationNumber: z.string(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  speedKmph: z.number().nullable(),
  headingDegrees: z.number().nullable(),
  depotName: z.string().nullable(),
  routeId: z.string().nullable(),
  routeName: z.string().nullable(),
  serviceNumber: z.string().nullable(),
  tripId: z.string().nullable(),
  vehicleType: z.string().nullable(),
  gpsTimestamp: z.string().nullable(),
  lastUpdatedAt: z.string(),
  ignitionOn: z.boolean().nullable(),
  rawStatus: z.string().nullable(),
  /**
   * Operating date (YYYY-MM-DD) of the vehicle's current assignment. The
   * schedule endpoint is keyed on this, not on today's calendar date — an
   * overnight service still runs under the date it departed.
   */
  tripDate: z.string().nullable(),
  dataQuality: dataQualitySchema,
});
export type CanonicalLiveBus = z.infer<typeof canonicalLiveBusSchema>;

export const canonicalStopSchema = z.object({
  id: z.string(),
  name: z.string(),
  sequence: z.number(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  scheduledArrival: z.string().nullable(),
  scheduledDeparture: z.string().nullable(),
});
export type CanonicalStop = z.infer<typeof canonicalStopSchema>;

export const canonicalScheduleSchema = z.object({
  registrationNumber: z.string(),
  date: z.string(),
  routeId: z.string().nullable(),
  routeName: z.string().nullable(),
  originName: z.string().nullable(),
  destinationName: z.string().nullable(),
  tripId: z.string().nullable(),
  scheduledDeparture: z.string().nullable(),
  scheduledArrival: z.string().nullable(),
  direction: z.string().nullable(),
  /**
   * How many journeys the upstream listed for this bus on this date. The
   * schedule above describes one of them — the one the vehicle is running.
   */
  tripCount: z.number(),
  stops: z.array(canonicalStopSchema),
});
export type CanonicalSchedule = z.infer<typeof canonicalScheduleSchema>;

/**
 * Provenance of a canonical payload. Four states, deliberately distinct:
 *
 * • 'live'        — fetched fresh from the upstream API this cycle.
 * • 'cache'       — a real upstream response served from this process's TTL
 *                   cache. `stale: false` = still inside the TTL (the normal
 *                   healthy fast path); `stale: true` = last-known-good served
 *                   after a failed refresh. Legitimate degradation: it is real
 *                   data that was really observed, only older than it looks.
 * • 'fixture'     — bundled sample data that describes vehicles/schedules
 *                   which do not exist. Only ever produced when someone has
 *                   explicitly asked for it (NEXT_PUBLIC_DEMO_MODE=1, or
 *                   ALLOW_FIXTURE_FALLBACK on a failed call); see
 *                   src/lib/upsrtc/fixtureFallback.ts.
 * • 'unavailable' — the upstream could not be reached and no real cached copy
 *                   exists. Carries zero rows. This is NOT the same as a
 *                   successful response that listed zero vehicles: that is a
 *                   quiet night and stays 'live'; this is an incident.
 */
export type UpstreamSource = 'live' | 'cache' | 'fixture' | 'unavailable';

export interface LiveFeedResponse {
  buses: CanonicalLiveBus[];
  fetchedAt: string;
  source: UpstreamSource;
  stale: boolean;
  recordCount: number;
  rejectedRecordCount: number;
  /** Human-readable provenance/failure detail. Set on 'unavailable' and 'fixture'. */
  message?: string;
}

export interface ScheduleResponse {
  schedule: CanonicalSchedule | null;
  fetchedAt: string;
  source: UpstreamSource;
  stale: boolean;
  message?: string;
}
