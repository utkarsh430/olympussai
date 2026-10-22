'use client';

import { useMemo } from 'react';
import { DEPOT_PALETTE } from '@/lib/depot/palette';
import type { LatLng } from '@/lib/depot/types';
import type { MapDepot, MapIncident, MapTransfer, MapVehicle } from './SituationMap';
import { pressureColour } from './SituationMap';

const W = 1000;
const H = 560;
const PAD = 36;
const LABELLED = 14;

interface Projection {
  readonly x: (p: LatLng) => number;
  readonly y: (p: LatLng) => number;
}

/** Fits the positions into the frame, longitude scaled by the cosine of the mean latitude. */
function projectionFor(points: readonly LatLng[]): Projection | null {
  if (points.length === 0) return null;
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const k = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
  const spanX = Math.max(1e-6, (maxLng - minLng) * k);
  const spanY = Math.max(1e-6, maxLat - minLat);
  const scale = Math.min((W - 2 * PAD) / spanX, (H - 2 * PAD) / spanY);
  const offX = (W - spanX * scale) / 2;
  const offY = (H - spanY * scale) / 2;
  return {
    x: (p) => offX + (p.lng - minLng) * k * scale,
    y: (p) => H - (offY + (p.lat - minLat) * scale),
  };
}

const VEHICLE_COLOUR: Readonly<Record<MapVehicle['state'], string>> = {
  moving: DEPOT_PALETTE.green,
  standing: DEPOT_PALETTE.amber,
  off_road: DEPOT_PALETTE.crimson,
  dark: DEPOT_PALETTE.slate,
};

/**
 * The network drawn schematically from the feed's own coordinates: no basemap, no
 * invented geometry, just the depots, flows and incidents in their true relative places.
 */
export function Schematic({
  depots,
  transfers,
  incidents,
  vehicles,
  pressure,
  selectedId,
  onSelect,
}: {
  readonly depots: readonly MapDepot[];
  readonly transfers: readonly MapTransfer[];
  readonly incidents: readonly MapIncident[];
  readonly vehicles: readonly MapVehicle[];
  readonly pressure: boolean;
  readonly selectedId: string | null;
  readonly onSelect: (id: string | null) => void;
}) {
  const projection = useMemo(
    () => projectionFor([...depots.flatMap((d) => (d.position ? [d.position] : [])), ...vehicles.map((v) => v.position)]),
    [depots, vehicles],
  );
  const maxFleet = Math.max(1, ...depots.map((d) => d.fleet));
  const labelled = new Set(
    [...depots].sort((a, b) => b.fleet - a.fleet).slice(0, LABELLED).map((d) => d.id),
  );
  if (!projection) {
    return <div className="flex h-full items-center justify-center font-sans text-[13px] text-depot-prose">No positioned depot to draw.</div>;
  }
  const { x, y } = projection;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" role="img" aria-label="Network schematic" onClick={() => onSelect(null)}>
      <defs>
        <marker id="os-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill={DEPOT_PALETTE.teal} />
        </marker>
        <pattern id="os-grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M 40 0 L 0 0 0 40" fill="none" stroke={DEPOT_PALETTE.line} strokeWidth="0.5" />
        </pattern>
      </defs>
      <rect width={W} height={H} fill="url(#os-grid)" opacity={0.6} />
      {vehicles.map((v) => (
        <circle key={v.id} cx={x(v.position)} cy={y(v.position)} r={1.4} fill={VEHICLE_COLOUR[v.state]} opacity={0.7} />
      ))}
      {transfers.map((t) => (
        <line
          key={t.id}
          x1={x(t.from)}
          y1={y(t.from)}
          x2={x(t.to)}
          y2={y(t.to)}
          stroke={DEPOT_PALETTE.teal}
          strokeWidth={1 + Math.min(3, t.buses / 3)}
          strokeDasharray="5 4"
          markerEnd="url(#os-arrow)"
          opacity={0.85}
        />
      ))}
      {depots.map((d) => {
        if (!d.position) return null;
        const r = 4 + 12 * Math.sqrt(d.fleet / maxFleet);
        const fill = pressure ? pressureColour(d.balance) : DEPOT_PALETTE.glow;
        const selected = d.id === selectedId;
        return (
          <g
            key={d.id}
            className="cursor-pointer"
            onClick={(event) => {
              event.stopPropagation();
              onSelect(d.id);
            }}
          >
            <title>{`${d.name} · ${d.fleet} buses`}</title>
            <circle cx={x(d.position)} cy={y(d.position)} r={r} fill={fill} fillOpacity={0.35} stroke={selected ? DEPOT_PALETTE.ink : fill} strokeWidth={selected ? 2.5 : 1} />
            {labelled.has(d.id) || selected ? (
              <text x={x(d.position) + r + 3} y={y(d.position) + 3} fill={DEPOT_PALETTE.label} fontSize={11} fontFamily="var(--font-sans)">
                {d.name}
              </text>
            ) : null}
          </g>
        );
      })}
      {incidents.map((i) => (
        <g key={i.id}>
          <title>{i.label}</title>
          <circle cx={x(i.position)} cy={y(i.position)} r={7} fill="none" stroke={DEPOT_PALETTE.crimson} strokeWidth={2} />
          <circle cx={x(i.position)} cy={y(i.position)} r={2} fill={DEPOT_PALETTE.crimson} />
        </g>
      ))}
    </svg>
  );
}
