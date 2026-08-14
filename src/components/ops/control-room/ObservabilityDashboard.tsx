import type { ObservabilitySnapshot } from '@/lib/controlService/observabilityData';
import { OpsAlert, OpsEmptyState, OpsSection, OpsStack } from '@/components/ops/ui';
import { ControlServiceNotice } from './ControlServiceNotice';
import { CorridorNavPicker } from './CorridorNavPicker';
import { HeadwayMetricsSummary } from './HeadwayMetricsSummary';
import { ActiveIncidentsPanel } from './ActiveIncidentsPanel';
import { LivePositionsTable } from './LivePositionsTable';

/**
 * One corridor in detail: how evenly its buses are spaced, which of them have
 * closed up, and where each one is.
 *
 * The console folds the headline versions of all three into the band and rail
 * beside the map. This page is where the per-corridor detail lives — the four
 * spacing figures with their reading keys, and the running-order table, both of
 * which need more room than a 30rem rail has. Presentational: the Server
 * Component page owns the fetching, matching every other ops dashboard's split.
 *
 * ─── THE DETECTION STATE IS THREADED THROUGH ─────────────────────────────
 *
 * `ActiveIncidentsPanel` is told whether this corridor can detect at all,
 * because an empty list means two completely different things and it must not
 * say "nothing is closing up" about a corridor nobody is checking. See that
 * component for the full reasoning.
 */
export function ObservabilityDashboard({
  snapshot,
  now,
}: {
  snapshot: ObservabilitySnapshot;
  now: number;
}) {
  const selected = snapshot.routeDirections.find(
    (rd) => rd.routeDirectionId === snapshot.selectedRouteDirectionId,
  );

  return (
    <OpsStack>
      <ControlServiceNotice
        source={snapshot.source}
        stale={snapshot.stale}
        error={snapshot.error}
      />

      <CorridorNavPicker
        corridors={snapshot.routeDirections}
        selectedId={snapshot.selectedRouteDirectionId}
      />

      {snapshot.routeDirections.length === 0 ? (
        <OpsEmptyState>The control service is not reporting any corridors yet.</OpsEmptyState>
      ) : (
        <>
          <OpsSection
            title="Spacing and passenger wait"
            description="For the chosen corridor only. These are not statewide figures."
          >
            {snapshot.headway ? (
              <HeadwayMetricsSummary aggregate={snapshot.headway.aggregate} />
            ) : selected?.hasActivePolicy === false ? (
              <OpsAlert tone="info">
                No planned gap has been set for this corridor, so there is nothing to measure
                spacing against and no figures can be worked out for it.
              </OpsAlert>
            ) : (
              <OpsEmptyState>No gap reading has been taken for this corridor yet.</OpsEmptyState>
            )}
          </OpsSection>

          <OpsSection title="Buses closing up" description="Found automatically by the gap check.">
            <ActiveIncidentsPanel
              incidents={snapshot.incidents}
              canDetect={selected?.hasActivePolicy}
            />
          </OpsSection>

          <OpsSection
            title="Where the buses are"
            description="In running order, furthest along the route first."
          >
            <LivePositionsTable positions={snapshot.positions} now={now} />
          </OpsSection>
        </>
      )}
    </OpsStack>
  );
}
