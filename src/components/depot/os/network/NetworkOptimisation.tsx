'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { useNetworkHourly } from '@/hooks/useNetworkHourly';
import { formatCount } from '@/lib/depot/format';
import { REBALANCE_PATH, SERVICE_PATH } from '@/lib/depot/nav';
import { SERVICE_BANDS } from '@/lib/depot/service/networkHours';
import type { ServiceBandKey } from '@/lib/depot/service/types';
import { useIntel } from '../IntelProvider';
import { OsHeader } from '../OsHeader';
import { useOsStore } from '../osStore';
import { EmptyNote, LocalTabs, Panel, PanelLoading, StatusTag } from '../ui';

interface Row {
  readonly label: string;
  readonly before: number;
  readonly after: number;
  readonly better: 'lower' | 'higher';
  readonly unit?: string;
}

function CompareTable({ rows }: { readonly rows: readonly Row[] }) {
  return (
    <table className="os-table">
      <thead>
        <tr>
          <th>Measure</th>
          <th className="text-right">Before</th>
          <th className="text-right">After</th>
          <th className="text-right">Change</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const d = r.after - r.before;
          const good = d === 0 ? null : r.better === 'lower' ? d < 0 : d > 0;
          return (
            <tr key={r.label} className="border-b border-holo-glow/[0.07]">
              <td>{r.label}</td>
              <td className="os-num text-depot-prose">{formatCount(r.before)}{r.unit ?? ''}</td>
              <td className="os-num font-semibold">{formatCount(r.after)}{r.unit ?? ''}</td>
              <td className={`os-num ${good === null ? 'text-depot-muted' : good ? 'text-alert-green' : 'text-alert-crimson'}`}>{d === 0 ? '—' : `${d > 0 ? '+' : ''}${formatCount(d)}`}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/**
 * Network optimisation, both stages on one page with one set of definitions: the depots'
 * fleet balance at the morning peak (the Between Depots plan) and the routes' hour gaps in
 * a band (the Hourly Demand reallocation), each before and after its moves.
 */
export function NetworkOptimisation() {
  const intel = useIntel();
  const openEntity = useOsStore((s) => s.openEntity);
  const [band, setBand] = useState<ServiceBandKey>('morning_peak');
  const hourly = useNetworkHourly({ band, depotId: null, page: 1 });
  const plan = intel.distribution?.plan ?? null;
  const summary = hourly.data?.bands.find((b) => b.band === band) ?? null;
  const realloc = hourly.data?.reallocation ?? null;
  const bandHours = (() => {
    const b = SERVICE_BANDS.find((x) => x.key === band);
    return b ? b.toHour - b.fromHour + 1 : 1;
  })();
  const moved = realloc ? realloc.busesWithin + realloc.busesBetween : 0;
  const uncovered = realloc ? realloc.uncovered.reduce((s, u) => s + u.buses, 0) : 0;
  const ops = (intel.distribution?.balances ?? []).filter((b) => b.kind === 'depot');
  const peakNeed = ops.reduce((s, b) => s + b.peakRequirement, 0);
  const available = ops.reduce((s, b) => s + b.available, 0);

  return (
    <div className="space-y-4" data-testid="os-network-optimisation">
      <OsHeader
        title="Network optimisation"
        description="Depot fleet balance and route-hour reallocation together, each before and after its proposed moves."
        statuses={['derived', 'forecast', 'proposed']}
        actions={
          <>
            <Link href={REBALANCE_PATH} className="os-button os-button-quiet">Between depots</Link>
            <Link href={SERVICE_PATH} className="os-button os-button-quiet">Hourly demand</Link>
          </>
        }
      />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel kicker="Stage 1 · between depots" title="Fleet balance at the morning peak" actions={<StatusTag status="proposed" />} bodyClassName="p-0">
          {!plan ? (
            <PanelLoading rows={5} label="Loading the distribution plan" />
          ) : (
            <>
              <CompareTable
                rows={[
                  { label: 'Depots short', before: plan.before.depotsInDeficit, after: plan.after.depotsInDeficit, better: 'lower' },
                  { label: 'Buses short', before: plan.before.totalDeficit, after: plan.after.totalDeficit, better: 'lower' },
                  { label: 'Uncovered peak bus-hours', before: plan.before.totalDeficit * 4, after: plan.after.totalDeficit * 4, better: 'lower' },
                  { label: 'Surplus buses standing', before: plan.before.totalSurplus, after: plan.after.totalSurplus, better: 'lower' },
                  { label: 'Empty repositioning bus-km', before: 0, after: Math.round(plan.totalBusKm), better: 'lower' },
                ]}
              />
              <p className="depot-caption px-4 py-3">
                Fleet utilisation at peak {available > 0 ? Math.round((peakNeed / available) * 100) : 0}% ({formatCount(peakNeed)} needed of {formatCount(available)} available). Uncovered bus-hours count the
                four peak hours per bus short.
              </p>
            </>
          )}
        </Panel>
        <Panel
          kicker="Stage 2 · between routes"
          title="Route-hour gaps in a band"
          actions={<StatusTag status="forecast" />}
          bodyClassName="p-0"
        >
          <LocalTabs<ServiceBandKey>
            label="Service band"
            value={band}
            onChange={setBand}
            items={SERVICE_BANDS.map((b) => ({ key: b.key, label: b.label }))}
          />
          {!summary || !realloc ? (
            <PanelLoading rows={5} label="Loading the band" />
          ) : (
            <>
              <CompareTable
                rows={[
                  { label: 'Routes short', before: summary.shortRoutes, after: new Set(realloc.uncovered.map((u) => u.routeName)).size, better: 'lower' },
                  { label: 'Buses short (mean per hour)', before: summary.busesShort, after: uncovered, better: 'lower' },
                  { label: 'Uncovered bus-hours in the band', before: summary.busesShort * bandHours, after: uncovered * bandHours, better: 'lower' },
                  { label: 'Buses moved within a depot', before: 0, after: realloc.busesWithin, better: 'higher' },
                  { label: 'Buses moved between depots', before: 0, after: realloc.busesBetween, better: 'lower' },
                  { label: 'Empty km', before: 0, after: Math.round(realloc.deadKm), better: 'lower' },
                ]}
              />
              <p className="depot-caption px-4 py-3">
                {formatCount(moved)} buses move from over-served routes and standing buses to short routes; demand per hour is projected, so the gaps say when, not
                exactly how many.
              </p>
            </>
          )}
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Panel kicker="Proposed moves" title="Route reallocation in the band" bodyClassName="p-0">
          {!realloc ? (
            <PanelLoading rows={6} label="Loading the moves" />
          ) : realloc.moves.length === 0 ? (
            <EmptyNote>No move is proposed in this band.</EmptyNote>
          ) : (
            <div className="os-scroll max-h-[440px] overflow-auto">
              <table className="os-table">
                <thead>
                  <tr>
                    <th>Route</th>
                    <th>From</th>
                    <th aria-label="to" />
                    <th>To</th>
                    <th className="text-right">Buses</th>
                    <th className="text-right">Empty km / bus</th>
                  </tr>
                </thead>
                <tbody>
                  {realloc.moves.map((m, i) => (
                    <tr key={`${m.routeName}-${m.fromDepotId}-${i}`} className="os-row" onClick={() => openEntity({ kind: 'route', id: m.routeName })}>
                      <td className="max-w-[14rem] truncate font-mono text-holo-glow">{m.routeName}</td>
                      <td className="max-w-[10rem] truncate">{m.fromDepotName}</td>
                      <td><ArrowRight className="h-3 w-3 text-holo-teal" aria-hidden /></td>
                      <td className="max-w-[10rem] truncate text-depot-prose">{m.withinDepot ? 'Same depot' : (m.toDepotName ?? '—')}</td>
                      <td className="os-num">{formatCount(m.buses)}</td>
                      <td className="os-num text-depot-prose">{formatCount(Math.round(m.deadKmPerBus))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
        <Panel kicker="Remaining constraints" title="What the moves cannot close" bodyClassName="space-y-3 p-4">
          {plan && plan.uncovered.length > 0 ? (
            <div>
              <div className="os-kicker mb-1">Depots</div>
              <ul className="space-y-0.5">
                {plan.uncovered.slice(0, 6).map((u) => (
                  <li key={u.depotId} className="font-sans text-[12px] text-depot-prose">
                    {intel.depotsById.get(u.depotId)?.name ?? u.depotId}: {formatCount(u.buses)} short · {u.reason.replace(/_/g, ' ')}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="depot-note">Every depot deficit in range is covered by the transfers.</p>
          )}
          {realloc && realloc.uncovered.length > 0 ? (
            <div>
              <div className="os-kicker mb-1">Routes</div>
              <ul className="space-y-0.5">
                {realloc.uncovered.slice(0, 10).map((u) => (
                  <li key={`${u.routeName}-${u.depotId}`} className="font-sans text-[12px] text-depot-prose">
                    <button type="button" onClick={() => openEntity({ kind: 'route', id: u.routeName })} className="font-mono text-depot-ink hover:text-holo-glow">
                      {u.routeName}
                    </button>
                    : {formatCount(u.buses)} short · {u.reason.replace(/_/g, ' ')}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Panel>
      </div>
    </div>
  );
}
