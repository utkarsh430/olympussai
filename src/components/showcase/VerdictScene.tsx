'use client';

import { motion } from 'framer-motion';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import type { CorridorTile, VerdictModel } from '@/lib/showcase/resolve';
import { cn } from '@/lib/utils';
import { SceneHeader } from './SceneHeader';
import { AnimatedFigure, StatTile } from './StatTile';

const MINUS = '−';

/** A true minus for a loss, a plus for a gain; the magnitude is passed separately. */
function signOf(value: number): string {
  return value < 0 ? MINUS : '+';
}

/**
 * The answer, then the evidence: one sentence, two numerals, three corridors.
 *
 * Both hero numerals are whole-journey figures; the net is the one figure on
 * this scene in the accent. The corridor tiles carry the seed agreement
 * beside each number because a mean whose seeds disagree is no effect however
 * large it is, and the tile has to say so itself.
 */
export function VerdictScene({ model }: { model: VerdictModel }) {
  const reduced = useReducedMotion();

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-10 px-6 py-16">
      <SceneHeader
        eyebrow="The verdict"
        title={<span className="sc-title">{model.sentence}</span>}
        lede={model.because}
      />

      <div className="grid gap-8 md:grid-cols-2">
        <StatTile
          size="hero"
          tone="glow"
          stat={{
            id: 'net',
            label: 'Total passenger time saved',
            value: Math.abs(model.netPercent),
            decimals: 1,
            prefix: signOf(model.netPercent),
            suffix: '%',
          }}
        />
        <StatTile
          size="hero"
          tone="foreground"
          stat={{
            id: 'ewt',
            label: 'Excess waiting removed',
            value: Math.abs(model.excessWaitPercent),
            prefix: model.excessWaitPercent < 0 ? '+' : MINUS,
            suffix: '%',
          }}
        />
      </div>

      <div className="sc-rule" aria-hidden />

      <ul className="grid gap-6 md:grid-cols-3">
        {model.corridors.map((tile, index) => (
          <CorridorCard key={tile.presetId} tile={tile} index={index} reduced={reduced} />
        ))}
      </ul>
    </div>
  );
}

function CorridorCard({
  tile,
  index,
  reduced,
}: {
  tile: CorridorTile;
  index: number;
  reduced: boolean;
}) {
  const pips = Array.from({ length: tile.seedsTotal }, (_, seed) => seed < tile.seedsAgreeing);

  return (
    <motion.li
      className="sc-panel sc-lift flex flex-col gap-3 p-5"
      initial={reduced ? false : { opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: reduced ? 0 : 0.6, delay: reduced ? 0 : index * 0.12 }}
    >
      <div>
        <h3 className="sc-display text-lg text-foreground">{tile.name}</h3>
        <p className="text-sm text-muted-foreground">{tile.shape}</p>
      </div>

      <div className="flex flex-col gap-1">
        <div className="sc-numeral sc-numeral-md text-foreground">
          <AnimatedFigure
            value={Math.abs(tile.netPercent)}
            decimals={1}
            prefix={signOf(tile.netPercent)}
            suffix="%"
          />
        </div>
        <span className="sc-label">passenger time saved</span>
      </div>

      <p className="font-mono text-sm tabular-nums text-success">
        {`${tile.excessWaitPercent < 0 ? '+' : MINUS}${Math.abs(Math.round(tile.excessWaitPercent))}% excess wait`}
      </p>

      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1" aria-hidden>
          {pips.map((agreeing, seed) => (
            <span
              key={seed}
              className={cn(
                'h-2 w-2 rounded-full',
                agreeing ? 'bg-success' : 'border border-border',
              )}
            />
          ))}
        </span>
        <span className="font-mono text-xs text-muted-foreground">
          {`${tile.seedsAgreeing} of ${tile.seedsTotal} seeds agree`}
        </span>
      </div>

      <span className="sc-chip sc-chip-accent self-start">{tile.bandLabel}</span>
    </motion.li>
  );
}
