import { z } from 'zod';

/**
 * Canonical models for LIVE UPSRTC data only.
 * Everything in these models originates from the real UPSRTC upstream API.
 * Simulated scenario data uses separate types under src/lib/demo-scenarios.
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

export type UpstreamSource = 'live' | 'cache' | 'fixture';

export interface LiveFeedResponse {
  buses: CanonicalLiveBus[];
  fetchedAt: string;
  source: UpstreamSource;
  stale: boolean;
  recordCount: number;
  rejectedRecordCount: number;
}

export interface ScheduleResponse {
  schedule: CanonicalSchedule | null;
  fetchedAt: string;
  source: UpstreamSource;
  stale: boolean;
  message?: string;
}
