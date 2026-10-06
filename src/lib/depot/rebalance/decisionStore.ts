import type { AuditEvent } from '@/lib/audit/auditLog';
import { parseDecisionEvent } from './decisionEvents';

/*
 * Transfer decisions keep their own storage slice beside the shared audit
 * log. The audit log is capped for every module together, so command-centre
 * traffic could push a decision out of it unseen; this slice has its own cap
 * and counts what it drops, so the trail can say so.
 */

export const DECISION_STORAGE_KEY = 'depot-transfer-decisions-v1';
/** About a month of a busy planner's decisions; older ones are dropped and counted. */
export const MAX_STORED_DECISIONS = 500;
const SLICE_VERSION = 1;

export interface DecisionSlice {
  /** Stored decision events, newest first, in the audit log's own shape. */
  readonly events: readonly AuditEvent[];
  /** How many older decisions the cap has dropped. */
  readonly dropped: number;
}

/** The two storage calls the slice needs, so tests can pass a fake. */
export interface StorageLike {
  readonly getItem: (key: string) => string | null;
  readonly setItem: (key: string, value: string) => void;
}

export const EMPTY_SLICE: DecisionSlice = { events: [], dropped: 0 };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Stored text as a slice; anything malformed reads as empty, and bad entries are skipped. */
export function parseDecisionSlice(raw: string | null): DecisionSlice {
  if (!raw) return EMPTY_SLICE;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY_SLICE;
  }
  if (!isRecord(parsed) || parsed.v !== SLICE_VERSION || !Array.isArray(parsed.events)) {
    return EMPTY_SLICE;
  }
  const events = parsed.events.filter(
    (e: unknown): e is AuditEvent => isRecord(e) && parseDecisionEvent(e) !== null,
  );
  const dropped = parsed.dropped;
  const count = typeof dropped === 'number' && Number.isInteger(dropped) && dropped > 0;
  return { events, dropped: count ? dropped : 0 };
}

export function serialiseSlice(slice: DecisionSlice): string {
  return JSON.stringify({ v: SLICE_VERSION, dropped: slice.dropped, events: slice.events });
}

/** Adds the newest event; past the cap the oldest go and are counted. */
export function appendToSlice(
  slice: DecisionSlice,
  event: AuditEvent,
  cap: number = MAX_STORED_DECISIONS,
): DecisionSlice {
  const all = [event, ...slice.events];
  const overflow = Math.max(0, all.length - cap);
  return { events: all.slice(0, cap), dropped: slice.dropped + overflow };
}

/** The stored text, or null when storage is missing or refuses to be read. */
export function readStoredSlice(storage: StorageLike | null): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(DECISION_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Writes the slice; false when storage is missing or refuses (private mode, quota). */
export function writeStoredSlice(storage: StorageLike | null, slice: DecisionSlice): boolean {
  if (!storage) return false;
  try {
    storage.setItem(DECISION_STORAGE_KEY, serialiseSlice(slice));
    return true;
  } catch {
    return false;
  }
}

/** Said under the trail once the cap has dropped anything; null until then. */
export function trailCapacityNote(slice: DecisionSlice): string | null {
  if (slice.dropped === 0) return null;
  const older =
    slice.dropped === 1 ? '1 older decision is' : `${slice.dropped} older decisions are`;
  return `The trail holds ${slice.events.length} decisions, the most it keeps; ${older} no longer listed.`;
}
