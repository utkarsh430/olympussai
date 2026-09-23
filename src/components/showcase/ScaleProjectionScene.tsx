'use client';

import { motion } from 'framer-motion';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import type { ScaleModel } from '@/lib/showcase/resolve';
import { SceneHeader } from './SceneHeader';
import { StatTile } from './StatTile';

/**
 * The trial's per-bus effect carried across the whole network: a header, a
 * rule, six figures. Nothing moves behind them.
 */
export function ScaleProjectionScene({ model }: { model: ScaleModel }) {
  const reduced = useReducedMotion();
  const eyebrow = `From ${model.fromBuses.toLocaleString('en-IN')} to ${model.toBuses.toLocaleString('en-IN')}`;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-14 px-6 py-24">
      <SceneHeader
        eyebrow={eyebrow}
        title="The same controller, the whole network."
        lede="What the trial's per-bus effect means once every corridor runs under it."
      />

      <div className="sc-rule" aria-hidden />

      <ul className="grid gap-10 sm:grid-cols-2 lg:grid-cols-3">
        {model.stats.map((stat, index) => (
          <motion.li
            key={stat.id}
            initial={reduced ? false : { opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ duration: reduced ? 0 : 0.5, delay: reduced ? 0 : index * 0.08 }}
          >
            <StatTile stat={stat} size="lg" tone="foreground" />
          </motion.li>
        ))}
      </ul>
    </div>
  );
}
