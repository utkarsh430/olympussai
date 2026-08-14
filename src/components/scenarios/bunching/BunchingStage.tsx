'use client';

import { motion } from 'framer-motion';
import { useState } from 'react';
import { ArrowRight, GitMerge } from 'lucide-react';
import { CountUp } from '@/components/shared/hud';
import type { BunchingScenario } from '@/lib/demo-scenarios/bunchingScenario';
import { cn } from '@/lib/utils';

/** Bunching visualisation — bus spacing geometry and projected recovery. */
export function BunchingStage({ scenario }: { scenario: BunchingScenario }) {
  const [accepted, setAccepted] = useState(false);

  const gapAhead = accepted ? scenario.projectedGapAheadAfter : scenario.gapAheadMinutes;
  const gapBehind = accepted ? scenario.projectedGapBehindAfter : scenario.gapBehindMinutes;

  return (
    <div className="space-y-3" data-testid="bunching-stage">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-holo-glow">
          <GitMerge className="h-3.5 w-3.5" aria-hidden />
          Bunching Analysis
        </h3>
<span className="rounded border border-holo-teal/40 bg-holo-teal/10 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.14em] text-holo-teal">
          Predictive
        </span>
      </div>

      {/* Corridor geometry */}
      <div className="relative rounded border border-holo-glow/15 bg-void-900/60 px-4 py-6">
        <div className="absolute inset-x-6 top-1/2 h-[2px] -translate-y-1/2 bg-gradient-to-r from-holo-glow/10 via-holo-glow/45 to-holo-glow/10" />

        <div className="relative flex items-center justify-between">
          <BusNode label="BUS AHEAD" sublabel="Preceding bus" tone="amber" />
          <GapIndicator minutes={gapAhead} label="Gap ahead" critical={gapAhead < 6} />
          <BusNode label="SELECTED BUS" sublabel="Live UPSRTC vehicle" tone="live" pulse />
          <GapIndicator minutes={gapBehind} label="Gap behind" critical={false} wide />
          <BusNode label="BUS BEHIND" sublabel="Following bus" tone="amber" />
        </div>
      </div>

      {/* Key figures */}
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Target headway" value={`${scenario.targetHeadwayMinutes} min`} />
        <Stat
          label="Bunching risk"
          value={<CountUp value={scenario.riskPercent} suffix="%" />}
          tone={scenario.riskPercent > 84 ? 'crimson' : 'amber'}
        />
        <Stat label="Time to bunching" value={`${scenario.minutesToBunching} min`} tone="amber" />
      </div>

      <div className="rounded border border-holo-glow/15 bg-void-900/50 px-3 py-2">
        <span className="hud-label">Predicted clustering point</span>
        <p className="mt-0.5 font-mono text-xs text-holo-teal">{scenario.clusteringPoint}</p>
      </div>

      {/* Before / after */}
      <div className="rounded border border-holo-glow/15 bg-void-900/50 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="hud-label">Projected intervention impact</span>
          <button
            type="button"
            onClick={() => setAccepted((value) => !value)}
            className={cn(accepted ? 'hud-button-primary' : 'hud-button', 'px-2 py-1 text-[9px]')}
            data-testid="bunching-accept-toggle"
          >
            {accepted ? 'Showing after intervention' : `Apply ${scenario.holdSeconds}s hold`}
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <ImpactColumn
            title="Before intervention"
            rows={[
              ['Forward gap', `${scenario.gapAheadMinutes} min`],
              ['Rear gap', `${scenario.gapBehindMinutes} min`],
            ]}
            tone="muted"
          />
          <ImpactColumn
            title="After intervention"
            rows={[
              ['Forward gap', `${scenario.projectedGapAheadAfter} min`],
              ['Rear gap', `${scenario.projectedGapBehindAfter} min`],
            ]}
            tone={accepted ? 'green' : 'muted'}
          />
        </div>
      </div>

      {/* Timeline */}
      <div className="rounded border border-holo-glow/15 bg-void-900/50 p-3">
        <span className="hud-label mb-2 block">Projection timeline</span>
        <ol className="space-y-1.5">
          {scenario.timeline.map((entry, index) => (
            <motion.li
              key={entry.at}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.09 }}
              className="flex items-center gap-2.5"
            >
              <span className="w-10 shrink-0 font-mono text-[10px] tabular-nums text-holo-glow/45">
                {entry.at}
              </span>
              <span className="h-1 w-1 shrink-0 rounded-full bg-holo-glow/60" aria-hidden />
              <span className="font-mono text-[10px] text-holo-glow/70">{entry.label}</span>
            </motion.li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function BusNode({
  label,
  sublabel,
  tone,
  pulse,
}: {
  label: string;
  sublabel: string;
  tone: 'amber' | 'live';
  pulse?: boolean;
}) {
  const colour = tone === 'live' ? 'hsl(var(--instrument-success))' : 'hsl(var(--instrument-warning))';

  return (
    <div className="relative z-10 flex w-24 flex-col items-center text-center">
      <span className="relative mb-1.5 flex h-8 w-8 items-center justify-center">
        {pulse && (
          <span
            className="absolute inset-0 animate-pulse-ring rounded-full border"
            style={{ borderColor: colour }}
            aria-hidden
          />
        )}
        <span
          className="h-4 w-4 rotate-45 rounded-sm"
          style={{ backgroundColor: colour, boxShadow: `0 0 14px 2px ${colour}88` }}
          aria-hidden
        />
      </span>
      <span
        className="font-mono text-[8px] uppercase leading-tight tracking-wider"
        style={{ color: colour }}
      >
        {label}
      </span>
      <span className="font-mono text-[7px] text-holo-glow/35">{sublabel}</span>
    </div>
  );
}

function GapIndicator({
  minutes,
  label,
  critical,
  wide,
}: {
  minutes: number;
  label: string;
  critical: boolean;
  wide?: boolean;
}) {
  return (
    <div className={cn('relative z-10 flex flex-col items-center', wide ? 'w-24' : 'w-20')}>
      <motion.span
        key={minutes}
        initial={{ scale: 1.25, opacity: 0.4 }}
        animate={{ scale: 1, opacity: 1 }}
        className={cn(
          'rounded border px-1.5 py-0.5 font-mono text-[11px] tabular-nums',
          critical
            ? 'border-alert-crimson/50 bg-alert-crimson/15 text-alert-crimson'
            : 'border-holo-teal/40 bg-holo-teal/10 text-holo-teal',
        )}
      >
        {minutes} min
      </motion.span>
      <span className="mt-0.5 flex items-center gap-0.5 font-mono text-[7px] uppercase tracking-wider text-holo-glow/35">
        {label}
        <ArrowRight className="h-2 w-2" aria-hidden />
      </span>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: React.ReactNode;
  tone?: 'default' | 'amber' | 'crimson';
}) {
  const colour =
    tone === 'crimson'
      ? 'text-alert-crimson'
      : tone === 'amber'
        ? 'text-alert-amber'
        : 'text-holo-glow';

  return (
    <div className="rounded border border-holo-glow/15 bg-void-900/50 px-2.5 py-2">
      <div className="hud-label truncate">{label}</div>
      <div className={cn('font-mono text-base tabular-nums', colour)}>{value}</div>
    </div>
  );
}

function ImpactColumn({
  title,
  rows,
  tone,
}: {
  title: string;
  rows: Array<[string, string]>;
  tone: 'muted' | 'green';
}) {
  return (
    <div>
      <p
        className={cn(
          'mb-1.5 font-mono text-[9px] uppercase tracking-wider',
          tone === 'green' ? 'text-alert-green' : 'text-holo-glow/45',
        )}
      >
        {title}
      </p>
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-center justify-between py-0.5">
          <span className="font-mono text-[10px] text-holo-glow/50">{label}</span>
          <span
            className={cn(
              'font-mono text-[11px] tabular-nums',
              tone === 'green' ? 'text-alert-green' : 'text-holo-glow/70',
            )}
          >
            {value}
          </span>
        </div>
      ))}
    </div>
  );
}
