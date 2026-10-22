'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useDepotEconomics } from '@/hooks/useDepotEconomics';
import { useDepotRevenue } from '@/hooks/useDepotRevenue';
import { depotHref } from '@/lib/depot/depotNav';
import { formatCount, formatPlainDate } from '@/lib/depot/format';
import { leakageFor, LEAKAGE_FLAG } from '@/lib/depot/os/intel/leakage';
import { useIntel } from '../IntelProvider';
import { OsHeader } from '../OsHeader';
import { useOsStore } from '../osStore';
import { EmptyNote, MeterBar, Metric, MetricStrip, Panel, PanelLoading, StatusTag } from '../ui';

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

/**
 * Revenue intelligence at Headquarters: every depot's earnings per kilometre, its fuel
 * cost per kilometre and their difference (a contribution before crew, maintenance and
 * overheads, so not a profit), load factor, and the revenue leakage method shown on one
 * depot against a scenario pilot boarding count.
 */
export function RevenueIntelligence() {
  const intel = useIntel();
  const openEntity = useOsStore((s) => s.openEntity);
  const { data, error } = useDepotEconomics();
  const [leakDepot, setLeakDepot] = useState<string | null>(null);

  const rows = useMemo(() => {
    return (data?.depots ?? [])
      .filter((d) => d.kind === 'depot' && (intel.scope === null || intel.scope.has(d.depotId)))
      .map((d) => {
        const c = new Map(d.score.components.map((x) => [x.key, x.value]));
        const earn = c.get('earningsPerKm') ?? null;
        const cost = c.get('costPerKm') ?? null;
        return {
          id: d.depotId,
          name: d.name,
          fleet: d.fleet,
          earn,
          cost,
          contribution: earn !== null && cost !== null ? earn - cost : null,
          load: c.get('loadFactor') ?? null,
          index: d.score.economicsIndex,
        };
      })
      .filter((r) => r.earn !== null)
      .sort((a, b) => (b.contribution ?? -1e9) - (a.contribution ?? -1e9));
  }, [data, intel.scope]);

  const earnMed = median(rows.flatMap((r) => (r.earn === null ? [] : [r.earn])));
  const costMed = median(rows.flatMap((r) => (r.cost === null ? [] : [r.cost])));
  const loadMed = median(rows.flatMap((r) => (r.load === null ? [] : [r.load])));
  const maxContribution = Math.max(1, ...rows.map((r) => Math.abs(r.contribution ?? 0)));
  const chosen = leakDepot ?? rows[0]?.id ?? null;

  return (
    <div className="space-y-4" data-testid="os-revenue-intelligence">
      <OsHeader
        title="Revenue intelligence"
        description="Earnings, fuel cost and load by depot, with clear definitions, and revenue leakage checked only where an independent count exists."
        statuses={['scenario', 'estimate']}
      />
      {!data ? (
        error ? (
          <div className="os-panel">
            <EmptyNote>{error}</EmptyNote>
          </div>
        ) : (
          <PanelLoading rows={6} label="Loading the economics of every depot" />
        )
      ) : (
        <>
          <MetricStrip columns={5}>
            <Metric label="Depots with revenue" value={formatCount(rows.length)} sub={`Operating day ${formatPlainDate(data.operatingDate)}`} status="scenario" />
            <Metric label="Earnings per km" value={earnMed === null ? '—' : `₹${earnMed.toFixed(2)}`} sub="Median depot" />
            <Metric label="Fuel cost per km" value={costMed === null ? '—' : `₹${costMed.toFixed(2)}`} sub="Median depot" />
            <Metric label="Fuel contribution per km" value={earnMed !== null && costMed !== null ? `₹${(earnMed - costMed).toFixed(2)}` : '—'} sub="Earnings less fuel; not profit" tone="teal" />
            <Metric label="Load factor" value={loadMed === null ? '—' : `${Math.round(loadMed * 100)}%`} sub="Median depot" />
          </MetricStrip>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_440px]">
            <Panel kicker="Route economics by depot" title="Fuel contribution per km, highest first" actions={<StatusTag status="scenario" />} bodyClassName="p-0">
              <div className="os-scroll max-h-[620px] overflow-auto">
                <table className="os-table">
                  <thead>
                    <tr>
                      <th>Depot</th>
                      <th className="text-right">Earnings / km</th>
                      <th className="text-right">Fuel / km</th>
                      <th className="w-48">Contribution / km</th>
                      <th className="text-right">Load</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} className={`os-row ${chosen === r.id ? 'os-row-selected' : ''}`} onClick={() => setLeakDepot(r.id)}>
                        <td className="max-w-[12rem] truncate">{r.name}</td>
                        <td className="os-num">₹{r.earn!.toFixed(2)}</td>
                        <td className="os-num text-depot-prose">{r.cost === null ? '—' : `₹${r.cost.toFixed(2)}`}</td>
                        <td>
                          <div className="flex items-center gap-2">
                            <span className={`w-14 text-right font-mono ${r.contribution !== null && r.contribution < 0 ? 'text-alert-crimson' : 'text-holo-teal'}`}>
                              {r.contribution === null ? '—' : `₹${r.contribution.toFixed(2)}`}
                            </span>
                            <div className="flex-1">
                              <MeterBar value={Math.abs(r.contribution ?? 0)} max={maxContribution} tone={r.contribution !== null && r.contribution < 0 ? 'crimson' : 'teal'} />
                            </div>
                          </div>
                        </td>
                        <td className="os-num">{r.load === null ? '—' : `${Math.round(r.load * 100)}%`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
            <LeakagePanel depotId={chosen} name={rows.find((r) => r.id === chosen)?.name ?? ''} onRoute={(route) => openEntity({ kind: 'route', id: route, depotId: chosen })} />
          </div>
          <Panel kicker="Definitions" title="What each figure is" bodyClassName="grid gap-3 p-4 md:grid-cols-3">
            <p className="depot-note"><span className="font-semibold text-depot-ink">Earnings per km</span>: ticket revenue over service kilometres on the depot&apos;s routes in the operating day.</p>
            <p className="depot-note"><span className="font-semibold text-depot-ink">Fuel contribution per km</span>: earnings less diesel per kilometre. Crew, maintenance, depreciation and overheads are not included, so it is not a profit.</p>
            <p className="depot-note"><span className="font-semibold text-depot-ink">Load factor</span>: occupied seats over seats offered, as a ratio of sums across the depot&apos;s routes.</p>
          </Panel>
        </>
      )}
    </div>
  );
}

function LeakagePanel({ depotId, name, onRoute }: { readonly depotId: string | null; readonly name: string; readonly onRoute: (route: string) => void }) {
  const { data } = useDepotRevenue(depotId);
  const rows = useMemo(() => (data ? leakageFor(data.routes, data.operatingDate) : []), [data]);
  const counted = rows.filter((r) => r.counted !== null);
  const flagged = counted.filter((r) => r.flagged);
  const atRisk = flagged.reduce((s, r) => s + (r.revenueAtRisk ?? 0), 0);
  return (
    <Panel kicker="Revenue leakage intelligence" title={name || 'Select a depot'} actions={<StatusTag status="scenario" />} bodyClassName="space-y-3 p-4" strong>
      {!depotId ? (
        <EmptyNote>Select a depot.</EmptyNote>
      ) : !data ? (
        <PanelLoading rows={4} label="Loading the depot's routes" />
      ) : (
        <>
          <p className="depot-note">
            Ticketed boardings compared with a pilot boarding count on {formatCount(counted.length)} of {formatCount(rows.length)} routes. A route without a counter is not
            judged; a gap above {Math.round(LEAKAGE_FLAG * 100)}% is an estimated anomaly to verify, not a finding.
          </p>
          <div className="grid grid-cols-3 gap-2 font-sans text-[12px] text-depot-prose">
            <div><div className="os-kicker">Counted routes</div><div className="font-mono text-[15px] text-depot-ink">{formatCount(counted.length)}</div></div>
            <div><div className="os-kicker">Flagged</div><div className="font-mono text-[15px] text-alert-amber">{formatCount(flagged.length)}</div></div>
            <div><div className="os-kicker">Revenue to verify</div><div className="font-mono text-[15px] text-depot-ink">₹{formatCount(atRisk)}</div></div>
          </div>
          {counted.length === 0 ? (
            <EmptyNote>No route of this depot carries a counter in the pilot.</EmptyNote>
          ) : (
            <div className="os-scroll max-h-[360px] overflow-auto">
              <table className="os-table">
                <thead>
                  <tr>
                    <th>Route</th>
                    <th className="text-right">Ticketed</th>
                    <th className="text-right">Counted</th>
                    <th className="text-right">Gap</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {counted.map((r) => (
                    <tr key={r.routeName} className="os-row" onClick={() => onRoute(r.routeName)}>
                      <td className="max-w-[9rem] truncate font-mono">{r.routeName}</td>
                      <td className="os-num">{formatCount(r.ticketed)}</td>
                      <td className="os-num">{formatCount(r.counted!)}</td>
                      <td className={`os-num ${r.flagged ? 'text-alert-amber' : 'text-depot-prose'}`}>{((r.gap ?? 0) * 100).toFixed(1)}%</td>
                      <td className="whitespace-nowrap text-[11.5px]">{r.flagged ? <span className="text-alert-amber">Estimated · verify</span> : <span className="text-depot-muted">Within tolerance</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Link href={`${depotHref(depotId)}/revenue`} className="depot-link font-sans text-[12px]">Depot revenue by route</Link>
        </>
      )}
    </Panel>
  );
}
