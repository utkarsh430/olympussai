'use client';

import { useMemo } from 'react';
import { useDepotDetailContext } from '@/components/depot/data/DepotDetailProvider';
import { useDepotCrew } from '@/hooks/useDepotCrew';
import { useDepotDuties } from '@/hooks/useDepotDuties';
import { formatCount, formatFeedTime } from '@/lib/depot/format';
import { buildReadiness, clockOf, feedMinuteOf } from '@/lib/depot/os/intel/readiness';
import { modelDepotMaster } from '@/lib/depot/sim/depotMaster';
import { useIntel } from '../IntelProvider';
import { OsHeader } from '../OsHeader';
import { useOsStore } from '../osStore';
import { ReadinessChip } from '../readiness/ReadinessChip';
import { EmptyNote, Metric, MetricStrip, Panel, PanelLoading, StatusTag } from '../ui';

const MAX_SLOTS = 160;

function Zone({ title, sub, children, className = '' }: { readonly title: string; readonly sub: string; readonly children: React.ReactNode; readonly className?: string }) {
  return (
    <section className={`rounded-md border border-dashed border-holo-glow/25 bg-depot-page/40 p-3 ${className}`}>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="os-kicker text-holo-glow">{title}</h3>
        <span className="font-mono text-[10.5px] text-depot-muted">{sub}</span>
      </div>
      {children}
    </section>
  );
}

/**
 * One depot's digital twin, drawn as a schematic of its zones — yard, workshop, fuel, the
 * gate's departure queue and the buses out on the road — filled from the feed's states and
 * locations and the day's duty plan. Zone capacities are the depot master record; the
 * layout is a diagram, not surveyed geometry.
 */
export function DepotTwin() {
  const { depotId, data: detail } = useDepotDetailContext();
  const duties = useDepotDuties(depotId);
  const crew = useDepotCrew(depotId);
  const intel = useIntel();
  const openEntity = useOsStore((s) => s.openEntity);
  const depot = detail?.depot ?? null;
  const master = depot ? modelDepotMaster(depot) : null;
  const buses = useMemo(() => detail?.buses ?? [], [detail]);
  const inYard = buses.filter((b) => b.location === 'in_yard' && b.state !== 'off_road');
  const offRoad = buses.filter((b) => b.state === 'off_road');
  const onRoad = buses.filter((b) => b.state === 'in_service' || b.state === 'on_road');
  const away = buses.filter((b) => b.location !== 'in_yard' && b.state !== 'in_service' && b.state !== 'on_road' && b.state !== 'off_road');
  const nowMin = feedMinuteOf(detail?.feedNow ?? null);
  const board = useMemo(
    () => (duties.data ? buildReadiness(duties.data, crew.data ?? null, buses, intel.healthByReg, nowMin) : null),
    [duties.data, crew.data, buses, intel.healthByReg, nowMin],
  );
  const queue = (board?.departures ?? []).filter((d) => d.readiness !== 'departed' && d.readiness !== 'completed' && (d.startsInMin === null || d.startsInMin >= -15)).slice(0, 8);
  const slots = master ? Math.min(MAX_SLOTS, master.parkingCapacity) : 0;
  const visitors = detail?.visitors ?? [];

  return (
    <div className="space-y-4" data-testid="os-depot-twin">
      <OsHeader
        title="Depot digital twin"
        description={`${depot?.name ?? `Depot ${depotId}`}: yard, workshop, fuel, the gate queue and the road, filled from the feed at ${formatFeedTime(detail?.feedNow ?? null)}.`}
        statuses={['live', 'derived', 'scenario']}
      />
      {!depot || !master ? (
        <PanelLoading rows={6} label="Loading the depot" />
      ) : (
        <>
          <MetricStrip columns={6}>
            <Metric label="Yard occupancy" value={`${formatCount(inYard.length + visitors.length)}/${formatCount(master.parkingCapacity)}`} sub={`${formatCount(visitors.length)} visiting`} tone={inYard.length + visitors.length > master.parkingCapacity ? 'crimson' : null} />
            <Metric label="Workshop" value={`${formatCount(offRoad.length)}/${formatCount(master.workshopBays)}`} sub="Off road / bays" tone={offRoad.length > master.workshopBays ? 'amber' : null} />
            <Metric label="Fuel points" value={formatCount(master.fuelPoints)} sub={`${Math.ceil(depot.fleet / Math.max(1, master.fuelPoints))} buses per point`} status="scenario" />
            <Metric label="On the road" value={formatCount(onRoad.length)} tone="green" status="live" />
            <Metric label="Away, not moving" value={formatCount(away.length)} sub="Outside the yard" />
            <Metric label="Next departures" value={formatCount(queue.length)} sub={queue[0] ? `First ${clockOf(queue[0].startMin)}` : '—'} />
          </MetricStrip>

          <Panel kicker="Depot schematic" title="Zones and what is in them now" actions={<StatusTag status="derived" />} strong bodyClassName="grid grid-cols-1 gap-3 p-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <Zone title="Parking yard" sub={`${formatCount(inYard.length)} home + ${formatCount(visitors.length)} visiting · ${formatCount(master.parkingCapacity)} bays`} className="lg:row-span-2">
              <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(18px, 1fr))' }}>
                {Array.from({ length: slots }, (_, i) => {
                  const bus = inYard[i];
                  const visitor = !bus ? visitors[i - inYard.length] : undefined;
                  const cls = bus
                    ? bus.state === 'dark'
                      ? 'bg-slate-500'
                      : 'bg-alert-amber'
                    : visitor
                      ? 'border border-holo-glow bg-transparent'
                      : 'border border-holo-glow/10 bg-holo-glow/[0.04]';
                  const reg = bus?.registrationNumber ?? visitor?.registrationNumber;
                  return reg ? (
                    <button
                      key={i}
                      type="button"
                      title={`${reg}${visitor ? ` · visiting from ${visitor.homeDepotName ?? 'another depot'}` : bus?.state === 'dark' ? ' · no GPS signal' : ' · standing'}`}
                      onClick={() => openEntity({ kind: 'vehicle', id: reg, depotId: visitor ? visitor.homeDepotId : depotId })}
                      className={`h-[18px] rounded-[2px] ${cls}`}
                      aria-label={reg}
                    />
                  ) : (
                    <span key={i} className={`h-[18px] rounded-[2px] ${cls}`} aria-hidden />
                  );
                })}
              </div>
              {master.parkingCapacity > MAX_SLOTS ? <p className="depot-caption mt-2">First {MAX_SLOTS} bays drawn.</p> : null}
              <div className="mt-2 flex flex-wrap gap-3 font-sans text-[11px] text-depot-prose">
                <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-alert-amber" aria-hidden />Standing</span>
                <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-slate-500" aria-hidden />No signal</span>
                <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm border border-holo-glow" aria-hidden />Visiting</span>
                <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-depot-raised" aria-hidden />Free</span>
              </div>
            </Zone>
            <Zone title="Workshop" sub={`${master.workshopBays} bays`}>
              <div className="grid grid-cols-2 gap-1.5">
                {Array.from({ length: master.workshopBays }, (_, i) => {
                  const bus = offRoad[i];
                  return (
                    <div key={i} className={`rounded-[3px] px-2 py-1.5 font-mono text-[11px] ${bus ? 'bg-alert-crimson/20 text-alert-crimson' : 'bg-depot-raised text-depot-faint'}`}>
                      Bay {i + 1}: {bus ? bus.registrationNumber.slice(-6) : 'free'}
                    </div>
                  );
                })}
              </div>
              {offRoad.length > master.workshopBays ? <p className="mt-2 font-sans text-[12px] text-alert-amber">{formatCount(offRoad.length - master.workshopBays)} more off road beyond the bays.</p> : null}
            </Zone>
            <Zone title="Gate · departure queue" sub="From the duty plan">
              {queue.length === 0 ? (
                <EmptyNote icon={false}>No departure queued.</EmptyNote>
              ) : (
                <ul className="space-y-1">
                  {queue.map((d) => (
                    <li key={d.dutyId} className="flex items-center justify-between gap-2 font-mono text-[11.5px]">
                      <span className="text-depot-prose">{clockOf(d.startMin)}</span>
                      <span className="truncate text-depot-ink">{d.registration ?? 'no bus'}</span>
                      <ReadinessChip readiness={d.readiness} />
                    </li>
                  ))}
                </ul>
              )}
            </Zone>
          </Panel>

          <Panel kicker="On the road" title={`${formatCount(onRoad.length)} buses working`} bodyClassName="p-4">
            {onRoad.length === 0 ? (
              <EmptyNote>No bus of this depot is moving on the latest snapshot.</EmptyNote>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {onRoad.map((b) => (
                  <button key={b.registrationNumber} type="button" onClick={() => openEntity({ kind: 'vehicle', id: b.registrationNumber, depotId })} className="rounded-[3px] border border-alert-green/30 px-1.5 py-0.5 font-mono text-[11px] text-alert-green hover:border-alert-green/70" title={b.routeName ?? 'No route in feed'}>
                    {b.registrationNumber}
                  </button>
                ))}
              </div>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}
