import type { MapArc } from '@/lib/depot/rebalance/mapGeometry';
import type { BalanceClass } from '@/lib/depot/rebalance/rebalanceModel';
import { removeMapListeners } from '@/lib/maps/listeners';
import { BALANCED_COLOUR, DEFICIT_COLOUR, SURPLUS_COLOUR } from './BalanceBar';
import { ARC_COLOUR } from './TransferMapLegend';
import { DEPOT_PALETTE } from '@/lib/depot/palette';

/*
 * The transfer map's overlays: node symbols by balance class (shape as well
 * as colour), arc options, and an in-place sync keyed by id so a poll never
 * redraws the whole map.
 */

export type Handle = google.maps.MapsEventListener | undefined;
export interface Overlay<T> {
  readonly item: T;
  readonly listeners: Handle[];
}

/** Near-white ink, not cyan: a surplus depot is cyan, so the selected ring must differ. */
export const SELECTED = DEPOT_PALETTE.ink;
const SHAPE: Readonly<Record<BalanceClass, { path: string; scale: number; fill: string }>> = {
  surplus: { path: 'M -1 -1 L 1 -1 L 1 1 L -1 1 Z', scale: 6, fill: SURPLUS_COLOUR },
  deficit: { path: 'M -1.2 -1 L 1.2 -1 L 0 1.2 Z', scale: 7, fill: DEFICIT_COLOUR },
  balanced: { path: 'M -1 0 A 1 1 0 1 0 1 0 A 1 1 0 1 0 -1 0 Z', scale: 4, fill: BALANCED_COLOUR },
};

export function nodeIcon(cls: BalanceClass, selected: boolean): google.maps.Symbol {
  const s = SHAPE[cls];
  return {
    path: s.path,
    scale: s.scale,
    fillColor: s.fill,
    fillOpacity: 1,
    strokeColor: selected ? SELECTED : DEPOT_PALETTE.page,
    strokeWeight: selected ? 2.5 : 1,
  };
}

export function arcOptions(arc: MapArc, selected: boolean): google.maps.PolylineOptions {
  const colour = selected ? SELECTED : ARC_COLOUR;
  return {
    path: [arc.from, arc.to],
    geodesic: true,
    strokeColor: colour,
    strokeOpacity: selected ? 1 : 0.8,
    strokeWeight: arc.widthPx,
    zIndex: selected ? 50 : 10,
    icons: [
      {
        icon: {
          path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
          scale: 3,
          fillOpacity: 1,
          strokeColor: colour,
        },
        offset: '100%',
      },
    ],
  };
}

export function sync<T, O extends google.maps.Marker | google.maps.Polyline>(
  overlays: Map<string, Overlay<O>>,
  items: readonly T[],
  idOf: (item: T) => string,
  create: (item: T) => [O, Handle[]],
  update: (overlay: O, item: T) => void,
): void {
  const wanted = new Set(items.map(idOf));
  for (const [id, o] of [...overlays]) {
    if (wanted.has(id)) continue;
    removeMapListeners(o.listeners);
    o.item.setMap(null);
    overlays.delete(id);
  }
  for (const item of items) {
    const existing = overlays.get(idOf(item));
    if (existing) update(existing.item, item);
    else {
      const [created, listeners] = create(item);
      overlays.set(idOf(item), { item: created, listeners });
    }
  }
}
