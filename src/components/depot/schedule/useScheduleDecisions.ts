'use client';

import { useMemo, useState } from 'react';
import { useDecisionLog } from '@/components/depot/rebalance/useDecisionLog';
import { trailCapacityNote } from '@/lib/depot/rebalance/decisionStore';
import { DECISION_REFUSED, TRAIL_CLEARED, TRAIL_CLEAR_REFUSED, UNDO_REFUSED, VERB_SENTENCE, recordStatus } from './decisionWords';
import type { TransferDecisionKind } from '@/lib/depot/rebalance/rebalanceModel';
import {
  scheduleDecisionEvent,
  scheduleDecisionFor,
  scheduleTrail,
  scheduleUndoEvent,
  scheduleWhat,
  type ScheduleDecisionEntry,
  type ScheduleSubject,
  type ScheduleTrailItem,
} from '@/lib/depot/schedule/scheduleDecisions';

export interface ScheduleDecisions {
  readonly current: ScheduleDecisionEntry | null;
  readonly trail: readonly ScheduleTrailItem[];
  readonly announcement: string;
  readonly capacityNote: string | null;
  readonly stateNote: string | null;
  readonly canClear: boolean;
  readonly decide: (subject: ScheduleSubject, kind: TransferDecisionKind, note: string) => void;
  readonly undo: (item: ScheduleTrailItem) => void;
  readonly clear: () => void;
}

/** Decisions on one depot's schedule plan for the date, kept in this browser. Nothing is dispatched. */
export function useScheduleDecisions(depotId: string, operatingDate: string): ScheduleDecisions {
  const log = useDecisionLog();
  const [announcement, setAnnouncement] = useState('');
  const events = log.slice.events;
  const current = useMemo(() => scheduleDecisionFor(events, depotId, operatingDate), [events, depotId, operatingDate]);
  const trail = useMemo(() => scheduleTrail(events, depotId, operatingDate), [events, depotId, operatingDate]);

  function decide(subject: ScheduleSubject, kind: TransferDecisionKind, note: string): void {
    if (current !== null && current.decision === kind && current.subject.planKey === subject.planKey) return;
    const recorded = log.record(scheduleDecisionEvent({ subject, operatingDate, note, decision: kind }));
    setAnnouncement(recordStatus(recorded, `${VERB_SENTENCE[kind]} ${scheduleWhat(subject)}.`, DECISION_REFUSED));
  }

  function undo(item: ScheduleTrailItem): void {
    const recorded = log.record(scheduleUndoEvent(item));
    setAnnouncement(recordStatus(recorded, `Withdrew the decision on ${scheduleWhat(item.subject)}.`, UNDO_REFUSED));
  }

  return {
    current,
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
