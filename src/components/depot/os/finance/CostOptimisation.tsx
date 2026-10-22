'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { useDepotEconomics } from '@/hooks/useDepotEconomics';
import { useNetworkHourly } from '@/hooks/useNetworkHourly';
import { DEFAULT_PRICE_PER_LITRE } from '@/lib/depot/fuel/types';
import { formatCount } from '@/lib/depot/format';
import { AUDIT_DAYS } from '@/lib/depot/os/intel/fuelAudit';
import { FUEL_AUDIT_PATH, OPTIMISATION_PATH } from '@/lib/depot/os/workspaces';
import { serviceBand } from '@/lib/depot/service/networkHours';
import { useIntel } from '../IntelProvider';
import { OsHeader } from '../OsHeader';
import { useOsStore } from '../osStore';
import { EmptyNote, MeterBar, Metric, MetricStrip, Panel, PanelLoading, StatusTag } from '../ui';

const DAYS_PER_MONTH = 30;
/** Planning assumptions for an over-served bus-hour: average speed and economy. */
const OVER_SERVED_KMPH = 22;
const PLAN_KM_PER_LITRE = 4.6;
const SUSTAINED_SHORTFALL = 0.92;

/**
 * Cost optimisation: where diesel can be saved, each source estimated from records the
 * other workspaces show — verified excess on flagged journeys, buses running below their
 * class economy, and route-hours served beyond the projected need — with its assumptions.
 */
export function CostOptimisation() {
  const intel = useIntel();
  const openEntity = useOsStore((s) => s.openEntity);
  const economics = useDepotEconomics();
  const midday = useNetworkHourly({ band: 'midday', depotId: null, page: 1 });
  const inScope = (id: string | null): boolean => intel.scope === null || (id !== null && intel.scope.has(id));

  const excess = useMemo(() => {
    const flagged = (intel.fuel?.flagged ?? []).filter((j) => inScope(j.depotId));
    return (flagged.reduce((s, j) => s + j.exposureRupees, 0) / AUDIT_DAYS) * DAYS_PER_MONTH;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intel.fuel, intel.scope]);

  const underperformers = useMemo(() => {
    if (!intel.fuel) return [];
    return [...intel.fuel.vehicles.values()]
      .filter((v) => inScope(v.depotId) && v.medianKmPerLitre !== null && v.medianKmPerLitre < v.classKmPerLitre * SUSTAINED_SHORTFALL && v.journeys.length >= 5)
      .map((v) => {
        const km = v.journeys.reduce((s, j) => s + j.distanceKm, 0) / AUDIT_DAYS;
        // Only the gap to the tolerance line counts: a bus within 8% of its class is not a saving.
        const lost = km / (v.medianKmPerLitre as number) - km / (v.classKmPerLitre * SUSTAINED_SHORTFALL);
        return { v, monthly: lost * DEFAULT_PRICE_PER_LITRE * DAYS_PER_MONTH };
      })
      .sort((a, b) => b.monthly - a.monthly);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intel.fuel, intel.scope]);
  const efficiencyTotal = underperformers.reduce((s, x) => s + x.monthly, 0);

  const overServed = useMemo(() => {
    const summary = midday.data?.bands.find((b) => b.band === 'midday');
    const band = serviceBand('midday');
    const hours = band.toHour - band.fromHour + 1;
    return (summary?.byDepot ?? [])
      .filter((d) => d.busesOver > 0 && inScope(d.depotId))
      .map((d) => ({ d, monthly: ((d.busesOver * hours * OVER_SERVED_KMPH) / PLAN_KM_PER_LITRE) * DEFAULT_PRICE_PER_LITRE * DAYS_PER_MONTH }))
      .sort((a, b) => b.monthly - a.monthly)
      .slice(0, 20);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [midday.data, intel.scope]);
  const overServedTotal = overServed.reduce((s, x) => s + x.monthly, 0);

  const costRows = useMemo(
    () =>
      (economics.data?.depots ?? [])
        .filter((d) => d.kind === 'depot' && inScope(d.depotId))
        .map((d) => ({ id: d.depotId, name: d.name, cost: d.score.components.find((c) => c.key === 'costPerKm')?.value ?? null }))
        .filter((d) => d.cost !== null)
        .sort((a, b) => (b.cost as number) - (a.cost as number)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [economics.data, intel.scope],
  );
  const maxCost = Math.max(1e-9, ...costRows.map((r) => r.cost as number));
  const sources = [
    { label: 'Excess on flagged journeys, if verified', value: excess, href: FUEL_AUDIT_PATH },
    { label: 'Buses brought back within 8% of their class economy', value: efficiencyTotal, href: FUEL_AUDIT_PATH },
    { label: 'Midday route-hours served beyond need', value: overServedTotal, href: OPTIMISATION_PATH },
  ];
  const total = sources.reduce((s, x) => s + x.value, 0);
  const plan = intel.distribution?.plan;

  return (
    <div className="space-y-4" data-testid="os-cost-optimisation">
      <OsHeader
        title="Cost optimisation"
        description="Diesel the network could save each month, by source, each estimated from records the other workspaces show."
        statuses={['estimate', 'scenario']}
      />
      {!intel.fuel ? (
        <PanelLoading rows={5} label="Waiting for the fuel audit" />
      ) : (
        <>
          <MetricStrip columns={5}>
            <Metric label="Avoidable, per month" value={`₹${formatCount(Math.round(total))}`} tone="teal" status="estimate" sub="Sum of the three sources" />
            <Metric label="Flagged excess" value={`₹${formatCount(Math.round(excess))}`} sub="If every flag is verified" />
            <Metric label="Below-class buses" value={formatCount(underperformers.length)} sub={`₹${formatCount(Math.round(efficiencyTotal))} / month`} />
            <Metric label="Over-served at midday" value={formatCount(overServed.reduce((n, x) => n + x.d.busesOver, 0))} sub={`Buses over need, ${formatCount(overServed.length)} depots`} />
            <Metric label="Idle surplus at peak" value={plan ? formatCount(plan.after.totalSurplus) : '—'} sub="Buses above need after transfers" />
          </MetricStrip>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Panel kicker="Where the saving is" title="Avoidable diesel per month, by source" actions={<StatusTag status="estimate" />} bodyClassName="space-y-3 p-4">
              {sources.map((s) => (
                <div key={s.label}>
                  <div className="mb-1 flex justify-between font-sans text-[12.5px]">
                    <Link href={s.href} className="text-depot-ink hover:text-holo-glow">{s.label}</Link>
                    <span className="font-mono text-depot-ink">₹{formatCount(Math.round(s.value))}</span>
                  </div>
                  <MeterBar value={s.value} max={Math.max(1, ...sources.map((x) => x.value))} tone="teal" />
                </div>
              ))}
              <p className="depot-caption">
                Assumptions: planning diesel ₹{DEFAULT_PRICE_PER_LITRE}/L; an over-served bus-hour runs {OVER_SERVED_KMPH} km at {PLAN_KM_PER_LITRE} km/L; a below-class bus is one whose
                14-day median is under {Math.round(SUSTAINED_SHORTFALL * 100)}% of its class figure.
              </p>
            </Panel>
            <Panel kicker="Fuel cost per km" title="By depot, highest first" actions={<StatusTag status="scenario" />} bodyClassName="p-0">
              {costRows.length === 0 ? (
                <EmptyNote>Loading the depots&apos; economics.</EmptyNote>
              ) : (
                <ul className="os-scroll max-h-[320px] overflow-y-auto py-1">
                  {costRows.slice(0, 40).map((r) => (
                    <li key={r.id} className="grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)_4rem] items-center gap-2 px-4 py-1">
                      <button type="button" onClick={() => openEntity({ kind: 'depot', id: r.id })} className="truncate text-left font-sans text-[12.5px] text-depot-ink hover:text-holo-glow">{r.name}</button>
                      <MeterBar value={r.cost as number} max={maxCost} tone="amber" />
                      <span className="text-right font-mono text-[12px]">₹{(r.cost as number).toFixed(2)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Panel kicker="Vehicle efficiency" title="Buses costing the most against their class" bodyClassName="p-0">
              {underperformers.length === 0 ? (
                <EmptyNote>No bus in scope runs persistently below its class.</EmptyNote>
              ) : (
                <div className="os-scroll max-h-[380px] overflow-auto">
                  <table className="os-table">
                    <thead>
                      <tr>
                        <th>Bus</th>
                        <th>Depot</th>
                        <th className="text-right">Median</th>
                        <th className="text-right">Class</th>
                        <th className="text-right">₹ / month</th>
                      </tr>
                    </thead>
                    <tbody>
                      {underperformers.slice(0, 30).map(({ v, monthly }) => (
                        <tr key={v.registration} className="os-row" onClick={() => openEntity({ kind: 'vehicle', id: v.registration, depotId: v.depotId })}>
                          <td className="font-mono text-holo-glow">{v.registration}</td>
                          <td className="max-w-[9rem] truncate text-depot-prose">{intel.depotsById.get(v.depotId ?? '')?.name ?? '—'}</td>
                          <td className="os-num text-alert-amber">{v.medianKmPerLitre?.toFixed(2)}</td>
                          <td className="os-num text-depot-prose">{v.classKmPerLitre.toFixed(1)}</td>
                          <td className="os-num">{formatCount(Math.round(monthly))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
            <Panel kicker="Low-utilisation services" title="Depots whose routes run beyond need at midday" actions={<StatusTag status="forecast" />} bodyClassName="p-0">
              {!midday.data ? (
                <PanelLoading rows={4} label="Loading the midday band" />
              ) : overServed.length === 0 ? (
                <EmptyNote>No depot in scope runs beyond need at midday.</EmptyNote>
              ) : (
                <div className="os-scroll max-h-[380px] overflow-auto">
                  <table className="os-table">
                    <thead>
                      <tr>
                        <th>Depot</th>
                        <th className="text-right">Routes over</th>
                        <th className="text-right">Buses over</th>
                        <th className="text-right">₹ / month</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overServed.map(({ d, monthly }) => (
                        <tr key={d.depotId} className="os-row" onClick={() => openEntity({ kind: 'depot', id: d.depotId })}>
                          <td className="max-w-[12rem] truncate">{d.depotName}</td>
                          <td className="os-num">{formatCount(d.overRoutes)}</td>
                          <td className="os-num">{formatCount(d.busesOver)}</td>
                          <td className="os-num">{formatCount(Math.round(monthly))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}
