'use client';

import { motion } from 'framer-motion';
import { Wrench, Users, MapPinned, TriangleAlert } from 'lucide-react';
import { CountUp } from '@/components/shared/hud';
import type { BreakdownScenario } from '@/lib/demo-scenarios/breakdownScenario';
import { cn } from '@/lib/utils';

/** Breakdown response — no vehicle is dispatched, no depot is notified. */
export function BreakdownStage({ scenario }: { scenario: BreakdownScenario }) {
  return (
    <div className="space-y-3" data-testid="breakdown-stage">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-alert-crimson">
          <Wrench className="h-3.5 w-3.5" aria-hidden />
          Critical Incident Response
        </h3>
<span className="rounded border border-holo-teal/40 bg-holo-teal/10 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.14em] text-holo-teal">
          Predictive
        </span>
      </div>

      {/* Alert banner */}
      <motion.div
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        className="relative overflow-hidden rounded border border-alert-crimson/45 bg-alert-crimson/[0.09] p-3"
      >
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-1 animate-flicker bg-alert-crimson"
        />
        <div className="flex items-start gap-2.5 pl-2">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 animate-flicker text-alert-crimson" aria-hidden />
          <div className="min-w-0">
            <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-alert-crimson">
              {scenario.breakdownType}
            </p>
            <p className="mt-0.5 font-mono text-[10px] text-alert-crimson/70">
              {scenario.locationSafetyStatus} · Severity: Critical
            </p>
          </div>
        </div>
      </motion.div>

      <div className="grid grid-cols-3 gap-2">
        <Stat
          label="Passengers onboard"
          value={<CountUp value={scenario.passengersOnboard} />}
          icon={Users}
          tone="amber"
        />
        <Stat
          label="Nearest assistance"
          value={scenario.recommendedCandidateId}
          icon={MapPinned}
          tone="green"
        />
        <Stat
          label="Secondary arrival"
          value={<CountUp value={scenario.secondaryArrivalMinutes} suffix=" min" />}
        />
      </div>

      {/* Rescue candidates */}
      <div>
        <span className="hud-label mb-2 block">Assistance candidates</span>
        <div className="space-y-2">
          {scenario.candidates.map((candidate, index) => {
            const recommended = candidate.id === scenario.recommendedCandidateId;
            return (
              <motion.div
                key={candidate.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.12 }}
                className={cn(
                  'rounded border p-2.5',
                  recommended
                    ? 'border-alert-green/45 bg-alert-green/[0.08]'
                    : 'border-holo-glow/15 bg-void-900/50',
                )}
              >
                <div className="mb-2 flex items-center justify-between">
                  <span
                    className={cn(
                      'font-mono text-[11px] font-semibold tracking-wider',
                      recommended ? 'text-alert-green' : 'text-holo-glow',
                    )}
                  >
                    {candidate.id}
                  </span>
                  <span
                    className={cn(
                      'rounded border px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-wider',
                      recommended
                        ? 'border-alert-green/50 text-alert-green'
                        : 'border-holo-glow/25 text-holo-glow/55',
                    )}
                  >
                    {candidate.suitability}
                  </span>
                </div>

                <div className="grid grid-cols-4 gap-2">
                  <MiniStat label="Distance" value={`${candidate.distanceKm} km`} />
                  <MiniStat label="Response" value={`${candidate.responseTimeMinutes} min`} />
                  <MiniStat label="Capacity" value={`${candidate.availableSeats} seats`} />
                  <MiniStat label="Suitability" value={`${candidate.suitabilityScore}%`} />
                </div>

                <p className="mt-1.5 border-t border-holo-glow/10 pt-1.5 font-mono text-[9px] text-holo-glow/45">
                  {candidate.routeCompatibility} · {candidate.depot}
                </p>

                {/* Suitability bar */}
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-holo-glow/10">
                  <motion.div
                    className={cn('h-full', recommended ? 'bg-alert-green' : 'bg-holo-glow/50')}
                    initial={{ width: 0 }}
                    animate={{ width: `${candidate.suitabilityScore}%` }}
                    transition={{ duration: 0.9, delay: index * 0.12 }}
                  />
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* Response timeline */}
      <div className="rounded border border-holo-glow/15 bg-void-900/50 p-3">
        <span className="hud-label mb-2 block">Projected response timeline</span>
        <ol className="relative space-y-2 pl-4">
          <span
            aria-hidden
            className="absolute bottom-1 left-[5px] top-1 w-px bg-gradient-to-b from-alert-crimson via-alert-amber to-alert-green"
          />
          {scenario.responseTimeline.map((entry, index) => (
            <motion.li
              key={entry.at}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.1 }}
              className="relative flex items-center gap-2.5"
            >
              <span
                aria-hidden
                className="absolute -left-4 h-2 w-2 rounded-full border border-void bg-holo-glow"
              />
              <span className="w-10 shrink-0 font-mono text-[10px] tabular-nums text-holo-glow/50">
                {entry.at}
              </span>
              <span className="font-mono text-[10px] text-holo-glow/75">{entry.label}</span>
            </motion.li>
          ))}
        </ol>
      </div>

      <p className="rounded border border-holo-glow/15 bg-void-900/50 px-3 py-2 font-mono text-[9px] leading-relaxed text-holo-glow/55">
        No assistance vehicle has been dispatched and no depot has been notified. Response requires
        dispatcher approval.
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  icon: Icon,
  tone = 'default',
}: {
  label: string;
  value: React.ReactNode;
  icon?: typeof Users;
  tone?: 'default' | 'amber' | 'green';
}) {
  const colour =
    tone === 'green' ? 'text-alert-green' : tone === 'amber' ? 'text-alert-amber' : 'text-holo-glow';

  return (
    <div className="rounded border border-holo-glow/15 bg-void-900/50 px-2.5 py-2">
      <div className="hud-label flex items-center gap-1 truncate">
        {Icon && <Icon className="h-2.5 w-2.5" aria-hidden />}
        {label}
      </div>
      <div className={cn('truncate font-mono text-sm tabular-nums', colour)}>{value}</div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-mono text-[8px] uppercase tracking-wider text-holo-glow/35">{label}</div>
      <div className="font-mono text-[10px] tabular-nums text-holo-glow/80">{value}</div>
    </div>
  );
}
