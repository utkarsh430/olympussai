'use client';

import { BrainCircuit, ShieldCheck, TriangleAlert, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MIN_SAFE_HEADWAY_MINUTES, TARGET_HEADWAY_MINUTES } from '@/lib/bunching/config';
import { controlSummary } from '@/lib/bunching/controller';
import {
  HEADWAY_LABELS,
  type ScenarioDefinition,
  type SimulationIteration,
} from '@/lib/bunching/types';
import { Row, SectionLabel } from './primitives';

/**
 * The controlled side's decision layer (Section 28).
 *
 * Everything shown here comes out of `planIntervention` for this iteration:
 * the free-running projection, the recommended per-bus action, the projection
 * after that action, and the reasoning — which is generated from those same
 * numbers, so the explanation can never describe a different decision from the
 * one being applied.
 *
 * The wording throughout is advisory. Nothing on this page is transmitted to a
 * driver, and no action is executed.
 */
export function AIDecisionPanel({
  iteration,
  scenario,
}: {
  iteration: SimulationIteration;
  scenario: ScenarioDefinition;
}) {
  const plan = iteration.plan;
  if (!plan) return null;

  return (
    <section
      className="rounded border border-holo-teal/30 bg-holo-teal/[0.04] p-3"
      data-testid="ai-decision-panel"
      aria-label="AI control recommendation"
    >
      <SectionLabel
        icon={<BrainCircuit className="h-3.5 w-3.5 text-holo-teal" aria-hidden />}
        right={
          <span className="shrink-0 rounded border border-holo-teal/45 bg-holo-teal/10 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.14em] text-holo-teal">
            Recommendation
          </span>
        }
      >
        AI Control — Iteration {iteration.index}
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

      <div className="space-y-2">
        <Projection
          label="Predicted without intervention"
          headways={plan.predictedFree}
          tone="amber"
        />

        <div className="rounded border border-holo-teal/25 bg-void-900/50 p-2">
          <div className="hud-label mb-1 text-holo-teal/80">Recommended intervention</div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
            {plan.controlList.map((control) => (
              <div key={control.bus} className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-[10px] text-holo-glow/55">Bus {control.bus}</span>
                <span
                  className={cn(
                    'truncate font-mono text-[10px] tabular-nums',
                    control.kind === 'hold'
                      ? 'text-holo-teal'
                      : control.kind === 'pace'
                        ? 'text-holo-glow'
                        : 'text-holo-glow/40',
                  )}
                  title={controlSummary(control)}
                >
                  {control.kind === 'hold'
                    ? `Suggested hold ${formatHold(control.minutes)}`
                    : control.kind === 'pace'
                      ? `Pacing ${formatHold(control.minutes)}`
                      : control.controllable
                        ? 'Monitor'
                        : 'No control'}
                </span>
              </div>
            ))}
          </div>
          {plan.totalHoldMinutes > 0 && (
            <div className="mt-1 border-t border-holo-glow/10 pt-1">
              <Row
                label="Total suggested hold this cycle"
                value={`${plan.totalHoldMinutes.toFixed(2)} min`}
                tone="teal"
              />
            </div>
          )}
        </div>

        <Projection
          label="Predicted after intervention"
          headways={plan.predictedControlled}
          tone="teal"
        />

        <div className="rounded border border-holo-glow/15 bg-void-900/50 p-2">
          <div className="hud-label mb-1 flex items-center gap-1">
            <ShieldCheck
              aria-hidden
              className={cn(
                'h-2.5 w-2.5',
                plan.safetyFloorRespected ? 'text-alert-green' : 'text-alert-amber',
              )}
            />
            Reason
          </div>
          <ul className="space-y-1">
            {plan.reasons.map((reason) => (
              <li
                key={reason}
                className="font-mono text-[9.5px] leading-relaxed text-holo-glow/70"
              >
                · {reason}
              </li>
            ))}
          </ul>
          <div className="mt-1.5 border-t border-holo-glow/10 pt-1">
            <Row
              label={`Safety floor (${MIN_SAFE_HEADWAY_MINUTES.toFixed(1)} min)`}
              value={plan.safetyFloorRespected ? 'Respected' : 'Adjusted'}
              tone={plan.safetyFloorRespected ? 'green' : 'amber'}
            />
          </div>
        </div>

        {iteration.dispatch && (
          <div className="rounded border border-holo-teal/25 bg-void-900/50 p-2">
            <div className="hud-label mb-1 text-holo-teal/80">
              Dynamic terminal dispatch — headway recovery mode
            </div>
            {iteration.dispatch.map((entry) => (
              <Row
                key={entry.bus}
                label={`Bus ${entry.bus} · scheduled ${entry.scheduled}`}
                value={`${entry.actual}${entry.offsetMinutes !== 0 ? ` (${entry.offsetMinutes > 0 ? '+' : '−'}${Math.abs(entry.offsetMinutes).toFixed(2)} min)` : ''}`}
                tone={entry.bus === 'A' ? 'amber' : 'teal'}
              />
            ))}
            <p className="mt-1 font-mono text-[9px] leading-relaxed text-holo-glow/50">
              Releasing Bus B on its scheduled departure would create a{' '}
              {scenario.initialHeadways[0].toFixed(1)}-minute initial headway. Departures are
              recomputed as a set so the corridor leaves correctly spaced.
            </p>
          </div>
        )}

        {scenario.id === 'passenger-surge' && (
          <div className="rounded border border-alert-amber/25 bg-alert-amber/[0.05] p-2">
            <div className="hud-label mb-1 flex items-center gap-1 text-alert-amber/80">
              <Users aria-hidden className="h-2.5 w-2.5" />
              Optional operational strategy
            </div>
            <p className="font-mono text-[9.5px] leading-relaxed text-alert-amber/75">
              If depot policy permits, boarding demand at the surge stop may be redistributed so the
              following bus absorbs part of the load. Offered for dispatcher consideration only —
              stop-skipping is not assumed to be permitted, and no instruction is issued.
            </p>
          </div>
        )}

        {iteration.incident.escalated && (
          <div className="rounded border border-alert-crimson/35 bg-alert-crimson/[0.07] p-2">
            <div className="hud-label mb-1 flex items-center gap-1 text-alert-crimson">
              <TriangleAlert aria-hidden className="h-2.5 w-2.5" />
              Incident recovery mode — recommended
            </div>
            <ul className="space-y-0.5 font-mono text-[9.5px] leading-relaxed text-alert-crimson/80">
              <li>
                · Bus A stationary for {iteration.incident.stalledIterations} consecutive control
                cycles.
              </li>
              <li>· Consider removing Bus A from active headway calculations.</li>
              <li>· Consider assigning Bus B as the effective lead bus and recomputing C and D.</li>
              <li>· Consider spare-bus insertion if one is operationally available.</li>
            </ul>
            <p className="mt-1 font-mono text-[9px] text-alert-crimson/60">
              Recommendations only. Nothing is dispatched from this simulator.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

function Projection({
  label,
  headways,
  tone,
}: {
  label: string;
  headways: readonly number[];
  tone: 'amber' | 'teal';
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-2 rounded border px-2 py-1.5',
        tone === 'amber'
          ? 'border-alert-amber/25 bg-alert-amber/[0.05]'
          : 'border-holo-teal/25 bg-holo-teal/[0.05]',
      )}
    >
      <span className="hud-label truncate">{label}</span>
      <span
        className={cn(
          'shrink-0 font-mono text-[11px] tabular-nums',
          tone === 'amber' ? 'text-alert-amber' : 'text-holo-teal',
        )}
      >
        {headways.map((value) => value.toFixed(1)).join(' / ')}
        <span className="ml-1 text-[9px] text-holo-glow/40">
          vs {TARGET_HEADWAY_MINUTES.toFixed(1)}
        </span>
      </span>
    </div>
  );
}

/** "02:00" for holds, "−00:45" for pacing advisories. */
function formatHold(minutes: number): string {
  const total = Math.round(Math.abs(minutes) * 60);
  const mm = String(Math.floor(total / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return `${minutes < 0 ? '−' : ''}${mm}:${ss}`;
}
