'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useNetworkHourly } from '@/hooks/useNetworkHourly';
import { depotHref } from '@/lib/depot/depotNav';
import { formatCount } from '@/lib/depot/format';
import { SERVICE_BANDS } from '@/lib/depot/service/networkHours';
import type { ServiceBandKey } from '@/lib/depot/service/types';
import { modelDepotMaster } from '@/lib/depot/sim/depotMaster';
import { useIntel } from '../IntelProvider';
import { OsHeader } from '../OsHeader';
import { useOsStore } from '../osStore';
import { Schematic } from '../map/Schematic';
import type { MapDepot, MapTransfer, MapVehicle } from '../map/SituationMap';
import { StateMixBar } from '../StateMixBar';
import { EmptyNote, Fact, LocalTabs, Panel, PanelLoading, StatusTag } from '../ui';

type Mode = 'peak' | 'band';

/**
 * The network's digital twin: every depot at its fleet's true position, sized by fleet and
 * coloured either by its morning-peak balance or by its routes' gap in a chosen service
 * band, with the proposed transfers as flows and, optionally, every positioned bus. It is
 * drawn from the snapshot, so it moves when the feed does.
 */
export function NetworkTwin() {
  const intel = useIntel();
  const openEntity = useOsStore((s) => s.openEntity);
  const [mode, setMode] = useState<Mode>('peak');
  const [band, setBand] = useState<ServiceBandKey>('morning_peak');
  const [showBuses, setShowBuses] = useState(false);
  const [showFlows, setShowFlows] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const hourly = useNetworkHourly({ band, depotId: null, page: 1 });
  const balances = useMemo(() => new Map((intel.distribution?.balances ?? []).map((b) => [b.depotId, b])), [intel.distribution]);
  const bandByDepot = useMemo(() => {
    const summary = hourly.data?.bands.find((b) => b.band === band);
    return new Map((summary?.byDepot ?? []).map((d) => [d.depotId, d.busesOver - d.busesShort]));
  }, [hourly.data, band]);

  const depots = useMemo<MapDepot[]>(
    () =>
      (intel.network?.depots ?? [])
        .filter((d) => d.kind === 'depot' && (intel.scope === null || intel.scope.has(d.id)))
        .map((d) => ({
          id: d.id,
          name: d.name,
          position: balances.get(d.id)?.position ?? d.centroid,
          fleet: d.fleet,
          balance: mode === 'peak' ? (balances.get(d.id)?.balance ?? null) : (bandByDepot.get(d.id) ?? null),
          decisions: 0,
        })),
    [intel.network, intel.scope, balances, bandByDepot, mode],
  );
  const flows = useMemo<MapTransfer[]>(
    () =>
      showFlows
        ? (intel.distribution?.plan.transfers ?? []).flatMap((t) => {
            const from = balances.get(t.fromDepotId)?.position;
            const to = balances.get(t.toDepotId)?.position;
            return from && to ? [{ id: t.id, from, to, buses: t.buses }] : [];
          })
        : [],
    [showFlows, intel.distribution, balances],
  );
  const vehicles = useMemo<MapVehicle[]>(
    () =>
      showBuses
        ? (intel.fleet ?? []).flatMap((b) =>
            b.lat !== null && b.lng !== null && (intel.scope === null || (b.depotId !== null && intel.scope.has(b.depotId)))
              ? [{ id: b.registration, position: { lat: b.lat, lng: b.lng }, state: b.state === 'in_service' || b.state === 'on_road' ? ('moving' as const) : b.state === 'off_road' ? ('off_road' as const) : b.state === 'dark' ? ('dark' as const) : ('standing' as const) }]
              : [],
          )
        : [],
    [showBuses, intel.fleet, intel.scope],
  );
  const depot = selected ? (intel.depotsById.get(selected) ?? null) : null;
  const master = depot ? modelDepotMaster(depot) : null;
  const balance = selected ? balances.get(selected) : undefined;

  return (
    <div className="space-y-4" data-testid="os-network-twin">
      <OsHeader
        title="Digital twin"
        description="The network as a live schematic: depots where their buses are, pressure by depot, flows and every positioned bus."
        statuses={['live', 'derived', 'proposed']}
      />
      {!intel.network ? (
        <PanelLoading rows={6} label="Loading the network" />
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <Panel
            kicker="Network schematic"
            title={mode === 'peak' ? 'Coloured by morning-peak balance' : `Coloured by route gaps · ${SERVICE_BANDS.find((b) => b.key === band)?.label}`}
            strong
            bodyClassName="p-0"
            actions={<StatusTag status={mode === 'peak' ? 'estimate' : 'forecast'} />}
          >
            <div className="flex flex-wrap items-center gap-3 border-b border-holo-glow/10 px-3 py-2">
              <LocalTabs<Mode> label="Colour by" value={mode} onChange={setMode} items={[{ key: 'peak', label: 'Peak balance' }, { key: 'band', label: 'Route gaps by band' }]} />
              {mode === 'band' ? (
                <select value={band} onChange={(e) => setBand(e.target.value as ServiceBandKey)} className="depot-control depot-select font-sans" aria-label="Band">
                  {SERVICE_BANDS.map((b) => (
                    <option key={b.key} value={b.key}>{b.label}</option>
                  ))}
                </select>
              ) : null}
              <label className="ml-auto flex items-center gap-1.5 font-sans text-[12px] text-depot-ink">
                <input type="checkbox" className="depot-checkbox" checked={showFlows} onChange={(e) => setShowFlows(e.target.checked)} />
                Transfer flows
              </label>
              <label className="flex items-center gap-1.5 font-sans text-[12px] text-depot-ink">
                <input type="checkbox" className="depot-checkbox" checked={showBuses} onChange={(e) => setShowBuses(e.target.checked)} />
                Every bus
              </label>
            </div>
            <div className="h-[600px]">
              <Schematic depots={depots} transfers={flows} incidents={[]} vehicles={vehicles} pressure selectedId={selected} onSelect={setSelected} />
            </div>
          </Panel>
          <Panel kicker="Selected depot" title={depot?.name ?? 'Click a depot'} bodyClassName="space-y-3 p-4">
            {!depot || !master ? (
              <EmptyNote>Click a depot on the schematic to see its capacity and state.</EmptyNote>
            ) : (
              <>
                <StateMixBar states={depot.states} fleet={depot.fleet} legend />
                <dl>
                  <Fact label="Fleet" value={formatCount(depot.fleet)} />
                  <Fact label="Parking capacity" value={formatCount(master.parkingCapacity)} />
                  <Fact label="Workshop bays · off road" value={`${master.workshopBays} · ${formatCount(depot.states.offRoad)}`} tone={depot.states.offRoad > master.workshopBays ? 'amber' : undefined} />
                  <Fact label="Fuel points" value={formatCount(master.fuelPoints)} />
                  {balance ? <Fact label="Peak balance" value={`${balance.balance > 0 ? '+' : ''}${formatCount(balance.balance)}`} tone={balance.balance < 0 ? 'crimson' : 'green'} /> : null}
                  {bandByDepot.has(depot.id) ? <Fact label="Route gap in band" value={`${formatCount(bandByDepot.get(depot.id)!)}`} /> : null}
                </dl>
                <div className="flex flex-wrap gap-2">
                  <Link href={`${depotHref(depot.id)}/twin`} className="os-button">Depot twin</Link>
                  <button type="button" onClick={() => openEntity({ kind: 'depot', id: depot.id })} className="os-button os-button-quiet">Profile</button>
                </div>
                <p className="depot-caption">Capacity figures are the depot master record (scenario until the asset register is connected).</p>
              </>
            )}
          </Panel>
        </div>
      )}
    </div>
  );
}
