import { isLiveObservation } from '@/lib/controlService/freshness';

/**
 * Per-row freshness indicator for the observability dashboard's live
 * position table (AC: "Dashboard shows live positions (LIVE badge)").
 * Same visual language as FleetStatusTable's data-quality badge
 * (rounded-full border chip, font-mono uppercase) so this reads as part of
 * the same product rather than a one-off.
 */
export function LiveBadge({ observedAt, now }: { observedAt: string; now: number }) {
  const live = isLiveObservation(observedAt, now);
  return (
    <span
      className={`rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] ${
        live
          ? 'border-alert-green/40 bg-alert-green/10 text-ops-good'
          : 'border-alert-amber/40 bg-alert-amber/10 text-ops-warn'
      }`}
    >
      {live ? 'Live' : 'Stale'}
    </span>
  );
}
