'use client';

import { cn } from '@/lib/utils';
import { BUS_COLORS, MIN_SAFE_HEADWAY_MINUTES, TARGET_HEADWAY_MINUTES } from '@/lib/bunching/config';
import { BUS_IDS, type HeadwayTrend, type HeadwayVector } from '@/lib/bunching/types';

/**
 * The corridor as an explicit chain:
 *
 *     A ← 9.7 min → B ← 9.5 min → C ← 9.8 min → D
 *
 * This is the primary read-out of the whole page: four badges in travel order
 * with the live headway between each pair, coloured against the demo target.
 */
export function HeadwayChain({
  headways,
  trends,
  compact,
}: {
  headways: HeadwayVector;
  trends?: readonly [HeadwayTrend, HeadwayTrend, HeadwayTrend];
  compact?: boolean;
}) {
  return (
    <div
      className="flex items-stretch justify-between gap-1 rounded border border-holo-glow/15 bg-void-900/60 px-2 py-2.5"
      role="group"
      aria-label="Current headways along the corridor"
    >
      {BUS_IDS.map((bus, index) => (
        <div key={bus} className="flex min-w-0 flex-1 items-center last:flex-none">
          <div className="flex shrink-0 flex-col items-center gap-1">
            <span
              className="flex h-7 w-7 items-center justify-center rounded-full border font-mono text-[12px] font-bold"
              style={{
                color: BUS_COLORS[bus],
                borderColor: `${BUS_COLORS[bus]}66`,
                backgroundColor: `${BUS_COLORS[bus]}1a`,
              }}
            >
              {bus}
            </span>
            {!compact && (
              <span className="font-mono text-[7px] uppercase tracking-[0.12em] text-holo-glow/35">
                {index === 0 ? 'Lead' : 'UPSRTC'}
              </span>
            )}
          </div>

          {index < 3 && (
            <Gap
              minutes={headways[index] as number}
              label={`${bus}–${BUS_IDS[index + 1]}`}
              trend={trends?.[index]}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function Gap({
  minutes,
  label,
  trend,
}: {
  minutes: number;
  label: string;
  trend?: HeadwayTrend;
}) {
  const deviation = Math.abs(minutes - TARGET_HEADWAY_MINUTES);
  const tone =
    minutes <= MIN_SAFE_HEADWAY_MINUTES
      ? 'text-alert-crimson'
      : deviation <= 1.5
        ? 'text-alert-green'
        : 'text-alert-amber';
  const line =
    minutes <= MIN_SAFE_HEADWAY_MINUTES
      ? 'via-alert-crimson/60'
      : deviation <= 1.5
        ? 'via-alert-green/50'
        : 'via-alert-amber/50';

  const arrow = trend === 'improving' ? '↑' : trend === 'deteriorating' ? '↓' : null;

  return (
    <div className="flex min-w-0 flex-1 flex-col items-center px-1">
      <span
        className={cn('whitespace-nowrap font-mono text-[11px] tabular-nums font-semibold', tone)}
      >
        {minutes.toFixed(1)}
        <span className="ml-0.5 text-[8px] opacity-70">min</span>
        {arrow && (
          <span
            className="ml-0.5 text-[9px]"
            title={trend === 'improving' ? 'Moving towards target' : 'Moving away from target'}
          >
            {arrow}
          </span>
        )}
      </span>
      <span
        aria-hidden
        className={cn(
          'my-0.5 h-px w-full bg-gradient-to-r from-transparent to-transparent',
          line,
        )}
      />
      <span className="font-mono text-[7px] uppercase tracking-[0.1em] text-holo-glow/30">
        {label}
      </span>
    </div>
  );
}
