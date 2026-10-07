import type { AuditEvent } from '@/lib/audit/auditLog';
import type { RowDecision, TransferDecisionKind } from './rebalanceModel';
import {
  parseDecisionEvent,
  type DecisionEntry,
  type DecisionTrail,
  type TrailFlags,
  type TrailItem,
} from './decisionEvents';

/*
 * Pure reducers over stored decision events: the current decision per
 * transfer and the trail. They only read; they never dispatch anything. The
 * replay itself is shared with the route proposals' reducers.
 */

/** Baseline and each scenario key keep their own decision per transfer. */
function keyOf(transferId: string, scenario: string | null): string {
  return JSON.stringify([scenario, transferId]);
}

/** Entries for the date, oldest first (storage keeps newest first). */
function entriesFor(events: readonly AuditEvent[], operatingDate: string): DecisionEntry[] {
  return events
    .map(parseDecisionEvent)
    .filter((e): e is DecisionEntry => e !== null && e.operatingDate === operatingDate)
    .reverse();
}

/** A recorded decision or undo, as the replay needs it. */
export interface Replayable {
  readonly eventId: string;
  /** Id of the decision this event withdraws; null for a decision. */
  readonly undoes: string | null;
}

export interface Replay<T extends Replayable> {
  readonly stacks: ReadonlyMap<string, readonly T[]>;
  /** Ids of decisions an undo actually removed; an undo the replay ignored adds nothing. */
  readonly withdrawn: ReadonlySet<string>;
}

/**
 * Each subject (one key) keeps a stack of decisions: a new one goes on top, and an undo of
 * the top restores the one beneath it. An undo naming anything but the top is ignored, so
 * a stale tab cannot withdraw the wrong decision. Entries come oldest first.
 */
export function replay<T extends Replayable>(
  entries: readonly T[],
  keyOf: (entry: T) => string,
): Replay<T> {
  const stacks = new Map<string, readonly T[]>();
  const withdrawn = new Set<string>();
  for (const entry of entries) {
    const key = keyOf(entry);
    const stack = stacks.get(key) ?? [];
    if (entry.undoes === null) stacks.set(key, [...stack, entry]);
    else if (stack.at(-1)?.eventId === entry.undoes) {
      stacks.set(key, stack.slice(0, -1));
      withdrawn.add(entry.undoes);
    }
  }
  return { stacks, withdrawn };
}

/** The decision on top of each subject's stack, by key. */
export function currentOf<T>(stacks: ReadonlyMap<string, readonly T[]>): ReadonlyMap<string, T> {
  const book = new Map<string, T>();
  for (const [key, stack] of stacks) {
    const top = stack.at(-1);
    if (top) book.set(key, top);
  }
  return book;
}

/** Every entry with where it stands (in force, undone, replaced), newest first. */
export function flagTrail<T extends Replayable>(
  entries: readonly T[],
  keyOf: (entry: T) => string,
): (T & TrailFlags)[] {
  const { stacks, withdrawn } = replay(entries, keyOf);
  const current = new Set([...currentOf(stacks).values()].map((e) => e.eventId));
  const beneath = new Set(
    [...stacks.values()].flatMap((stack) => stack.slice(0, -1).map((e) => e.eventId)),
  );
  return entries
    .map((e) => ({
      ...e,
      undoable: current.has(e.eventId),
      undone: withdrawn.has(e.eventId),
      superseded: beneath.has(e.eventId),
    }))
    .reverse();
}

const transferKey = (entry: DecisionEntry): string => keyOf(entry.transferId, entry.scenario);

/** The current decision per transfer (baseline and scenarios kept apart) for one date. */
export function decisionsFor(
  events: readonly AuditEvent[],
  operatingDate: string,
): ReadonlyMap<string, DecisionEntry> {
  return currentOf(replay(entriesFor(events, operatingDate), transferKey).stacks);
}

/** Current decisions for the plan showing (baseline null, or a scenario key), by transfer id. */
export function rowDecisionsFor(
  book: ReadonlyMap<string, DecisionEntry>,
  scenario: string | null,
): ReadonlyMap<string, RowDecision> {
  const rows = new Map<string, RowDecision>();
  for (const entry of book.values()) {
    if (entry.scenario === scenario) {
      rows.set(entry.transferId, { kind: entry.decision, buses: entry.buses });
    }
  }
  return rows;
}

/** A click on the decision already in force for this bus count records nothing. */
export function isRepeatDecision(
  current: RowDecision | null,
  kind: TransferDecisionKind,
  buses: number,
): boolean {
  return current !== null && current.kind === kind && current.buses === buses;
}

/** Every decision and undo for the date, newest first, baseline and scenarios listed apart. */
export function decisionTrail(events: readonly AuditEvent[], operatingDate: string): DecisionTrail {
  const items: TrailItem[] = flagTrail(entriesFor(events, operatingDate), transferKey);
  return {
    baseline: items.filter((e) => e.scenario === null),
    scenario: items.filter((e) => e.scenario !== null),
  };
}

/**
 * The decision in force for one transfer on the plan showing (baseline null, or a scenario
 * key): the entry its Undo withdraws, or null when there is nothing to undo.
 */
export function undoableFor(
  trail: DecisionTrail,
  transferId: string,
  scenario: string | null,
): TrailItem | null {
  const items = scenario === null ? trail.baseline : trail.scenario;
  return (
    items.find((i) => i.undoable && i.transferId === transferId && i.scenario === scenario) ?? null
  );
}
