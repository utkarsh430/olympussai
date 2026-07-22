'use client';

import { lazy, Suspense } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { useCopilotStore } from '@/stores/copilotStore';
import type { BunchingScenario } from '@/lib/demo-scenarios/bunchingScenario';
import type { TrafficScenario } from '@/lib/demo-scenarios/trafficScenario';
import type { BreakdownScenario } from '@/lib/demo-scenarios/breakdownScenario';
import type { DemandScenario } from '@/lib/demo-scenarios/demandScenario';

// Scenario bodies are heavy (Recharts) — load them only when demonstrated.
const BunchingStage = lazy(() =>
  import('./bunching/BunchingStage').then((m) => ({ default: m.BunchingStage })),
);
const TrafficStage = lazy(() =>
  import('./traffic/TrafficStage').then((m) => ({ default: m.TrafficStage })),
);
const BreakdownStage = lazy(() =>
  import('./breakdown/BreakdownStage').then((m) => ({ default: m.BreakdownStage })),
);
const DemandStage = lazy(() =>
  import('./demand/DemandStage').then((m) => ({ default: m.DemandStage })),
);

export function ScenarioStage() {
  const scenario = useCopilotStore((state) => state.activeScenario);
  const setScenario = useCopilotStore((state) => state.setScenario);
  const logAudit = useCopilotStore((state) => state.logAudit);

  function close() {
    if (scenario) {
      logAudit('scenario-completed', `${scenario.simulationLabel} closed`);
    }
    setScenario(null, null);
  }

  return (
    // mode="wait" so switching scenarios fully retires the outgoing panel
    // before the next one mounts — otherwise the two stack in the same slot.
    <AnimatePresence mode="wait">
      {scenario && (
        <motion.section
          key={scenario.seed}
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 18 }}
          transition={{ type: 'spring', stiffness: 240, damping: 28 }}
          className="hud-panel-strong hud-corners absolute right-3 top-3 z-40 flex max-h-[calc(100%-24px)] w-[470px] flex-col overflow-hidden"
          role="region"
          aria-label={`${scenario.simulationLabel} for the selected service`}
          data-testid="scenario-stage"
        >
          <header className="flex shrink-0 items-center justify-between border-b border-holo-glow/15 px-4 py-2.5">
            <div className="flex items-center gap-2">
              <h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-holo-glow">
                {scenario.simulationLabel}
              </h2>
              <span className="rounded border border-holo-teal/40 bg-holo-teal/10 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.14em] text-holo-teal">
                Predictive
              </span>
            </div>
            <button
              type="button"
              onClick={close}
              className="hud-button px-2 py-1"
              aria-label="Close analysis"
              data-testid="close-scenario"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <Suspense fallback={<StageSkeleton />}>
              {scenario.kind === 'bunching' && (
                <BunchingStage scenario={scenario as BunchingScenario} />
              )}
              {scenario.kind === 'traffic' && <TrafficStage scenario={scenario as TrafficScenario} />}
              {scenario.kind === 'breakdown' && (
                <BreakdownStage scenario={scenario as BreakdownScenario} />
              )}
              {scenario.kind === 'demand' && <DemandStage scenario={scenario as DemandScenario} />}
            </Suspense>
          </div>
        </motion.section>
      )}
    </AnimatePresence>
  );
}

function StageSkeleton() {
  return (
    <div className="space-y-3" aria-label="Loading scenario">
      {[64, 120, 96, 140].map((height, index) => (
        <div
          key={index}
          className="animate-pulse rounded bg-holo-glow/[0.05]"
          style={{ height }}
        />
      ))}
    </div>
  );
}
