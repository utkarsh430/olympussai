'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { useDepotDetailContext } from '@/components/depot/data/DepotDetailProvider';
import { ClearControl, TRAIL_LIST_CLASS, TrailLine, TrailStateNotes } from '@/components/depot/rebalance/TrailParts';
import { ErrorPanel, LoadingBlock, StaleNotice } from '@/components/depot/shell/DataStates';
import { DataTable } from '@/components/depot/shell/DataTable';
import { PageHeader } from '@/components/depot/shell/PageHeader';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';
import { useDeclareIncident, useDepotIncidents } from '@/hooks/useDepotIncidents';
import { DEPOT_UNAVAILABLE_MESSAGE } from '@/hooks/usePolledJson';
import { ROSTER_BUS_PARAM } from '@/lib/depot/depotNav';
import { formatCount } from '@/lib/depot/format';
import type { IncidentView } from '@/lib/depot/incident/api';
import { describeReplacementTrailItem } from '@/lib/depot/incident/incidentDecisions';
import { CONFIDENCE_WORD, DECLARE_LABEL, EMPTY_SENTENCE, INCIDENT_TRAIL_NOTE, METHOD_LINES, PAGE_DESCRIPTION, PAGE_TITLE, SIGNAL_TEXT, kindText, stoppedText } from '@/lib/depot/incident/incidentWording';
import { trailHeading } from '@/lib/depot/rebalance/decisionWording';
import { DEPOT_NOT_FOUND_MESSAGE } from '@/lib/depot/scopeState';
import { IncidentDetail } from './IncidentDetail';
import { useIncidentDecisions } from './useIncidentDecisions';

export function IncidentHeader() {
  return <PageHeader title={PAGE_TITLE} description={PAGE_DESCRIPTION} />;
}

function DeclareForm({ busy, error, onDeclare }: { readonly busy: boolean; readonly error: string | null; readonly onDeclare: (reg: string) => void }) {
  const id = useId();
  const [value, setValue] = useState('');
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim() !== '') onDeclare(value);
      }}
    >
      <label htmlFor={id} className="flex flex-col gap-1 font-sans text-[12px] text-depot-muted">
        Declare a bus broken down
        <input id={id} type="text" value={value} onChange={(e) => setValue(e.target.value)} placeholder="registration" className="depot-field w-48 py-0.5" maxLength={24} />
      </label>
      <button type="submit" disabled={busy} className="depot-button-primary">{busy ? 'Planning…' : DECLARE_LABEL}</button>
      {error ? <p role="alert" className="depot-note text-alert-amber">{error}</p> : null}
    </form>
  );
}

/** The depot's Incident Response page: suspected and declared breakdowns, each with its ranked replacements and a decision. */
export function IncidentPage() {
  const detail = useDepotDetailContext();
  const { data, error, loading, refresh } = useDepotIncidents(detail.depotId);
  const declare = useDeclareIncident(detail.depotId);
  const params = useSearchParams();
  const fromDrawer = params.get(ROSTER_BUS_PARAM);
  const declaredFromUrl = useRef<string | null>(null);
  useEffect(() => {
    if (fromDrawer !== null && declaredFromUrl.current !== fromDrawer) {
      declaredFromUrl.current = fromDrawer;
      declare.declare(fromDrawer);
    }
  }, [fromDrawer, declare]);
  const decisions = useIncidentDecisions(detail.depotId, data?.operatingDate ?? '');
  if (loading) {
    return (
      <>
        <IncidentHeader />
        <LoadingBlock rows={8} label="Loading the incidents" />
      </>
    );
  }
  if (!data) {
    return (
      <>
        <IncidentHeader />
        <ErrorPanel title={error === DEPOT_NOT_FOUND_MESSAGE ? DEPOT_NOT_FOUND_MESSAGE : 'Could not load the incidents'} message={error ?? DEPOT_UNAVAILABLE_MESSAGE} onRetry={refresh} />
      </>
    );
  }
  const declaredRegs = new Set(declare.declared.map((v) => v.incident.registrationNumber));
  const rows: readonly IncidentView[] = [...declare.declared, ...data.incidents.filter((v) => !declaredRegs.has(v.incident.registrationNumber))];
  return (
    <>
      <IncidentHeader />
      <div className="flex flex-col gap-8">
        {data.stale || error ? <StaleNotice since={data.feedNow} /> : null}
        <DeclareForm busy={declare.busy} error={declare.error} onDeclare={declare.declare} />
        <section aria-label="Incidents" className="min-w-0">
          <SectionLabel label="Incidents" count={rows.length} note={`${formatCount(data.detection.considered)} buses checked`} />
          {rows.length === 0 ? (
            <p className="depot-prose" data-testid="incidents-empty">{EMPTY_SENTENCE}</p>
          ) : (
            <DataTable
              caption="Buses that may have broken down, most pressing first"
              rows={rows}
              rowKey={(v) => v.incident.registrationNumber}
              freezeFirstColumn
              overflowCue
              expandLabel={(v) => `Show the replacement plan for ${v.incident.registrationNumber}`}
              renderExpanded={(v) => (
                <IncidentDetail depotId={data.depotId} depotName={data.depotName} view={v} decision={decisions.book.get(v.incident.registrationNumber) ?? null} onDecide={decisions.decide} />
              )}
              columns={[
                { key: 'bus', header: 'Bus', render: (v) => v.incident.registrationNumber },
                { key: 'route', header: 'Route', render: (v) => v.incident.routeName ?? '—' },
                { key: 'origin', header: 'Origin', render: (v) => (v.incident.origin === 'declared' ? 'Declared' : 'Detected') },
                { key: 'confidence', header: 'Confidence', render: (v) => CONFIDENCE_WORD[v.incident.confidence] },
                { key: 'signals', header: 'Signals', render: (v) => (v.incident.signals.length === 0 ? '—' : v.incident.signals.map((s) => SIGNAL_TEXT[s]).join('; ')) },
                { key: 'stopped', header: 'Stopped', render: (v) => stoppedText(v.incident.stoppedMinutes) },
                { key: 'aboard', header: 'Aboard', align: 'right', render: (v) => formatCount(v.plan.passengersAboard.value) },
                { key: 'recommended', header: 'Recommended', render: (v) => (v.plan.recommended === null ? 'Next scheduled bus' : kindText(v.plan.recommended.kind, v.plan.recommended.depotName)) },
                { key: 'arrival', header: 'Arrival', align: 'right', render: (v) => { const m = v.plan.recommended?.arrivalMinutes ?? v.plan.baseline.arrivalMinutes; return m === null ? '—' : `${formatCount(m)} min`; } },
              ]}
            />
          )}
        </section>
        <section aria-label="How a breakdown is spotted" className="min-w-0">
          <SectionLabel label="How a breakdown is spotted" />
          {METHOD_LINES.map((line) => (
            <p key={line} className="depot-note">{line}</p>
          ))}
        </section>
        <section aria-label="Decision trail" className="min-w-0 print:hidden">
          <h3 className="depot-section-label mb-1.5">{trailHeading(data.operatingDate, decisions.trail.length)}</h3>
          <p className="depot-note">{INCIDENT_TRAIL_NOTE}</p>
          {decisions.announcement ? <p role="status" className="depot-note">{decisions.announcement}</p> : null}
          <TrailStateNotes capacityNote={decisions.capacityNote} stateNote={decisions.stateNote} stateTestId="incident-trail-state" />
          {decisions.canClear ? <ClearControl onClear={decisions.clear} /> : null}
          {decisions.trail.length > 0 ? (
            <ol className={`${TRAIL_LIST_CLASS} mt-3`}>
              {decisions.trail.map((item, index) => (
                <TrailLine key={`${index}-${item.eventId}`} at={item.at} line={describeReplacementTrailItem(item)} context={null} note={item.note} onUndo={item.undoable ? () => decisions.undo(item) : null} />
              ))}
            </ol>
          ) : null}
        </section>
      </div>
    </>
  );
}
