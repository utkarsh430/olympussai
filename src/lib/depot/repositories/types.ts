import type { UpstreamSource } from '@/models/canonical';
import type { DepotBusRow } from '@/models/depotLive';
import type { CrewRepository } from '../crew/types';
import type { FuelRepository } from '../fuel/types';
import type { HistoryScope, MetricKey, SeriesAnchor, SeriesPoint } from '../sim/types';

/**
 * The seam between depot logic and where its data comes from.
 *
 * Depot modules never call the live snapshot, a modelled generator or (later)
 * a database directly. They ask a repository. Today the fleet repository reads
 * the in-memory live snapshot and the history repository generates a modelled
 * series; when a real feed or a database arrives it is a new adapter behind
 * the same interface, wired in the composition root (`./index.ts`).
 */

/** One consistent read of the fleet: every row comes from the same payload. */
export interface FleetSnapshotView {
  readonly rows: readonly DepotBusRow[];
  /** Newest `receivedTime` in the payload: the reference for every age. */
  readonly feedNow: string | null;
  /** Server time the snapshot was built. Also the memoisation key for views. */
  readonly fetchedAt: string;
  readonly source: UpstreamSource;
  readonly stale: boolean;
  readonly recordCount: number;
}

export interface FleetRepository {
  snapshot(): Promise<FleetSnapshotView>;
}

export interface HistoryRepository {
  /** A daily series for `metric`, ending on `anchor.date` at `anchor.value`. */
  series(
    metric: MetricKey,
    scope: HistoryScope,
    days: number,
    anchor: SeriesAnchor,
  ): Promise<readonly SeriesPoint[]>;
}

export interface DepotRepositories {
  readonly fleet: FleetRepository;
  readonly history: HistoryRepository;
  readonly crew: CrewRepository;
  readonly fuel: FuelRepository;
}
