'use client';

import { useId, useState } from 'react';
import { ClearControl, TRAIL_LIST_CLASS, TrailLine, TrailStateNotes } from '@/components/depot/rebalance/TrailParts';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';
import { NOTE_MAX_CHARS, VERB, validateNote } from '@/lib/depot/rebalance/decisionEvents';
import { trailHeading } from '@/lib/depot/rebalance/decisionWording';
import type { TransferDecisionKind } from '@/lib/depot/rebalance/rebalanceModel';
import { describeScheduleTrailItem, type ScheduleSubject } from '@/lib/depot/schedule/scheduleDecisions';
import { SCHEDULE_DECISION_NOTE, SCHEDULE_TRAIL_NOTE } from '@/lib/depot/schedule/scheduleWording';
import { useScheduleDecisions } from './useScheduleDecisions';

const DECISIONS: readonly { readonly kind: TransferDecisionKind; readonly label: string }[] = [
  { kind: 'approved', label: 'Approve' },
  { kind: 'deferred', label: 'Defer' },
  { kind: 'rejected', label: 'Reject' },
];

export interface ScheduleDecisionProps {
  readonly subject: ScheduleSubject;
  readonly operatingDate: string;
}

/** The decision in force on this plan, the three decisions, Undo, and the trail kept in this browser. */
export function ScheduleDecision({ subject, operatingDate }: ScheduleDecisionProps) {
  const decisions = useScheduleDecisions(subject.depotId, operatingDate);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const noteId = useId();
  const current = decisions.current;
  const onThisPlan = current !== null && current.subject.planKey === subject.planKey;
  const status = onThisPlan ? `${VERB[current.decision]} this plan.` : current === null ? 'No decision on this plan.' : 'No decision on this plan; an earlier plan was decided on.';
  const undoable = decisions.trail.find((i) => i.undoable) ?? null;

  function decide(kind: TransferDecisionKind): void {
    const result = validateNote(note);
    if (!result.ok) return setError(result.error);
    decisions.decide(subject, kind, result.value);
    setNote('');
    setError('');
  }

  return (
    <section aria-label="Decision on the plan" className="min-w-0 print:hidden" data-testid="schedule-decision">
      <SectionLabel label="Decision" />
      <p className="depot-prose text-[13px]">{status}</p>
      <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-2">
        <label htmlFor={noteId} className="sr-only">Note, optional, up to {NOTE_MAX_CHARS} characters</label>
        <input id={noteId} type="text" maxLength={NOTE_MAX_CHARS} placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} className="depot-field w-48 max-w-full py-0.5" />
        {DECISIONS.map((d) => (
          <button key={d.kind} type="button" aria-pressed={onThisPlan && current.decision === d.kind} onClick={() => decide(d.kind)} className="depot-filter-button shrink-0">
            {d.label}
          </button>
        ))}
        {undoable ? (
          <button type="button" onClick={() => decisions.undo(undoable)} className="depot-filter-button shrink-0">Undo</button>
        ) : null}
      </div>
      <p className="depot-note mt-1">{SCHEDULE_DECISION_NOTE}</p>
      {error ? <p role="alert" className="depot-note text-alert-amber">{error}</p> : null}
      {decisions.announcement ? <p role="status" className="depot-note">{decisions.announcement}</p> : null}
      <h3 className="depot-section-label mb-1.5 mt-4">{trailHeading(operatingDate, decisions.trail.length)}</h3>
      <p className="depot-note">{SCHEDULE_TRAIL_NOTE}</p>
      <TrailStateNotes capacityNote={decisions.capacityNote} stateNote={decisions.stateNote} stateTestId="schedule-trail-state" />
      {decisions.canClear ? <ClearControl onClear={decisions.clear} /> : null}
      {decisions.trail.length > 0 ? (
        <ol className={`${TRAIL_LIST_CLASS} mt-3`}>
          {decisions.trail.map((item, index) => (
            <TrailLine key={`${index}-${item.eventId}`} at={item.at} line={describeScheduleTrailItem(item)} context={null} note={item.note} onUndo={item.undoable ? () => decisions.undo(item) : null} />
          ))}
        </ol>
      ) : null}
    </section>
  );
}
