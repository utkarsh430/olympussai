'use client';

import { motion } from 'framer-motion';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import type { HeroModel } from '@/lib/showcase/resolve';
import { StatTile } from './StatTile';

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

/** "10,000 buses. One controller." -> the first sentence, and the rest. */
function splitTitle(title: string): [string, string] {
  const at = title.indexOf('. ');
  if (at < 0) return [title, ''];
  return [title.slice(0, at + 1), title.slice(at + 2)];
}

/**
 * The opening scene: the claim, over the fleet.
 *
 * The scene carries no field of its own; the page-wide one in
 * `ShowcaseBackdrop` shows through. The copy carries everything, so the
 * gradients at top and bottom keep the title legible over it.
 */
export function HeroScene({ model }: { model: HeroModel }) {
  const reduced = useReducedMotion();
  const [head, tail] = splitTitle(model.title);

  const rise = (delay: number) => ({
    initial: reduced ? false : { opacity: 0, y: 18 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: reduced ? 0 : 0.8, delay: reduced ? 0 : delay, ease: EASE },
  });

  return (
    <div className="relative flex min-h-[100svh] w-full items-center justify-center overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-48 bg-gradient-to-b from-background to-transparent"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-56 bg-gradient-to-t from-background to-transparent"
      />

      <div className="relative z-10 mx-auto flex w-full max-w-7xl flex-col items-center gap-10 px-6 py-24 text-center">
        <motion.p className="sc-eyebrow" {...rise(0)}>
          {model.eyebrow}
        </motion.p>
        <motion.h1 className="sc-display sc-title text-foreground" {...rise(0.12)}>
          {head}
          {tail ? <span className="block text-primary">{tail}</span> : null}
        </motion.h1>
        <motion.p className="ol-body ol-measure-wide mx-auto text-center" {...rise(0.26)}>
          {model.subtitle}
        </motion.p>
        <motion.div className="grid w-full grid-cols-2 gap-8 pt-6 md:grid-cols-4" {...rise(0.4)}>
          {model.stats.map((stat) => (
            <StatTile
              key={stat.id}
              stat={stat}
              size="lg"
              tone="foreground"
              className="items-center text-center"
            />
          ))}
        </motion.div>
      </div>

      {!reduced ? (
        <div
          aria-hidden
          className="absolute bottom-8 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-2"
        >
          <span className="sc-label">Scroll</span>
          <span className="relative block h-10 w-px bg-primary/25">
            <span
              className="absolute left-1/2 top-0 -ml-[3px] h-1.5 w-1.5 rounded-full bg-primary"
              style={{ animation: 'ol-scroll-cue 1.8s ease-in-out infinite' }}
            />
          </span>
        </div>
      ) : null}
    </div>
  );
}
