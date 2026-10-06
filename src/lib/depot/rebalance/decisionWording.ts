import { formatCount, formatPlainDate } from '../format';
import type { TrailItem } from './decisionEvents';
import { busesWord, type RowDecision, type TransferDecisionKind } from './rebalanceModel';

/*
 * The words the table, the trail and the status line use for decisions. A
 * decision always names the bus count it was made for, because the live plan
 * can recommend a different count on the next poll.
 */

export const DECISION_WORD: Readonly<Record<TransferDecisionKind, string>> = {
  approved: 'Approved',
  rejected: 'Rejected',
  deferred: 'Deferred',
};

const RECORDED_ONLY = 'Recorded only; nothing dispatched.';

/** "Approved for 5 buses", or with "; the plan now recommends 9" when the plan moved. */
export function decisionStatusText(decision: RowDecision | null, planBuses: number): string {
  if (decision === null) return 'None yet';
  const made = `${DECISION_WORD[decision.kind]} for ${busesWord(decision.buses)}`;
  return decision.buses === planBuses ? made : `${made}; the plan now recommends ${planBuses}`;
}

/**
 * The decision as the transfer row shows it: one word, with the count it was made for when
 * the plan now recommends a different one. The full status is in the row's `title` and in
 * its expanded row.
 */
export function decisionRowWord(decision: RowDecision | null, planBuses: number): string {
  if (decision === null) return 'None yet';
  const word = DECISION_WORD[decision.kind];
  return decision.buses === planBuses ? word : `${word} for ${formatCount(decision.buses)}`;
}

/** Whether a decision button reads as pressed: same verdict, made for the bus count shown. */
export function isDecisionCurrent(
  decision: RowDecision | null,
  kind: TransferDecisionKind,
  planBuses: number,
): boolean {
  return decision !== null && decision.kind === kind && decision.buses === planBuses;
}

/** The polite status line after a decision is recorded. */
export function decisionAnnouncement(
  kind: TransferDecisionKind,
  buses: number,
  fromName: string,
  toName: string,
): string {
  return `${DECISION_WORD[kind]} ${busesWord(buses)} ${fromName} to ${toName}. ${RECORDED_ONLY}`;
}

const DECISION_NOUN: Readonly<Record<TransferDecisionKind, string>> = {
  approved: 'approval',
  rejected: 'rejection',
  deferred: 'deferral',
};

/** The polite status line after an undo is recorded. */
export function undoAnnouncement(
  kind: TransferDecisionKind,
  buses: number,
  fromName: string,
  toName: string,
): string {
  return `Undid the ${DECISION_NOUN[kind]} of ${busesWord(buses)} ${fromName} to ${toName}. ${RECORDED_ONLY}`;
}

/** One trail line: what was decided, and whether it was later undone or replaced. */
export function describeTrailItem(item: TrailItem): string {
  const route = `${busesWord(item.buses)}, ${item.fromDepotName} → ${item.toDepotName}`;
  const word = DECISION_WORD[item.decision];
  if (item.undoes !== null) return `Undid ${word.toLowerCase()}: ${route}`;
  const marks = [
    item.undone ? '(later undone)' : null,
    item.superseded ? '(replaced by a later decision)' : null,
  ].filter((m): m is string => m !== null);
  return [`${word}: ${route}`, ...marks].join(' ');
}

/**
 * Said under the trail's heading in every state: the trail is a local record only, and
 * anyone at this browser can read it (one shared sign-in, no server copy).
 */
export const TRAIL_NOTE =
  'Decisions are kept in this browser only, are not sent anywhere, and are visible to ' +
  'anyone who uses this browser, notes included. The trail is append-only: Undo records ' +
  'a further entry and deletes nothing; Clear trail removes the whole trail at once. The ' +
  'audit log in this browser keeps one line for each decision, without its note. A ' +
  'decision changes nothing but this record; no transfer order is issued.';

/** Said with a recorded decision when the shared audit log refused its copy. */
export const AUDIT_LOG_REFUSED =
  'The shared audit log in this browser refused it (storage full or blocked), so only the decision trail holds it.';
export const TRAIL_CLEAR_CONFIRM =
  'Clear every decision kept in this browser, notes included? This cannot be undone.';
export const TRAIL_CLEARED = 'The decision trail kept in this browser is cleared.';
export const TRAIL_CLEAR_REFUSED =
  'The decision trail could not be cleared: this browser refused to change its storage.';

/** How far a write reached: both records, the trail alone, or neither. */
export type RecordOutcome = 'recorded' | 'trail_only' | 'refused';

/** The status line for a write: what was done, or why it was not. */
export function recordStatus(outcome: RecordOutcome, said: string, refused: string): string {
  if (outcome === 'refused') return refused;
  return outcome === 'trail_only' ? `${said} ${AUDIT_LOG_REFUSED}` : said;
}

/** The trail's heading: one line that also says when nothing is recorded yet. */
export function trailHeading(operatingDate: string, entries: number): string {
  const base = `Decision trail · ${formatPlainDate(operatingDate)}`;
  return entries === 0 ? `${base}: none recorded in this browser` : base;
}
