'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { appendAuditEvent, readAuditLog, writeAuditLog } from '@/lib/audit/auditLog';
import type { NewAuditEvent } from '@/lib/depot/rebalance/decisionEvents';
import {
  DECISION_STORAGE_KEY,
  appendToSlice,
  parseDecisionSlice,
  readStoredSlice,
  writeStoredSlice,
  type DecisionSlice,
  type StorageLike,
} from '@/lib/depot/rebalance/decisionStore';

/** Same-tab writes do not fire `storage`, so the hook announces its own. */
const LOCAL_WRITE_EVENT = 'depot-decisions-written';

function storage(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function subscribe(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent): void => {
    // A null key means another tab cleared storage.
    if (event.key === null || event.key === DECISION_STORAGE_KEY) onChange();
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

function serverSnapshot(): string | null {
  return null;
}

export interface DecisionLog {
  readonly slice: DecisionSlice;
  /**
   * Writes the decision slice, then the audit event; false when storage refused the slice,
   * in which case no audit event exists.
   */
  readonly record: (event: NewAuditEvent) => boolean;
}

/**
 * Transfer decisions from their own storage slice, kept in step with other
 * tabs through the `storage` event. Each decision is also written to the
 * shared audit log, which keeps its own behaviour.
 */
export function useDecisionLog(): DecisionLog {
  const raw = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const slice = useMemo(() => parseDecisionSlice(raw), [raw]);
  const record = useCallback((event: NewAuditEvent): boolean => {
    const log = appendAuditEvent(readAuditLog(), event);
    const stored = log[0];
    if (!stored) return false;
    // The slice is what the page reads, so it goes first: if storage refuses it, no audit
    // event is written and the two records cannot disagree.
    const next = appendToSlice(parseDecisionSlice(readStoredSlice(storage())), stored);
    if (!writeStoredSlice(storage(), next)) return false;
    writeAuditLog(log);
    window.dispatchEvent(new Event(LOCAL_WRITE_EVENT));
    return true;
  }, []);
  return { slice, record };
}
