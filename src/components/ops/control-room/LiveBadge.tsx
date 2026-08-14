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
      className={`rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.1em] ${
        live
          ? 'border-success/40 bg-success/10 text-success'
          : 'border-warning/40 bg-warning/10 text-warning'
      }`}
    >
      {/* "Stale" is engineering vocabulary for a reading that has stopped
          arriving. What an operator needs to know is that this position is
          old, which is what it now says. */}
      {live ? 'Live' : 'Old'}
    </span>
  );
}
