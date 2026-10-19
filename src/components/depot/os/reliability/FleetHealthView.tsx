'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { depotHref } from '@/lib/depot/depotNav';
import { formatCount } from '@/lib/depot/format';
import { BUS_STATE_LABEL } from '@/lib/depot/labels';
import { planBays, PLAN_DAYS } from '@/lib/depot/os/intel/bays';
import { FAULT_LABEL, summariseHealth, type FaultSystem, type VehicleHealth } from '@/lib/depot/os/intel/vehicleHealth';
import { regionById } from '@/lib/depot/os/regions';
import { modelDepotMaster } from '@/lib/depot/sim/depotMaster';
import { useIntel } from '../IntelProvider';
import { OsHeader } from '../OsHeader';
import { MaintenanceImpact, ServiceDueProjection } from './MaintenanceImpact';
import { useOsStore } from '../osStore';
import { EmptyNote, MeterBar, Metric, MetricStrip, Panel, PanelLoading, StatusTag } from '../ui';

const LIST = 60;
const BAND_TONE = { high: 'crimson', elevated: 'amber', normal: 'green' } as const;
const BUCKETS = 10;

function actionFor(h: VehicleHealth): string {
  const onRoad = h.state === 'in_service' || h.state === 'on_road';
  if (h.state === 'off_road') return 'In the workshop';
  if (h.service.group === 'overdue' && onRoad) return 'Withdraw at trip end';
  if (h.band === 'high' && onRoad) return 'Swap at trip end';
  if (h.service.group === 'overdue') return 'Book into a bay';
  if (h.band === 'high') return 'Inspect before next duty';
  if (h.service.group === 'due_soon') return `Plan service in ~${Math.max(0, h.serviceDueInDays)} days`;
  return 'Routine';
}

/**
 * Fleet health and predictive maintenance, at Headquarters or for one depot. Every bus's
 * service position is the Maintenance page's own; its risk index is a points score whose
 * factors are listed; a depot gets a seven-day repair-bay plan from its workshop bays and
 * what that plan keeps off the road each day.
 */
export function FleetHealthView() {
  const intel = useIntel();
  const regionId = useOsStore((s) => s.regionId);
  const openEntity = useOsStore((s) => s.openEntity);
  const [onlyOnRoad, setOnlyOnRoad] = useState(false);
  const depotId = intel.scopeDepotId;
  const depot = depotId ? (intel.depotsById.get(depotId) ?? null) : null;
  const scopeLabel = depot?.name ?? (regionById(regionId) ? `${regionById(regionId)!.name} region` : 'UPSRTC network');
  const health = useMemo(
    () => (intel.health ?? []).filter((h) => intel.scope === null || (h.depotId !== null && intel.scope.has(h.depotId))),
    [intel.health, intel.scope],
  );
  const summary = useMemo(() => summariseHealth(health), [health]);
  const ranked = useMemo(
    () =>
      [...health]
        .filter((h) => !onlyOnRoad || h.state === 'in_service' || h.state === 'on_road')
        .sort((a, b) => b.risk - a.risk || a.service.kmToNextService - b.service.kmToNextService)
        .slice(0, LIST),
    [health, onlyOnRoad],
  );
  const histogram = useMemo(() => {
    const counts = Array.from({ length: BUCKETS }, () => 0);
    for (const h of health) counts[Math.min(BUCKETS - 1, Math.floor(h.risk / 10))]! += 1;
    return counts;
  }, [health]);
  const faults = useMemo(() => {
    const counts = new Map<FaultSystem, number>();
    for (const h of health) if (h.recurring) counts.set(h.recurring, (counts.get(h.recurring) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [health]);
  const bayPlan = useMemo(() => (depot ? planBays(health, modelDepotMaster(depot).workshopBays) : null), [depot, health]);
  const workload = useMemo(() => {
    if (depotId) return [];
    const groups = new Map<string, VehicleHealth[]>();
    for (const h of health) {
      if (!h.depotId) continue;
      const held = groups.get(h.depotId);
      if (held) held.push(h);
      else groups.set(h.depotId, [h]);
    }
    return [...groups.entries()]
      .map(([id, list]) => ({ id, name: intel.depotsById.get(id)?.name ?? id, s: summariseHealth(list) }))
      .sort((a, b) => b.s.highRiskOnRoad - a.s.highRiskOnRoad || b.s.overdue - a.s.overdue)
      .slice(0, 25);
  }, [health, depotId, intel.depotsById]);
  const maxBucket = Math.max(1, ...histogram);

  return (
    <div className="space-y-4" data-testid="os-fleet-health">
      <OsHeader
        title="Fleet health"
        description={`${scopeLabel}: service positions, breakdown risk with its factors, recurring faults and the workshop plan.`}
        statuses={['live', 'estimate', 'scenario']}
      />
      {!intel.health ? (
        <PanelLoading rows={5} label="Reading every bus's service position" />
      ) : (
        <>
          <MetricStrip columns={8}>
            <Metric label="Operational" value={formatCount(summary.operational)} sub={`of ${formatCount(summary.buses)} buses`} tone="green" status="live" />
            <Metric label="Off road" value={formatCount(summary.offRoad)} tone="crimson" sub="Flagged maintenance" />
            <Metric label="Service overdue" value={formatCount(summary.overdue)} tone={summary.overdue > 0 ? 'amber' : null} sub="Past the interval" />
            <Metric label="Due soon" value={formatCount(summary.dueSoon)} sub="Within 1,500 km" />
            <Metric label="High risk" value={formatCount(summary.highRisk)} tone={summary.highRisk > 0 ? 'crimson' : null} sub={`${formatCount(summary.elevatedRisk)} elevated`} status="estimate" />
            <Metric label="High risk on road" value={formatCount(summary.highRiskOnRoad)} tone={summary.highRiskOnRoad > 0 ? 'crimson' : null} sub="Running now" />
            <Metric label="Recurring faults" value={formatCount(summary.recurring)} sub="Same system twice in 180 d" />
            <Metric label="Fit standby" value={formatCount(summary.standbyCandidates)} tone="teal" sub="Replacement availability" />
          </MetricStrip>

          <div className={`grid grid-cols-1 gap-4 ${depotId ? 'xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]' : ''}`}>
            <ServiceDueProjection health={health} />
            {depotId ? <MaintenanceImpact depotId={depotId} /> : null}
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <Panel kicker="Breakdown risk" title="Buses by risk index" actions={<StatusTag status="estimate" />} bodyClassName="space-y-4 p-4">
              <div className="flex h-28 items-end gap-1.5" role="img" aria-label="Buses per risk-index band">
                {histogram.map((n, i) => (
                  <div key={i} className="flex flex-1 flex-col items-center justify-end gap-1">
                    <span className="font-mono text-[10px] text-depot-prose">{n > 0 ? formatCount(n) : ''}</span>
                    <div
                      className={`w-full rounded-t-[2px] ${i >= 5 ? 'bg-alert-crimson' : i >= 3 ? 'bg-alert-amber' : 'bg-holo-deep'}`}
                      style={{ height: `${(n / maxBucket) * 80}px` }}
                      title={`${i * 10}–${i * 10 + 9}: ${n} buses`}
                    />
                  </div>
                ))}
              </div>
              <div className="flex justify-between font-mono text-[10px] text-depot-muted">
                <span>0</span>
                <span>Risk index (points; elevated from 32, high from 50)</span>
                <span>100</span>
              </div>
              <div>
                <div className="os-kicker mb-1.5">Recurring faults by system</div>
                {faults.length === 0 ? (
                  <p className="depot-note">No system repaired twice in 180 days in this scope.</p>
                ) : (
                  <div className="space-y-1.5">
                    {faults.map(([system, n]) => (
                      <div key={system} className="grid grid-cols-[8rem_minmax(0,1fr)_3rem] items-center gap-2">
                        <span className="font-sans text-[12px] text-depot-prose">{FAULT_LABEL[system]}</span>
                        <MeterBar value={n} max={faults[0]![1]} tone="amber" />
                        <span className="text-right font-mono text-[12px] text-depot-ink">{formatCount(n)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Panel>

            {bayPlan && depot ? (
              <Panel id="bay-plan" kicker="Repair bay scheduling" title={`${bayPlan.bays} workshop bay${bayPlan.bays === 1 ? '' : 's'} · next ${PLAN_DAYS} days`} actions={<StatusTag status="proposed" />} bodyClassName="space-y-3 p-4">
                <div className="os-scroll overflow-x-auto">
                  <table className="w-full border-separate border-spacing-1 font-mono text-[10.5px]">
                    <thead>
                      <tr>
                        <th className="text-left font-normal text-depot-muted">Bay</th>
                        {Array.from({ length: PLAN_DAYS }, (_, d) => (
                          <th key={d} className="font-normal text-depot-muted">D+{d + 1}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {Array.from({ length: bayPlan.bays }, (_, bay) => (
                        <tr key={bay}>
                          <td className="pr-2 text-depot-muted">{bay + 1}</td>
                          {bayPlan.grid.map((row, d) => {
                            const reg = row[bay];
                            const job = reg ? bayPlan.jobs.find((j) => j.registration === reg) : undefined;
                            return (
                              <td key={d}>
                                {reg ? (
                                  <button
                                    type="button"
                                    onClick={() => openEntity({ kind: 'vehicle', id: reg, depotId })}
                                    className={`block w-full truncate rounded-[3px] px-1 py-1 text-left text-void ${job?.reason === 'overdue' ? 'bg-alert-amber' : job?.reason === 'risk' ? 'bg-alert-crimson' : 'bg-holo-teal'}`}
                                    title={`${reg}: ${job?.reason === 'overdue' ? 'service overdue' : job?.reason === 'risk' ? 'high risk' : 'due soon'}`}
                                  >
                                    {reg.slice(-6)}
                                  </button>
                                ) : (
                                  <span className="block rounded-[3px] bg-depot-raised px-1 py-1 text-depot-faint">free</span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="grid grid-cols-3 gap-3 font-sans text-[12px] text-depot-prose">
                  <div>
                    <div className="os-kicker">Jobs placed</div>
                    <div className="font-mono text-[15px] text-depot-ink">{formatCount(bayPlan.jobs.length)}</div>
                  </div>
                  <div>
                    <div className="os-kicker">Still waiting</div>
                    <div className={`font-mono text-[15px] ${bayPlan.unscheduled > 0 ? 'text-alert-amber' : 'text-depot-ink'}`}>{formatCount(bayPlan.unscheduled)}</div>
                  </div>
                  <div>
                    <div className="os-kicker">Availability impact</div>
                    <div className="font-mono text-[15px] text-depot-ink">−{formatCount(Math.max(...bayPlan.offRoadByDay))} / day</div>
                  </div>
                </div>
                <p className="depot-caption">Amber: past its service · crimson: high risk · teal: due soon. A recurring fault takes two bay-days.</p>
              </Panel>
            ) : (
              <Panel kicker="Maintenance workload" title="Depots by high-risk buses on the road" bodyClassName="p-0">
                {workload.length === 0 ? (
                  <EmptyNote>No depot in scope.</EmptyNote>
                ) : (
                  <div className="os-scroll max-h-[340px] overflow-auto">
                    <table className="os-table">
                      <thead>
                        <tr>
                          <th>Depot</th>
                          <th className="text-right">Buses</th>
                          <th className="text-right">Overdue</th>
                          <th className="text-right">High risk</th>
                          <th className="text-right">On road</th>
                          <th className="text-right">Recurring</th>
                        </tr>
                      </thead>
                      <tbody>
                        {workload.map((w) => (
                          <tr key={w.id} className="os-row">
                            <td>
                              <Link href={`${depotHref(w.id)}/health`} className="hover:text-holo-glow">{w.name}</Link>
                            </td>
                            <td className="os-num">{formatCount(w.s.buses)}</td>
                            <td className="os-num text-alert-amber">{formatCount(w.s.overdue)}</td>
                            <td className="os-num">{formatCount(w.s.highRisk)}</td>
                            <td className={`os-num ${w.s.highRiskOnRoad > 0 ? 'text-alert-crimson' : ''}`}>{formatCount(w.s.highRiskOnRoad)}</td>
                            <td className="os-num">{formatCount(w.s.recurring)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>
            )}
          </div>

          <Panel
            kicker="Predictive maintenance"
            title={`Highest risk first · ${formatCount(ranked.length)} shown`}
            actions={
              <label className="flex items-center gap-2 font-sans text-[12px] text-depot-prose">
                <input type="checkbox" className="depot-checkbox" checked={onlyOnRoad} onChange={(e) => setOnlyOnRoad(e.target.checked)} />
                Only buses on the road
              </label>
            }
            bodyClassName="p-0"
          >
            <div className="os-scroll max-h-[560px] overflow-auto">
              <table className="os-table">
                <thead>
                  <tr>
                    <th>Bus</th>
                    {depotId ? null : <th>Depot</th>}
                    <th>State</th>
                    <th className="w-40">Risk</th>
                    <th>Service position</th>
                    <th>Recurring</th>
                    <th>Leading factor</th>
                    <th>Recommended</th>
                  </tr>
                </thead>
                <tbody>
                  {ranked.map((h) => (
                    <tr key={h.registration} className="os-row" onClick={() => openEntity({ kind: 'vehicle', id: h.registration, depotId: h.depotId })}>
                      <td className="font-mono text-holo-glow">{h.registration}</td>
                      {depotId ? null : <td className="max-w-[9rem] truncate text-depot-prose">{intel.depotsById.get(h.depotId ?? '')?.name ?? '—'}</td>}
                      <td className="whitespace-nowrap text-depot-prose">{BUS_STATE_LABEL[h.state].split(',')[0]}</td>
                      <td>
                        <div className="flex items-center gap-2">
                          <span className="w-7 font-mono">{h.risk}</span>
                          <div className="flex-1">
                            <MeterBar value={h.risk} max={100} tone={BAND_TONE[h.band]} />
                          </div>
                        </div>
                      </td>
                      <td className={`whitespace-nowrap font-mono ${h.service.group === 'overdue' ? 'text-alert-amber' : 'text-depot-prose'}`}>
                        {h.service.kmToNextService < 0 ? `${formatCount(-h.service.kmToNextService)} km over` : `${formatCount(h.service.kmToNextService)} km left`}
                      </td>
                      <td className="text-depot-prose">{h.recurring ? FAULT_LABEL[h.recurring] : '—'}</td>
                      <td className="max-w-[16rem] truncate text-depot-prose">{h.factors[0]?.label ?? '—'}</td>
                      <td className="whitespace-nowrap font-medium text-holo-teal">{actionFor(h)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}
