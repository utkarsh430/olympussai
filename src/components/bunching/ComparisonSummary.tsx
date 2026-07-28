'use client';

import { cn } from '@/lib/utils';
import { STATUS_META } from '@/lib/bunching/config';
import type { SimulationIteration } from '@/lib/bunching/types';
import { StatusBadge } from './primitives';

interface SummaryRow {
  label: string;
  without: string;
  with: string;
  /** Which side is better on this measure, for the emphasis treatment. */
  better: 'with' | 'without' | 'equal';
  hint?: string;
}

/**
 * The synchronised scoreboard (Section 31). Values move with the iteration, so
 * the gap between the two policies opens up live rather than appearing at the
 * end as a claim.
 */
export function ComparisonSummary({
  withoutAI,
  withAI,
  isFinal,
}: {
  withoutAI: SimulationIteration;
  withAI: SimulationIteration;
  isFinal: boolean;
}) {
  const compare = (left: number, right: number, lowerIsBetter: boolean): SummaryRow['better'] => {
    if (Math.abs(left - right) < 0.005) return 'equal';
    const withIsBetter = lowerIsBetter ? right < left : right > left;
    return withIsBetter ? 'with' : 'without';
  };

  const rows: SummaryRow[] = [
    {
      label: 'Minimum headway',
      without: `${withoutAI.metrics.minHeadway.toFixed(1)} min`,
      with: `${withAI.metrics.minHeadway.toFixed(1)} min`,
      better: compare(withoutAI.metrics.minHeadway, withAI.metrics.minHeadway, false),
    },
    {
      label: 'Mean headway error',
      without: `${withoutAI.metrics.mae.toFixed(2)} min`,
      with: `${withAI.metrics.mae.toFixed(2)} min`,
      better: compare(withoutAI.metrics.mae, withAI.metrics.mae, true),
    },
    {
      label: 'Headway regularity',
      without: `${withoutAI.metrics.regularity.toFixed(1)}%`,
      with: `${withAI.metrics.regularity.toFixed(1)}%`,
      better: compare(withoutAI.metrics.regularity, withAI.metrics.regularity, false),
      hint: 'Demo score based on deviation from the 10-minute target headway.',
    },
    {
      label: 'Passenger wait proxy',
      without: `${withoutAI.metrics.waitProxy.toFixed(2)} min`,
      with: `${withAI.metrics.waitProxy.toFixed(2)} min`,
      better: compare(withoutAI.metrics.waitProxy, withAI.metrics.waitProxy, true),
      hint: 'Illustrative waiting-time proxy derived from service headway irregularity.',
    },
    {
      label: 'Headway variance',
      without: `${withoutAI.metrics.variance.toFixed(2)} min²`,
      with: `${withAI.metrics.variance.toFixed(2)} min²`,
      better: compare(withoutAI.metrics.variance, withAI.metrics.variance, true),
    },
    {
      label: 'Recovery progress',
      without: 'None',
      with: `${(withAI.recoveryProgress ?? 0).toFixed(0)}%`,
      better: (withAI.recoveryProgress ?? 0) > 0 ? 'with' : 'equal',
    },
  ];

  return (
    <section
      className="rounded-lg border border-holo-glow/20 bg-void-900/60 p-3"
      aria-label="Comparison summary"
      data-testid="comparison-summary"
    >
      <div className="mb-2 grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 border-b border-holo-glow/12 pb-2 sm:grid-cols-[1.4fr_1fr_1fr]">
        <span className="hud-label min-w-0 truncate">
          Comparison at iteration {withAI.index}
        </span>
        <span className="text-right font-mono text-[10px] uppercase tracking-[0.14em] text-alert-crimson sm:text-left">
          Without AI
        </span>
        <span className="text-right font-mono text-[10px] uppercase tracking-[0.14em] text-holo-teal sm:text-left">
          With AI
        </span>
      </div>

      <dl className="space-y-0.5">
        <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 py-1 sm:grid-cols-[1.4fr_1fr_1fr]">
          <dt className="min-w-0 truncate font-mono text-[10px] text-holo-glow/55">
            Bunching status
          </dt>
          <dd className="flex justify-end sm:justify-start">
            <StatusBadge status={withoutAI.status} />
          </dd>
          <dd className="flex justify-end sm:justify-start">
            <StatusBadge status={withAI.status} />
          </dd>
        </div>

        {rows.map((row) => (
          <div
            key={row.label}
            className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-x-3 py-1 sm:grid-cols-[1.4fr_1fr_1fr]"
            title={row.hint}
          >
            <dt className="min-w-0 truncate font-mono text-[10px] text-holo-glow/55">
              {row.label}
            </dt>
            <dd
              className={cn(
                'text-right font-mono text-[11px] tabular-nums sm:text-left',
                row.better === 'without'
                  ? 'font-semibold text-alert-green'
                  : row.better === 'with'
                    ? 'text-alert-crimson/80'
                    : 'text-holo-glow/70',
              )}
            >
              {row.without}
            </dd>
            <dd
              className={cn(
                'text-right font-mono text-[11px] tabular-nums sm:text-left',
                row.better === 'with'
                  ? 'font-semibold text-alert-green'
                  : row.better === 'without'
                    ? 'text-alert-crimson/80'
                    : 'text-holo-glow/70',
              )}
            >
              {row.with}
            </dd>
          </div>
        ))}
      </dl>

      {isFinal && (
        <p
          className="mt-2 border-t border-holo-glow/12 pt-2 font-mono text-[10px] leading-relaxed text-holo-glow/70"
          data-testid="comparison-verdict"
        >
          After the same disturbance and the same simulated time, the uncontrolled corridor ends{' '}
          <span className="text-alert-crimson">
            {STATUS_META[withoutAI.status].label.toLowerCase()}
          </span>{' '}
          at {withoutAI.metrics.regularity.toFixed(0)}% regularity, and the controlled corridor ends{' '}
          <span className="text-holo-teal">{STATUS_META[withAI.status].label.toLowerCase()}</span> at{' '}
          {withAI.metrics.regularity.toFixed(0)}%. Coordinated control did not remove the
          disturbance — it stopped the disturbance from propagating through the corridor.
        </p>
      )}
    </section>
  );
}
