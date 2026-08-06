import type { CanonicalLiveBus } from '@/models/canonical';

const QUALITY_LABEL: Record<CanonicalLiveBus['dataQuality'], string> = {
  good: 'Live',
  degraded: 'Degraded',
  stale: 'Stale',
};

const QUALITY_CLASS: Record<CanonicalLiveBus['dataQuality'], string> = {
  good: 'border-[#4fbf82]/40 bg-[#4fbf82]/10 text-[#7fd9a4]',
  degraded: 'border-[#e8b34a]/40 bg-[#e8b34a]/10 text-[#e8c07a]',
  stale: 'border-[#f0857d]/40 bg-[#f0857d]/10 text-[#f5a89f]',
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
    return <p className="text-sm text-[#9aa0ad]">{emptyLabel}</p>;
  }

  return (
    <div className="overflow-x-auto rounded-md border border-[rgba(255,255,255,0.08)]">
      <table className="w-full min-w-[640px] text-left text-sm">
        <caption className="sr-only">Live fleet status, {buses.length} of {totalCount} vehicles shown</caption>
        <thead>
          <tr className="border-b border-[rgba(255,255,255,0.08)] text-[11px] uppercase tracking-[0.12em] text-[#6f7684]">
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
            <tr key={bus.id} className="border-b border-[rgba(255,255,255,0.04)] text-[#e6e9ef] last:border-0">
              <td className="px-3 py-2 font-mono">{bus.registrationNumber}</td>
              <td className="px-3 py-2 text-[#9aa0ad]">{bus.routeName ?? bus.routeId ?? '—'}</td>
              <td className="px-3 py-2 text-[#9aa0ad]">{bus.depotName ?? '—'}</td>
              <td className="px-3 py-2 text-[#9aa0ad]">{bus.speedKmph === null ? '—' : `${bus.speedKmph} km/h`}</td>
              <td className="px-3 py-2">
                <span
                  className={`rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] ${QUALITY_CLASS[bus.dataQuality]}`}
                >
                  {QUALITY_LABEL[bus.dataQuality]}
                </span>
              </td>
              <td className="px-3 py-2 text-[#9aa0ad]">
                {bus.gpsTimestamp ? new Date(bus.gpsTimestamp).toLocaleTimeString() : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
