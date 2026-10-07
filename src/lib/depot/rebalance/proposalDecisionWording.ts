import { formatCount, formatPlainDate } from '../format';
import type { ProposalDecisionCounts } from '../service/types';
import { sameFigures, type ProposalFigures, type ProposalSubject } from './decisionSubject';
import {
  BROWSER_TRAIL_NOTE,
  DECISION_NOUN,
  DECISION_WORD,
  RECORDED_ONLY,
  withMarks,
} from './decisionWording';
import {
  proposalWhat,
  subjectChange,
  type ProposalDecisionEntry,
  type ProposalTrailItem,
} from './proposalDecisionEvents';
import type { TransferDecisionKind } from './rebalanceModel';

/*
 * The words the proposals table, the status line and the trail use for decisions on route
 * proposals. A decision names the change it was made for ("Add 3"), because the next poll
 * can propose a different one for the same band.
 */

/** "Approved for Add 3", or with "; the proposal now says Add 5" when the proposal moved. */
export function proposalStatusText(
  decision: ProposalDecisionEntry | null,
  figures: ProposalFigures,
): string {
  if (decision === null) return 'None yet';
  const made = `${DECISION_WORD[decision.decision]} for ${subjectChange(decision.subject)}`;
  if (sameFigures(decision.subject, figures)) return made;
  return `${made}; the proposal now says ${subjectChange(decision.subject, figures)}`;
}

/** Whether a decision button reads as pressed: same verdict, made for the change shown. */
export function isProposalDecisionCurrent(
  decision: ProposalDecisionEntry | null,
  kind: TransferDecisionKind,
  figures: ProposalFigures,
): boolean {
  return decision !== null && decision.decision === kind && sameFigures(decision.subject, figures);
}

/** The polite status line after a decision on a proposal is recorded. */
export function proposalDecisionAnnouncement(
  kind: TransferDecisionKind,
  subject: ProposalSubject,
): string {
  return `${DECISION_WORD[kind]} ${proposalWhat(subject)}. ${RECORDED_ONLY}`;
}

/** The polite status line after an undo on a proposal is recorded. */
export function proposalUndoAnnouncement(
  kind: TransferDecisionKind,
  subject: ProposalSubject,
): string {
  return `Undid the ${DECISION_NOUN[kind]} of ${proposalWhat(subject)}. ${RECORDED_ONLY}`;
}

/** One trail line: the proposal decided on, and whether it was later undone or replaced. */
export function describeProposalTrailItem(item: ProposalTrailItem): string {
  const word = DECISION_WORD[item.decision];
  const what = proposalWhat(item.subject);
  if (item.undoes !== null) return `Undid ${word.toLowerCase()} proposal: ${what}`;
  return withMarks(`${word} proposal: ${what}`, item);
}

/** Said under the proposals' trail heading in every state, as the transfer trail says it. */
export const PROPOSAL_TRAIL_NOTE = `${BROWSER_TRAIL_NOTE} A decision changes nothing but this record; no bus is added, held or moved.`;

/** Said once beside the decision buttons. */
export const PROPOSAL_DECISION_NOTE = RECORDED_ONLY;

/** The brief's count line: "… for 6 Oct 2026: 1 accepted, 0 declined, 2 still open. …". */
export function decisionCountsSentence(counts: ProposalDecisionCounts, operatingDate: string): string {
  const figures = `${formatCount(counts.accepted)} accepted, ${formatCount(counts.declined)} declined, ${formatCount(counts.open)} still open`;
  return `Decisions kept in this browser for ${formatPlainDate(operatingDate)}: ${figures}. ${RECORDED_ONLY}`;
}
