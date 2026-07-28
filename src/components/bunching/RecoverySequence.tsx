'use client';

import { formatSimClock } from '@/lib/bunching/math';
import type { PolicyRun } from '@/lib/bunching/types';
import { HeadwayStrip } from './HeadwayStrip';

/**
 * The recovery, stacked (Section 32).
 *
 * Each row is one iteration of the controlled run drawn on the same fixed
 * scale, so the cluster spreading out over successive cycles is visible as a
 * shape rather than as a table of numbers. Rows beyond the current iteration are
 * dimmed rather than hidden, which keeps the layout stable during playback.
 */
export function RecoverySequence({
  run,
  currentIndex,
}: {
  run: PolicyRun;
  currentIndex: number;
}) {
  return (
    <section
      className="rounded-lg border border-sim-line bg-sim-well p-3"
      aria-label="Headway recovery sequence"
      data-testid="recovery-sequence"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-sim-ink">
          Headway recovery — coordinated control
        </h2>
        <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-sim-faint">
          Fixed scale · dashed ticks mark perfect 10-minute spacing
        </span>
      </div>

      <div className="space-y-0.5">
        {run.iterations.map((iteration) => (
          <div
            key={iteration.index}
            className="flex items-center gap-2 rounded px-1 py-0.5 transition-colors"
          >
            <span className="w-10 shrink-0 font-mono text-[9px] tabular-nums text-sim-faint">
              {formatSimClock(iteration.simMinutes)}
            </span>
            <div className="min-w-0 flex-1">
              <HeadwayStrip
                headways={iteration.headways}
                dim={iteration.index > currentIndex}
              />
            </div>
            <span className="w-28 shrink-0 text-right font-mono text-[9px] tabular-nums text-sim-muted">
              {iteration.headways.map((value) => value.toFixed(1)).join(' / ')}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
