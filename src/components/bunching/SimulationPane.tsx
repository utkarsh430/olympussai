'use client';

import { cn } from '@/lib/utils';
import { BUS_COLORS } from '@/lib/bunching/config';
import { formatSimClock } from '@/lib/bunching/math';
import {
  BUS_IDS,
  type Policy,
  type ScenarioDefinition,
  type SimulationIteration,
} from '@/lib/bunching/types';
import { AIDecisionPanel } from './AIDecisionPanel';
import { BunchingMap } from './BunchingMap';
import { HeadwayChain } from './HeadwayChain';
import { HeadwayMetrics } from './HeadwayMetrics';
import { HeadwayStrip } from './HeadwayStrip';
import { ObservationPanel } from './ObservationPanel';
import { PhaseTimeline } from './PhaseTimeline';
import { StatusBadge } from './primitives';

/**
 * One side of the comparison: map, corridor state, decision layer and metrics
 * for a single control policy. Both panes receive the same scenario and the
 * same iteration index — only the policy differs.
 */
export function SimulationPane({
  policy,
  iteration,
  scenario,
  reduced,
  className,
  hidden,
}: {
  policy: Policy;
  iteration: SimulationIteration;
  scenario: ScenarioDefinition;
  reduced: boolean;
  className?: string;
  hidden?: boolean;
}) {
  const controlled = policy === 'withAI';
  const title = controlled ? 'With AI' : 'Without AI';
  const subtitle = controlled
    ? 'Coordinated headway control'
    : 'No control intervention applied';

  // A hidden pane keeps its map instance alive: it is display:none on small
  // screens, never unmounted, so switching tabs never reloads a basemap.
  return (
    <section
      className={cn('flex min-w-0 flex-col gap-2.5', hidden && 'hidden lg:flex', className)}
      aria-label={`${title} simulation`}
      data-testid={controlled ? 'pane-with-ai' : 'pane-without-ai'}
    >
      <header
        className={cn(
          'flex flex-wrap items-center justify-between gap-2 rounded border px-3 py-2',
          controlled
            ? 'border-holo-teal/35 bg-holo-teal/[0.06]'
            : 'border-alert-crimson/30 bg-alert-crimson/[0.05]',
        )}
      >
        <div className="min-w-0">
          <h2
            className={cn(
              'font-mono text-[13px] font-semibold uppercase tracking-[0.18em]',
              controlled ? 'text-holo-teal' : 'text-alert-crimson',
            )}
          >
            {title}
          </h2>
          <p className="truncate font-mono text-[9px] uppercase tracking-[0.12em] text-holo-glow/45">
            {subtitle}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="font-mono text-[10px] tabular-nums text-holo-glow/50">
            {formatSimClock(iteration.simMinutes)}
          </span>
          <StatusBadge status={iteration.status} />
        </div>
      </header>

      <PhaseTimeline policy={policy} currentIndex={iteration.index} />

      <BunchingMap iteration={iteration} reduced={reduced} paneLabel={title} />

      <HeadwayChain
        headways={iteration.headways}
        trends={iteration.observation?.trends}
      />

      <HeadwayStrip headways={iteration.headways} caption="Spacing" />

      {iteration.occupancy && (
        <div className="flex items-center gap-2 rounded border border-holo-glow/15 bg-void-900/50 px-2.5 py-1.5">
          <span className="hud-label shrink-0">Occupancy</span>
          <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
            {BUS_IDS.map((bus) => {
              const value = iteration.occupancy?.[bus] ?? 0;
              return (
                <div key={bus} className="flex min-w-0 items-center gap-1">
                  <span
                    className="font-mono text-[9px] font-bold"
                    style={{ color: BUS_COLORS[bus] }}
                  >
                    {bus}
                  </span>
                  <span className="relative h-1.5 w-8 overflow-hidden rounded-full bg-holo-glow/10 sm:w-12">
                    <span
                      className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-500"
                      style={{ width: `${value}%`, backgroundColor: BUS_COLORS[bus], opacity: 0.75 }}
                    />
                  </span>
                  <span className="font-mono text-[9px] tabular-nums text-holo-glow/60">
                    {value}%
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {controlled ? (
        <AIDecisionPanel iteration={iteration} scenario={scenario} />
      ) : (
        <ObservationPanel iteration={iteration} scenario={scenario} />
      )}

      <HeadwayMetrics iteration={iteration} />
    </section>
  );
}
