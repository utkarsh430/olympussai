'use client';

import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip, ReferenceLine } from 'recharts';
import { TrafficCone, ShieldAlert, Route } from 'lucide-react';
import { CountUp } from '@/components/shared/hud';
import type { TrafficScenario } from '@/lib/demo-scenarios/trafficScenario';
import { cn } from '@/lib/utils';

/** Corridor traffic intelligence — no Google TrafficLayer, no Routes API. */
export function TrafficStage({ scenario }: { scenario: TrafficScenario }) {
  return (
    <div className="space-y-3" data-testid="traffic-stage">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-holo-glow">
          <TrafficCone className="h-3.5 w-3.5" aria-hidden />
          Corridor Traffic Intelligence
        </h3>
<span className="rounded border border-holo-teal/40 bg-holo-teal/10 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.14em] text-holo-teal">
          Predictive
        </span>
      </div>

      {/* Headline figures */}
      <div className="grid grid-cols-4 gap-2">
        <Stat label="Congestion" value={scenario.congestionLevel} tone="crimson" />
        <Stat
          label="Distance ahead"
          value={<CountUp value={scenario.distanceToCongestionKm} decimals={1} suffix=" km" />}
        />
        <Stat
          label="Traffic delay"
          value={<CountUp value={scenario.trafficDelayMinutes} suffix=" min" />}
          tone="amber"
        />
        <Stat
          label="Corridor speed"
          value={<CountUp value={scenario.predictedCorridorSpeedKmph} suffix=" km/h" />}
          tone="crimson"
        />
      </div>

      {/* Incident */}
      <div className="flex items-start gap-2.5 rounded border border-alert-crimson/30 bg-alert-crimson/[0.07] px-3 py-2">
        <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-alert-crimson" aria-hidden />
        <div>
          <span className="hud-label text-alert-crimson/70">Projected incident</span>
          <p className="font-mono text-[11px] text-alert-crimson/90">
            {scenario.incidentDescription}
          </p>
        </div>
      </div>

      {/* Density / speed profile */}
      <div className="rounded border border-holo-glow/15 bg-void-900/50 p-3">
        <span className="hud-label mb-2 block">
          Projected traffic density along corridor (km ahead)
        </span>
        <div className="h-36">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={scenario.densityCurve} margin={{ top: 4, right: 4, bottom: 0, left: -22 }}>
              <defs>
                <linearGradient id="densityFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#ff4d5e" stopOpacity={0.55} />
                  <stop offset="100%" stopColor="#ff4d5e" stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="speedFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3ff0ff" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#3ff0ff" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="distanceKm"
                stroke="#3ff0ff40"
                tick={{ fontSize: 9, fill: '#3ff0ff70', fontFamily: 'monospace' }}
                tickLine={false}
              />
              <YAxis
                stroke="#3ff0ff40"
                tick={{ fontSize: 9, fill: '#3ff0ff70', fontFamily: 'monospace' }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                contentStyle={{
                  background: 'rgba(6,14,28,0.95)',
                  border: '1px solid rgba(63,240,255,0.3)',
                  borderRadius: 4,
                  fontFamily: 'monospace',
                  fontSize: 10,
                }}
                labelStyle={{ color: '#3ff0ff' }}
                formatter={(value: number, name: string) => [
                  name === 'densityPercent' ? `${value}%` : `${value} km/h`,
                  name === 'densityPercent' ? 'Density' : 'Speed',
                ]}
              />
              <ReferenceLine
                x={scenario.distanceToCongestionKm}
                stroke="#ff4d5e"
                strokeDasharray="3 3"
                label={{
                  value: 'Incident',
                  fill: '#ff4d5e',
                  fontSize: 9,
                  fontFamily: 'monospace',
                  position: 'top',
                }}
              />
              <Area
                type="monotone"
                dataKey="densityPercent"
                stroke="#ff4d5e"
                strokeWidth={1.6}
                fill="url(#densityFill)"
              />
              <Area
                type="monotone"
                dataKey="speedKmph"
                stroke="#3ff0ff"
                strokeWidth={1.6}
                fill="url(#speedFill)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Route comparison */}
      <div className="grid grid-cols-2 gap-2">
        {scenario.routes.map((route) => (
          <div
            key={route.id}
            className={cn(
              'rounded border p-3',
              route.isRecommended
                ? 'border-holo-glow/50 bg-holo-glow/[0.09]'
                : 'border-holo-glow/15 bg-void-900/50',
            )}
          >
            <div className="mb-1.5 flex items-center justify-between">
              <span
                className={cn(
                  'flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-wider',
                  route.isRecommended ? 'text-holo-glow' : 'text-holo-glow/45',
                )}
              >
                <Route className="h-3 w-3" aria-hidden />
                {route.name}
              </span>
              {route.isRecommended && (
                <span className="rounded border border-holo-glow/50 bg-holo-glow/10 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-wider text-holo-glow">
                  Suggested
                </span>
              )}
            </div>

            <div className="mb-2 flex items-baseline gap-1.5">
              <span
                className={cn(
                  'font-mono text-2xl tabular-nums',
                  route.isRecommended ? 'text-holo-glow' : 'text-alert-crimson',
                )}
              >
                {route.etaMinutes}
              </span>
              <span className="font-mono text-[10px] text-holo-glow/45">min ETA</span>
            </div>

            <div className="space-y-0.5">
              <Row label="Distance" value={`${route.distanceKm} km`} />
              <Row label="Avg speed" value={`${route.averageSpeedKmph} km/h`} />
            </div>

            <p className="mt-2 border-t border-holo-glow/10 pt-1.5 font-mono text-[9px] leading-relaxed text-holo-glow/45">
              {route.description}
            </p>
          </div>
        ))}
      </div>

      {/* Saving */}
      <div className="flex items-center justify-between rounded border border-alert-green/30 bg-alert-green/[0.07] px-3 py-2">
        <span className="font-mono text-[10px] uppercase tracking-wider text-alert-green/70">
          Potential saving
        </span>
        <span className="font-mono text-lg tabular-nums text-alert-green">
          <CountUp value={scenario.potentialSavingMinutes} suffix=" min" />
        </span>
      </div>

      {/* Recommendations */}
      <div className="rounded border border-holo-glow/15 bg-void-900/50 p-3">
        <span className="hud-label mb-2 block">Future recommendations</span>
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

        <p className="mt-2.5 border-t border-alert-amber/20 pt-2 font-mono text-[9px] leading-relaxed text-alert-amber/75">
          {scenario.safetyNote}
        </p>
      </div>
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
      <div className={cn('font-mono text-sm tabular-nums', colour)}>{value}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="font-mono text-[9px] text-holo-glow/40">{label}</span>
      <span className="font-mono text-[10px] tabular-nums text-holo-glow/70">{value}</span>
    </div>
  );
}
