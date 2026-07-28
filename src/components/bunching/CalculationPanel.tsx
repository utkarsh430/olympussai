'use client';

import { ChevronDown, Sigma } from 'lucide-react';
import { TARGET_HEADWAY_MINUTES } from '@/lib/bunching/config';
import { advance, formatSigned, formatVector } from '@/lib/bunching/math';
import {
  BUS_IDS,
  HEADWAY_LABELS,
  type BusId,
  type SimulationIteration,
} from '@/lib/bunching/types';

/**
 * The audit trail for the numbers on screen (Section 30).
 *
 * Every line is rendered from the iteration's own state via the same functions
 * the panels use — the arithmetic is printed, not transcribed, so it cannot
 * drift away from the metrics it explains.
 */
export function CalculationPanel({
  withoutAI,
  withAI,
}: {
  withoutAI: SimulationIteration;
  withAI: SimulationIteration;
}) {
  return (
    <details
      className="group rounded-lg border border-sim-line bg-sim-well"
      data-testid="calculation-panel"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 transition-colors hover:bg-sim-accent/[0.04] [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-sim-ink">
          <Sigma className="h-3.5 w-3.5" aria-hidden />
          View calculations — iteration {withAI.index}
        </span>
        <ChevronDown
          aria-hidden
          className="h-4 w-4 shrink-0 text-sim-muted transition-transform group-open:rotate-180"
        />
      </summary>

      <div className="grid gap-3 border-t border-sim-line p-3 lg:grid-cols-2">
        <Column title="Without AI" iteration={withoutAI} tone="crimson" />
        <Column title="With AI" iteration={withAI} tone="teal" />
      </div>
    </details>
  );
}

function Column({
  title,
  iteration,
  tone,
}: {
  title: string;
  iteration: SimulationIteration;
  tone: 'crimson' | 'teal';
}) {
  const { headways, metrics, natural, controls } = iteration;
  const [ab, bc, cd] = headways;

  // Re-derived here rather than stored: the same call the engine makes, so the
  // per-bus minutes printed below are exactly the ones that were applied.
  const transition = advance(headways, natural, controls);
  const effective = transition.effective;

  const absTerms = headways
    .map((value) => `|${value.toFixed(2)} − ${TARGET_HEADWAY_MINUTES}|`)
    .join(' + ');
  const absSum = headways.reduce(
    (total, value) => total + Math.abs(value - TARGET_HEADWAY_MINUTES),
    0,
  );
  const squares = headways.map((value) => value.toFixed(2) + '²').join(' + ');
  const sum = ab + bc + cd;
  const squareSum = ab ** 2 + bc ** 2 + cd ** 2;

  return (
    <div
      className={`rounded border p-2.5 ${
        tone === 'teal'
          ? 'border-sim-teal/25 bg-sim-teal/[0.03]'
          : 'border-sim-crimson/25 bg-sim-crimson/[0.03]'
      }`}
    >
      <h3
        className={`mb-2 font-mono text-[10px] uppercase tracking-[0.16em] ${
          tone === 'teal' ? 'text-sim-teal' : 'text-sim-crimson'
        }`}
      >
        {title}
      </h3>

      <dl className="space-y-1.5 font-mono text-[10px] leading-relaxed">
        <Line term="Target headway" value={`${TARGET_HEADWAY_MINUTES.toFixed(1)} min`} />
        <Line term="Current vector" value={`${formatVector(headways, 2)} min`} />

        <Line
          term="Mean absolute error"
          value={`(${absTerms}) / 3 = ${(absSum / 3).toFixed(4)} → ${metrics.mae.toFixed(2)} min`}
        />
        <Line
          term="Headway regularity"
          value={`100 × (1 − ${metrics.mae.toFixed(2)} / ${TARGET_HEADWAY_MINUTES}) = ${metrics.regularity.toFixed(2)}%`}
        />
        <Line
          term="Headway variance"
          value={`mean = ${metrics.mean.toFixed(2)}; variance = ${metrics.variance.toFixed(3)} min²`}
        />
        <Line
          term="Passenger wait proxy"
          value={`(${squares}) / (2 × ${sum.toFixed(2)}) = ${squareSum.toFixed(2)} / ${(2 * sum).toFixed(2)} = ${metrics.waitProxy.toFixed(2)} min`}
        />

        <div className="border-t border-sim-line pt-1.5">
          <Line
            term="Natural minutes (disturbance + dwell feedback)"
            value={BUS_IDS.map((bus) => `${bus} ${formatSigned(natural[bus])}`).join('  ')}
          />
          <Line
            term="Intervention u (+ hold, − pacing)"
            value={BUS_IDS.map((bus) => `${bus} ${formatSigned(controls[bus])}`).join('  ')}
          />
          <Line
            term="Applied per bus (natural + u)"
            value={BUS_IDS.map((bus) => `${bus} ${formatSigned(effective[bus])}`).join('  ')}
          />
        </div>

        <div className="border-t border-sim-line pt-1.5">
          {HEADWAY_LABELS.map((label, index) => {
            const leader = BUS_IDS[index] as BusId;
            const follower = BUS_IDS[index + 1] as BusId;
            return (
              <Line
                key={label}
                term={`H'${label}`}
                value={`${(headways[index] as number).toFixed(2)} + (${follower} ${formatSigned(
                  effective[follower],
                )}) − (${leader} ${formatSigned(effective[leader])}) = ${(
                  transition.headways[index] as number
                ).toFixed(2)}`}
              />
            );
          })}
          <Line
            term="Projected next vector"
            value={`${formatVector(transition.headways, 2)} min`}
          />
          {transition.clamped && (
            <p className="mt-1 text-sim-amber/80">
              Overtaking floor applied: a following bus cannot close past the minimum physical
              headway, so the time it could not gain is carried into the headway behind it.
            </p>
          )}
        </div>
      </dl>
    </div>
  );
}

function Line({ term, value }: { term: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-2">
      <dt className="shrink-0 text-sim-muted">{term}</dt>
      <dd className="min-w-0 break-words text-sim-ink">{value}</dd>
    </div>
  );
}
