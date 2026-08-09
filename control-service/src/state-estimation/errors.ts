// Translates a Postgres driver error raised while persisting a vehicle
// state into an AppError with a stable code and an accurate HTTP status.
//
// Why this lives at the ingestion boundary rather than inside
// StateEstimationService: the service is a pure library over an injected
// repository (an in-memory fake in tests), so it must not assume its
// persistence layer speaks SQLSTATE. The route applies this PER EVENT, so
// one vehicle with a bad foreign key never fails the other 664 fixes in
// the same batch.
//
// Before this existed, processPositionEvent rethrew the raw pg error, which
// the generic error handler turned into an opaque 500 - indistinguishable
// from a real bug, and un-actionable for the caller.

import { AppError } from '../lib/errors.js';

/** The subset of pg's error shape we depend on. */
interface PostgresErrorLike {
  code?: unknown;
  constraint?: unknown;
  detail?: unknown;
}

function sqlState(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const code = (error as PostgresErrorLike).code;
  return typeof code === 'string' ? code : null;
}

/**
 * Maps a persistence failure to an AppError, or rethrows anything we can't
 * classify. Fail loud on the unknown: silently bucketing an unrecognised
 * SQLSTATE into a 4xx would hide a real defect behind a "client error".
 *
 *  23503 foreign_key_violation  -> unknown_vehicle    422
 *  23514 check_violation        -> invalid_position   422
 *  57014 query_canceled         -> ingest_unavailable 503
 *  08xxx connection exception   -> ingest_unavailable 503
 */
export function toIngestionError(error: unknown, vehicleId: string): AppError {
  const code = sqlState(error);

  if (code === '23503') {
    return new AppError(
      'unknown_vehicle',
      `vehicle ${vehicleId} is not registered in this control service`,
      422,
    );
  }

  if (code === '23514') {
    return new AppError(
      'invalid_position',
      `position for vehicle ${vehicleId} violates a vehicle_states constraint`,
      422,
    );
  }

  if (code !== null && (code === '57014' || code.startsWith('08'))) {
    return new AppError(
      'ingest_unavailable',
      'the control-service datastore is not accepting writes right now',
      503,
    );
  }

  throw error;
}

/**
 * True when `error` is one this module would classify. Lets a caller decide
 * whether to attempt classification without entering a try/catch just to
 * find out that toIngestionError is going to rethrow.
 */
export function isClassifiableIngestionError(error: unknown): boolean {
  const code = sqlState(error);
  if (code === null) return false;
  return code === '23503' || code === '23514' || code === '57014' || code.startsWith('08');
}
