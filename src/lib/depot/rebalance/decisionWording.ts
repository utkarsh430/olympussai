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
