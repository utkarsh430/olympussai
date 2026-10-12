'use client';

import { useDepotDetailContext } from '@/components/depot/data/DepotDetailProvider';
import { ErrorPanel, LoadingBlock, StaleNotice } from '@/components/depot/shell/DataStates';
import { StatePanel } from '@/components/depot/shell/StatePanel';
import { useDepotSchedule } from '@/hooks/useDepotSchedule';
import { useScheduleWhatIf } from '@/hooks/useScheduleWhatIf';
import { DEPOT_UNAVAILABLE_MESSAGE } from '@/hooks/usePolledJson';
import { clampScheduleParams } from '@/lib/depot/schedule/params';
import { blockRows, coverageRows, heldOutSentence, scheduleFigures, shiftRows, uncoveredRows } from '@/lib/depot/schedule/schedulePageModel';
import { emptyScheduleSentence, whatIfLine } from '@/lib/depot/schedule/scheduleWording';
import { DEPOT_NOT_FOUND_MESSAGE } from '@/lib/depot/scopeState';
import { BlockBoard } from './BlockBoard';
import { CoverageStrip } from './CoverageStrip';
import { ResourceBand } from './ResourceBand';
import { ScheduleDecision } from './ScheduleDecision';
import { ScheduleHeader } from './ScheduleHeader';
import { ShiftTable } from './ShiftTable';
import { UncoveredNeed } from './UncoveredNeed';
import { WhatIfPanel } from './WhatIfPanel';

const LOADING_ROWS = 12;
const NO_CONTEXT = { routes: [], buses: [], available: { driver: 0, conductor: 0 } };

/**
 * The depot's AI Scheduler page: the plan's figures against today, coverage by hour,
 * the block timeline, crew shifts, uncovered need, the what-if, the decision and trail.
 * While a what-if is in force every section shows its plan.
 */
export function SchedulePage() {
  const detail = useDepotDetailContext();
  const base = useDepotSchedule(detail.depotId);
  const whatIf = useScheduleWhatIf(detail.depotId);

  if (base.loading) {
    return (
      <>
        <ScheduleHeader />
        <LoadingBlock rows={LOADING_ROWS} label="Loading the schedule" />
      </>
    );
  }
  if (!base.data) {
    return (
      <>
        <ScheduleHeader />
        <ErrorPanel title={base.error === DEPOT_NOT_FOUND_MESSAGE ? DEPOT_NOT_FOUND_MESSAGE : 'Could not load the schedule'} message={base.error ?? DEPOT_UNAVAILABLE_MESSAGE} onRetry={base.refresh} />
      </>
    );
  }
  const shown = whatIf.data ?? base.data;
  const { plan } = shown;
  const stale = base.data.stale || base.error ? <StaleNotice since={base.data.feedNow} /> : null;
  const defaults = clampScheduleParams({}, NO_CONTEXT).params;
  const inForce = whatIf.data ? whatIfLine(plan.params, defaults) || 'What-if: no change from the baseline.' : '';
  const subject = { kind: 'schedule' as const, depotId: shown.depotId, depotName: shown.depotName, planKey: shown.planKey, busesScheduled: plan.figures.buses, crewSlotsUsed: plan.figures.crewSlots.driver + plan.figures.crewSlots.conductor };
  const routes = [...plan.routes.map((r) => r.routeName), ...plan.routesWithoutNeed];
  if (plan.routes.length === 0 && !whatIf.data) {
    return (
      <>
        <ScheduleHeader />
        <div className="flex flex-col gap-8">
          {stale}
          <StatePanel kind="empty" sentence={emptyScheduleSentence(plan.operatingDate)} remedy="A route of the depot needs a bus once its buses report a route name." />
        </div>
      </>
    );
  }
  return (
    <>
      <ScheduleHeader />
      <div className="flex flex-col gap-8">
        {stale}
        <ResourceBand figures={scheduleFigures(plan)} />
        <WhatIfPanel routes={routes} limits={shown.limits} busy={whatIf.busy} inForce={inForce} clamped={plan.clamped} error={whatIf.error} onRun={whatIf.run} onReset={whatIf.reset} />
        <CoverageStrip rows={coverageRows(plan)} />
        <BlockBoard depotId={shown.depotId} rows={blockRows(plan)} feedNow={shown.feedNow} />
        <ShiftTable rows={shiftRows(plan)} />
        <UncoveredNeed rows={uncoveredRows(plan)} heldOut={heldOutSentence(plan)} />
        <ScheduleDecision subject={subject} operatingDate={plan.operatingDate} />
      </div>
    </>
  );
}
