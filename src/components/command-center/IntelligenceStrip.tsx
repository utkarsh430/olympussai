'use client';

import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Area, AreaChart, ResponsiveContainer } from 'recharts';
import { Activity, Radio, TriangleAlert, BarChart3, Play, TrendingUp } from 'lucide-react';
import { useCopilotStore } from '@/stores/copilotStore';
import { Badge, sourceBadge } from '@/components/shared/hud';
import { AUDIT_EVENT_LABELS } from '@/lib/audit/auditLog';
import { formatIndiaTime } from '@/lib/formatters';
import { PITCH_STEPS } from '@/components/pitch-mode/pitchScript';
import { cn } from '@/lib/utils';

/** Bottom intelligence strip: stream activity, health, demand, incidents, log. */
export function IntelligenceStrip() {
  const buses = useCopilotStore((state) => state.buses);
  const feedMeta = useCopilotStore((state) => state.feedMeta);
  const events = useCopilotStore((state) => state.auditEvents);
  const scenario = useCopilotStore((state) => state.activeScenario);
  const setPitchMode = useCopilotStore((state) => state.setPitchMode);
  const toggleImpact = useCopilotStore((state) => state.toggleImpact);
  const isPitchMode = useCopilotStore((state) => state.isPitchMode);
  const pitchStep = useCopilotStore((state) => state.pitchStep);

  // Rolling GPS stream activity — real counts, sampled each poll.
  const [stream, setStream] = useState<Array<{ t: number; v: number }>>([]);

  // The stream clock reads "now" when no fetch has landed yet, which would
  // differ between the server render and hydration. Hold it back until mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    setStream((previous) => {
      const next = [...previous, { t: Date.now(), v: buses.length }];
      return next.slice(-40);
    });
  }, [buses.length, feedMeta.lastFetchAt]);

  const qualityCounts = useMemo(() => {
    let good = 0;
    let degraded = 0;
    let stale = 0;
    for (const bus of buses) {
      if (bus.dataQuality === 'good') good += 1;
      else if (bus.dataQuality === 'degraded') degraded += 1;
      else stale += 1;
    }
    return { good, degraded, stale };
  }, [buses]);

  // Modelled demand curve for the ambient strip readout.
  const demandCurve = useMemo(
    () =>
      Array.from({ length: 24 }, (_, hour) => ({
        hour,
        demand:
          40 +
          Math.round(
            55 * Math.exp(-((hour - 8.5) ** 2) / 7) + 62 * Math.exp(-((hour - 18) ** 2) / 8),
          ),
      })),
    [],
  );

  const activeIncidents = scenario ? 1 : 0;

  return (
    <footer className="relative z-20 flex h-[132px] shrink-0 gap-2 px-3 pb-2">
      {/* Live GPS stream */}
      <Panel
        title="Live GPS Stream"
        icon={Radio}
        badge={<Badge variant={sourceBadge(feedMeta.source).variant} pulse>
          {feedMeta.source === 'unavailable' ? 'UNAVAILABLE' : feedMeta.source === 'fixture' ? 'FIXTURE' : 'LIVE'}
        </Badge>}
        className="w-[240px]"
      >
        <div className="h-9">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={stream} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="streamFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#2bff88" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="#2bff88" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="v"
                stroke="#2bff88"
                strokeWidth={1.4}
                fill="url(#streamFill)"
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-1 flex items-center justify-between">
          <span className="font-mono text-[9px] text-holo-glow/40">
            {mounted ? formatIndiaTime(feedMeta.lastFetchAt ?? new Date()) : '--:--:--'}
          </span>
          <span className="font-mono text-[11px] tabular-nums text-alert-green">
            {buses.length} vehicles
          </span>
        </div>
      </Panel>

      {/* Network health */}
      <Panel title="Network Health" icon={Activity} className="w-[210px]">
        <div className="space-y-1.5">
          <HealthBar label="Good fix" value={qualityCounts.good} total={buses.length} tone="green" />
          <HealthBar label="Degraded" value={qualityCounts.degraded} total={buses.length} tone="amber" />
          <HealthBar label="Stale" value={qualityCounts.stale} total={buses.length} tone="crimson" />
        </div>
      </Panel>

      {/* Demand curve */}
      <Panel
        title="Demand Curve"
        icon={BarChart3}
        badge={<PredictiveChip />}
        className="w-[200px]"
      >
        <div className="h-11">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={demandCurve} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="demandStripFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3ff0ff" stopOpacity={0.45} />
                  <stop offset="100%" stopColor="#3ff0ff" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="demand"
                stroke="#3ff0ff"
                strokeWidth={1.4}
                fill="url(#demandStripFill)"
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-0.5 font-mono text-[9px] text-holo-glow/35">
          Twin-peak weekday profile
        </p>
      </Panel>

      {/* Incidents — narrow panel, so the badge is abbreviated to avoid clipping. */}
      <Panel
        title="Active Incidents"
        icon={TriangleAlert}
        className="w-[186px]"
      >
        <div className="flex h-full flex-col items-center justify-center">
          <span
            className={cn(
              'font-mono text-3xl tabular-nums',
              activeIncidents > 0 ? 'text-alert-crimson' : 'text-holo-glow/30',
            )}
          >
            {activeIncidents}
          </span>
          <span className="font-mono text-[9px] uppercase tracking-wider text-holo-glow/40">
            {scenario ? scenario.severityText : 'None open'}
          </span>
        </div>
      </Panel>

      {/* Pitch timeline */}
      <Panel title="Scenario Timeline" icon={Play} className="w-[230px]">
        <div className="mb-1.5 flex gap-0.5">
          {PITCH_STEPS.map((step, index) => (
            <span
              key={step.id}
              className={cn(
                'h-1 flex-1 rounded-full transition-colors',
                isPitchMode && index === pitchStep
                  ? 'bg-holo-glow'
                  : isPitchMode && index < pitchStep
                    ? 'bg-holo-teal/60'
                    : 'bg-holo-glow/15',
              )}
            />
          ))}
        </div>

        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => setPitchMode(true)}
            className="hud-button flex-1 px-1.5 text-[9px]"
            data-testid="start-pitch-mode-strip"
          >
            <Play className="h-3 w-3" aria-hidden />
            Pitch Mode
          </button>
          <button
            type="button"
            onClick={() => toggleImpact(true)}
            className="hud-button flex-1 px-1.5 text-[9px]"
            data-testid="open-impact"
          >
            <TrendingUp className="h-3 w-3" aria-hidden />
            Impact
          </button>
        </div>

        <p className="mt-1.5 font-mono text-[9px] text-holo-glow/35">
          {isPitchMode ? `Step ${pitchStep + 1} / ${PITCH_STEPS.length}` : 'Idle — ready to present'}
        </p>
      </Panel>

      {/* AI event log */}
      <Panel title="AI Event Log" icon={Activity} className="min-w-0 flex-1">
        <div className="h-full overflow-y-auto pr-1">
          {events.length === 0 && (
            <p className="pt-2 font-mono text-[9px] text-holo-glow/30">
              Awaiting operator activity…
            </p>
          )}
          {events.slice(0, 12).map((event) => (
            <motion.div
              key={event.id}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              className="flex items-center gap-2 border-b border-holo-glow/[0.05] py-0.5 last:border-0"
            >
              <span className="shrink-0 font-mono text-[8px] tabular-nums text-holo-glow/25">
                {formatIndiaTime(event.at)}
              </span>

              <span className="shrink-0 font-mono text-[8px] uppercase tracking-wider text-holo-teal/70">
                {AUDIT_EVENT_LABELS[event.type]}
              </span>
              <span className="truncate font-mono text-[9px] text-holo-glow/50">
                {event.summary}
              </span>
            </motion.div>
          ))}
        </div>
      </Panel>
    </footer>
  );
}

/** Consistent provenance marker for model-derived panels. */
function PredictiveChip() {
  return (
    <span className="rounded border border-holo-teal/40 bg-holo-teal/10 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.14em] text-holo-teal">
      Predictive
    </span>
  );
}

function Panel({
  title,
  icon: Icon,
  badge,
  children,
  className,
}: {
  title: string;
  icon: typeof Activity;
  badge?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('hud-panel hud-corners flex flex-col overflow-hidden p-2.5', className)}>
      <header className="mb-1.5 flex shrink-0 items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.14em] text-holo-glow/70">
          <Icon className="h-2.5 w-2.5" aria-hidden />
          {title}
        </h3>
        {badge}
      </header>
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  );
}

function HealthBar({
  label,
  value,
  total,
  tone,
}: {
  label: string;
  value: number;
  total: number;
  tone: 'green' | 'amber' | 'crimson';
}) {
  const percent = total > 0 ? (value / total) * 100 : 0;
  const colour =
    tone === 'green' ? 'bg-alert-green' : tone === 'amber' ? 'bg-alert-amber' : 'bg-alert-crimson';

  return (
    <div>
      <div className="mb-0.5 flex items-center justify-between">
        <span className="font-mono text-[9px] text-holo-glow/45">{label}</span>
        <span className="font-mono text-[9px] tabular-nums text-holo-glow/65">
          {value} ({percent.toFixed(0)}%)
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-holo-glow/10">
        <motion.div
          className={cn('h-full', colour)}
          animate={{ width: `${percent}%` }}
          transition={{ duration: 0.5 }}
        />
      </div>
    </div>
  );
}
