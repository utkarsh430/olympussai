'use client';

import { Activity, TrendingDown } from 'lucide-react';
import { HEADWAY_LABELS, type ScenarioDefinition, type SimulationIteration } from '@/lib/bunching/types';
import { TARGET_HEADWAY_MINUTES } from '@/lib/bunching/config';
import { forwardProjection } from '@/lib/bunching/simulation';
import { Row, SectionLabel } from './primitives';

/**
 * The uncontrolled side's live commentary.
 *
 * No intervention is applied here, but the corridor is still being measured and
 * projected — which is what makes the comparison legible: the instability is
 * described as it develops rather than merely animated.
 */
export function ObservationPanel({
  iteration,
  scenario,
}: {
  iteration: SimulationIteration;
  scenario: ScenarioDefinition;
}) {
  const observation = iteration.observation;
  if (!observation) return null;

  const worstLabel = HEADWAY_LABELS[observation.worstIndex] ?? '';
  const trend = observation.trends[observation.worstIndex] ?? 'flat';

  return (
    <section
      className="rounded border border-alert-crimson/25 bg-alert-crimson/[0.04] p-3"
      data-testid="observation-panel"
      aria-label="System observation"
    >
      <SectionLabel
        icon={<Activity className="h-3.5 w-3.5 text-alert-crimson" aria-hidden />}
        right={
          <span className="shrink-0 rounded border border-alert-crimson/40 bg-alert-crimson/10 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.14em] text-alert-crimson">
            No control
          </span>
        }
      >
        System Observation — Iteration {iteration.index}
      </SectionLabel>

      <div className="mb-2 grid grid-cols-3 gap-1.5">
        {HEADWAY_LABELS.map((label, index) => (
          <div
            key={label}
            className="rounded border border-holo-glow/12 bg-void-900/50 px-2 py-1.5 text-center"
          >
            <div className="hud-label">{label}</div>
            <div className="font-mono text-sm tabular-nums text-holo-glow">
              {(iteration.headways[index] as number).toFixed(1)}
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-0.5 border-t border-holo-glow/10 pt-2">
        <Row
          label="Trend"
          value={`${worstLabel} ${trend === 'deteriorating' ? 'deteriorating' : trend === 'improving' ? 'improving' : 'unchanged'}`}
          tone={trend === 'deteriorating' ? 'crimson' : 'glow'}
        />
        <Row
          label="Closing rate"
          value={
            observation.closingRatePerIteration > 0
              ? `${observation.closingRatePerIteration.toFixed(2)} min / cycle`
              : 'not closing'
          }
          tone={observation.closingRatePerIteration > 0 ? 'crimson' : 'glow'}
        />
        <Row
          label="Projected bunching"
          value={
            observation.iterationsToBunching === null
              ? 'beyond projection horizon'
              : observation.iterationsToBunching === 0
                ? 'already bunched'
                : `${observation.iterationsToBunching} iteration${observation.iterationsToBunching === 1 ? '' : 's'}`
          }
          tone={observation.iterationsToBunching === null ? 'glow' : 'crimson'}
        />
        <Row
          label="Next iteration if unchanged"
          value={observation.predictedFree.map((value) => value.toFixed(1)).join(' / ')}
          tone="amber"
        />
        <Row label="Control applied" value="None" tone="crimson" />
        <Row label="Result" value={observation.result} tone="crimson" mono={false} />
      </div>

      {/* Scenario-specific commentary, all derived from the current state. */}
      {scenario.id === 'fast-follower' && (
        <div className="mt-2 rounded border border-alert-amber/25 bg-alert-amber/[0.06] p-2">
          <div className="hud-label mb-1 flex items-center gap-1 text-alert-amber/80">
            <TrendingDown aria-hidden className="h-2.5 w-2.5" />
            Free-run projection — {HEADWAY_LABELS[0]}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5">
            {forwardProjection(iteration.headways, iteration.natural, [2, 4, 6]).map((entry) => (
              <span key={entry.steps} className="font-mono text-[10px] text-alert-amber">
                +{entry.steps} cycles:{' '}
                <span className="tabular-nums">{entry.headways[0].toFixed(1)}</span> min
              </span>
            ))}
          </div>
          <p className="mt-1 font-mono text-[9px] leading-relaxed text-alert-amber/70">
            Bunching is predicted from the closing rate, before any physical cluster forms.
          </p>
        </div>
      )}

      {scenario.id === 'temporary-stoppage' && iteration.incident.cleared && (
        <div className="mt-2 rounded border border-alert-amber/25 bg-alert-amber/[0.06] p-2">
          <Row label="Original disruption" value="Cleared" tone="green" />
          <Row
            label="Residual bunching"
            value={`Remains — minimum headway ${iteration.metrics.minHeadway.toFixed(1)} min`}
            tone="crimson"
          />
          <p className="mt-1 font-mono text-[9px] leading-relaxed text-alert-amber/70">
            Removing the cause does not restore service regularity.
          </p>
        </div>
      )}

      {scenario.id === 'multi-bus-bunch' && (
        <div className="mt-2 rounded border border-alert-crimson/25 bg-alert-crimson/[0.06] p-2">
          <Row
            label="Services within the cluster"
            value={`${iteration.headways[0] + iteration.headways[1] < 6 ? 3 : 2} of 4`}
            tone="crimson"
          />
          <Row
            label="Effective frequency in cluster"
            value="≈ one service"
            tone="crimson"
          />
          <p className="mt-1 font-mono text-[9px] leading-relaxed text-alert-crimson/70">
            Adding buses to a cluster does not improve effective frequency — passengers wait for the
            interval between clusters.
          </p>
        </div>
      )}

      {iteration.dispatch && (
        <div className="mt-2 rounded border border-holo-glow/15 bg-void-900/50 p-2">
          <div className="hud-label mb-1">Terminal departures — schedule priority</div>
          {iteration.dispatch.map((entry) => (
            <Row
              key={entry.bus}
              label={`Bus ${entry.bus} · scheduled ${entry.scheduled}`}
              value={`${entry.actual}${entry.offsetMinutes > 0 ? ` (+${entry.offsetMinutes.toFixed(0)} min)` : ' (on time)'}`}
              tone={entry.offsetMinutes > 0 ? 'crimson' : 'glow'}
            />
          ))}
          <p className="mt-1 font-mono text-[9px] leading-relaxed text-holo-glow/50">
            Every following bus is punctual against its own timetable, yet the corridor starts{' '}
            {iteration.headways[0].toFixed(1)} minutes apart instead of{' '}
            {TARGET_HEADWAY_MINUTES.toFixed(1)}.
          </p>
        </div>
      )}
    </section>
  );
}
