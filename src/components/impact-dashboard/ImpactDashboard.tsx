'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useEffect } from 'react';
import { X, TrendingDown, TrendingUp, Info } from 'lucide-react';
import { useCopilotStore } from '@/stores/copilotStore';
import { CountUp } from '@/components/shared/hud';
import {
  FUTURE_IMPACT_KPIS,
  IMPACT_DISCLAIMER,
  IMPACT_LABEL,
  IMPACT_NARRATIVES,
} from '@/lib/demo-scenarios/impactScenario';
import { cn } from '@/lib/utils';

/** Projected operational impact — modelled estimates, not measured results. */
export function ImpactDashboard() {
  const isOpen = useCopilotStore((state) => state.isImpactOpen);
  const toggleImpact = useCopilotStore((state) => state.toggleImpact);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') toggleImpact(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, toggleImpact]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[90] flex items-center justify-center bg-void/90 backdrop-blur-md"
          role="dialog"
          aria-modal="true"
          aria-label="Illustrative future impact dashboard"
          data-testid="impact-dashboard"
        >
          <div aria-hidden className="pointer-events-none absolute inset-0 bg-hud-grid bg-hud-grid opacity-40" />

          <motion.div
            initial={{ scale: 0.96, y: 18 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.96, y: 18 }}
            className="hud-panel-strong hud-corners relative max-h-[90vh] w-[1120px] max-w-[94vw] overflow-hidden"
          >
            <header className="flex items-center justify-between border-b border-holo-glow/20 px-6 py-4">
              <div>
                <div className="mb-1.5 flex items-center gap-2">
                  <span className="rounded border border-holo-teal/45 bg-holo-teal/10 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-holo-teal">
                    {IMPACT_LABEL}
                  </span>
                </div>
                <h2 className="text-lg font-bold tracking-[0.1em] text-holo-glow text-glow">
                  Projected Operational Impact
                </h2>
                <p className="font-mono text-[10px] text-holo-glow/45">
                  Olympuss AI — projected operational outcomes
                </p>
              </div>

              <button
                type="button"
                onClick={() => toggleImpact(false)}
                className="hud-button px-2 py-1"
                aria-label="Close impact dashboard"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </header>

            <div className="max-h-[calc(90vh-150px)] overflow-y-auto p-6">
              {/* KPI grid */}
              <div className="grid grid-cols-4 gap-3">
                {FUTURE_IMPACT_KPIS.map((kpi, index) => {
                  const isImprovementDown = kpi.direction === 'reduction';
                  const Icon = isImprovementDown ? TrendingDown : TrendingUp;

                  return (
                    <motion.div
                      key={kpi.id}
                      initial={{ opacity: 0, y: 16 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.06 }}
                      className="hud-panel hud-corners group relative overflow-hidden p-4"
                    >
                      <div
                        aria-hidden
                        className={cn(
                          'absolute inset-x-0 top-0 h-0.5',
                          isImprovementDown ? 'bg-alert-green/60' : 'bg-holo-glow/60',
                        )}
                      />

                      <div className="mb-2 flex items-start justify-between">
                        <span className="hud-label leading-tight">{kpi.label}</span>
                        <Icon
                          className={cn(
                            'h-3.5 w-3.5 shrink-0',
                            isImprovementDown ? 'text-alert-green' : 'text-holo-glow',
                          )}
                          aria-hidden
                        />
                      </div>

                      <div
                        className={cn(
                          'font-mono text-3xl font-bold tabular-nums',
                          isImprovementDown ? 'text-alert-green' : 'text-holo-glow',
                        )}
                      >
                        <CountUp
                          value={kpi.changePercent}
                          prefix={kpi.changePercent > 0 ? '+' : ''}
                          suffix="%"
                        />
                      </div>

                      <div className="mt-2 flex items-center gap-1.5 border-t border-holo-glow/10 pt-2">
                        <span className="font-mono text-[10px] text-holo-glow/35 line-through">
                          {kpi.baseline}
                        </span>
                        <span className="text-holo-glow/25">→</span>
                        <span className="font-mono text-[10px] text-holo-teal">{kpi.projected}</span>
                      </div>

                      {/* Screen-reader + hover description */}
                      <p className="sr-only">{kpi.description}</p>
                      <div className="pointer-events-none absolute inset-x-0 bottom-0 translate-y-full bg-void-900/95 p-2.5 font-mono text-[9px] leading-relaxed text-holo-glow/70 transition-transform duration-200 group-hover:translate-y-0">
                        {kpi.description}
                      </div>
                    </motion.div>
                  );
                })}
              </div>

              {/* Narratives */}
              <div className="mt-5 grid grid-cols-3 gap-3">
                {IMPACT_NARRATIVES.map((narrative, index) => (
                  <motion.div
                    key={narrative.headline}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.4 + index * 0.08 }}
                    className="rounded border border-holo-glow/15 bg-void-900/50 p-4"
                  >
                    <h3 className="mb-1.5 font-mono text-[11px] uppercase tracking-wider text-holo-teal">
                      {narrative.headline}
                    </h3>
                    <p className="font-mono text-[10px] leading-relaxed text-holo-glow/60">
                      {narrative.body}
                    </p>
                  </motion.div>
                ))}
              </div>
            </div>

            <footer className="flex items-start gap-2 border-t border-holo-glow/15 bg-void-900/60 px-6 py-3">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-holo-teal" aria-hidden />
              <p className="font-mono text-[10px] leading-relaxed text-holo-glow/65">
                {IMPACT_DISCLAIMER}
              </p>
            </footer>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
