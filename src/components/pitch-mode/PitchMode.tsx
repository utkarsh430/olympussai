'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Play, Pause, SkipBack, SkipForward, X } from 'lucide-react';
import { useCopilotStore } from '@/stores/copilotStore';
import { buildScenario } from '@/lib/simulation/scenarioEngine';
import { PITCH_STEPS, TOTAL_PITCH_MS } from './pitchScript';
import { Badge } from '@/components/shared/hud';

/**
 * DIRECTOR PITCH MODE — automated cinematic walkthrough.
 * Never autoplays sound.
 */
export function PitchMode() {
  const isPitchMode = useCopilotStore((state) => state.isPitchMode);
  const setPitchMode = useCopilotStore((state) => state.setPitchMode);
  const pitchStep = useCopilotStore((state) => state.pitchStep);
  const setPitchStep = useCopilotStore((state) => state.setPitchStep);

  const buses = useCopilotStore((state) => state.buses);
  const selectBus = useCopilotStore((state) => state.selectBus);
  const schedule = useCopilotStore((state) => state.schedule);
  const setScenario = useCopilotStore((state) => state.setScenario);
  const setMessageModalOpen = useCopilotStore((state) => state.setMessageModalOpen);
  const setCallActive = useCopilotStore((state) => state.setCallActive);
  const toggleImpact = useCopilotStore((state) => state.toggleImpact);
  const setAi = useCopilotStore((state) => state.setAi);
  const overrides = useCopilotStore((state) => state.overrides);

  const [isPaused, setIsPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const stepStarted = useRef<number>(0);
  const pausedAt = useRef<number>(0);
  const anchorBusId = useRef<string | null>(null);

  const step = PITCH_STEPS[pitchStep];

  /** Pick a well-populated bus so the demo always has good data. */
  const pickAnchorBus = useCallback(() => {
    if (anchorBusId.current) return anchorBusId.current;
    const candidate =
      buses.find((bus) => bus.routeName && bus.depotName && bus.dataQuality === 'good') ??
      buses.find((bus) => bus.routeName) ??
      buses[0];
    anchorBusId.current = candidate?.id ?? null;
    return anchorBusId.current;
  }, [buses]);

  // Apply the side effect for the current step.
  useEffect(() => {
    if (!isPitchMode || !step) return;

    const busId = anchorBusId.current;
    const bus = busId ? buses.find((b) => b.id === busId) : null;

    switch (step.action.type) {
      case 'select-bus': {
        const picked = pickAnchorBus();
        if (picked) selectBus(picked);
        setAi('Analysing', 'Live service selected. Retrieving UPSRTC schedule.');
        break;
      }
      case 'open-schedule':
        setAi('Analysing', 'Live UPSRTC schedule retrieved for the selected service.');
        break;
      case 'scenario': {
        setMessageModalOpen(false);
        setCallActive(false);
        toggleImpact(false);
        if (bus) {
          const kind = step.action.kind;
          const scenario = buildScenario(kind, { bus, schedule, overrides });
          setScenario(kind, scenario);
          setAi('Recommendation Ready', 'Simulation engine has generated an intervention scenario.');
        }
        break;
      }
      case 'message':
        setMessageModalOpen(true);
        setAi('Awaiting Authorization', 'Communication channel prepared.');
        break;
      case 'call':
        setMessageModalOpen(false);
        setCallActive(true);
        break;
      case 'impact':
        setMessageModalOpen(false);
        setCallActive(false);
        setScenario(null, null);
        toggleImpact(true);
        setAi('Monitoring', 'Network impact projection updated.');
        break;
      case 'none':
      default:
        break;
    }
    // Deliberately keyed on the step index only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pitchStep, isPitchMode]);

  // Step timer + progress bar.
  useEffect(() => {
    if (!isPitchMode || isPaused || !step) return;

    stepStarted.current = Date.now() - pausedAt.current;

    const tick = setInterval(() => {
      const elapsed = Date.now() - stepStarted.current;
      setProgress(Math.min(1, elapsed / step.durationMs));
    }, 60);

    const advance = setTimeout(() => {
      pausedAt.current = 0;
      setProgress(0);
      if (pitchStep < PITCH_STEPS.length - 1) {
        setPitchStep(pitchStep + 1);
      } else {
        exit();
      }
    }, step.durationMs - pausedAt.current);

    return () => {
      clearInterval(tick);
      clearTimeout(advance);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pitchStep, isPitchMode, isPaused]);

  const exit = useCallback(() => {
    setPitchMode(false);
    setMessageModalOpen(false);
    setCallActive(false);
    toggleImpact(false);
    setScenario(null, null);
    setIsPaused(false);
    setProgress(0);
    pausedAt.current = 0;
    anchorBusId.current = null;
    setAi('Listening', 'Presentation complete. Fleet telemetry synchronized.');
  }, [setPitchMode, setMessageModalOpen, setCallActive, toggleImpact, setScenario, setAi]);

  // Keyboard controls.
  useEffect(() => {
    if (!isPitchMode) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') exit();
      if (event.key === ' ') {
        event.preventDefault();
        togglePause();
      }
      if (event.key === 'ArrowRight') goNext();
      if (event.key === 'ArrowLeft') goPrevious();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPitchMode, pitchStep, isPaused]);

  function togglePause() {
    if (!isPaused) {
      pausedAt.current = Date.now() - stepStarted.current;
      setIsPaused(true);
    } else {
      setIsPaused(false);
    }
  }

  function goNext() {
    pausedAt.current = 0;
    setProgress(0);
    if (pitchStep < PITCH_STEPS.length - 1) setPitchStep(pitchStep + 1);
    else exit();
  }

  function goPrevious() {
    pausedAt.current = 0;
    setProgress(0);
    if (pitchStep > 0) setPitchStep(pitchStep - 1);
  }

  if (!isPitchMode || !step) return null;

  const overallProgress =
    (PITCH_STEPS.slice(0, pitchStep).reduce((sum, s) => sum + s.durationMs, 0) +
      progress * step.durationMs) /
    TOTAL_PITCH_MS;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="pointer-events-none fixed inset-0 z-[120]"
        data-testid="pitch-mode-overlay"
      >
        {/* Cinematic letterbox. The lower band is near-opaque because the
            intelligence strip sits beneath it and would otherwise show
            through the presenter captions. */}
        <div className="absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-void via-void/85 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-64 bg-void/96 backdrop-blur-md" />
        <div className="absolute inset-x-0 bottom-64 h-24 bg-gradient-to-t from-void/96 to-transparent" />

        {/* Overall progress */}
        <div className="absolute inset-x-0 top-0 h-0.5 bg-holo-glow/10">
          <motion.div
            className="h-full bg-holo-glow"
            style={{ width: `${overallProgress * 100}%`, boxShadow: '0 0 12px #3ff0ff' }}
          />
        </div>

        {/* Caption block */}
        <div className="pointer-events-auto absolute inset-x-0 bottom-0 px-8 pb-6">
          <div className="mx-auto max-w-4xl">
            <div className="mb-3 flex items-center justify-center gap-3">
              <Badge variant="sim" pulse>
                DIRECTOR PITCH MODE
              </Badge>
              <span className="font-mono text-[10px] uppercase tracking-widest text-holo-glow/50">
                Step {pitchStep + 1} of {PITCH_STEPS.length}
              </span>
            </div>

            <AnimatePresence mode="wait">
              <motion.div
                key={step.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -16 }}
                transition={{ duration: 0.45 }}
                className="text-center"
              >
                <h2
                  className="mb-2 text-2xl font-bold tracking-[0.06em] text-holo-glow text-glow"
                  data-testid="pitch-caption"
                >
                  {step.caption}
                </h2>
                <p className="mx-auto max-w-2xl font-mono text-xs leading-relaxed text-holo-glow/60">
                  {step.detail}
                </p>
              </motion.div>
            </AnimatePresence>

            {/* Step progress */}
            <div className="mx-auto mt-4 h-0.5 w-64 overflow-hidden rounded-full bg-holo-glow/12">
              <div
                className="h-full bg-holo-teal transition-[width] duration-100 ease-linear"
                style={{ width: `${progress * 100}%` }}
              />
            </div>

            {/* Controls */}
            <div className="mt-5 flex items-center justify-center gap-2">
              <button type="button" onClick={goPrevious} className="hud-button" disabled={pitchStep === 0}>
                <SkipBack className="h-3.5 w-3.5" aria-hidden />
                Previous
              </button>
              <button
                type="button"
                onClick={togglePause}
                className="hud-button-primary"
                data-testid="pitch-pause"
              >
                {isPaused ? (
                  <>
                    <Play className="h-3.5 w-3.5" aria-hidden />
                    Resume
                  </>
                ) : (
                  <>
                    <Pause className="h-3.5 w-3.5" aria-hidden />
                    Pause
                  </>
                )}
              </button>
              <button type="button" onClick={goNext} className="hud-button">
                Next
                <SkipForward className="h-3.5 w-3.5" aria-hidden />
              </button>
              <button
                type="button"
                onClick={exit}
                className="hud-button-danger"
                data-testid="exit-pitch-mode"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
                Exit
              </button>
            </div>

            <p className="mt-3 text-center font-mono text-[9px] uppercase tracking-widest text-holo-glow/30">
              Space pause · ← → step · Esc exit
            </p>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
