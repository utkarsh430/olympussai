'use client';

import { useEffect, useState, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Mic, MicOff, Volume2, VolumeX, PhoneOff, PhoneCall, FileText } from 'lucide-react';
import { useCopilotStore, useSelectedBus } from '@/stores/copilotStore';
import { Badge, Waveform } from '@/components/shared/hud';
import { buildCommunicationScenario } from '@/lib/demo-scenarios/communicationScenario';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { cn } from '@/lib/utils';

type CallPhase = 'connecting' | 'active' | 'ended';

/**
 * Control-room voice interface.
 * No external VoIP provider is contacted. No microphone is accessed.
 * No audio is captured, transmitted or played.
 */
export function VoipCallOverlay() {
  const isActive = useCopilotStore((state) => state.isCallActive);
  const setCallActive = useCopilotStore((state) => state.setCallActive);
  const scenario = useCopilotStore((state) => state.activeScenario);
  const overrides = useCopilotStore((state) => state.overrides);
  const logAudit = useCopilotStore((state) => state.logAudit);
  const bus = useSelectedBus();
  const reduced = useReducedMotion();

  const [phase, setPhase] = useState<CallPhase>('connecting');
  const [seconds, setSeconds] = useState(0);
  const [muted, setMuted] = useState(false);
  const [speaker, setSpeaker] = useState(true);
  const loggedStart = useRef(false);

  const plan =
    bus &&
    buildCommunicationScenario(
      { bus, schedule: null, overrides },
      {
        scenarioKind: scenario?.kind ?? 'communication',
        scenarioLabel: scenario?.simulationLabel ?? 'DRIVER COMMUNICATION',
        suggestedAction:
          scenario?.recommendation ?? 'Confirm current status and await control-room instruction.',
        englishMessage: scenario?.suggestedDriverMessageEn ?? '',
        hindiMessage: scenario?.suggestedDriverMessageHi ?? '',
      },
    );

  // Connect → active transition.
  useEffect(() => {
    if (!isActive || !bus) return;

    setPhase('connecting');
    setSeconds(0);
    setMuted(false);
    setSpeaker(true);

    if (!loggedStart.current) {
      loggedStart.current = true;
      logAudit('call-started', `Voice call opened to ${bus.registrationNumber}`, {
        registrationNumber: bus.registrationNumber,
      });
    }

    const connectTimer = setTimeout(() => setPhase('active'), 2200);
    return () => clearTimeout(connectTimer);
  }, [isActive, bus, logAudit]);

  // Call timer.
  useEffect(() => {
    if (phase !== 'active') return;
    const timer = setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [phase]);

  function endCall() {
    if (bus) {
      logAudit('call-ended', `Voice call ended with ${bus.registrationNumber}`, {
        registrationNumber: bus.registrationNumber,
        detail: `Duration ${formatDuration(seconds)}`,
      });
    }
    setPhase('ended');
    loggedStart.current = false;
    setTimeout(() => setCallActive(false), 2600);
  }

  useEffect(() => {
    if (!isActive) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') endCall();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, seconds]);

  if (!bus || !plan) return null;

  return (
    <AnimatePresence>
      {isActive && (
        <motion.div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-void/88 backdrop-blur-md"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          role="dialog"
          aria-modal="true"
          aria-label="Control-room call"
        >
          <motion.div
            initial={{ scale: 0.94 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0.94 }}
            className="hud-panel-strong hud-corners w-[680px] max-w-[92vw] overflow-hidden"
            data-testid="voip-overlay"
          >
            <div className="flex items-center justify-center gap-2 border-b border-alert-amber/35 bg-alert-amber/12 py-2">
              <span className="font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-alert-amber">
                {plan.call.demoBanner}
              </span>
            </div>

            <div className="p-6">
              <div className="flex items-start gap-6">
                {/* Circular voice visualiser */}
                <div className="relative flex h-40 w-40 shrink-0 items-center justify-center">
                  {!reduced &&
                    phase === 'active' &&
                    [0, 0.8, 1.6].map((delay) => (
                      <span
                        key={delay}
                        className="absolute inset-6 animate-pulse-ring rounded-full border border-holo-glow/50"
                        style={{ animationDelay: `${delay}s` }}
                        aria-hidden
                      />
                    ))}

                  <motion.div
                    className="absolute inset-4 rounded-full border border-dashed border-holo-glow/35"
                    animate={reduced ? {} : { rotate: 360 }}
                    transition={{ duration: 16, repeat: Infinity, ease: 'linear' }}
                  />

                  <div
                    className={cn(
                      'absolute inset-10 rounded-full',
                      phase === 'ended' ? 'bg-alert-crimson/25' : 'bg-holo-glow/20',
                    )}
                    style={{
                      boxShadow:
                        phase === 'ended'
                          ? '0 0 40px -6px hsl(var(--instrument-danger) / calc(0.7 * var(--hud-bloom)))'
                          : '0 0 40px -6px hsl(var(--primary) / calc(0.7 * var(--hud-bloom)))',
                    }}
                  />

                  <PhoneCall
                    className={cn(
                      'relative h-8 w-8',
                      phase === 'ended' ? 'text-alert-crimson' : 'text-holo-glow',
                      phase === 'connecting' && 'animate-flicker',
                    )}
                    aria-hidden
                  />
                </div>

                {/* Call detail */}
                <div className="min-w-0 flex-1">
                  <div className="mb-2 flex items-center gap-2">
                    <Badge variant="live">LIVE VEHICLE</Badge>
                  </div>

                  <h2 className="font-mono text-xl font-bold tracking-[0.1em] text-holo-glow text-glow">
                    {bus.registrationNumber}
                  </h2>
                  <p className="font-mono text-[11px] text-holo-glow/50">
                    {plan.call.driverPlaceholder}
                  </p>

                  <div className="mt-3 flex items-center gap-3">
                    <span
                      className={cn(
                        'font-mono text-[11px] uppercase tracking-[0.16em]',
                        phase === 'connecting'
                          ? 'animate-flicker text-alert-amber'
                          : phase === 'active'
                            ? 'text-alert-green'
                            : 'text-alert-crimson',
                      )}
                      data-testid="call-status"
                    >
                      {phase === 'connecting'
                        ? 'Connecting…'
                        : phase === 'active'
                          ? 'Connected (simulated)'
                          : 'Call ended'}
                    </span>
                    <span className="font-mono text-lg tabular-nums text-holo-glow">
                      {formatDuration(seconds)}
                    </span>
                  </div>

                  <Waveform
                    bars={40}
                    active={phase === 'active' && !muted}
                    className="mt-3 h-10"
                    color={phase === 'ended' ? 'hsl(var(--instrument-danger))' : 'hsl(var(--instrument-info))'}
                  />
                </div>
              </div>

              {/* Incident context */}
              <div className="mt-5 rounded border border-holo-glow/15 bg-void-900/60 p-3">
                <span className="hud-label mb-1 block">Current incident context</span>
                <p className="font-mono text-[11px] leading-relaxed text-holo-teal">
                  {plan.call.incidentSummary}
                </p>
              </div>

              {/* Speaking points */}
              <div className="mt-3 rounded border border-holo-glow/15 bg-void-900/60 p-3">
                <span className="hud-label mb-2 block">Suggested speaking points</span>
                <ol className="space-y-1.5">
                  {plan.call.speakingPoints.map((point, index) => (
                    <li key={point} className="flex gap-2.5">
                      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-holo-glow/35 font-mono text-[9px] text-holo-glow">
                        {index + 1}
                      </span>
                      <span className="font-mono text-[10px] leading-relaxed text-holo-glow/70">
                        {point}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>

              {/* AI call summary appears once ended */}
              <AnimatePresence>
                {phase === 'ended' && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    className="mt-3 overflow-hidden rounded border border-holo-teal/30 bg-holo-teal/[0.07] p-3"
                  >
                    <span className="hud-label mb-1 flex items-center gap-1.5 text-holo-teal/70">
                      <FileText className="h-3 w-3" aria-hidden />
                      AI-generated call summary
                    </span>
                    <p className="font-mono text-[10px] leading-relaxed text-holo-teal">
                      {plan.call.callSummaryTemplate.replace('{reg}', bus.registrationNumber)}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Controls */}
            <footer className="flex items-center justify-center gap-3 border-t border-holo-glow/15 px-4 py-4">
              <ControlButton
                active={!muted}
                onClick={() => setMuted((value) => !value)}
                icon={muted ? MicOff : Mic}
                label={muted ? 'Unmute' : 'Mute'}
                disabled={phase !== 'active'}
              />
              <ControlButton
                active={speaker}
                onClick={() => setSpeaker((value) => !value)}
                icon={speaker ? Volume2 : VolumeX}
                label={speaker ? 'Speaker on' : 'Speaker off'}
                disabled={phase !== 'active'}
              />
              <button
                type="button"
                onClick={endCall}
                disabled={phase === 'ended'}
                className="hud-button-danger px-5 py-2.5"
                data-testid="end-call"
              >
                <PhoneOff className="h-4 w-4" aria-hidden />
                End Call
              </button>
            </footer>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ControlButton({
  active,
  onClick,
  icon: Icon,
  label,
  disabled,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Mic;
  label: string;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        'flex h-11 w-11 items-center justify-center rounded-full border transition disabled:opacity-35',
        active
          ? 'border-holo-glow/60 bg-holo-glow/15 text-holo-glow'
          : 'border-holo-glow/25 bg-void-900/60 text-holo-glow/45',
      )}
    >
      <Icon className="h-4 w-4" aria-hidden />
    </button>
  );
}

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
