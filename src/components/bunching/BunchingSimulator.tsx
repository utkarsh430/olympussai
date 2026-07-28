'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { SimulationBanner } from '@/components/shared/hud';
import { FooterDisclaimer } from '@/components/shared/FooterDisclaimer';
import { TARGET_HEADWAY_MINUTES } from '@/lib/bunching/config';
import { DEFAULT_SCENARIO_ID, getScenario } from '@/lib/bunching/scenarios';
import { buildSimulation } from '@/lib/bunching/simulation';
import { SIMULATION_ROUTE_DESCRIPTION, SIMULATION_ROUTE_LABEL } from '@/lib/bunching/route';
import type { Policy, ScenarioId, SimulationIteration } from '@/lib/bunching/types';
import { CalculationPanel } from './CalculationPanel';
import { ComparisonSummary } from './ComparisonSummary';
import { RecoverySequence } from './RecoverySequence';
import { ScenarioExplanation } from './ScenarioExplanation';
import { ScenarioSelector } from './ScenarioSelector';
import { SimulationControls } from './SimulationControls';
import { SimulationPane } from './SimulationPane';
import { useSimulationPlayer } from './useSimulationPlayer';

/**
 * Bus Bunching Control Simulator.
 *
 * Two runs of the same corridor, from the same disturbed starting state, on the
 * same clock — one with no control intervention and one under coordinated
 * headway control. A single iteration index drives both, which is what makes
 * the comparison a controlled experiment rather than two animations.
 *
 * The runs are precomputed by `buildSimulation` and are entirely local: no
 * backend, no live GPS polling, no AI service, and no traffic-signal control of
 * any kind.
 */
export function BunchingSimulator() {
  const [scenarioId, setScenarioId] = useState<ScenarioId>(DEFAULT_SCENARIO_ID);
  const [mobileTab, setMobileTab] = useState<Policy>('withoutAI');
  const reduced = useReducedMotion();

  const scenario = useMemo(() => getScenario(scenarioId), [scenarioId]);
  const simulation = useMemo(() => buildSimulation(scenario), [scenario]);

  const total = scenario.iterations;
  const player = useSimulationPlayer(total, scenarioId);

  const withoutAI = simulation.withoutAI.iterations[player.index] as SimulationIteration;
  const withAI = simulation.withAI.iterations[player.index] as SimulationIteration;

  const showPrompt = player.index === 0 && !player.playing;

  return (
    <div className="flex min-h-dvh flex-col bg-void">
      <header className="sticky top-0 z-30 border-b border-holo-glow/20 bg-[rgb(5,11,23)]/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-[1800px] flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5 sm:px-5">
          <Link
            href="/project/upsrtc"
            className="inline-flex shrink-0 items-center gap-1.5 rounded border border-[#d6a13a]/40 bg-[#d6a13a]/[0.06] px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[#e8c477] transition-colors hover:border-[#d6a13a]/80 hover:bg-[#d6a13a]/15"
            data-testid="back-to-operations"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            Back to Operations
          </Link>

          <div className="min-w-0 flex-1">
            <h1 className="truncate font-display text-[15px] font-semibold uppercase tracking-[0.14em] text-holo-glow sm:text-[17px]">
              Bus Bunching Control Simulator
            </h1>
            <p className="truncate font-mono text-[9.5px] uppercase tracking-[0.1em] text-holo-glow/45">
              Real-time headway instability prediction and coordinated recovery simulation
            </p>
          </div>

          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span
              className="whitespace-nowrap rounded border border-holo-teal/45 bg-holo-teal/10 px-2 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.12em] text-holo-teal"
              title={SIMULATION_ROUTE_DESCRIPTION}
            >
              {SIMULATION_ROUTE_LABEL}
            </span>
            <span
              className="whitespace-nowrap rounded border border-holo-glow/30 bg-holo-glow/[0.07] px-2 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.12em] text-holo-glow/80"
              title="Simulation assumption for this demonstration, not a universal UPSRTC operating standard."
            >
              Target headway {TARGET_HEADWAY_MINUTES.toFixed(1)} min
            </span>
          </div>
        </div>
      </header>

      <SimulationBanner label="SIMULATED SCENARIO" />

      <main className="mx-auto w-full max-w-[1800px] flex-1 space-y-3 px-3 py-3 sm:px-5">
        <ScenarioSelector selected={scenarioId} onSelect={setScenarioId} />

        <section className="rounded-lg border border-holo-glow/20 bg-void-900/60 p-3">
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
            <div className="min-w-0 flex-1">
              <h2 className="font-display text-[14px] font-semibold uppercase tracking-[0.1em] text-holo-glow">
                <span className="mr-2 text-holo-glow/40">{scenario.number}</span>
                {scenario.title}
              </h2>
              <p className="mt-1 max-w-4xl font-mono text-[10px] leading-relaxed text-holo-glow/60">
                {scenario.description}
              </p>
            </div>

            {scenario.figures.length > 0 && (
              <dl className="flex min-w-0 flex-wrap gap-2">
                {scenario.figures.map((figure) => (
                  <div
                    key={figure.label}
                    className="min-w-0 rounded border border-holo-glow/15 bg-void/60 px-2.5 py-1.5"
                  >
                    <dt className="hud-label">{figure.label}</dt>
                    <dd className="whitespace-nowrap font-mono text-[11px] tabular-nums text-holo-glow">
                      {figure.expected && (
                        <span className="text-holo-glow/40 line-through">{figure.expected}</span>
                      )}
                      {figure.expected && <span className="mx-1 text-holo-glow/30">→</span>}
                      <span className={figure.expected ? 'text-alert-amber' : undefined}>
                        {figure.observed}
                      </span>
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </div>

          {showPrompt && (
            <p
              className="mt-2.5 flex items-start gap-1.5 rounded border border-holo-glow/25 bg-holo-glow/[0.05] px-2.5 py-1.5 font-mono text-[10px] leading-relaxed text-holo-glow/75"
              data-testid="bunching-prompt"
            >
              <Info aria-hidden className="mt-0.5 h-3 w-3 shrink-0" />
              Press Play to compare how the same disturbance evolves with and without coordinated
              control. Both simulations start from the same state and advance on the same clock.
            </p>
          )}
        </section>

        <SimulationControls player={player} total={total} />

        {/* Small screens get tabs rather than two unreadably narrow maps. */}
        <div className="flex gap-1.5 lg:hidden" role="tablist" aria-label="Simulation view">
          {(['withoutAI', 'withAI'] as const).map((policy) => (
            <button
              key={policy}
              type="button"
              role="tab"
              aria-selected={mobileTab === policy}
              onClick={() => setMobileTab(policy)}
              className={cn(
                'flex-1 rounded border px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] transition-colors',
                mobileTab === policy
                  ? policy === 'withAI'
                    ? 'border-holo-teal/60 bg-holo-teal/15 text-holo-teal'
                    : 'border-alert-crimson/60 bg-alert-crimson/15 text-alert-crimson'
                  : 'border-holo-glow/20 bg-void-900/50 text-holo-glow/50',
              )}
            >
              {policy === 'withAI' ? 'With AI' : 'Without AI'}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <SimulationPane
            policy="withoutAI"
            iteration={withoutAI}
            scenario={scenario}
            reduced={reduced}
            hidden={mobileTab !== 'withoutAI'}
          />
          <SimulationPane
            policy="withAI"
            iteration={withAI}
            scenario={scenario}
            reduced={reduced}
            hidden={mobileTab !== 'withAI'}
          />
        </div>

        <ComparisonSummary
          withoutAI={withoutAI}
          withAI={withAI}
          isFinal={player.atEnd}
        />

        <RecoverySequence run={simulation.withAI} currentIndex={player.index} />

        <CalculationPanel withoutAI={withoutAI} withAI={withAI} />

        <ScenarioExplanation scenario={scenario} />
      </main>

      <FooterDisclaimer />
    </div>
  );
}
