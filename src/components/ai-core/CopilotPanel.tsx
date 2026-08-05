'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Pencil, X, Eye, Send, PhoneCall, Radio, Bot } from 'lucide-react';
import { useCopilotStore, useSelectedBus } from '@/stores/copilotStore';
import { IntelligenceCore } from './IntelligenceCore';
import { ConfidenceRing, Typewriter, Waveform, Readout } from '@/components/shared/hud';
import { AI_AMBIENT_LINES } from '@/lib/constants';
import { SCENARIO_FULL_LABELS } from '@/lib/simulation/scenarioEngine';
import { cn } from '@/lib/utils';

const SEVERITY_STYLES = {
  info: { text: 'text-holo-glow', border: 'border-holo-glow/30', bg: 'bg-holo-glow/5' },
  advisory: { text: 'text-holo-teal', border: 'border-holo-teal/30', bg: 'bg-holo-teal/5' },
  warning: { text: 'text-alert-amber', border: 'border-alert-amber/40', bg: 'bg-alert-amber/5' },
  critical: { text: 'text-alert-crimson', border: 'border-alert-crimson/50', bg: 'bg-alert-crimson/8' },
} as const;

export function CopilotPanel() {
  const aiState = useCopilotStore((state) => state.aiState);
  const aiLine = useCopilotStore((state) => state.aiLine);
  const setAi = useCopilotStore((state) => state.setAi);
  const scenario = useCopilotStore((state) => state.activeScenario);
  const setMessageModalOpen = useCopilotStore((state) => state.setMessageModalOpen);
  const setCallActive = useCopilotStore((state) => state.setCallActive);
  const setCommunicationState = useCopilotStore((state) => state.setCommunicationState);
  const logAudit = useCopilotStore((state) => state.logAudit);
  const selectedBus = useSelectedBus();

  const [ambientIndex, setAmbientIndex] = useState(0);
  const [decision, setDecision] = useState<string | null>(null);

  // Ambient copilot chatter when no scenario is running. Local templates only.
  useEffect(() => {
    if (scenario) return;
    const timer = setInterval(() => {
      setAmbientIndex((index) => (index + 1) % AI_AMBIENT_LINES.length);
    }, 6500);
    return () => clearInterval(timer);
  }, [scenario]);

  useEffect(() => {
    if (scenario) return;
    setAi('Listening', AI_AMBIENT_LINES[ambientIndex]);
  }, [ambientIndex, scenario, setAi]);

  useEffect(() => {
    setDecision(null);
  }, [scenario?.seed]);

  const severity = scenario ? SEVERITY_STYLES[scenario.severity] : SEVERITY_STYLES.info;

  function handleDecision(kind: string, label: string) {
    if (!scenario || !selectedBus) return;
    setDecision(kind);

    if (kind === 'accept') {
      setCommunicationState('approved');
      setAi('Awaiting Authorization', 'Recommendation approved. Communication channel prepared.');
      logAudit('suggestion-approved', `Dispatcher approved: ${scenario.recommendation}`, {
        registrationNumber: selectedBus.registrationNumber,
      });
    } else if (kind === 'reject') {
      setAi('Monitoring', 'Recommendation rejected. Continuing passive monitoring.');
      logAudit('suggestion-rejected', `Dispatcher rejected: ${scenario.headline}`, {
        registrationNumber: selectedBus.registrationNumber,
      });
    } else if (kind === 'modify') {
      setAi('Analysing', 'Adjusting intervention parameters. Open Scenario Lab to tune values.');
      logAudit('suggestion-modified', `Dispatcher requested modification: ${label}`, {
        registrationNumber: selectedBus.registrationNumber,
      });
    } else if (kind === 'monitor') {
      setAi('Monitoring', 'Monitoring only. No instruction will be transmitted.');
      logAudit('suggestion-modified', `Dispatcher selected monitor-only for ${scenario.headline}`, {
        registrationNumber: selectedBus.registrationNumber,
      });
    } else if (kind === 'message') {
      setMessageModalOpen(true);
      setCommunicationState('message-prepared');
    } else if (kind === 'call') {
      setCallActive(true);
    }
  }

  return (
    <aside
      className="hud-panel hud-corners relative z-20 flex w-[344px] shrink-0 flex-col overflow-hidden"
      aria-label="AI copilot panel"
    >
      {/* Core header */}
      <header className="shrink-0 border-b border-holo-glow/15 px-4 py-3">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-holo-glow">
            <Bot className="h-3.5 w-3.5" aria-hidden />
            Olympuss Copilot
          </h2>
          <span className="rounded border border-holo-teal/45 bg-holo-teal/10 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-holo-teal">
            Predictive
          </span>
        </div>

        <div className="flex items-center gap-4">
          <IntelligenceCore state={aiState} size={104} />

          <div className="min-w-0 flex-1">
            <div className="mb-1.5 flex items-center gap-2">
              <Radio className="h-3 w-3 animate-flicker text-holo-teal" aria-hidden />
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-holo-teal">
                {aiState}
              </span>
            </div>

            <Waveform bars={22} active={aiState !== 'Monitoring'} className="mb-2 h-6" />

            <Typewriter
              key={aiLine}
              text={aiLine}
              className="font-mono text-[11px] leading-relaxed text-holo-glow/75"
            />
          </div>
        </div>
      </header>

      {/* Scenario body */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <AnimatePresence mode="wait">
          {!scenario ? (
            <motion.div
              key="idle"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex h-full flex-col px-4 py-4"
            >
              <div className="mb-3 h-px w-full bg-gradient-to-r from-transparent via-holo-glow/35 to-transparent" />

              <p className="mb-4 text-center font-mono text-[11px] leading-relaxed text-holo-glow/50">
                {selectedBus
                  ? `Live telemetry synchronised for ${selectedBus.registrationNumber}. Open an analysis from the vehicle panel, or act on an alert from the Alert Centre.`
                  : 'Select a vehicle from the fleet panel or the map, or open an alert from the Alert Centre, to begin.'}
              </p>

              {/* Standing readiness readout — keeps the panel informative while idle. */}
              <div className="mb-3">
                <p className="hud-label mb-1.5">Monitoring Channels</p>
                <div className="space-y-1">
                  <Channel label="Fleet telemetry ingest" status="live" detail="15s polling" />
                  <Channel label="Schedule retrieval" status="live" detail="on selection" />
                  <Channel label="Bunching analysis" status="model" detail="predictive" />
                  <Channel label="Corridor traffic model" status="model" detail="predictive" />
                  <Channel label="Vehicle health monitor" status="model" detail="predictive" />
                  <Channel label="Demand forecasting" status="model" detail="predictive" />
                  <Channel label="Driver communications" status="model" detail="predictive" />
                </div>
              </div>

              <div className="mt-auto rounded border border-holo-glow/15 bg-void-900/50 p-3">
                <p className="hud-label mb-1.5">Operating Principle</p>
                <p className="font-mono text-[10px] leading-relaxed text-holo-glow/55">
                  The copilot observes, predicts and recommends. It never executes. Every
                  intervention requires explicit authorization from a qualified dispatcher.
                </p>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key={scenario.seed}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3 }}
              className="p-4"
            >
              {/* Scenario headline */}
              <div className={cn('mb-3 rounded border p-3', severity.border, severity.bg)}>
                <div className="mb-2 flex items-start justify-between gap-2">
                  <span
                    className={cn(
                      'rounded border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em]',
                      severity.border,
                      severity.text,
                    )}
                  >
                    {scenario.simulationLabel}
                  </span>
                  <ConfidenceRing percent={scenario.confidencePercent} size={62} />
                </div>

                <h3 className={cn('mb-1 text-[13px] font-semibold leading-snug', severity.text)}>
                  {scenario.headline}
                </h3>

                {/* Severity communicated as text, not colour alone. */}
                <p className={cn('font-mono text-[10px] uppercase tracking-wider', severity.text)}>
                  {scenario.severityText}
                </p>
              </div>

              <Section title="AI Observation">
                <Typewriter
                  key={`obs-${scenario.seed}`}
                  text={scenario.observation}
                  speed={11}
                  className="font-mono text-[11px] leading-relaxed text-holo-glow/75"
                />
              </Section>

              <Section title="Recommended Action">
                <p className="font-mono text-[11px] leading-relaxed text-holo-teal">
                  {scenario.recommendation}
                </p>
              </Section>

              <Section title="Expected Outcome">
                <p className="font-mono text-[11px] leading-relaxed text-holo-glow/70">
                  {scenario.expectedOutcome}
                </p>
              </Section>

              <Section title="Affected Buses">
                <div className="flex flex-wrap gap-1.5">
                  {scenario.affectedBuses.map((bus) => {
                    const isReal = bus === selectedBus?.registrationNumber;
                    return (
                      <span
                        key={bus}
                        className={cn(
                          'rounded border px-1.5 py-0.5 font-mono text-[9px] tracking-wider',
                          isReal
                            ? 'border-alert-green/50 bg-alert-green/10 text-alert-green'
                            : 'border-alert-amber/40 bg-alert-amber/10 text-alert-amber',
                        )}
                      >
                        {bus}
                        {isReal ? ' · LIVE' : ''}
                      </span>
                    );
                  })}
                </div>
              </Section>

              <Section title="Suggested Driver Message">
                <div className="rounded border border-holo-glow/15 bg-void-900/60 p-2.5">
                  <p className="mb-2 font-mono text-[10px] leading-relaxed text-holo-glow/70">
                    {scenario.suggestedDriverMessageEn}
                  </p>
                  <p className="border-t border-holo-glow/10 pt-2 font-mono text-[10px] leading-relaxed text-holo-glow/55">
                    {scenario.suggestedDriverMessageHi}
                  </p>
                </div>
              </Section>

              {/* Dispatcher controls */}
              <div className="mt-4 border-t border-holo-glow/12 pt-3">
                <p className="hud-label mb-2">Dispatcher Controls</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {scenario.actions.map((action) => {
                    const Icon =
                      action.kind === 'accept'
                        ? Check
                        : action.kind === 'modify'
                          ? Pencil
                          : action.kind === 'reject'
                            ? X
                            : action.kind === 'monitor'
                              ? Eye
                              : action.kind === 'call'
                                ? PhoneCall
                                : Send;

                    const isActive = decision === action.kind;

                    return (
                      <button
                        key={action.id}
                        type="button"
                        onClick={() => handleDecision(action.kind, action.label)}
                        data-testid={`copilot-action-${action.kind}`}
                        className={cn(
                          action.kind === 'accept'
                            ? 'hud-button-primary'
                            : action.kind === 'reject'
                              ? 'hud-button-danger'
                              : 'hud-button',
                          'justify-start px-2 text-[9px]',
                          isActive && 'ring-1 ring-holo-glow',
                        )}
                      >
                        <Icon className="h-3 w-3 shrink-0" aria-hidden />
                        <span className="truncate">{action.label}</span>
                      </button>
                    );
                  })}

                  <button
                    type="button"
                    onClick={() => handleDecision('call', 'Start VoIP Call')}
                    className="hud-button col-span-2 justify-start px-2 text-[9px]"
                    data-testid="copilot-action-voip"
                  >
                    <PhoneCall className="h-3 w-3 shrink-0" aria-hidden />
                    Start Voice Call
                  </button>
                </div>

                <p className="mt-2.5 rounded border border-holo-glow/15 bg-void-900/50 px-2 py-1.5 font-mono text-[9px] leading-relaxed text-holo-glow/55">
                  {SCENARIO_FULL_LABELS[scenario.kind]} — no operational instruction is executed
                  automatically. Authorized dispatcher approval is required.
                </p>
              </div>

              {/* Impact preview */}
              {scenario.impact.length > 0 && (
                <div className="mt-3 border-t border-holo-glow/12 pt-3">
                  <p className="hud-label mb-2">Projected Impact</p>
                  <div className="space-y-1.5">
                    {scenario.impact.map((metric) => (
                      <div
                        key={metric.label}
                        className="flex items-center justify-between gap-2 rounded border border-holo-glow/12 bg-void-900/50 px-2 py-1.5"
                      >
                        <span className="truncate font-mono text-[9px] text-holo-glow/55">
                          {metric.label}
                        </span>
                        <span className="flex shrink-0 items-center gap-1.5 font-mono text-[10px]">
                          <span className="text-holo-glow/40 line-through">{metric.before}</span>
                          <span className="text-holo-glow/30">→</span>
                          <span
                            className={
                              decision === 'accept' ? 'text-alert-green' : 'text-holo-teal'
                            }
                          >
                            {metric.after}
                          </span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {selectedBus && (
        <footer className="shrink-0 border-t border-holo-glow/15 px-4 py-2">
          <div className="grid grid-cols-2 gap-2">
            <Readout label="Anchored Live Bus" value={selectedBus.registrationNumber} />
            <Readout label="Depot" value={selectedBus.depotName ?? '—'} />
          </div>
        </footer>
      )}
    </aside>
  );
}

/** Idle readiness row distinguishing live ingest from model-derived capability. */
function Channel({
  label,
  status,
  detail,
}: {
  label: string;
  status: 'live' | 'model';
  detail: string;
}) {
  const isLive = status === 'live';
  return (
    <div className="flex items-center gap-2 rounded border border-holo-glow/10 bg-void-900/40 px-2 py-1">
      <span
        className={cn(
          'h-1.5 w-1.5 shrink-0 rounded-full',
          isLive ? 'animate-flicker bg-alert-green' : 'bg-alert-amber',
        )}
        aria-hidden
      />
      <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-holo-glow/65">
        {label}
      </span>
      <span
        className={cn(
          'shrink-0 font-mono text-[8px] uppercase tracking-wider',
          isLive ? 'text-alert-green/70' : 'text-alert-amber/70',
        )}
      >
        {detail}
      </span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <p className="hud-label mb-1">{title}</p>
      {children}
    </div>
  );
}
