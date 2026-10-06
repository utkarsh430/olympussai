import { z } from 'zod';

/**
 * Depot projection of the LIVE UPSRTC feed.
 *
 * `CanonicalLiveBus` (see `canonical.ts`) is shaped for the command-centre map:
 * it ships to the browser every 15 seconds for ~9.6k buses, drops rows without
 * a GPS fix, and discards the fields a depot cares about. This second
 * projection is read from the same upstream payload, stays on the server, and
 * keeps those fields.
 *
 * Two rules distinguish it:
 *  - A bus with no valid position is still a bus the depot owns, so position is
 *    nullable and such rows are kept.
 *  - `vehicleStatus` comes only from upstream `vehicle_status`. Upstream also
 *    sends `status`, a different vocabulary that often disagrees; it is carried
 *    verbatim as `tripStatus` and never merged in.
 *
 * Times are ISO strings on the feed's own clock. Upstream stamps wall-clock
 * values with a `Z` suffix, so they are only ever compared with each other,
 * never with the server clock.
 */

export const depotVehicleStatusSchema = z.enum([
  'live',
  'stationary',
  'no_signal',
  'under_maintenance',
  'unknown',
]);
export type DepotVehicleStatus = z.infer<typeof depotVehicleStatusSchema>;

export const depotBusRowSchema = z.object({
  registrationNumber: z.string().min(1),
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
  speedKmph: z.number().min(0).nullable(),
  /** The raw ignition line. Unlike the map projection, never forced on by speed. */
  ignitionOn: z.boolean().nullable(),
  /** Device fix time (`timestamp`). */
  gpsTimestamp: z.string().nullable(),
  /** Time the upstream server received the packet (`receivedTime`). */
  receivedAt: z.string().nullable(),
  /** Upstream `home_depot`, digits only. */
  depotId: z
    .string()
    .regex(/^\d{1,6}$/)
    .nullable(),
  depotName: z.string().nullable(),
  vehicleStatus: depotVehicleStatusSchema,
  /** Upstream `status` verbatim (Offline / Live / Stationary / Towing). */
  tripStatus: z.string().nullable(),
  routeId: z.string().nullable(),
  routeName: z.string().nullable(),
  routeDescription: z.string().nullable(),
  journeyId: z.string().nullable(),
  journeyCode: z.string().nullable(),
  scheduledStart: z.string().nullable(),
  scheduledEnd: z.string().nullable(),
  actualStart: z.string().nullable(),
  /** Upstream `delay` in minutes, as sent. Plausibility is judged by consumers. */
  delayMinutes: z.number().nullable(),
  /** Upstream `distance`. The unit is not yet confirmed; do not present as km. */
  odometerRaw: z.number().nullable(),
  mainPowerOn: z.boolean().nullable(),
  mainVoltage: z.number().nullable(),
  /** Raw `tamperAlert` code (observed C / W / O). Its meaning is not asserted. */
  tamperCode: z.string().nullable(),
  emergency: z.boolean().nullable(),
});
export type DepotBusRow = z.infer<typeof depotBusRowSchema>;
