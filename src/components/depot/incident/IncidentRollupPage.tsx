'use client';

import Link from 'next/link';
import { ErrorPanel, LoadingBlock, StaleNotice } from '@/components/depot/shell/DataStates';
import { DataTable } from '@/components/depot/shell/DataTable';
import { Figure, FigureBand } from '@/components/depot/shell/FigureBand';
import { PageHeader } from '@/components/depot/shell/PageHeader';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';
import { useIncidentRollup } from '@/hooks/useDepotIncidents';
import { DEPOT_UNAVAILABLE_MESSAGE } from '@/hooks/usePolledJson';
import { depotHref } from '@/lib/depot/depotNav';
import { formatCount } from '@/lib/depot/format';
import { CONFIDENCE_WORD, PAGE_TITLE, ROLLUP_DESCRIPTION, kindText, rollupProgressSentence } from '@/lib/depot/incident/incidentWording';

const CONFIDENCE_RANK = { high: 0, medium: 1, low: 2 } as const;

function RollupHeader() {
  return <PageHeader title={PAGE_TITLE} description={ROLLUP_DESCRIPTION} />;
}

/** Headquarters' Incident Response: every depot's suspected breakdowns with the replacement recommended for each. */
export function IncidentRollupPage() {
  const { data, error, loading, refresh } = useIncidentRollup();
  if (loading) {
    return (
      <>
        <RollupHeader />
        <LoadingBlock rows={8} label="Loading the incidents" />
      </>
    );
  }
  if (!data) {
    return (
      <>
        <RollupHeader />
        <ErrorPanel title="Could not load the incidents" message={error ?? DEPOT_UNAVAILABLE_MESSAGE} onRetry={refresh} />
      </>
    );
  }
  const total = data.planned + data.pending;
  return (
    <>
      <RollupHeader />
      <div className="flex flex-col gap-8">
        {data.stale || error ? <StaleNotice since={data.feedNow} /> : null}
        <FigureBand label="Network figures">
          <Figure label="Buses that may have broken down" value={formatCount(data.totals.suspected)} caption={`across ${formatCount(data.planned)} depots checked`} tone={data.totals.suspected === 0 ? 'better' : 'critical'} lead />
          <Figure label="High confidence" value={formatCount(data.totals.high)} caption="under tow or flagged" tone="critical" />
          <Figure label="Medium confidence" value={formatCount(data.totals.medium)} caption="stopped away from any stop" tone="warning" />
          <Figure label="Depots checked" value={`${formatCount(data.planned)} of ${formatCount(total)}`} caption={data.pending > 0 ? `${formatCount(data.pending)} still to come` : 'every operating depot'} tone="plan" />
        </FigureBand>
        {data.pending > 0 ? <p role="status" className="depot-prose" data-testid="incidents-progress">{rollupProgressSentence(data.planned, total)}</p> : null}
        <section aria-label="Incidents" className="min-w-0">
          <SectionLabel label="Incidents" count={data.rows.length} note="highest confidence first" />
          <DataTable
            caption="Every depot's suspected breakdowns"
            rows={data.rows}
            rowKey={(r) => `${r.depotId}|${r.registrationNumber}`}
            initialSort={{ key: 'confidence', direction: 'asc' }}
            freezeFirstColumn
            overflowCue
            emptyMessage="No bus looks broken down on this snapshot."
            columns={[
              { key: 'depot', header: 'Depot', sortValue: (r) => r.depotName, render: (r) => <Link href={`${depotHref(r.depotId)}/incidents`} className="depot-table-link">{r.depotName}</Link> },
              { key: 'bus', header: 'Bus', render: (r) => r.registrationNumber },
              { key: 'route', header: 'Route', render: (r) => r.routeName ?? '—' },
              { key: 'confidence', header: 'Confidence', sortValue: (r) => CONFIDENCE_RANK[r.confidence], render: (r) => CONFIDENCE_WORD[r.confidence] },
              { key: 'aboard', header: 'Aboard', align: 'right', sortValue: (r) => r.passengersAboard ?? -1, render: (r) => (r.passengersAboard === null ? '—' : formatCount(r.passengersAboard)) },
              { key: 'recommended', header: 'Recommended', render: (r) => (r.recommendedKind === null ? 'Next scheduled bus' : kindText(r.recommendedKind, r.recommendedDepotName ?? r.depotName)) },
              { key: 'arrival', header: 'Arrival', align: 'right', sortValue: (r) => r.arrivalMinutes ?? Number.MAX_SAFE_INTEGER, render: (r) => (r.arrivalMinutes === null ? '—' : `${formatCount(r.arrivalMinutes)} min`) },
            ]}
          />
        </section>
      </div>
    </>
  );
}
