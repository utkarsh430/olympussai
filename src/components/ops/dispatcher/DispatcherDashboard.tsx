import type { OpsFleetSnapshot } from '@/lib/ops/fleetData';
import { filterFleet } from '@/lib/ops/fleetView';
import { DataSourceNotice } from '@/components/ops/DataSourceNotice';
import { FleetSearchForm } from '@/components/ops/FleetSearchForm';
import { FleetStatusTable } from '@/components/ops/FleetStatusTable';
import { DispatcherActionForm } from './DispatcherActionForm';

const DEFAULT_ROW_LIMIT = 25;

/**
 * Dispatcher dashboard content (this ticket's AC1/AC2/AC3). Presentational
 * — takes already-fetched data as props so it can be unit-tested directly
 * (src/tests/unit/opsDashboards.test.tsx) without a Next.js server request
 * context, and rendered from the Server Component page
 * (src/app/(ops)/ops/dispatcher/page.tsx) with real fetched data.
 */
export function DispatcherDashboard({ snapshot, query }: { snapshot: OpsFleetSnapshot; query: string }) {
  const filtered = filterFleet(snapshot.buses, query);
  const rows = query ? filtered : filtered.slice(0, DEFAULT_ROW_LIMIT);

  return (
    <div className="space-y-8">
      <DataSourceNotice source={snapshot.source} stale={snapshot.stale} error={snapshot.error} />

      <section>
        <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-[#6f7684]">
          Live fleet status
        </h2>
        <FleetSearchForm query={query} resultCount={rows.length} totalCount={snapshot.buses.length} />
        <FleetStatusTable buses={rows} totalCount={snapshot.buses.length} />
      </section>

      <section>
        <DispatcherActionForm />
      </section>
    </div>
  );
}
