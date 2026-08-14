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

  // The two states are genuinely different and must not share a sentence.
  // With a cached copy the figures below are REAL but old; without one there
  // is nothing at all, and saying "showing the last known data" then would be
  // describing data that does not exist.
  const message = stale
    ? `These are the last figures taken, not current ones — the control service did not answer just now.${error ? ` (${error})` : ''}`
    : `The control service cannot be reached and nothing has been read from it yet, so there is nothing to show — not nothing to report.${error ? ` (${error})` : ''}`;

  return (
    <div
      role="alert"
      data-tone={stale ? 'warning' : 'error'}
      className={`mb-6 rounded-md border px-4 py-3 text-sm ${
        stale
          ? 'border-warning/40 bg-warning/10 text-warning'
          : 'border-destructive/40 bg-destructive/10 text-destructive'
      }`}
    >
      {message}
    </div>
  );
}
