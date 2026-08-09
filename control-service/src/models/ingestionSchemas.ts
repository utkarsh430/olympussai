// Request schemas for the position-ingestion surface (POST /v1/positions).
//
// Deliberately a separate module from models/schemas.ts: that file is the
// web -> control-service command/query contract, this one is the telemetry
// intake contract. They change for different reasons and are owned by
// different parts of the system.

import { z } from 'zod';

/**
 * One GPS fix.
 *
 * `headingDegrees` is CLAMPED into [0, 360) rather than rejected.
 * `vehicle_states.heading_degrees` carries a `>= 0 and < 360` CHECK, and
 * estimator.ts writes `rawHeading ?? segmentHeading` straight through, so
 * an upstream that reports a bare 360 (several AVL vendors do) would turn
 * into a constraint violation on an otherwise perfectly good fix. Wrapping
 * is lossless for a compass bearing; rejecting is not.
 *
 * `.strict()` so a typo'd field name (`lng`, `speed`) is a loud 400 at the
 * envelope level rather than a silently-dropped value.
 */
export const positionEventSchema = z
  .object({
    vehicleId: z.string().min(1).max(64),
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
    headingDegrees: z
      .number()
      .finite()
      .transform((h) => ((h % 360) + 360) % 360)
      .nullable()
      .optional(),
    speedKmph: z.number().finite().min(0).max(200).nullable().optional(),
    observedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type PositionEventInput = z.infer<typeof positionEventSchema>;

/**
 * Batch, not single-event: a poll cycle carries ~665 vehicles, and
 * partial success (one unknown vehicle among 664 good fixes) can only be
 * expressed by a per-event result array.
 *
 * `autoRegisterVehicles` defaults FALSE so a typo'd registration number
 * from an ad-hoc caller cannot silently create master data. The in-process
 * poller sets it true, because for that path the live feed IS the vehicle
 * master.
 */
export const ingestPositionsRequestSchema = z.object({
  events: z.array(positionEventSchema).min(1).max(1000),
  autoRegisterVehicles: z.boolean().optional().default(false),
});

export type IngestPositionsRequest = z.infer<typeof ingestPositionsRequestSchema>;

/** One rejected event, reported positionally so the caller can correlate it with its input. */
export interface RejectedPositionEvent {
  index: number;
  vehicleId: string;
  code: string;
  message: string;
}

export interface IngestPositionsResponse {
  accepted: number;
  rejected: RejectedPositionEvent[];
}
