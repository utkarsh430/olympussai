export interface WorkshopLoad {
  /** Modelled bays at the depot. */
  readonly bays: number;
  /** Buses the feed reports under maintenance (live). */
  readonly offRoad: number;
  readonly inBays: number;
  readonly queue: number;
  readonly freeBays: number;
}

/**
 * Off-road buses against the bays: as many as fit are taken to be in a bay, the
 * rest wait. The bay count is modelled and the off-road count is live; neither
 * is changed here.
 */
export function workshopLoad(offRoad: number, bays: number): WorkshopLoad {
  const safeOffRoad = Math.max(0, Math.floor(offRoad));
  const safeBays = Math.max(0, Math.floor(bays));
  const inBays = Math.min(safeOffRoad, safeBays);
  return {
    bays: safeBays,
    offRoad: safeOffRoad,
    inBays,
    queue: safeOffRoad - inBays,
    freeBays: safeBays - inBays,
  };
}
