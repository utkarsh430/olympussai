import type { LatLng } from '../types';
import type { DepotBalance, TransferPlan } from '../optimise/types';
import { classifyBalance, type BalanceClass } from './rebalanceModel';

/*
 * What the transfer map draws: a node per positioned operating depot and an
 * arc per transfer whose ends are both positioned.
 */

/** Thinnest arc that still reads as a line on the dark basemap. */
export const MIN_ARC_PX = 1.5;
/** Widest arc before neighbouring arcs start to merge at network zoom. */
export const MAX_ARC_PX = 8;
export interface MapNode {
  readonly depotId: string;
  readonly depotName: string;
  readonly position: LatLng;
  readonly balance: number;
  readonly cls: BalanceClass;
}

export interface MapArc {
  readonly transferId: string;
  readonly fromDepotId: string;
  readonly toDepotId: string;
  readonly from: LatLng;
  readonly to: LatLng;
  readonly buses: number;
  readonly widthPx: number;
}

export interface MapGeometry {
  readonly nodes: readonly MapNode[];
  readonly arcs: readonly MapArc[];
}

/** Arc width on a square-root scale, so area-like perception tracks buses moved. */
export function arcWidthPx(buses: number, maxBuses: number): number {
  if (!Number.isFinite(buses) || !Number.isFinite(maxBuses) || buses <= 0 || maxBuses <= 0) {
    return MIN_ARC_PX;
  }
  const share = Math.sqrt(Math.min(1, buses / maxBuses));
  return MIN_ARC_PX + (MAX_ARC_PX - MIN_ARC_PX) * share;
}

/** Nodes for operating depots with a position; one arc per transfer between positioned ends. */
export function mapGeometry(balances: readonly DepotBalance[], plan: TransferPlan): MapGeometry {
  const nodes: MapNode[] = balances
    .filter((b) => b.kind === 'depot' && b.position !== null)
    .map((b) => ({
      depotId: b.depotId,
      depotName: b.depotName,
      position: b.position as LatLng,
      balance: b.balance,
      cls: classifyBalance(b.balance),
    }));
  const positions = new Map(nodes.map((n) => [n.depotId, n.position]));
  const maxBuses = plan.transfers.reduce((max, t) => Math.max(max, t.buses), 0);
  const arcs: MapArc[] = [];
  for (const t of plan.transfers) {
    const from = positions.get(t.fromDepotId);
    const to = positions.get(t.toDepotId);
    if (!from || !to) continue;
    arcs.push({
      transferId: t.id,
      fromDepotId: t.fromDepotId,
      toDepotId: t.toDepotId,
      from,
      to,
      buses: t.buses,
      widthPx: arcWidthPx(t.buses, maxBuses),
    });
  }
  return { nodes, arcs };
}
