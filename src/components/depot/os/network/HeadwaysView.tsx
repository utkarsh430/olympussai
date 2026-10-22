'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { formatCount } from '@/lib/depot/format';
import { BUNCH_KM, routeHeadways } from '@/lib/depot/os/intel/headways';
import { regionById } from '@/lib/depot/os/regions';
import { BUNCHING_PATH } from '@/lib/depot/os/workspaces';
import { useIntel } from '../IntelProvider';
import { OsHeader } from '../OsHeader';
import { useOsStore } from '../osStore';
import { EmptyNote, Metric, MetricStrip, Panel, PanelLoading, StatusTag } from '../ui';

/**
 * Headways and possible bunching across the routes the feed names: moving buses on one
 * route within a kilometre of each other. The exact holds and spacing are computed by the
 * Operations dashboard's bunching module, which this view links to rather than repeats.
 */
export function HeadwaysView() {
  const intel = useIntel();
  const regionId = useOsStore((s) => s.regionId);
  const openEntity = useOsStore((s) => s.openEntity);
  const [selected, setSelected] = useState<string | null>(null);
  const fleet = useMemo(
    () => (intel.fleet ?? []).filter((b) => intel.scope === null || (b.depotId !== null && intel.scope.has(b.depotId))),
    [intel.fleet, intel.scope],
  );
  const routes = useMemo(() => routeHeadways(fleet), [fleet]);
  const atRisk = routes.filter((r) => r.pairs.length > 0);
  const moving = fleet.filter((b) => (b.state === 'in_service' || b.state === 'on_road') && b.routeName).length;
  const named = fleet.filter((b) => b.routeName).length;
  const pick = routes.find((r) => r.routeName === selected) ?? atRisk[0] ?? null;
  const scopeLabel = regionById(regionId) ? `${regionById(regionId)!.name} region` : 'UPSRTC network';

  return (
    <div className="space-y-4" data-testid="os-headways">
      <OsHeader
        title="Headways & bunching"
        description={`${scopeLabel}: moving buses on the same route within ${BUNCH_KM} km of each other, from the GPS feed.`}
        statuses={['live', 'derived']}
        actions={
          <Link href={BUNCHING_PATH} className="os-button">
            Bunching control on Operations
            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        }
      />
      {!intel.fleet ? (
        <PanelLoading rows={5} label="Reading positions" />
      ) : (
        <>
          <MetricStrip columns={5}>
            <Metric label="Routes in the feed" value={formatCount(routes.length)} sub="With two or more buses moving" status="live" />
            <Metric label="Buses moving on a route" value={formatCount(moving)} sub={`${formatCount(named)} carry a route name`} />
            <Metric label="Routes at risk" value={formatCount(atRisk.length)} tone={atRisk.length > 0 ? 'amber' : 'green'} sub={`A pair within ${BUNCH_KM} km`} />
            <Metric label="Close pairs" value={formatCount(atRisk.reduce((s, r) => s + r.pairs.length, 0))} tone="amber" sub="Possible bunching" />
            <Metric label="Route coverage" value={`${fleet.length > 0 ? Math.round((named / fleet.length) * 100) : 0}%`} sub="Buses whose feed row names a route" />
          </MetricStrip>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
            <Panel kicker="Bunching prediction" title="Routes ranked by close pairs" actions={<StatusTag status="derived" />} bodyClassName="p-0">
              {atRisk.length === 0 ? (
                <EmptyNote>No two moving buses on the same route are within {BUNCH_KM} km of each other.</EmptyNote>
              ) : (
                <div className="os-scroll max-h-[520px] overflow-auto">
                  <table className="os-table">
                    <thead>
                      <tr>
                        <th>Route</th>
                        <th className="text-right">Moving</th>
                        <th className="text-right">Close pairs</th>
                        <th className="text-right">Closest</th>
                        <th className="text-right">Share bunched</th>
                        <th>Depot</th>
                      </tr>
                    </thead>
                    <tbody>
                      {atRisk.map((r) => (
                        <tr key={r.routeName} onClick={() => setSelected(r.routeName)} className={`os-row ${pick?.routeName === r.routeName ? 'os-row-selected' : ''}`}>
                          <td className="max-w-[16rem] truncate font-mono">{r.routeName}</td>
                          <td className="os-num">{formatCount(r.moving)}</td>
                          <td className="os-num text-alert-amber">{formatCount(r.pairs.length)}</td>
                          <td className="os-num">{r.closestKm === null ? '—' : `${r.closestKm.toFixed(2)} km`}</td>
                          <td className="os-num">{Math.round(r.bunchedShare * 100)}%</td>
                          <td className="max-w-[10rem] truncate text-depot-prose">{r.depots.map((d) => intel.depotsById.get(d)?.name ?? d).join(', ')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
            <Panel kicker="Selected route" title={pick?.routeName ?? 'None'} bodyClassName="space-y-3 p-4">
              {pick ? (
                <>
                  <ul className="space-y-1.5">
                    {pick.pairs.map((p) => (
                      <li key={`${p.a}-${p.b}`} className="flex items-center justify-between gap-2 rounded-[4px] border border-holo-glow/10 px-2.5 py-1.5 font-mono text-[12px]">
                        <button type="button" onClick={() => openEntity({ kind: 'vehicle', id: p.a, depotId: null })} className="text-holo-glow hover:underline">{p.a}</button>
                        <span className="text-alert-amber">{p.km.toFixed(2)} km</span>
                        <button type="button" onClick={() => openEntity({ kind: 'vehicle', id: p.b, depotId: null })} className="text-holo-glow hover:underline">{p.b}</button>
                      </li>
                    ))}
                  </ul>
                  <div className="os-ai-glow rounded-[4px] border border-holo-glow/25 p-3">
                    <div className="os-kicker mb-1">Suggested adjustment</div>
                    <p className="depot-note">
                      Confirm the pair runs the same direction, then hold the trailing bus at its next stop until the gap to the leader is restored; dispatch the next
                      departure on time rather than early. The Operations bunching module computes the exact hold from the stops.
                    </p>
                  </div>
                  <button type="button" onClick={() => openEntity({ kind: 'route', id: pick.routeName })} className="os-button os-button-quiet">Route profile</button>
                  <p className="depot-caption">The feed carries no heading, so a close pair may be two buses passing each other in opposite directions.</p>
                </>
              ) : (
                <EmptyNote>Select a route.</EmptyNote>
              )}
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}
