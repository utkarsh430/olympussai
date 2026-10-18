'use client';

import { useEffect, useRef, useState } from 'react';
import { Layers } from 'lucide-react';
import { useBaseMap } from '@/components/depot/shell/useBaseMap';
import { DEPOT_PALETTE } from '@/lib/depot/palette';
import type { LatLng } from '@/lib/depot/types';
import { Schematic } from './Schematic';

export interface MapDepot {
  readonly id: string;
  readonly name: string;
  readonly position: LatLng | null;
  readonly fleet: number;
  /** Peak balance: negative short, positive surplus; null when unknown. */
  readonly balance: number | null;
  readonly decisions: number;
}

export interface MapTransfer {
  readonly id: string;
  readonly from: LatLng;
  readonly to: LatLng;
  readonly buses: number;
}

export interface MapIncident {
  readonly id: string;
  readonly position: LatLng;
  readonly label: string;
}

export interface MapVehicle {
  readonly id: string;
  readonly position: LatLng;
  readonly state: 'moving' | 'standing' | 'off_road' | 'dark';
}

export type MapLayer = 'pressure' | 'transfers' | 'incidents' | 'vehicles';

const LAYER_LABEL: Readonly<Record<MapLayer, string>> = {
  pressure: 'Depot pressure',
  transfers: 'Proposed transfers',
  incidents: 'Incidents',
  vehicles: 'Vehicles',
};

export function pressureColour(balance: number | null): string {
  if (balance === null) return DEPOT_PALETTE.glow;
  if (balance < 0) return DEPOT_PALETTE.crimson;
  if (balance >= 3) return DEPOT_PALETTE.teal;
  return DEPOT_PALETTE.slate;
}

const VEHICLE_COLOUR: Readonly<Record<MapVehicle['state'], string>> = {
  moving: DEPOT_PALETTE.green,
  standing: DEPOT_PALETTE.amber,
  off_road: DEPOT_PALETTE.crimson,
  dark: DEPOT_PALETTE.slate,
};

function radiusFor(fleet: number, maxFleet: number): number {
  return 4 + 10 * Math.sqrt(fleet / Math.max(1, maxFleet));
}

interface SituationMapProps {
  readonly depots: readonly MapDepot[];
  readonly transfers: readonly MapTransfer[];
  readonly incidents: readonly MapIncident[];
  readonly vehicles?: readonly MapVehicle[];
  readonly selectedId: string | null;
  readonly onSelect: (id: string | null) => void;
  readonly availableLayers: readonly MapLayer[];
  readonly heightClass?: string;
}

/**
 * The geospatial instrument of Mission Control and the digital twin. Depots sit at their
 * fleet's median position (the feed's own coordinates; nothing is placed by hand), sized
 * by fleet and coloured by peak balance. Proposed transfers are dashed teal lines between
 * depots; suspected breakdowns are crimson rings at the bus's last fix. When the basemap
 * cannot load, the same layers are drawn on a schematic projection.
 */
export function SituationMap({
  depots,
  transfers,
  incidents,
  vehicles = [],
  selectedId,
  onSelect,
  availableLayers,
  heightClass = 'h-[440px]',
}: SituationMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const overlays = useRef<{ setMap: (m: google.maps.Map | null) => void }[]>([]);
  const fitted = useRef(false);
  const [layers, setLayers] = useState<ReadonlySet<MapLayer>>(new Set(availableLayers.filter((l) => l !== 'vehicles')));
  const { mapRef, status } = useBaseMap(containerRef, {
    stillAvailable: 'The same layers are drawn on the schematic.',
    onCleanup: () => {
      overlays.current.forEach((o) => o.setMap(null));
      overlays.current = [];
    },
  });
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    const map = mapRef.current;
    if (status !== 'ready' || !map) return;
    overlays.current.forEach((o) => o.setMap(null));
    overlays.current = [];
    const maxFleet = Math.max(1, ...depots.map((d) => d.fleet));

    if (layers.has('vehicles')) {
      for (const v of vehicles) {
        overlays.current.push(
          new google.maps.Marker({
            map,
            position: v.position,
            clickable: false,
            zIndex: 1,
            icon: { path: google.maps.SymbolPath.CIRCLE, scale: 1.6, fillColor: VEHICLE_COLOUR[v.state], fillOpacity: 0.75, strokeWeight: 0 },
          }),
        );
      }
    }
    if (layers.has('transfers')) {
      for (const t of transfers) {
        overlays.current.push(
          new google.maps.Polyline({
            map,
            path: [t.from, t.to],
            geodesic: true,
            strokeOpacity: 0,
            zIndex: 2,
            icons: [
              {
                icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.9, strokeColor: DEPOT_PALETTE.teal, scale: 2 },
                offset: '0',
                repeat: '9px',
              },
              {
                icon: { path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW, scale: 2.4, strokeColor: DEPOT_PALETTE.teal, fillColor: DEPOT_PALETTE.teal, fillOpacity: 1 },
                offset: '60%',
              },
            ],
          }),
        );
      }
    }
    for (const d of depots) {
      if (!d.position) continue;
      const selected = d.id === selectedId;
      const fill = layers.has('pressure') ? pressureColour(d.balance) : DEPOT_PALETTE.glow;
      const marker = new google.maps.Marker({
        map,
        position: d.position,
        title: `${d.name} · ${d.fleet} buses${d.balance !== null ? ` · ${d.balance < 0 ? `${-d.balance} short` : `${d.balance} spare`} at peak` : ''}`,
        zIndex: selected ? 5000 : Math.round(1000 - d.fleet),
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: radiusFor(d.fleet, maxFleet),
          fillColor: fill,
          fillOpacity: 0.55,
          strokeColor: selected ? DEPOT_PALETTE.ink : fill,
          strokeWeight: selected ? 2.5 : 1,
        },
      });
      marker.addListener('click', () => onSelectRef.current(d.id));
      overlays.current.push(marker);
    }
    if (layers.has('incidents')) {
      for (const inc of incidents) {
        overlays.current.push(
          new google.maps.Marker({
            map,
            position: inc.position,
            title: inc.label,
            zIndex: 6000,
            icon: { path: google.maps.SymbolPath.CIRCLE, scale: 7, fillColor: DEPOT_PALETTE.crimson, fillOpacity: 0.25, strokeColor: DEPOT_PALETTE.crimson, strokeWeight: 2 },
          }),
        );
      }
    }
    if (!fitted.current) {
      const bounds = new google.maps.LatLngBounds();
      let any = false;
      for (const d of depots) {
        if (d.position) {
          bounds.extend(d.position);
          any = true;
        }
      }
      if (any) {
        map.fitBounds(bounds, 32);
        fitted.current = true;
      }
    }
  }, [status, mapRef, depots, transfers, incidents, vehicles, layers, selectedId]);

  const toggle = (layer: MapLayer): void => {
    setLayers((held) => {
      const next = new Set(held);
      if (next.has(layer)) next.delete(layer);
      else next.add(layer);
      return next;
    });
  };

  return (
    <div className={`depot-map-frame relative ${heightClass}`} data-testid="os-situation-map">
      {status === 'error' ? (
        <Schematic
          depots={depots}
          transfers={layers.has('transfers') ? transfers : []}
          incidents={layers.has('incidents') ? incidents : []}
          vehicles={layers.has('vehicles') ? vehicles : []}
          pressure={layers.has('pressure')}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      ) : (
        <div ref={containerRef} className="absolute inset-0" />
      )}
      <div className="absolute left-3 top-3 z-10 flex flex-col gap-1 rounded-[4px] border border-depot-line bg-depot-page/85 p-1.5 backdrop-blur-sm">
        <div className="flex items-center gap-1.5 px-1 pb-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-depot-muted">
          <Layers className="h-3 w-3" aria-hidden />
          Layers
        </div>
        {availableLayers.map((layer) => (
          <label key={layer} className="flex cursor-pointer items-center gap-2 px-1 font-sans text-[11.5px] text-depot-ink">
            <input type="checkbox" className="depot-checkbox" checked={layers.has(layer)} onChange={() => toggle(layer)} />
            {LAYER_LABEL[layer]}
          </label>
        ))}
      </div>
      <div className="absolute bottom-3 left-3 z-10 flex flex-wrap items-center gap-3 rounded-[4px] border border-depot-line bg-depot-page/85 px-2.5 py-1.5 font-sans text-[11px] text-depot-prose backdrop-blur-sm">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-alert-crimson/70" aria-hidden />
          Short at peak
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-slate-400/70" aria-hidden />
          Balanced
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-holo-teal/70" aria-hidden />
          Surplus
        </span>
        {layers.has('transfers') ? (
          <span className="flex items-center gap-1.5">
            <span className="h-0 w-4 border-t-2 border-dashed border-holo-teal" aria-hidden />
            Transfer
          </span>
        ) : null}
      </div>
    </div>
  );
}
