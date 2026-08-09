// The one path a position event takes into this service.
//
// Both entrypoints - POST /v1/positions (routes/positions.ts) and the
// in-process GPS poller (scheduler/gpsPoll.ts) - call through here, so
// there is exactly one place that decides how a fix becomes durable state
// and how a failure is classified. A second copy of this logic would drift.
//
// The write-through to `stateStore` deliberately does NOT live inside
// StateEstimationService: that class is a pure library over an injected
// repository and is unit-tested against an in-memory fake, so importing the
// process-wide store singleton into it would make it untestable and couple
// the estimator to the HTTP process's lifecycle.

import { getPool } from '../db/pool.js';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import type { RejectedPositionEvent } from '../models/ingestionSchemas.js';
import { toIngestionError } from '../state-estimation/errors.js';
import { getStateEstimationService } from '../state-estimation/singleton.js';
import type { PositionEvent, VehicleStateEstimate } from '../state-estimation/types.js';
import { vehicleStateRowFromEstimate } from '../state/fromEstimate.js';
import { stateStore } from '../state/store.js';

/** Timestamp of the most recently ingested event, and how many the last batch accepted - surfaced on /readyz. */
interface IngestStats {
  lastEventAt: string | null;
  eventsLastCycle: number;
}

const stats: IngestStats = { lastEventAt: null, eventsLastCycle: 0 };

export function getIngestStats(): IngestStats {
  return { ...stats };
}

/** Test-only: reset the observability counters between cases. */
export function _resetIngestStatsForTests(): void {
  stats.lastEventAt = null;
  stats.eventsLastCycle = 0;
}

/**
 * Estimates state for one fix, persists it, and mirrors the result into the
 * in-memory runtime store.
 *
 * The stateStore write is skipped when the repository reports the row was
 * not written (an out-of-order fix losing to a newer persisted one) - that
 * skip is what keeps this cache and the vehicle_states table agreeing about
 * which fix won.
 */
export async function ingestPositionEvent(event: PositionEvent): Promise<VehicleStateEstimate> {
  const { estimate, persisted } = await getStateEstimationService().processPositionEventWithOutcome(event);

  if (persisted) {
    stateStore.upsertVehicleState(
      vehicleStateRowFromEstimate(estimate, stateStore.getVehicleState(event.vehicleId)),
    );
    stats.lastEventAt = new Date().toISOString();
  }

  return estimate;
}

/**
 * Creates the vehicles rows a batch refers to, so a fix for a bus this
 * service has never seen doesn't fail on vehicle_states' foreign key.
 *
 * Only ever called when the caller explicitly opted in
 * (`autoRegisterVehicles`), because this writes master data: for the GPS
 * poller the live feed IS the vehicle master, but for an arbitrary API
 * caller a typo'd registration number would silently create a phantom bus.
 */
async function autoRegisterVehicles(vehicleIds: readonly string[]): Promise<void> {
  const unique = [...new Set(vehicleIds)];
  if (unique.length === 0) return;
  await getPool().query(
    `insert into vehicles (id, registration_number)
     select id, id from unnest($1::text[]) as t(id)
     on conflict do nothing`,
    [unique],
  );
}

export interface IngestBatchResult {
  accepted: number;
  rejected: RejectedPositionEvent[];
}

/**
 * Ingests a batch, classifying failures PER EVENT.
 *
 * This is the whole point of the batch shape: at 665 vehicles per poll
 * cycle, letting one unregistered bus or one out-of-range heading reject
 * the other 664 good fixes would mean a single bad row blinds the fleet.
 * An error this module cannot classify (i.e. not a known SQLSTATE) is
 * rethrown and fails the batch, because an unrecognised failure is a bug,
 * not a data problem, and hiding it in a per-event `rejected` entry would
 * make it invisible.
 */
export async function ingestPositionEvents(
  events: readonly PositionEvent[],
  options: { autoRegisterVehicles?: boolean } = {},
): Promise<IngestBatchResult> {
  if (options.autoRegisterVehicles) {
    await autoRegisterVehicles(events.map((e) => e.vehicleId));
  }

  let accepted = 0;
  const rejected: RejectedPositionEvent[] = [];

  for (const [index, event] of events.entries()) {
    try {
      await ingestPositionEvent(event);
      accepted += 1;
    } catch (error) {
      // AppError is already classified (e.g. the pre-rehydration 503 the
      // service raises); anything else gets mapped from its SQLSTATE, and
      // toIngestionError rethrows whatever it cannot recognise.
      const appError = error instanceof AppError ? error : toIngestionError(error, event.vehicleId);
      rejected.push({
        index,
        vehicleId: event.vehicleId,
        code: appError.code,
        message: appError.message,
      });
    }
  }

  stats.eventsLastCycle = accepted;
  if (rejected.length > 0) {
    logger.warn(
      { accepted, rejected: rejected.length, codes: [...new Set(rejected.map((r) => r.code))] },
      'position batch partially rejected',
    );
  }

  return { accepted, rejected };
}
