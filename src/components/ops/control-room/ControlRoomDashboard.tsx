import Link from 'next/link';
import type { OpsFleetSnapshot } from '@/lib/ops/fleetData';
import { filterFleet } from '@/lib/ops/fleetView';
import { DataSourceNotice } from '@/components/ops/DataSourceNotice';
import { FleetSearchForm } from '@/components/ops/FleetSearchForm';
import { FleetStatusTable } from '@/components/ops/FleetStatusTable';
import { ControlRoomCommandForm } from './ControlRoomCommandForm';

const DEFAULT_ROW_LIMIT = 25;

/**
 * Control-room dashboard content (AC1/AC2/AC3). Same fleet-wide status view
 * as the dispatcher dashboard (AC2 groups these two together), plus the
 * command action panel. Presentational — see DispatcherDashboard's doc
 * comment for why.
 */
export function ControlRoomDashboard({ snapshot, query }: { snapshot: OpsFleetSnapshot; query: string }) {
  const filtered = filterFleet(snapshot.buses, query);
  const rows = query ? filtered : filtered.slice(0, DEFAULT_ROW_LIMIT);

  return (
    <div className="space-y-8">
      <DataSourceNotice source={snapshot.source} stale={snapshot.stale} error={snapshot.error} />

      <p className="flex flex-wrap gap-3">
        <Link
          href="/ops/control-room/observability"
          className="inline-flex items-center gap-2 rounded-md border border-[rgba(255,255,255,0.14)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-[#8fb4ff] hover:border-[#4f8cff]/60"
        >
          Live observability &rarr; headway / EWT / CV / incidents
        </Link>
        <Link
          href="/ops/control-room/copilot"
          className="inline-flex items-center gap-2 rounded-md border border-[rgba(255,255,255,0.14)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-[#8fb4ff] hover:border-[#4f8cff]/60"
        >
          Copilot &rarr; incident explanations / shift reports / ask a question
        </Link>
      </p>

      <section>
        <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-[#6f7684]">
          Live fleet status
        </h2>
        <FleetSearchForm query={query} resultCount={rows.length} totalCount={snapshot.buses.length} />
        <FleetStatusTable buses={rows} totalCount={snapshot.buses.length} />
      </section>

      <section>
        <ControlRoomCommandForm />
      </section>
    </div>
  );
}
