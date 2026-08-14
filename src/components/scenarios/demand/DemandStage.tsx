'use client';

import { motion } from 'framer-motion';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
  Legend,
  ReferenceLine,
} from 'recharts';
import { Users, ArrowRight, Building2 } from 'lucide-react';
import { CountUp } from '@/components/shared/hud';
import { useCopilotStore } from '@/stores/copilotStore';
import {
  TIME_WINDOWS,
  TIME_WINDOW_LABELS,
  type DemandScenario,
  type TimeWindow,
} from '@/lib/demo-scenarios/demandScenario';
import { cn } from '@/lib/utils';

/** Demand and fleet-redistribution overlay. */
export function DemandStage({ scenario }: { scenario: DemandScenario }) {
  const setOverrides = useCopilotStore((state) => state.setOverrides);

  const routeChartData = scenario.routes.map((route) => ({
    name: route.name.split('—').pop()?.trim() ?? route.name,
    Current: route.currentBuses,
    Required: route.requiredBuses,
  }));

  return (
    <div className="space-y-3" data-testid="demand-stage">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-holo-glow">
          <Users className="h-3.5 w-3.5" aria-hidden />
          Network Demand Intelligence
        </h3>
<span className="rounded border border-holo-teal/40 bg-holo-teal/10 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.14em] text-holo-teal">
          Predictive
        </span>
      </div>

      {/* Time slider */}
      <div className="rounded border border-holo-glow/15 bg-void-900/50 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="hud-label">Demand time window</span>
          <span className="font-mono text-xs text-holo-teal">
            {TIME_WINDOW_LABELS[scenario.activeWindow]}
          </span>
        </div>

        <div
          className="flex gap-1"
          role="group"
          aria-label="Select demand time window"
          data-testid="demand-time-slider"
        >
          {TIME_WINDOWS.map((window) => (
            <button
              key={window}
              type="button"
              onClick={() => setOverrides({ peakWindow: window as TimeWindow })}
              aria-pressed={scenario.activeWindow === window}
              className={cn(
                'flex-1 rounded border py-1.5 font-mono text-[10px] transition',
                scenario.activeWindow === window
                  ? 'border-holo-glow/70 bg-holo-glow/15 text-holo-glow'
                  : 'border-holo-glow/15 text-holo-glow/45 hover:border-holo-glow/40',
              )}
            >
              {TIME_WINDOW_LABELS[window]}
            </button>
          ))}
        </div>

        {scenario.festivalSurge && (
          <p className="mt-2 font-mono text-[9px] text-alert-amber">
            Festival surge profile active — demand multiplied across all windows.
          </p>
        )}
      </div>

      {/* Route allocation */}
      <div className="space-y-1.5">
        {scenario.routes.map((route, index) => (
          <motion.div
            key={route.id}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.08 }}
            className={cn(
              'rounded border p-2.5',
              route.status === 'deficit'
                ? 'border-alert-crimson/35 bg-alert-crimson/[0.06]'
                : route.status === 'surplus'
                  ? 'border-alert-green/35 bg-alert-green/[0.06]'
                  : 'border-holo-glow/15 bg-void-900/50',
            )}
          >
            <div className="mb-1.5 flex items-center justify-between">
              <span className="truncate font-mono text-[11px] text-holo-glow">{route.name}</span>
              <span
                className={cn(
                  'shrink-0 rounded border px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-wider',
                  route.status === 'deficit'
                    ? 'border-alert-crimson/50 text-alert-crimson'
                    : route.status === 'surplus'
                      ? 'border-alert-green/50 text-alert-green'
                      : 'border-holo-glow/30 text-holo-glow/60',
                )}
              >
                {route.status === 'deficit'
                  ? `Deficit ${route.deficit}`
                  : route.status === 'surplus'
                    ? `Surplus ${Math.abs(route.deficit)}`
                    : 'Balanced'}
              </span>
            </div>

            <div className="grid grid-cols-4 gap-2">
              <MiniStat label="Current" value={String(route.currentBuses)} />
              <MiniStat label="Required" value={String(route.requiredBuses)} />
              <MiniStat label="Demand" value={`${route.demandPercent}%`} />
              <MiniStat
                label="Gap"
                value={route.deficit > 0 ? `+${route.deficit}` : String(route.deficit)}
              />
            </div>

            {/* Demand bar, clamped visually at 200% */}
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-holo-glow/10">
              <motion.div
                className={cn(
                  'h-full',
                  route.demandPercent > 120
                    ? 'bg-alert-crimson'
                    : route.demandPercent > 95
                      ? 'bg-alert-amber'
                      : 'bg-alert-green',
                )}
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(100, route.demandPercent / 2)}%` }}
                transition={{ duration: 0.8, delay: index * 0.08 }}
              />
            </div>
          </motion.div>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-2 gap-2">
        <ChartCard title="Allocation vs requirement">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={routeChartData} margin={{ top: 4, right: 4, bottom: 0, left: -26 }}>
              <XAxis
                dataKey="name"
                stroke="hsl(var(--instrument-info) / 0.25)"
                tick={{ fontSize: 8, fill: 'hsl(var(--instrument-info) / 0.44)', fontFamily: 'monospace' }}
                tickLine={false}
              />
              <YAxis
                stroke="hsl(var(--instrument-info) / 0.25)"
                tick={{ fontSize: 8, fill: 'hsl(var(--instrument-info) / 0.44)', fontFamily: 'monospace' }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                cursor={{ fill: 'hsl(var(--primary) / 0.06)' }}
                contentStyle={tooltipStyle}
                labelStyle={{ color: 'hsl(var(--instrument-info))' }}
              />
              <Legend wrapperStyle={{ fontSize: 9, fontFamily: 'monospace' }} />
              <Bar dataKey="Current" fill="hsl(var(--primary))" radius={[2, 2, 0, 0]} />
              <Bar dataKey="Required" fill="hsl(var(--instrument-warning))" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Demand curve">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={scenario.demandCurve} margin={{ top: 4, right: 4, bottom: 0, left: -26 }}>
              <XAxis
                dataKey="window"
                stroke="hsl(var(--instrument-info) / 0.25)"
                tick={{ fontSize: 8, fill: 'hsl(var(--instrument-info) / 0.44)', fontFamily: 'monospace' }}
                tickLine={false}
              />
              <YAxis
                stroke="hsl(var(--instrument-info) / 0.25)"
                tick={{ fontSize: 8, fill: 'hsl(var(--instrument-info) / 0.44)', fontFamily: 'monospace' }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: 'hsl(var(--instrument-info))' }} />
              <Legend wrapperStyle={{ fontSize: 9, fontFamily: 'monospace' }} />
              <ReferenceLine y={100} stroke="hsl(var(--instrument-info) / 0.19)" strokeDasharray="3 3" />
              <Line
                type="monotone"
                dataKey="morningDemand"
                name="Morning"
                stroke="hsl(var(--instrument-info))"
                strokeWidth={1.8}
                dot={{ r: 2 }}
              />
              <Line
                type="monotone"
                dataKey="eveningDemand"
                name="Evening"
                stroke="hsl(var(--instrument-warning))"
                strokeWidth={1.8}
                dot={{ r: 2 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Depots */}
      <div className="rounded border border-holo-glow/15 bg-void-900/50 p-3">
        <span className="hud-label mb-2 block">Depot availability</span>
        <div className="space-y-1.5">
          {scenario.depots.map((depot) => (
            <div key={depot.depot} className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1.5">
                <Building2 className="h-3 w-3 shrink-0 text-holo-glow/45" aria-hidden />
                <span className="truncate font-mono text-[10px] text-holo-glow/70">
                  {depot.depot}
                </span>
              </span>
              <span className="shrink-0 font-mono text-[10px] tabular-nums text-holo-glow/60">
                {depot.available} available · {depot.reserve} reserve · {depot.committed} committed
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Reallocation plan */}
      <div className="rounded border border-holo-glow/15 bg-void-900/50 p-3">
        <span className="hud-label mb-2 block">Redistribution plan</span>
        <ol className="space-y-1.5">
          {scenario.recommendations.map((recommendation, index) => (
            <li key={recommendation} className="flex gap-2.5">
              <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-holo-glow/35 font-mono text-[9px] text-holo-glow">
                {index + 1}
              </span>
              <span className="font-mono text-[10px] leading-relaxed text-holo-glow/70">
                {recommendation}
              </span>
            </li>
          ))}
        </ol>
      </div>

      {/* Before / after */}
      <div className="grid grid-cols-3 gap-2">
        {scenario.impact.map((metric) => (
          <div
            key={metric.label}
            className="rounded border border-holo-glow/15 bg-void-900/50 px-2.5 py-2"
          >
            <div className="hud-label mb-1 truncate">{metric.label}</div>
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-[11px] text-holo-glow/40 line-through">
                {metric.before}
              </span>
              <ArrowRight className="h-2.5 w-2.5 text-holo-glow/30" aria-hidden />
              <span className="font-mono text-sm tabular-nums text-alert-green">{metric.after}</span>
            </div>
            <div className="mt-0.5 font-mono text-[8px] text-alert-green/60">{metric.delta}</div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between rounded border border-holo-glow/15 bg-void-900/50 px-3 py-2">
        <span className="hud-label">Demand hotspots plotted</span>
        <span className="font-mono text-sm text-holo-teal">
          <CountUp value={scenario.hotspots.length} />
        </span>
      </div>
    </div>
  );
}

const tooltipStyle = {
  background: 'hsl(var(--popover) / 0.95)',
  border: '1px solid hsl(var(--primary) / 0.3)',
  borderRadius: 4,
  fontFamily: 'monospace',
  fontSize: 10,
} as const;

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded border border-holo-glow/15 bg-void-900/50 p-2.5">
      <span className="hud-label mb-1.5 block">{title}</span>
      <div className="h-32">{children}</div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-mono text-[8px] uppercase tracking-wider text-holo-glow/35">{label}</div>
      <div className="font-mono text-[11px] tabular-nums text-holo-glow/80">{value}</div>
    </div>
  );
}
