'use client';

import Link from 'next/link';
import { useId, useState } from 'react';
import { DataTable } from '@/components/depot/shell/DataTable';
import { depotHref } from '@/lib/depot/depotNav';
import { formatCount } from '@/lib/depot/format';
import type { IncidentView } from '@/lib/depot/incident/api';
import { CREW_SENTENCE, CREW_TEXT, EXCLUDED_TEXT, INCIDENT_DECISION_NOTE, kindText, recommendationSentence } from '@/lib/depot/incident/incidentWording';
import type { ReplacementDecisionEntry, ReplacementSubject } from '@/lib/depot/incident/incidentDecisions';
import type { ReplacementCandidate } from '@/lib/depot/incident/types';
import { NOTE_MAX_CHARS, VERB, validateNote } from '@/lib/depot/rebalance/decisionEvents';
import type { TransferDecisionKind } from '@/lib/depot/rebalance/rebalanceModel';

const DECISIONS: readonly { readonly kind: TransferDecisionKind; readonly label: string }[] = [
  { kind: 'approved', label: 'Approve' },
  { kind: 'deferred', label: 'Defer' },
  { kind: 'rejected', label: 'Reject' },
];

export interface IncidentDetailProps {
  readonly depotId: string;
  readonly depotName: string;
  readonly view: IncidentView;
  readonly decision: ReplacementDecisionEntry | null;
  readonly onDecide: (subject: ReplacementSubject, kind: TransferDecisionKind, note: string) => void;
}

const minutes = (n: number | null): string => (n === null ? '—' : `${formatCount(n)} min`);

function RestOfDay({ view, depotId }: { readonly view: IncidentView; readonly depotId: string }) {
  const { restOfBlock, dayKnockOn } = view.plan;
  const href = `${depotHref(depotId)}/schedule`;
  const block =
    restOfBlock === null
      ? 'This bus has no block in the schedule plan.'
      : restOfBlock.coveredBy === 'replacement_continues'
        ? `The replacement continues the bus's block: ${formatCount(restOfBlock.remainingPieces)} ${restOfBlock.remainingPieces === 1 ? 'piece' : 'pieces'} of work left.`
        : restOfBlock.coveredBy === 'reassigned'
          ? 'The rest of the block is covered by the depot’s other buses.'
          : 'The rest of the block is left uncovered.';
  const knock =
    dayKnockOn === null
      ? 'The rest-of-day effect is not available until the schedule plan is built.'
      : `With this bus out, the schedule plan has ${formatCount(dayKnockOn.blocksWithoutBusDelta)} more ${dayKnockOn.blocksWithoutBusDelta === 1 ? 'block' : 'blocks'} without a bus and ${formatCount(dayKnockOn.uncoveredBusHoursDelta)} more uncovered bus-hours.`;
  return (
    <p className="depot-prose">
      {block} {knock} <Link href={href} className="depot-link">AI Scheduler</Link>
    </p>
  );
}

/** One incident opened: passengers, the remaining trip, the ranked replacements, the rest of the day and the decision. */
export function IncidentDetail({ depotId, depotName, view, decision, onDecide }: IncidentDetailProps) {
  const { plan, incident } = view;
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const noteId = useId();
  const recommended = plan.recommended;
  const subject: ReplacementSubject | null =
    recommended === null
      ? null
      : { kind: 'replacement', depotId, depotName, registrationNumber: incident.registrationNumber, candidateId: recommended.id, candidateKind: recommended.kind, arrivalMinutes: recommended.arrivalMinutes, planKey: plan.planKey };
  const onThisPlan = decision !== null && decision.subject.planKey === plan.planKey;
  const trip = plan.remainingTrip;
  const rows: readonly ReplacementCandidate[] = [...plan.candidates, plan.baseline];
  function decide(kind: TransferDecisionKind): void {
    if (subject === null) return;
    const result = validateNote(note);
    if (!result.ok) return setError(result.error);
    onDecide(subject, kind, result.value);
    setNote('');
    setError('');
  }
  return (
    <div className="flex min-w-0 flex-col gap-4 py-2">
      <p className="depot-prose">
        Passengers aboard: about {formatCount(plan.passengersAboard.value)}.{' '}
        {trip === null
          ? 'No journey is known for this bus today.'
          : `Remaining trip: ${trip.stops === null ? 'stops not loaded' : `${formatCount(trip.stops)} stops`}${trip.km === null ? '' : `, ${trip.km} km`}${trip.minutes === null ? '' : `, ${formatCount(trip.minutes)} min to ${trip.destination ?? 'the end'}`}.`}
      </p>
      <p className="depot-prose font-semibold" data-testid="replacement-recommendation">{recommendationSentence(recommended, plan.baseline)}</p>
      <DataTable
        caption={`Replacement options for ${incident.registrationNumber}`}
        rows={rows}
        rowKey={(c) => c.id}
        columns={[
          { key: 'kind', header: 'Option', render: (c) => `${c.id === recommended?.id ? '★ ' : ''}${kindText(c.kind, c.depotName)}` },
          { key: 'bus', header: 'Bus', render: (c) => c.registrationNumber ?? '—' },
          { key: 'arrival', header: 'Arrival', align: 'right', render: (c) => minutes(c.arrivalMinutes) },
          { key: 'moving', header: 'Passengers moving', align: 'right', render: (c) => minutes(c.passengersMovingMinutes) },
          { key: 'dead', header: 'Dead km', align: 'right', render: (c) => (c.deadKm === 0 ? '0' : c.deadKm.toFixed(1)) },
          { key: 'seats', header: 'Seats free', align: 'right', render: (c) => formatCount(c.seatsFree) },
          { key: 'crew', header: 'Crew', render: (c) => CREW_TEXT[c.crew] },
          { key: 'knock', header: 'Knock-on', align: 'right', render: (c) => minutes(c.knockOnMinutes) },
          { key: 'status', header: 'Status', render: (c) => (c.excludedReason !== null ? `Excluded: ${EXCLUDED_TEXT[c.excludedReason]}` : c.id === recommended?.id ? 'Recommended' : c.kind === 'next_scheduled' ? 'Baseline' : c.direction === 'unknown' ? 'Direction not known' : 'Possible') },
        ]}
      />
      <p className="depot-note">{CREW_SENTENCE}</p>
      <RestOfDay view={view} depotId={depotId} />
      {plan.clamped.length > 0 ? (
        <ul className="flex flex-col gap-0.5">
          {plan.clamped.map((line) => (
            <li key={line} className="depot-note">{line}</li>
          ))}
        </ul>
      ) : null}
      <div role="group" aria-label={`Decision on the replacement for ${incident.registrationNumber}`} className="flex min-w-0 flex-col gap-1.5 print:hidden" data-testid="replacement-decision">
        <p className="depot-prose text-[13px]">
          <span className="depot-label mr-2">Decision</span>
          {subject === null ? 'No replacement to decide on.' : onThisPlan ? `${VERB[decision.decision]} this replacement.` : 'No decision on this replacement.'}
        </p>
        {subject === null ? null : (
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <label htmlFor={noteId} className="sr-only">Note, optional, up to {NOTE_MAX_CHARS} characters</label>
            <input id={noteId} type="text" maxLength={NOTE_MAX_CHARS} placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} className="depot-field w-48 max-w-full py-0.5" />
            {DECISIONS.map((d) => (
              <button key={d.kind} type="button" aria-pressed={onThisPlan && decision.decision === d.kind} onClick={() => decide(d.kind)} className="depot-filter-button shrink-0">
                {d.label}
              </button>
            ))}
          </div>
        )}
        <p className="depot-note">{INCIDENT_DECISION_NOTE}</p>
        {error ? <p role="alert" className="depot-note text-alert-amber">{error}</p> : null}
      </div>
    </div>
  );
}
