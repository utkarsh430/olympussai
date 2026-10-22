'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { useDecisionLog } from '@/components/depot/rebalance/useDecisionLog';
import { ErrorPanel, LoadingBlock, StaleNotice } from '@/components/depot/shell/DataStates';
import { DataTable } from '@/components/depot/shell/DataTable';
import { Figure, FigureBand } from '@/components/depot/shell/FigureBand';
import { PageHeader } from '@/components/depot/shell/PageHeader';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';
import { useSchedulerRollup } from '@/hooks/useSchedulerRollup';
import { DEPOT_UNAVAILABLE_MESSAGE } from '@/hooks/usePolledJson';
import { depotHref } from '@/lib/depot/depotNav';
import { formatCount, formatOneDecimal } from '@/lib/depot/format';
import { VERB } from '@/lib/depot/rebalance/decisionEvents';
import type { ScheduleSummary } from '@/lib/depot/schedule/api';
import type { ScheduleDecisionEntry } from '@/lib/depot/schedule/scheduleDecisions';
import { scheduleDecisionsByDepot } from '@/lib/depot/schedule/scheduleDecisions';
import { AWAITING_CAPTION, PAGE_TITLE, ROLLUP_DESCRIPTION, rollupProgressSentence } from '@/lib/depot/schedule/scheduleWording';

const LOADING_ROWS = 10;

function RollupHeader() {
  return <PageHeader title={PAGE_TITLE} description={ROLLUP_DESCRIPTION} />;
}

const slotsFreed = (d: ScheduleSummary): number =>
  d.crewSlotsToday.driver - d.crewSlotsUsed.driver + d.crewSlotsToday.conductor - d.crewSlotsUsed.conductor;

/**
 * Headquarters' AI Scheduler: every depot's plan for the day as it is built, the network
 * figures, and each depot's row with its decision from the trail kept in this browser.
 */
export function SchedulerRollupPage() {
  const { data, error, loading, refresh } = useSchedulerRollup();
  const log = useDecisionLog();
  const decisions = useMemo(
    () => (data ? scheduleDecisionsByDepot(log.slice.events, data.operatingDate) : new Map<string, ScheduleDecisionEntry>()),
    [log.slice.events, data],
  );
  if (loading) {
    return (
      <>
        <RollupHeader />
        <LoadingBlock rows={LOADING_ROWS} label="Loading the schedules" />
      </>
    );
  }
  if (!data) {
    return (
      <>
        <RollupHeader />
        <ErrorPanel title="Could not load the schedules" message={error ?? DEPOT_UNAVAILABLE_MESSAGE} onRetry={refresh} />
      </>
    );
  }
  const decided = data.depots.filter((d) => decisions.get(d.depotId)?.subject.planKey === d.planKey).length;
  const awaiting = data.depots.length - decided;
  const decisionWord = (d: ScheduleSummary): string => {
    const entry = decisions.get(d.depotId);
    return entry && entry.subject.planKey === d.planKey ? VERB[entry.decision] : 'Awaiting';
  };
  return (
    <>
      <RollupHeader />
      <div className="flex flex-col gap-8">
        {data.stale || error ? <StaleNotice since={data.feedNow} /> : null}
        <FigureBand label="Network figures">
          <Figure label="Depots planned" value={`${formatCount(data.planned)} of ${formatCount(data.total)}`} caption={data.pending > 0 ? `${formatCount(data.pending)} still to come` : 'every depot with a route'} tone="plan" lead />
          <Figure label="Buses freed" value={formatCount(data.summary.busesFreed)} caption="against today's plans" tone={data.summary.busesFreed >= 0 ? 'better' : 'worse'} />
          <Figure label="Crew slots freed" value={formatCount(data.summary.crewSlotsFreed)} caption="drivers and conductors" tone={data.summary.crewSlotsFreed >= 0 ? 'better' : 'worse'} />
          <Figure label="Uncovered bus-hours" value={formatCount(data.summary.uncoveredBusHours)} caption={`${formatCount(data.summary.depotsWithUncovered)} depots short`} tone={data.summary.uncoveredBusHours === 0 ? 'better' : 'critical'} />
          <Figure label="Awaiting a decision" value={formatCount(awaiting)} caption={AWAITING_CAPTION} tone="count" />
        </FigureBand>
        {data.pending > 0 ? (
          <p role="status" className="depot-prose" data-testid="scheduler-progress">{rollupProgressSentence(data.planned, data.total)}</p>
        ) : null}
        <section aria-label="Depots" className="min-w-0">
          <SectionLabel label="Depots" count={data.depots.length} note="most buses freed first" />
          <DataTable
            caption="Every depot's schedule plan"
            rows={data.depots}
            rowKey={(d) => d.depotId}
            initialSort={{ key: 'freed', direction: 'desc' }}
            freezeFirstColumn
            overflowCue
            columns={[
              { key: 'depot', header: 'Depot', sortValue: (d) => d.depotName, render: (d) => <Link href={`${depotHref(d.depotId)}/schedule`} className="depot-table-link">{d.depotName}</Link> },
              { key: 'routes', header: 'Routes', align: 'right', sortValue: (d) => d.routes, render: (d) => formatCount(d.routes) },
              { key: 'buses', header: 'Buses', align: 'right', sortValue: (d) => d.busesScheduled, render: (d) => formatCount(d.busesScheduled) },
              { key: 'today', header: 'Today', align: 'right', sortValue: (d) => d.busesToday, render: (d) => formatCount(d.busesToday) },
              { key: 'freed', header: 'Freed', align: 'right', sortValue: (d) => d.busesFreed, render: (d) => formatCount(d.busesFreed) },
              { key: 'drivers', header: 'Driver slots', align: 'right', sortValue: (d) => d.crewSlotsUsed.driver, render: (d) => formatCount(d.crewSlotsUsed.driver) },
              { key: 'conductors', header: 'Conductor slots', align: 'right', sortValue: (d) => d.crewSlotsUsed.conductor, render: (d) => formatCount(d.crewSlotsUsed.conductor) },
              { key: 'slotsFreed', header: 'Slots freed', align: 'right', sortValue: slotsFreed, render: (d) => formatCount(slotsFreed(d)) },
              { key: 'uncovered', header: 'Uncovered h', align: 'right', sortValue: (d) => d.uncoveredBusHours, render: (d) => formatCount(d.uncoveredBusHours) },
              { key: 'dead', header: 'Dead km', align: 'right', sortValue: (d) => d.deadKm ?? -1, render: (d) => (d.deadKm === null ? '—' : formatOneDecimal(d.deadKm)) },
              { key: 'decision', header: 'Decision', sortValue: decisionWord, render: decisionWord },
            ]}
          />
        </section>
      </div>
    </>
  );
}
