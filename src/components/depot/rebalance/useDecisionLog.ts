'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { appendAuditEvent, readAuditLog, writeAuditLog } from '@/lib/audit/auditLog';
import { withoutNote, type NewAuditEvent } from '@/lib/depot/rebalance/decisionEvents';
import {
  DECISION_STORAGE_KEY,
  UNREADABLE_TRAIL_KEY,
  appendToSlice,
  clearStoredTrail,
  readDecisionTrail,
  readStoredSlice,
  setAsideUnreadable,
  trailStateNote,
  writeStoredSlice,
  type ClearableStorage,
  type DecisionSlice,
} from '@/lib/depot/rebalance/decisionStore';
import type { RecordOutcome } from '@/lib/depot/rebalance/decisionWording';

/** Same-tab writes do not fire `storage`, so the hook announces its own. */
const LOCAL_WRITE_EVENT = 'depot-decisions-written';

function storage(): ClearableStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function subscribe(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent): void => {
    // A null key means another tab cleared storage.
    if (event.key === null || event.key === DECISION_STORAGE_KEY || event.key === UNREADABLE_TRAIL_KEY) {
      onChange();
    }
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener(LOCAL_WRITE_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(LOCAL_WRITE_EVENT, onChange);
  };
}

/** The raw text is the snapshot: a string compares by value, so renders stay stable. */
function snapshot(): string | null {
  return readStoredSlice(storage());
}

/** Whether an unreadable trail is kept aside, as a boolean so renders stay stable. */
function keptAsideSnapshot(): boolean {
  try {
    return storage()?.getItem(UNREADABLE_TRAIL_KEY) != null;
  } catch {
    return false;
  }
}

function serverSnapshot(): null {
  return null;
}

function serverKeptAside(): boolean {
  return false;
}

export interface DecisionLog {
  readonly slice: DecisionSlice;
  /** What of the stored record is not listed, and why; null when all of it is. */
  readonly stateNote: string | null;
  /** Something is stored in this browser that Clear trail would remove. */
  readonly canClear: boolean;
  /**
   * Writes the decision slice, then the audit event. `refused` when storage refused the
   * slice (no audit event exists then); `trail_only` when the audit log refused its copy.
   */
  readonly record: (event: NewAuditEvent) => RecordOutcome;
  /** Removes the trail kept in this browser; false when storage refused. */
  readonly clear: () => boolean;
}

/**
 * Transfer decisions from their own storage slice, kept in step with other
 * tabs through the `storage` event. Each decision is also written to the
 * shared audit log without its note; that log keeps its own behaviour.
 */
export function useDecisionLog(): DecisionLog {
  const raw = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const keptAside = useSyncExternalStore(subscribe, keptAsideSnapshot, serverKeptAside);
  const trail = useMemo(() => readDecisionTrail(raw), [raw]);
  const record = useCallback((event: NewAuditEvent): RecordOutcome => {
    const store = storage();
    const current = readStoredSlice(store);
    const read = readDecisionTrail(current);
    // A trail that cannot be read is kept aside before a new one starts, never written over.
    if (read.unreadable && current !== null && !setAsideUnreadable(store, current)) {
      return 'refused';
    }
    const log = appendAuditEvent(readAuditLog(), event);
    const stored = log[0];
    if (!stored) return 'refused';
    // The slice is what the page reads, so it goes first: if storage refuses it, no audit
    // event is written. The audit log swallows its own refusal, so it is read back.
    if (!writeStoredSlice(store, appendToSlice(read.slice, stored))) return 'refused';
    writeAuditLog([withoutNote(stored), ...log.slice(1)]);
    const audited = readAuditLog()[0]?.id === stored.id;
    window.dispatchEvent(new Event(LOCAL_WRITE_EVENT));
    return audited ? 'recorded' : 'trail_only';
  }, []);
  const clear = useCallback((): boolean => {
    const cleared = clearStoredTrail(storage());
    window.dispatchEvent(new Event(LOCAL_WRITE_EVENT));
    return cleared;
  }, []);
  return {
    slice: trail.slice,
    stateNote: trailStateNote(trail, keptAside),
    canClear: raw !== null || keptAside,
    record,
    clear,
  };
}
