import type { ObservabilitySnapshot } from '@/lib/controlService/observabilityData';
import { ControlServiceNotice } from './ControlServiceNotice';
import { RouteDirectionPicker } from './RouteDirectionPicker';
import { HeadwayMetricsSummary } from './HeadwayMetricsSummary';
import { ActiveIncidentsPanel } from './ActiveIncidentsPanel';
import { LivePositionsTable } from './LivePositionsTable';

/**
 * Live observability dashboard: headway/EWT/CV metrics and reactive
 * bunching incidents for one route-direction at a time, plus that
 * direction's live vehicle positions (AC: "Dashboard shows live positions
 * (LIVE badge) and active incidents distinctly"). Presentational — the
 * Server Component page (page.tsx) owns data fetching via
 * getObservabilitySnapshot, matching every other ops dashboard's split.
 */
export function ObservabilityDashboard({ snapshot, now }: { snapshot: ObservabilitySnapshot; now: number }) {
  return (
    <div className="space-y-8">
      <ControlServiceNotice source={snapshot.source} stale={snapshot.stale} error={snapshot.error} />

      <RouteDirectionPicker routeDirections={snapshot.routeDirections} selectedId={snapshot.selectedRouteDirectionId} />

      {snapshot.routeDirections.length === 0 ? (
        <p className="text-sm text-[#9aa0ad]">
          No active route-directions reported by the control service yet.
        </p>
      ) : (
        <>
          <section>
            <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-[#6f7684]">
              Headway / EWT / CV
            </h2>
            {snapshot.headway ? (
              <HeadwayMetricsSummary aggregate={snapshot.headway.aggregate} />
            ) : (
              <p className="text-sm text-[#9aa0ad]">No headway sample computed yet for this route-direction.</p>
            )}
          </section>

          <section>
            <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-[#6f7684]">
              Active incidents
            </h2>
            <ActiveIncidentsPanel incidents={snapshot.incidents} />
          </section>

          <section>
            <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-[#6f7684]">
              Live vehicle positions
            </h2>
            <LivePositionsTable positions={snapshot.positions} now={now} />
          </section>
        </>
      )}
    </div>
  );
}
