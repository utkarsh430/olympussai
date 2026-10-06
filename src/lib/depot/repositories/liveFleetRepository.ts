import { getLiveSnapshot, type LiveSnapshotResult } from '@/lib/upsrtc/liveSnapshot';
import type { FleetRepository, FleetSnapshotView } from './types';

/**
 * The fleet as the shared live snapshot sees it. The map route reads the same
 * snapshot, so a depot count and a map pin always describe one upstream fetch.
 * Rows are passed through, not copied: the snapshot is already immutable data.
 */
export function createLiveFleetRepository(
  load: () => Promise<LiveSnapshotResult> = () => getLiveSnapshot(),
): FleetRepository {
  return {
    async snapshot(): Promise<FleetSnapshotView> {
      const { snapshot, source, stale } = await load();
      return {
        rows: snapshot.depotRows,
        feedNow: snapshot.feedNow,
        fetchedAt: snapshot.fetchedAt,
        source,
        stale,
        recordCount: snapshot.recordCount,
      };
    },
  };
}

export const liveFleetRepository: FleetRepository = createLiveFleetRepository();
