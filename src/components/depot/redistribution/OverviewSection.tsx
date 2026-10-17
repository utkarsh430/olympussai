'use client';

import { useState } from 'react';
import { FilterRow, Select } from '@/components/depot/shell/Controls';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';
import { formatCount, formatPercent } from '@/lib/depot/format';
import { TIME_BANDS } from '@/lib/depot/redistribution/bands';
import type { EngineModel } from '@/lib/depot/redistribution/engineModel';
import type { EngineAction } from '@/lib/depot/redistribution/engineState';
import { HOURS_PER_DAY } from '@/lib/depot/redistribution/types';
import { KPI_HELP, SECTION } from '@/lib/depot/redistribution/wording';
import { hourLabel } from '@/lib/depot/service/serviceWording';
import { KpiCard } from './KpiCard';

export interface OverviewSectionProps {
  readonly model: EngineModel;
  readonly dispatch: (action: EngineAction) => void;
}

const HOURS = Array.from({ length: HOURS_PER_DAY }, (_, h) => h);

function Controls({ model, dispatch }: OverviewSectionProps) {
  const [customOpen, setCustomOpen] = useState(model.band === 'custom');
  const custom = model.band === 'custom';
  const { fromHour, toHour } = model.selection;
  return (
    <FilterRow label="Choose a time band and a depot">
      <div role="group" aria-label="Time band" className="flex flex-wrap gap-1.5">
        {TIME_BANDS.map((b) => (
          <button
            key={b.key}
            type="button"
            className="depot-filter-button"
            aria-pressed={model.band === b.key}
            onClick={() => {
              setCustomOpen(false);
              dispatch({ type: 'band', key: b.key });
            }}
          >
            {b.label}
          </button>
        ))}
        <button
          type="button"
          className="depot-filter-button"
          aria-pressed={custom || customOpen}
          aria-expanded={customOpen}
          onClick={() => setCustomOpen((v) => !v)}
        >
          Custom Hour Range
        </button>
      </div>
      {customOpen ? (
        <div className="flex flex-wrap items-center gap-3" data-testid="custom-hours">
          <Select label="From" value={fromHour} onChange={(e) => dispatch({ type: 'hours', fromHour: Number(e.target.value), toHour })}>
            {HOURS.map((h) => (
              <option key={h} value={h}>
                {hourLabel(h)}
              </option>
            ))}
          </Select>
          <Select label="To" value={toHour} onChange={(e) => dispatch({ type: 'hours', fromHour, toHour: Number(e.target.value) })}>
            {HOURS.map((h) => (
              <option key={h} value={h}>
                {h + 1 === HOURS_PER_DAY ? '24:00' : hourLabel(h + 1)}
              </option>
            ))}
          </Select>
        </div>
      ) : null}
      <Select label="Depot" value={model.selection.depotId ?? ''} onChange={(e) => dispatch({ type: 'depot', depotId: e.target.value === '' ? null : e.target.value })}>
        <option value="">All depots</option>
        {model.scenario.depots.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </Select>
    </FilterRow>
  );
}

/** The six network figures and the controls above them. */
export function OverviewSection({ model, dispatch }: OverviewSectionProps) {
  const { before, potential, plan } = model;
  const closable = before.shortageBusHours - potential.shortageBusHours;
  const gainPts = Math.round((potential.coverage - before.coverage) * 100);
  const scope = model.selection.depotId === null ? 'all depots' : (model.depotNames.get(model.selection.depotId) ?? 'the depot');
  return (
    <section aria-labelledby={SECTION.overview.id} className="min-w-0" data-testid="network-overview">
      <SectionLabel id={SECTION.overview.id} label={SECTION.overview.label} note={`${model.bandLabel} · ${scope}`} />
      <div className="mb-4">
        <Controls model={model} dispatch={dispatch} />
      </div>
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6" aria-label="Network figures">
        <KpiCard
          label="Routes Facing Shortage"
          value={formatCount(before.routesShort)}
          subtitle={`of ${formatCount(before.routes)} routes short in at least one hour`}
          help={KPI_HELP.routesShort}
          tone={before.routesShort > 0 ? 'worse' : 'better'}
          indicator={`${formatCount(before.routesSurplus)} routes with surplus`}
        />
        <KpiCard
          label="Total Bus-Hour Shortage"
          value={formatCount(before.shortageBusHours)}
          subtitle="cumulative bus-hours across the window"
          help={KPI_HELP.shortage}
          tone={before.shortageBusHours > 0 ? 'worse' : 'better'}
          indicator={
            before.peakShortageHour === null
              ? 'No hour short'
              : `Peak ${formatCount(before.peakSimultaneousShortage)} buses short at ${hourLabel(before.peakShortageHour)}`
          }
        />
        <KpiCard
          label="Available Surplus Capacity"
          value={formatCount(before.surplusBusHours)}
          subtitle="spare bus-hours on surplus routes"
          help={KPI_HELP.surplus}
          tone="better"
          indicator={`Peak ${formatCount(before.peakSimultaneousSurplus)} spare buses at once`}
        />
        <KpiCard
          label="Redistribution Opportunities"
          value={formatCount(plan.recommendations.length)}
          subtitle="feasible transfers the engine can propose"
          help={KPI_HELP.opportunities}
          tone="plan"
          indicator={`Closes ${formatCount(closable)} of ${formatCount(before.shortageBusHours)} short bus-hours`}
        />
        <KpiCard
          label="Passenger Demand Coverage"
          value={formatPercent(before.coverage)}
          subtitle={`${formatCount(Math.round(before.demandCovered))} of ${formatCount(before.demand)} passengers carried`}
          help={KPI_HELP.coverage}
          tone="info"
          indicator={`After plan ${formatPercent(potential.coverage)}`}
          indicatorTone="better"
        />
        <KpiCard
          label="Potential Service Improvement"
          value={`${gainPts > 0 ? '+' : ''}${gainPts} pts`}
          subtitle="coverage gain from every feasible transfer"
          help={KPI_HELP.improvement}
          tone={gainPts > 0 ? 'better' : 'info'}
          indicator={`Shortage falls to ${formatCount(potential.shortageBusHours)} bus-hours`}
        />
      </ul>
    </section>
  );
}
