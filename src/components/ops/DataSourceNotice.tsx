import type { UpstreamSource } from '@/models/canonical';

/**
 * Visible, non-blank error/degradation state for the ops dashboards (AC:
 * "fails gracefully ... when a dashboard's data source is unavailable,
 * without breaking the page guard or navigation"). Rendered inline inside
 * OpsShell, never replaces the page or throws — the guard/nav chrome around
 * it is always intact.
 *
 * Three distinguishable states, because they mean very different things to
 * the person reading the dashboard:
 *
 * • stale cache — real data that was really observed, just older than it
 *   looks. Warning tone: keep working, but check the timestamp.
 * • unavailable — the upstream did not answer and there is nothing real to
 *   show. The table below is EMPTY, and that emptiness is an outage, not a
 *   quiet night. Error tone, said explicitly.
 * • fixture     — bundled demo data, only ever shown when someone explicitly
 *   asked for it. Error tone, and it must say the vehicles are not real.
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
  // cache) — neither is a degradation worth surfacing.
  if (source === 'live') return null;
  if (source === 'cache' && !stale) return null;

  const suffix = error ? ` (${error})` : '';
  const tone = source === 'cache' ? 'warning' : 'error';

  let message: string;
  if (source === 'unavailable') {
    message = `Live data is unavailable — the upstream feed did not respond and no cached data is held. Nothing is shown below: this is an outage, not an empty fleet.${suffix}`;
  } else if (source === 'fixture') {
    message = `Showing bundled demo/fixture data — these vehicles are not real. Live data is unavailable.${suffix}`;
  } else {
    message = `Showing the last known data — the live feed did not respond.${suffix}`;
  }

  return (
    <div
      role="alert"
      data-tone={tone}
      data-source={source}
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

/**
 * What an empty fleet table/roster should say, which depends on *why* it is
 * empty. "No vehicles currently reporting" is a true and reassuring sentence
 * on a quiet night and a dangerously misleading one during an outage, so the
 * unavailable state gets its own wording and points at the notice above.
 */
export function emptyFleetLabel(source: UpstreamSource, quietLabel: string): string {
  return source === 'unavailable'
    ? 'No fleet data to show — the live feed is unavailable (see the notice above).'
    : quietLabel;
}
