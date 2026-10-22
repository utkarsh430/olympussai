'use client';

import { useMemo, useState } from 'react';
import { useDecisionLog } from '@/components/depot/rebalance/useDecisionLog';
import { DECISION_REFUSED, TRAIL_CLEARED, TRAIL_CLEAR_REFUSED, UNDO_REFUSED, recordStatus } from '@/lib/depot/rebalance/decisionWording';
import { VERB } from '@/lib/depot/rebalance/decisionEvents';
import { trailCapacityNote } from '@/lib/depot/rebalance/decisionStore';
import type { TransferDecisionKind } from '@/lib/depot/rebalance/rebalanceModel';
import {
  replacementDecisionEvent,
  replacementDecisionsFor,
  replacementTrail,
  replacementUndoEvent,
  replacementWhat,
  type ReplacementDecisionEntry,
  type ReplacementSubject,
  type ReplacementTrailItem,
} from '@/lib/depot/incident/incidentDecisions';

export interface IncidentDecisions {
  readonly book: ReadonlyMap<string, ReplacementDecisionEntry>;
  readonly trail: readonly ReplacementTrailItem[];
  readonly announcement: string;
  readonly capacityNote: string | null;
  readonly stateNote: string | null;
  readonly canClear: boolean;
  readonly decide: (subject: ReplacementSubject, kind: TransferDecisionKind, note: string) => void;
  readonly undo: (item: ReplacementTrailItem) => void;
  readonly clear: () => void;
}

/** Decisions on the depot's replacements for the date, kept in this browser. Nothing is dispatched. */
export function useIncidentDecisions(depotId: string, operatingDate: string): IncidentDecisions {
  const log = useDecisionLog();
  const [announcement, setAnnouncement] = useState('');
  const events = log.slice.events;
  const book = useMemo(() => replacementDecisionsFor(events, depotId, operatingDate), [events, depotId, operatingDate]);
  const trail = useMemo(() => replacementTrail(events, depotId, operatingDate), [events, depotId, operatingDate]);
  function decide(subject: ReplacementSubject, kind: TransferDecisionKind, note: string): void {
    const current = book.get(subject.registrationNumber) ?? null;
    if (current !== null && current.decision === kind && current.subject.planKey === subject.planKey) return;
    const recorded = log.record(replacementDecisionEvent({ subject, operatingDate, note, decision: kind }));
    setAnnouncement(recordStatus(recorded, `${VERB[kind]} ${replacementWhat(subject)}.`, DECISION_REFUSED));
  }
  function undo(item: ReplacementTrailItem): void {
    const recorded = log.record(replacementUndoEvent(item));
    setAnnouncement(recordStatus(recorded, `Withdrew the decision on the ${replacementWhat(item.subject)}.`, UNDO_REFUSED));
  }
  return {
    book,
    trail,
    announcement,
    capacityNote: trailCapacityNote(log.slice),
    stateNote: log.stateNote,
    canClear: log.canClear,
    decide,
    undo,
    clear: () => setAnnouncement(log.clear() ? TRAIL_CLEARED : TRAIL_CLEAR_REFUSED),
  };
}
