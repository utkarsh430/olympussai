import type { AuditEvent } from '@/lib/audit/auditLog';
import type { TransferDecisionKind } from './rebalanceModel';
import {
  isString,
  parseDecisionEvent,
  type DecisionEntry,
  type DecisionTrail,
  type TrailItem,
} from './decisionEvents';

/*
 * Pure reducers over stored decision events: the current decision per
 * transfer and the trail. They only read; they never dispatch anything.
 */

/** Baseline and each scenario keep their own decision per transfer. */
function keyOf(transferId: string, scenario: string | null): string {
  return JSON.stringify([scenario, transferId]);
}

/** Entries for the date, oldest first (the log stores newest first). */
function entriesFor(events: readonly AuditEvent[], operatingDate: string): DecisionEntry[] {
  return events
    .map(parseDecisionEvent)
    .filter((e): e is DecisionEntry => e !== null && e.operatingDate === operatingDate)
    .reverse();
}

function replay(entries: readonly DecisionEntry[]): ReadonlyMap<string, DecisionEntry> {
  const book = new Map<string, DecisionEntry>();
  for (const entry of entries) {
    const key = keyOf(entry.transferId, entry.scenario);
    if (entry.undoes === null) book.set(key, entry);
    else if (book.get(key)?.eventId === entry.undoes) book.delete(key);
  }
  return book;
}

/** The current decision per transfer (baseline and scenario kept apart) for one date. */
export function decisionsFor(
  events: readonly AuditEvent[],
  operatingDate: string,
): ReadonlyMap<string, DecisionEntry> {
  return replay(entriesFor(events, operatingDate));
}

/** Current decisions for the plan showing: the baseline (null) or one scenario's summary. */
export function decisionKindsFor(
  book: ReadonlyMap<string, DecisionEntry>,
  scenario: string | null,
): ReadonlyMap<string, TransferDecisionKind> {
  const kinds = new Map<string, TransferDecisionKind>();
  for (const entry of book.values()) {
    if (entry.scenario === scenario) kinds.set(entry.transferId, entry.decision);
  }
  return kinds;
}

/** Every decision and undo for the date, newest first, baseline and scenario listed apart. */
export function decisionTrail(events: readonly AuditEvent[], operatingDate: string): DecisionTrail {
  const entries = entriesFor(events, operatingDate);
  const book = replay(entries);
  const current = new Set([...book.values()].map((e) => e.eventId));
  const undone = new Set(entries.map((e) => e.undoes).filter(isString));
  const items: TrailItem[] = entries
    .map((e) => ({
      ...e,
      undoable: current.has(e.eventId),
      undone: undone.has(e.eventId),
    }))
    .reverse();
  return {
    baseline: items.filter((e) => e.scenario === null),
    scenario: items.filter((e) => e.scenario !== null),
  };
}
