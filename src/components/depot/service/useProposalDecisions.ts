'use client';

import { useMemo, useState } from 'react';
import { useDecisionLog } from '@/components/depot/rebalance/useDecisionLog';
import { trailCapacityNote } from '@/lib/depot/rebalance/decisionStore';
import type { ProposalFigures, ProposalSubject } from '@/lib/depot/rebalance/decisionSubject';
import {
  DECISION_REFUSED,
  TRAIL_CLEARED,
  TRAIL_CLEAR_REFUSED,
  UNDO_REFUSED,
  recordStatus,
} from '@/lib/depot/rebalance/decisionWording';
import {
  proposalDecisionEvent,
  proposalUndoEvent,
  type ProposalDecisionEntry,
  type ProposalTrailItem,
} from '@/lib/depot/rebalance/proposalDecisionEvents';
import {
  isRepeatProposalDecision,
  proposalDecisionsFor,
  proposalTrail,
  proposalUndoableFor,
} from '@/lib/depot/rebalance/proposalDecisionReducers';
import {
  proposalDecisionAnnouncement,
  proposalUndoAnnouncement,
} from '@/lib/depot/rebalance/proposalDecisionWording';
import type { TransferDecisionKind } from '@/lib/depot/rebalance/rebalanceModel';
import type { NetworkProposal } from '@/lib/depot/service/types';

/** A route's own proposal, or a network one that may name no route. */
export type DecidableProposal = Pick<NetworkProposal, 'id' | 'kind' | 'band' | 'change' | 'routeName'> &
  Partial<Pick<NetworkProposal, 'routes' | 'depotName' | 'count'>>;

export interface ProposalDecisions {
  /** The decision in force per proposal id, for the date. */
  readonly book: ReadonlyMap<string, ProposalDecisionEntry>;
  /** The trail the page shows: one route's proposals, or every route's. */
  readonly trail: readonly ProposalTrailItem[];
  /** The last thing recorded or refused, for the polite status line. */
  readonly announcement: string;
  readonly capacityNote: string | null;
  readonly stateNote: string | null;
  readonly canClear: boolean;
  readonly decide: (proposal: DecidableProposal, kind: TransferDecisionKind, note: string) => void;
  /** Withdraws the decision in force on a proposal; null when there is none. */
  readonly undoFor: (proposalId: string) => (() => void) | null;
  readonly undo: (item: ProposalTrailItem) => void;
  readonly clear: () => void;
}

/** The figures a decision is made for: the change and a network kind's own figure. */
export function figuresOf(proposal: DecidableProposal): ProposalFigures {
  return { change: proposal.change, count: proposal.count ?? null };
}

/** What a decision on a proposal is about, as the trail keeps it. */
export function subjectOf(proposal: DecidableProposal): ProposalSubject {
  return {
    kind: 'proposal',
    proposalId: proposal.id,
    routeName: proposal.routeName,
    routes: proposal.routes ?? [],
    depotName: proposal.depotName ?? null,
    proposalKind: proposal.kind,
    band: proposal.band,
    ...figuresOf(proposal),
  };
}

/**
 * Decisions on route proposals for one date, read from and written to the trail the
 * transfer decisions use. `routeName` narrows the listed trail to one route; null lists
 * every route's. Nothing is dispatched: each call only adds to the record in this browser.
 */
export function useProposalDecisions(
  operatingDate: string,
  routeName: string | null,
): ProposalDecisions {
  const log = useDecisionLog();
  const [announcement, setAnnouncement] = useState('');
  const events = log.slice.events;
  const book = useMemo(() => proposalDecisionsFor(events, operatingDate), [events, operatingDate]);
  // The whole date's trail: Undo reads it, so a route filter never hides a decision in force.
  const all = useMemo(() => proposalTrail(events, operatingDate, null), [events, operatingDate]);
  const trail = useMemo(
    () => (routeName === null ? all : all.filter((i) => i.subject.routeName === routeName)),
    [all, routeName],
  );

  function decide(proposal: DecidableProposal, kind: TransferDecisionKind, note: string): void {
    if (isRepeatProposalDecision(book.get(proposal.id) ?? null, kind, figuresOf(proposal))) return;
    const subject = subjectOf(proposal);
    const recorded = log.record(
      proposalDecisionEvent({ subject, operatingDate, note, decision: kind }),
    );
    const said = proposalDecisionAnnouncement(kind, subject);
    setAnnouncement(recordStatus(recorded, said, DECISION_REFUSED));
  }

  function undo(item: ProposalTrailItem): void {
    const recorded = log.record(proposalUndoEvent(item));
    const said = proposalUndoAnnouncement(item.decision, item.subject);
    setAnnouncement(recordStatus(recorded, said, UNDO_REFUSED));
  }

  function undoFor(proposalId: string): (() => void) | null {
    const item = proposalUndoableFor(all, proposalId);
    return item ? () => undo(item) : null;
  }

  return {
    book,
    trail,
    announcement,
    capacityNote: trailCapacityNote(log.slice),
    stateNote: log.stateNote,
    canClear: log.canClear,
    decide,
    undoFor,
    undo,
    clear: () => setAnnouncement(log.clear() ? TRAIL_CLEARED : TRAIL_CLEAR_REFUSED),
  };
}
