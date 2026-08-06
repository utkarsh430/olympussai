import type { UpstreamSource } from '@/models/canonical';

/**
 * Visible, non-blank error/degradation state for the ops dashboards (AC:
 * "fails gracefully ... when a dashboard's data source is unavailable,
 * without breaking the page guard or navigation"). Rendered inline inside
 * OpsShell, never replaces the page or throws — the guard/nav chrome around
 * it is always intact.
 */
export function DataSourceNotice({
  source,
  stale,
  error,
}: {
  source: UpstreamSource;
  stale: boolean;
  error: string | null;
}) {
  // 'live' is always fresh; a fresh (non-stale) 'cache' hit is the normal,
  // healthy fast path (getOpsFleetSnapshot/getOpsVehicleSchedule's own TTL
  // cache) — neither is a degradation worth surfacing. Only a stale cache
  // fallback or a fixture fallback means the real data source was
  // unavailable.
  if (source === 'live') return null;
  if (source === 'cache' && !stale) return null;

  const tone = source === 'fixture' ? 'error' : 'warning';
  const message =
    source === 'fixture'
      ? `Live data is unavailable — showing demo/fixture data.${error ? ` (${error})` : ''}`
      : `Showing the last known data — the live feed did not respond.${error ? ` (${error})` : ''}`;

  return (
    <div
      role="alert"
      data-tone={tone}
      className={`mb-6 rounded-md border px-4 py-3 text-sm ${
        tone === 'error'
          ? 'border-[#f0857d]/40 bg-[#f0857d]/10 text-[#f5a89f]'
          : 'border-[#e8b34a]/40 bg-[#e8b34a]/10 text-[#e8c07a]'
      }`}
    >
      {message}
    </div>
  );
}
