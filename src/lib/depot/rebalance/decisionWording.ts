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

/** Said under the trail's heading in every state: the trail is a local record only. */
export const TRAIL_NOTE =
  'Decisions are kept in this browser only and are not sent anywhere. The trail is ' +
  'append-only: Undo records a further entry and deletes nothing. A decision changes ' +
  'nothing but this record; no transfer order is issued.';

/** The trail's heading: one line that also says when nothing is recorded yet. */
export function trailHeading(operatingDate: string, entries: number): string {
  const base = `Decision trail · ${operatingDate}`;
  return entries === 0 ? `${base}: none recorded in this browser` : base;
}
