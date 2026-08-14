import type { CanonicalLiveBus } from '@/models/canonical';

const QUALITY_LABEL: Record<CanonicalLiveBus['dataQuality'], string> = {
  good: 'Live',
  degraded: 'Degraded',
  stale: 'Stale',
};

const QUALITY_CLASS: Record<CanonicalLiveBus['dataQuality'], string> = {
  good: 'border-alert-green/40 bg-alert-green/10 text-ops-good',
  degraded: 'border-alert-amber/40 bg-alert-amber/10 text-ops-warn',
  stale: 'border-alert-crimson/40 bg-alert-crimson/10 text-ops-danger',
};

/**
 * Live fleet/vehicle status view for the dispatcher and control-room
 * dashboards (this ticket's AC2). Presentational-only, no hooks — safe to
 * render from a Server Component so the (potentially large) fleet table is
 * rendered on the server rather than shipped as client JS + client fetch.
 */
export function FleetStatusTable({
  buses,
  totalCount,
  emptyLabel = 'No vehicles match.',
}: {
  buses: CanonicalLiveBus[];
  totalCount: number;
  emptyLabel?: string;
}) {
  if (buses.length === 0) {
    return <p className="text-sm text-ops-muted">{emptyLabel}</p>;
  }

  return (
    <div className="overflow-x-auto rounded-md border border-ops-line">
      <table className="w-full min-w-[640px] text-left text-sm">
        <caption className="sr-only">Live fleet status, {buses.length} of {totalCount} vehicles shown</caption>
        <thead>
          <tr className="border-b border-ops-line text-[11px] uppercase tracking-[0.12em] text-ops-muted">
            <th scope="col" className="px-3 py-2 font-mono">Registration</th>
            <th scope="col" className="px-3 py-2 font-mono">Route</th>
            <th scope="col" className="px-3 py-2 font-mono">Depot</th>
            <th scope="col" className="px-3 py-2 font-mono">Speed</th>
            <th scope="col" className="px-3 py-2 font-mono">Status</th>
            <th scope="col" className="px-3 py-2 font-mono">Updated</th>
          </tr>
        </thead>
        <tbody>
          {buses.map((bus) => (
            <tr key={bus.id} className="border-b border-ops-line/50 text-ops-ink last:border-0">
              <td className="px-3 py-2 font-mono">{bus.registrationNumber}</td>
              <td className="px-3 py-2 text-ops-muted">{bus.routeName ?? bus.routeId ?? '—'}</td>
              <td className="px-3 py-2 text-ops-muted">{bus.depotName ?? '—'}</td>
              <td className="px-3 py-2 text-ops-muted">{bus.speedKmph === null ? '—' : `${bus.speedKmph} km/h`}</td>
              <td className="px-3 py-2">
                <span
                  className={`rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] ${QUALITY_CLASS[bus.dataQuality]}`}
                >
                  {QUALITY_LABEL[bus.dataQuality]}
                </span>
              </td>
              <td className="px-3 py-2 text-ops-muted">
                {bus.gpsTimestamp ? new Date(bus.gpsTimestamp).toLocaleTimeString() : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
