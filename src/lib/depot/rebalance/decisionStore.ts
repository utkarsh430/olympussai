import type { AuditEvent } from '@/lib/audit/auditLog';
import { parseDecisionEvent } from './decisionEvents';

/*
 * Transfer decisions keep their own storage slice beside the shared audit
 * log. The audit log is capped for every module together, so command-centre
 * traffic could push a decision out of it unseen; this slice has its own cap
 * and counts what it drops, so the trail can say so.
 */

export const DECISION_STORAGE_KEY = 'depot-transfer-decisions-v1';
/** Where a stored trail that cannot be read is kept, unchanged, before a new one starts. */
export const UNREADABLE_TRAIL_KEY = 'depot-transfer-decisions-v1-unreadable';
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

/** Storage that can also remove a key, for clearing the trail. */
export interface ClearableStorage extends StorageLike {
  readonly removeItem: (key: string) => void;
}

/** The stored trail as read, with what could not be read. */
export interface StoredTrail {
  readonly slice: DecisionSlice;
  /** Text was stored but is not a trail (damaged, or another version): not an empty trail. */
  readonly unreadable: boolean;
  /** Entries of a readable trail that failed their checks and are not listed. */
  readonly skipped: number;
}

export const EMPTY_SLICE: DecisionSlice = { events: [], dropped: 0 };
const UNREADABLE: StoredTrail = { slice: EMPTY_SLICE, unreadable: true, skipped: 0 };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Stored text as a trail. Text that is not a trail is reported as unreadable, never read
 * as an empty trail, so the caller can keep it from being written over; entries that fail
 * their checks are skipped and counted.
 */
export function readDecisionTrail(raw: string | null): StoredTrail {
  if (!raw) return { slice: EMPTY_SLICE, unreadable: false, skipped: 0 };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return UNREADABLE;
  }
  if (!isRecord(parsed) || parsed.v !== SLICE_VERSION || !Array.isArray(parsed.events)) {
    return UNREADABLE;
  }
  // Newest first, so slicing before the checks bounds the work a damaged store can cause.
  const bounded: readonly unknown[] = parsed.events.slice(0, MAX_STORED_DECISIONS);
  const events = bounded.filter(
    (e: unknown): e is AuditEvent => isRecord(e) && parseDecisionEvent(e) !== null,
  );
  const dropped = parsed.dropped;
  const count = typeof dropped === 'number' && Number.isInteger(dropped) && dropped > 0;
  return {
    slice: { events, dropped: count ? dropped : 0 },
    unreadable: false,
    skipped: bounded.length - events.length,
  };
}

/** Stored text as a slice: an unreadable store gives the empty slice. */
export function parseDecisionSlice(raw: string | null): DecisionSlice {
  return readDecisionTrail(raw).slice;
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

/** Keeps an unreadable trail's text under its own key; false when storage refuses. */
export function setAsideUnreadable(storage: StorageLike | null, raw: string): boolean {
  if (!storage) return false;
  try {
    storage.setItem(UNREADABLE_TRAIL_KEY, raw);
    return true;
  } catch {
    return false;
  }
}

/** Removes the trail and any trail kept aside; false when storage is missing or refuses. */
export function clearStoredTrail(storage: ClearableStorage | null): boolean {
  if (!storage) return false;
  try {
    storage.removeItem(DECISION_STORAGE_KEY);
    storage.removeItem(UNREADABLE_TRAIL_KEY);
    return true;
  } catch {
    return false;
  }
}

/** Said under the trail when part of the stored record is not listed; null when all of it is. */
export function trailStateNote(trail: StoredTrail, keptAside: boolean): string | null {
  const lines: string[] = [];
  if (trail.unreadable) {
    lines.push(
      'The decision trail stored in this browser could not be read, so none is listed. It is not written over: the next decision keeps it aside, unchanged, and starts a new trail.',
    );
  } else if (keptAside) {
    lines.push(
      'An earlier decision trail in this browser could not be read; it is kept aside, unchanged, and is not listed.',
    );
  }
  if (trail.skipped === 1) lines.push('1 stored entry could not be read and is not listed.');
  if (trail.skipped > 1) {
    lines.push(`${trail.skipped} stored entries could not be read and are not listed.`);
  }
  return lines.length === 0 ? null : lines.join(' ');
}

/** Said under the trail once the cap has dropped anything; null until then. */
export function trailCapacityNote(slice: DecisionSlice): string | null {
  if (slice.dropped === 0) return null;
  // The trail shows one date; this counts the whole record, so it says so.
  const entries = slice.events.length === 1 ? '1 entry' : `${slice.events.length} entries`;
  return `The decision record holds ${entries} across all dates; older ones are no longer listed.`;
}
