'use client';

import { useMemo, useState } from 'react';
import { shortDate } from '@/lib/depot/os/words';
import { useSearchParams } from 'next/navigation';
import { ArrowDownWideNarrow } from 'lucide-react';
import { formatCount, formatPlainDate } from '@/lib/depot/format';
import { auditFleet, type FuelAudit, type JourneyAudit } from '@/lib/depot/os/intel/fuelAudit';
import type { Severity } from '@/lib/depot/os/intel/types';
import { regionById } from '@/lib/depot/os/regions';
import { useIntel } from '../IntelProvider';
import { OsHeader } from '../OsHeader';
import { useOsStore } from '../osStore';
import { EmptyNote, LocalTabs, Metric, MetricStrip, Panel, PanelLoading, SeverityChip, StatusTag } from '../ui';
import { CASE_LABEL, FuelInvestigation } from './FuelInvestigation';

type SortKey = 'excess' | 'variance' | 'exposure' | 'date';
type Tab = 'queue' | 'efficiency';
const PAGE = 60;

function DailyChart({ audit }: { readonly audit: FuelAudit }) {
  const max = Math.max(1, ...audit.daily.map((d) => d.fuelLitres));
  const maxExcess = Math.max(1, ...audit.daily.map((d) => d.excessLitres));
  const row = (label: string, value: (d: FuelAudit['daily'][number]) => number, top: number, cls: string, height: number) => (
    <div className="flex items-end gap-3">
      <span className="w-28 shrink-0 pb-0.5 font-sans text-[11.5px] text-depot-prose">{label}</span>
      <div className="flex flex-1 items-end gap-1.5" style={{ height }}>
        {audit.daily.map((d) => (
          <div
            key={d.date}
            className={`flex-1 rounded-t-[2px] ${cls}`}
            style={{ height: `${(value(d) / top) * 100}%` }}
            title={`${shortDate(d.date)}: ${formatCount(Math.round(value(d)))} L`}
          />
        ))}
      </div>
    </div>
  );
  return (
    <div className="space-y-2 px-4 pb-3 pt-3" role="img" aria-label="Fuel issued per day, and the flagged excess per day">
      {row('Issued', (d) => d.fuelLitres, max, 'bg-holo-deep', 64)}
      {row('Flagged excess', (d) => d.excessLitres, maxExcess, 'bg-alert-amber', 28)}
      <div className="flex justify-between pl-[7.75rem] font-mono text-[10px] text-depot-muted">
        <span>{shortDate(audit.daily[0]?.date ?? '')}</span>
        <span>Each row on its own scale; hover a bar for its litres</span>
        <span>{shortDate(audit.daily[audit.daily.length - 1]?.date ?? '')}</span>
      </div>
    </div>
  );
}

/**
 * Fuel audit and anomaly detection, at Headquarters or for one depot. Journey-level only:
 * distance and fuel issued against each bus's own median economy, with no tank sensor
 * of any kind. The queue ranks flagged journeys; the panel investigates one and moves
 * its case along; the efficiency tab benchmarks each bus against its class.
 */
export function FuelAuditView() {
  const intel = useIntel();
  const params = useSearchParams();
  const regionId = useOsStore((s) => s.regionId);
  const fuelCases = useOsStore((s) => s.fuelCases);
  const [tab, setTab] = useState<Tab>('queue');
  const [sort, setSort] = useState<SortKey>('excess');
  const [severity, setSeverity] = useState<Severity | 'all'>('all');
  const [limit, setLimit] = useState(PAGE);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const wantedBus = params?.get('bus') ?? null;
  const depotId = intel.scopeDepotId;
  const scopeLabel = depotId
    ? (intel.depotsById.get(depotId)?.name ?? `Depot ${depotId}`)
    : regionById(regionId)
      ? `${regionById(regionId)!.name} region`
      : 'UPSRTC network';

  // One depot is audited here and now; Headquarters reads the shell's network audit.
  const audit = useMemo<FuelAudit | null>(() => {
    if (!intel.fleet || !intel.operatingDate) return null;
    if (depotId) return auditFleet(intel.fleet.filter((b) => b.depotId === depotId), intel.operatingDate);
    if (!intel.fuel) return null;
    if (intel.scope === null) return intel.fuel;
    return auditFleet(intel.fleet.filter((b) => b.depotId !== null && intel.scope!.has(b.depotId)), intel.operatingDate);
  }, [intel.fleet, intel.operatingDate, intel.fuel, intel.scope, depotId]);

  const flagged = useMemo(() => {
    const list = (audit?.flagged ?? []).filter((j) => severity === 'all' || j.severity === severity);
    const key: Record<SortKey, (j: JourneyAudit) => number | string> = {
      excess: (j) => -j.excessLitres,
      variance: (j) => -j.variance,
      exposure: (j) => -j.exposureRupees,
      date: (j) => j.date,
    };
    const pick = key[sort];
    return [...list].sort((a, b) => {
      const x = pick(a);
      const y = pick(b);
      return sort === 'date' ? String(y).localeCompare(String(x)) : (x as number) - (y as number);
    });
  }, [audit, severity, sort]);

  const selected =
    flagged.find((j) => j.id === selectedId) ??
    (wantedBus ? flagged.find((j) => j.registration === wantedBus) : undefined) ??
    flagged[0] ??
    null;
  const history = selected ? (audit?.vehicles.get(selected.registration) ?? null) : null;
  const peers = useMemo(() => {
    if (!audit || !history) return [];
    return [...audit.vehicles.values()]
      .filter((v) => v.depotId === history.depotId && v.serviceClass === history.serviceClass && v.registration !== history.registration)
      .map((v) => ({ registration: v.registration, median: v.medianKmPerLitre }));
  }, [audit, history]);

  const efficiency = useMemo(() => {
    if (!audit) return [];
    return [...audit.vehicles.values()]
      .filter((v) => v.medianKmPerLitre !== null && v.journeys.length >= 5)
      .map((v) => ({ v, ratio: (v.medianKmPerLitre as number) / v.classKmPerLitre }))
      .sort((a, b) => a.ratio - b.ratio)
      .slice(0, 40);
  }, [audit]);

  const openCases = (audit?.flagged ?? []).filter((j) => {
    const c = fuelCases[j.id];
    return c && c.status !== 'explained';
  }).length;

  return (
    <div className="space-y-4" data-testid="os-fuel-audit">
      <OsHeader
        title="Fuel audit"
        description={`${scopeLabel}: each completed journey's fuel issue against the same bus's own median economy. No tank sensors; flags are for verification.`}
        statuses={['scenario', 'derived', 'estimate']}
      />
      {!audit ? (
        <PanelLoading rows={4} label="Auditing the last fourteen days of journeys" />
      ) : (
        <>
          <MetricStrip columns={8}>
            <Metric label="Fleet economy" value={audit.summary.fleetKmPerLitre === null ? '—' : `${audit.summary.fleetKmPerLitre.toFixed(2)}`} sub="km/L, 14 days" />
            <Metric label="Fuel issued" value={`${formatCount(Math.round(audit.summary.fuelLitres / 1000))}k L`} sub={`${formatCount(audit.summary.journeys)} journeys`} />
            <Metric label="Expected" value={`${formatCount(Math.round(audit.summary.expectedLitres / 1000))}k L`} sub="At each bus's own median" />
            <Metric label="Excess, flagged" value={`${formatCount(Math.round(audit.summary.excessLitres))} L`} tone="amber" sub="Above expectation" />
            <Metric label="Flagged journeys" value={formatCount(audit.summary.flagged)} tone={audit.summary.flagged > 0 ? 'amber' : null} sub={`${((audit.summary.flagged / Math.max(1, audit.summary.journeys)) * 100).toFixed(1)}% of journeys`} />
            <Metric label="Buses flagged" value={formatCount(audit.summary.flaggedVehicles)} sub={`of ${formatCount(audit.summary.vehicles)}`} />
            <Metric label="Exposure" value={`₹${formatCount(audit.summary.exposureRupees)}`} tone="amber" status="estimate" sub="Excess × planning price" />
            <Metric label="Open cases" value={formatCount(openCases)} tone="teal" sub="Assigned or under review" />
          </MetricStrip>

          <Panel kicker="Consumption" title="Fuel issued per day, and the excess on flagged journeys" bodyClassName="p-0" actions={<StatusTag status="scenario" />}>
            <DailyChart audit={audit} />
          </Panel>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_440px]">
            <Panel id="anomaly-queue" kicker="AI anomaly detection" title="Flagged journeys and efficiency" bodyClassName="flex min-h-0 flex-col p-0" className="h-[820px]">
              <LocalTabs<Tab>
                label="Fuel audit tables"
                value={tab}
                onChange={setTab}
                items={[
                  { key: 'queue', label: 'Anomaly queue', count: audit.flagged.length },
                  { key: 'efficiency', label: 'Vehicle efficiency', count: efficiency.length },
                ]}
              />
              {tab === 'queue' ? (
                <>
                  <div className="flex flex-wrap items-center gap-2 border-b border-holo-glow/10 px-3 py-2">
                    {(['all', 'high', 'medium', 'low'] as const).map((s) => (
                      <button key={s} type="button" aria-pressed={severity === s} onClick={() => setSeverity(s)} className={`os-chip px-2 py-0.5 ${severity === s ? 'border-holo-glow/60 text-holo-glow' : 'border-depot-line text-depot-muted'}`}>
                        {s === 'all' ? 'All' : s}
                      </button>
                    ))}
                    <label className="ml-auto flex items-center gap-1.5 font-sans text-[12px] text-depot-prose">
                      <ArrowDownWideNarrow className="h-3.5 w-3.5" aria-hidden />
                      <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="depot-control depot-select h-7 font-sans" aria-label="Sort by">
                        <option value="excess">Excess litres</option>
                        <option value="variance">Variance</option>
                        <option value="exposure">Exposure</option>
                        <option value="date">Most recent</option>
                      </select>
                    </label>
                  </div>
                  {flagged.length === 0 ? (
                    <EmptyNote>No journey crossed both thresholds in this scope: 10% over the bus&apos;s own median and three robust deviations below it.</EmptyNote>
                  ) : (
                    <div className="os-scroll min-h-0 flex-1 overflow-auto">
                      <table className="os-table">
                        <thead>
                          <tr>
                            <th>Severity</th>
                            <th>Date</th>
                            <th>Bus</th>
                            {depotId ? null : <th>Depot</th>}
                            <th className="text-right">Km</th>
                            <th className="text-right">Issued</th>
                            <th className="text-right">Expected</th>
                            <th className="text-right">Var.</th>
                            <th className="text-right">₹</th>
                            <th>Case</th>
                          </tr>
                        </thead>
                        <tbody>
                          {flagged.slice(0, limit).map((j) => (
                            <tr key={j.id} onClick={() => setSelectedId(j.id)} className={`os-row ${selected?.id === j.id ? 'os-row-selected' : ''}`}>
                              <td>{j.severity ? <SeverityChip severity={j.severity} /> : null}</td>
                              <td className="whitespace-nowrap font-mono text-depot-prose">{shortDate(j.date)}</td>
                              <td className="font-mono">
                                {j.registration}
                                {j.recurrence >= 2 ? <span className="ml-1 text-alert-amber">×{j.recurrence}</span> : null}
                              </td>
                              {depotId ? null : <td className="max-w-[9rem] truncate text-depot-prose">{intel.depotsById.get(j.depotId ?? '')?.name ?? '—'}</td>}
                              <td className="os-num">{formatCount(j.distanceKm)}</td>
                              <td className="os-num">{j.fuelLitres.toFixed(0)}</td>
                              <td className="os-num text-depot-prose">{j.expectedLitres.toFixed(0)}</td>
                              <td className="os-num text-alert-amber">+{Math.round(j.variance * 100)}%</td>
                              <td className="os-num">{formatCount(j.exposureRupees)}</td>
                              <td className="whitespace-nowrap text-[11.5px] text-holo-teal">{fuelCases[j.id] ? CASE_LABEL[fuelCases[j.id]!.status].split(' ')[0] : <span className="text-depot-muted">Open</span>}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {flagged.length > limit ? (
                        <button type="button" onClick={() => setLimit((n) => n + PAGE)} className="os-button os-button-quiet m-3">
                          Show {Math.min(PAGE, flagged.length - limit)} more of {formatCount(flagged.length - limit)}
                        </button>
                      ) : null}
                    </div>
                  )}
                </>
              ) : (
                <div className="os-scroll min-h-0 flex-1 overflow-auto">
                  <table className="os-table">
                    <thead>
                      <tr>
                        <th>Bus</th>
                        {depotId ? null : <th>Depot</th>}
                        <th>Class</th>
                        <th className="text-right">Median km/L</th>
                        <th className="text-right">Class km/L</th>
                        <th className="text-right">Against class</th>
                        <th className="text-right">Flags</th>
                      </tr>
                    </thead>
                    <tbody>
                      {efficiency.map(({ v, ratio }) => (
                        <tr key={v.registration} className="os-row" onClick={() => {
                          const first = v.journeys.find((x) => x.flagged);
                          if (first) {
                            setTab('queue');
                            setSelectedId(first.id);
                          }
                        }}>
                          <td className="font-mono">{v.registration}</td>
                          {depotId ? null : <td className="max-w-[9rem] truncate text-depot-prose">{intel.depotsById.get(v.depotId ?? '')?.name ?? '—'}</td>}
                          <td className="capitalize text-depot-prose">{v.serviceClass}</td>
                          <td className="os-num">{v.medianKmPerLitre?.toFixed(2)}</td>
                          <td className="os-num text-depot-prose">{v.classKmPerLitre.toFixed(1)}</td>
                          <td className={`os-num ${ratio < 0.92 ? 'text-alert-amber' : 'text-depot-ink'}`}>{Math.round((ratio - 1) * 100)}%</td>
                          <td className="os-num">{v.journeys.filter((x) => x.flagged).length}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="depot-caption px-4 py-3">The 40 buses furthest below their class figure over the window: a sustained shortfall points to the bus, not to one journey.</p>
                </div>
              )}
            </Panel>
            <Panel kicker="Investigation" title={selected ? `Journey of ${formatPlainDate(selected.date)}` : 'No journey selected'} strong bodyClassName="os-scroll overflow-y-auto p-0" className="xl:h-[820px]">
              <FuelInvestigation journey={selected} history={history} peers={peers} />
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}
