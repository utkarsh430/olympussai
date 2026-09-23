'use client';

/**
 * The chrome around the showcase: a Present button when idle, and the
 * letterbox, progress hairline, scene pips and transport controls while a
 * presentation is running.
 *
 * Modelled on the pitch-mode overlay: the overlay is `pointer-events-none` so
 * the scenes underneath stay interactive, and only the bottom control strip
 * re-enables pointer events. Colour comes from the tokens alone and the one
 * accent is `primary`; nothing here glows. Both faces carry
 * `data-showcase-chrome`, which is what the print stylesheet hides.
 */
import { AnimatePresence, motion } from 'framer-motion';
import { Play, SkipBack, SkipForward, X } from 'lucide-react';
import { OlympussWordmark } from '@/components/shared/OlympussWordmark';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { cn } from '@/lib/utils';

export interface PresentScene {
  id: string;
  label: string;
}

export interface PresentChromeProps {
  active: boolean;
  index: number;
  scenes: readonly PresentScene[];
  onEnter: () => void;
  onExit: () => void;
  onNext: () => void;
  onPrev: () => void;
  onGoTo: (index: number) => void;
}

export function PresentChrome({
  active,
  index,
  scenes,
  onEnter,
  onExit,
  onNext,
  onPrev,
  onGoTo,
}: PresentChromeProps) {
  const reduced = useReducedMotion();
  const fade = { duration: reduced ? 0 : 0.35 };
  const count = scenes.length;
  const current = scenes[index];
  const progress = count > 0 ? ((index + 1) / count) * 100 : 0;

  return (
    <AnimatePresence initial={false}>
      {!active && (
        <motion.div
          key="idle"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={fade}
          className="pointer-events-auto fixed right-4 top-4 z-[110] flex items-center gap-4"
          data-showcase-chrome
          data-testid="present-idle-bar"
        >
          <OlympussWordmark className="text-sm" />
          <button type="button" onClick={onEnter} className="sc-button-primary">
            <Play className="h-3.5 w-3.5" aria-hidden />
            Present
          </button>
          <kbd className="sc-label" aria-label="Press P to present">
            P
          </kbd>
        </motion.div>
      )}

      {active && (
        <motion.div
          key="present"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={fade}
          className="pointer-events-none fixed inset-0 z-[120]"
          data-showcase-chrome
          data-testid="present-overlay"
        >
          <div aria-hidden className="sc-letterbox-top absolute inset-x-0 top-0 h-16" />
          <div aria-hidden className="sc-letterbox-bottom absolute inset-x-0 bottom-0 h-44" />

          <div
            className="absolute inset-x-0 top-0 h-px bg-muted-foreground/20"
            role="progressbar"
            aria-label="Presentation progress"
            aria-valuemin={1}
            aria-valuemax={Math.max(1, count)}
            aria-valuenow={Math.min(index + 1, Math.max(1, count))}
          >
            <div
              className="h-full bg-primary transition-[width] duration-300 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>

          <div className="pointer-events-auto absolute inset-x-0 bottom-0 flex flex-col items-center gap-3 px-8 pb-5">
            <span className="sc-label" data-testid="present-scene-label">
              {current?.label ?? ''}
            </span>

            <div className="flex items-center gap-2" aria-label="Scenes">
              {scenes.map((scene, sceneIndex) => {
                const isCurrent = sceneIndex === index;
                return (
                  <button
                    key={scene.id}
                    type="button"
                    aria-label={scene.label}
                    aria-current={isCurrent ? 'step' : undefined}
                    onClick={() => onGoTo(sceneIndex)}
                    className={cn(
                      'h-1.5 w-1.5 rounded-full transition-colors duration-300',
                      isCurrent
                        ? 'bg-primary'
                        : 'bg-muted-foreground/40 hover:bg-muted-foreground/70',
                    )}
                  />
                );
              })}
            </div>

            <div className="flex items-center gap-2">
              <button type="button" onClick={onPrev} className="sc-button" disabled={index <= 0}>
                <SkipBack className="h-3.5 w-3.5" aria-hidden />
                Previous
              </button>
              <button
                type="button"
                onClick={onNext}
                className="sc-button"
                disabled={index >= count - 1}
              >
                Next
                <SkipForward className="h-3.5 w-3.5" aria-hidden />
              </button>
              <button type="button" onClick={onExit} className="sc-button-danger">
                <X className="h-3.5 w-3.5" aria-hidden />
                Exit
              </button>
            </div>

            {/* `sc-label` is 11px and loads after the utilities, so the override is marked important. */}
            <p className="sc-label !text-[10px]">← → step · Esc exit</p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
