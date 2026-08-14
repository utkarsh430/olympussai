/**
 * Visible, non-blank degradation notice for the observability dashboard —
 * same shape/tone convention as DataSourceNotice (src/components/ops/), so
 * "the live feed didn't answer" reads consistently across every ops
 * surface. Rendered inline, never replaces the page.
 */
export function ControlServiceNotice({
  source,
  stale,
  error,
}: {
  source: 'live' | 'unavailable';
  stale: boolean;
  error: string | null;
}) {
  if (source === 'live') return null;

  const message = stale
    ? `Showing the last known control-service data — it did not respond just now.${error ? ` (${error})` : ''}`
    : `Control service is unavailable and no cached data exists yet.${error ? ` (${error})` : ''}`;

  return (
    <div
      role="alert"
      data-tone={stale ? 'warning' : 'error'}
      className={`mb-6 rounded-md border px-4 py-3 text-sm ${
        stale
          ? 'border-alert-amber/40 bg-alert-amber/10 text-ops-warn'
          : 'border-alert-crimson/40 bg-alert-crimson/10 text-ops-danger'
      }`}
    >
      {message}
    </div>
  );
}
