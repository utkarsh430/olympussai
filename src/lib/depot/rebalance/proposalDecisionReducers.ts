import type { AuditEvent } from '@/lib/audit/auditLog';
import type { Proposal, ProposalDecisionCounts } from '../service/types';
import { currentOf, flagTrail, replay } from './decisionReducers';
import {
  parseProposalDecisionEvent,
  type ProposalDecisionEntry,
  type ProposalTrailItem,
} from './proposalDecisionEvents';
import { sameFigures, type ProposalFigures } from './decisionSubject';
import type { TransferDecisionKind } from './rebalanceModel';

/*
 * Pure reducers over the route proposals' decisions in the shared trail: the decision in
 * force per proposal, the trail (of one route, or of every route) and the day's counts.
 * They only read; nothing is dispatched.
 */

/** A proposal's id already names its date, kind, route and band. */
const keyOf = (entry: ProposalDecisionEntry): string => entry.subject.proposalId;

/** Proposal entries for the date, oldest first (storage keeps newest first). */
function entriesFor(
  events: readonly AuditEvent[],
  operatingDate: string,
): ProposalDecisionEntry[] {
  return events
    .map(parseProposalDecisionEvent)
    .filter((e): e is ProposalDecisionEntry => e !== null && e.operatingDate === operatingDate)
    .reverse();
}

/** The decision in force per proposal id for one date. */
export function proposalDecisionsFor(
  events: readonly AuditEvent[],
  operatingDate: string,
): ReadonlyMap<string, ProposalDecisionEntry> {
  return currentOf(replay(entriesFor(events, operatingDate), keyOf).stacks);
}

/**
 * Every proposal decision and undo for the date, newest first: one route's when a route is
 * named, every route's when it is null.
 */
export function proposalTrail(
  events: readonly AuditEvent[],
  operatingDate: string,
  routeName: string | null,
): readonly ProposalTrailItem[] {
  const items = flagTrail(entriesFor(events, operatingDate), keyOf);
  return routeName === null ? items : items.filter((i) => i.subject.routeName === routeName);
}

/** The decision in force on a proposal, as its Undo withdraws it; null when there is none. */
export function proposalUndoableFor(
  trail: readonly ProposalTrailItem[],
  proposalId: string,
): ProposalTrailItem | null {
  return trail.find((i) => i.undoable && i.subject.proposalId === proposalId) ?? null;
}

/** A click on the decision already in force for these figures records nothing. */
export function isRepeatProposalDecision(
  current: ProposalDecisionEntry | null,
  kind: TransferDecisionKind,
  figures: ProposalFigures,
): boolean {
  return current !== null && current.decision === kind && sameFigures(current.subject, figures);
}

/**
 * The proposals shown, by the decision in force on each: approved is accepted, rejected
 * is declined, and deferred or undecided is still open. A decision on a proposal no longer
 * made is not counted.
 */
export function proposalDecisionCounts(
  proposals: readonly Pick<Proposal, 'id'>[],
  book: ReadonlyMap<string, ProposalDecisionEntry>,
): ProposalDecisionCounts {
  const count = (kind: TransferDecisionKind): number =>
    proposals.filter((p) => book.get(p.id)?.decision === kind).length;
  const accepted = count('approved');
  const declined = count('rejected');
  return { accepted, declined, open: proposals.length - accepted - declined };
}
