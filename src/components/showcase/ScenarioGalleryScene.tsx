'use client';

import { motion } from 'framer-motion';
import { useState } from 'react';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import {
  OUTCOME_LABEL,
  type GalleryCorridorModel,
  type GalleryModel,
  type ScenarioCardModel,
  type ScenarioFamily,
  type ScenarioOutcome,
} from '@/lib/showcase/resolve';
import { cn } from '@/lib/utils';
import { SceneHeader } from './SceneHeader';
import { Sparkline } from './Sparkline';

type Filter = 'all' | ScenarioFamily;

const MINUS = '−';

const OUTCOME_CHIP: Record<ScenarioOutcome, string> = {
  helped: 'sc-chip sc-chip-good',
  no_effect: 'sc-chip',
  stress_test: 'sc-chip sc-chip-warn',
};

/** Net passenger time: a gain reads "+3.8%", a loss "−1.2%". */
function signedPercent(value: number, decimals: number): string {
  const magnitude = Math.abs(value).toFixed(decimals);
  return value < 0 ? `${MINUS}${magnitude}%` : `+${magnitude}%`;
}

/** Excess wait is a cut, so an improvement reads "−54%" and a worsening "+12%". */
function cutPercent(value: number): string {
  const magnitude = Math.abs(Math.round(value));
  return value < 0 ? `+${magnitude}%` : `${MINUS}${magnitude}%`;
}

/**
 * The corridors the toggle offers. A model with no per-corridor split still
 * renders: its lead cards become the one, unnamed corridor.
 */
function corridorsOf(model: GalleryModel): readonly GalleryCorridorModel[] {
  if (model.corridors.length > 0) return model.corridors;
  return [{ presetId: 'lead', name: '', shape: '', cards: model.cards, families: model.families }];
}

function defaultCorridor(corridors: readonly GalleryCorridorModel[]): string {
  return (
    (corridors.find((corridor) => corridor.presetId === 'urban') ?? corridors[0])?.presetId ?? ''
  );
}

/**
 * Every scenario, both arms, on one card each - for whichever corridor is
 * chosen. The corridor toggle sits above the family filter, and switching
 * corridor resets the filter, because a family count belongs to one corridor
 * and carrying the filter across would show a chip whose count no longer
 * describes the grid. A stress test stays a stress test rather than becoming
 * a failure, and a null result renders as an em dash rather than a zero.
 */
export function ScenarioGalleryScene({ model }: { model: GalleryModel }) {
  const reduced = useReducedMotion();
  const corridors = corridorsOf(model);
  const [presetId, setPresetId] = useState<string>(() => defaultCorridor(corridors));
  const [filter, setFilter] = useState<Filter>('all');
  const current = corridors.find((corridor) => corridor.presetId === presetId) ?? corridors[0];
  const cards = current?.cards ?? [];
  const families = current?.families ?? [];
  const visible = cards.filter((card) => filter === 'all' || card.family === filter);

  const chooseCorridor = (next: string) => {
    setPresetId(next);
    setFilter('all');
  };

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-12 px-6 py-24">
      <SceneHeader
        eyebrow="Nineteen ways a corridor comes apart"
        title="Every scenario, both arms."
        lede="Each scenario ran twice on the same seed - once with nobody intervening, once under the deployed control laws - and the open-incident curve of both is drawn on every card."
      />

      {corridors.length > 1 ? (
        <div className="flex flex-col gap-3">
          <div role="group" aria-label="Choose a corridor" className="flex flex-wrap gap-2">
            {corridors.map((corridor) => (
              <button
                key={corridor.presetId}
                type="button"
                className="sc-button"
                aria-pressed={corridor.presetId === current?.presetId}
                onClick={() => chooseCorridor(corridor.presetId)}
              >
                {corridor.name}
              </button>
            ))}
          </div>
          {current?.shape ? <p className="sc-label">{current.shape}</p> : null}
        </div>
      ) : null}

      <div role="group" aria-label="Filter scenarios by family" className="flex flex-wrap gap-2">
        <button
          type="button"
          className="sc-button"
          aria-pressed={filter === 'all'}
          onClick={() => setFilter('all')}
        >
          {`All (${cards.length})`}
        </button>
        {families.map((family) => (
          <button
            key={family.id}
            type="button"
            className="sc-button"
            aria-pressed={filter === family.id}
            onClick={() => setFilter(family.id)}
          >
            {`${family.label} (${family.count})`}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">No scenarios in this family.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((card, index) => (
            <ScenarioCard
              key={`${current?.presetId ?? ''}:${card.id}`}
              card={card}
              index={index}
              reduced={reduced}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ScenarioCard({
  card,
  index,
  reduced,
}: {
  card: ScenarioCardModel;
  index: number;
  reduced: boolean;
}) {
  return (
    <motion.article
      className="sc-panel sc-lift flex flex-col gap-3 p-5"
      initial={reduced ? false : { opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: reduced ? 0 : 0.5, delay: reduced ? 0 : index * 0.05 }}
    >
      <h3 className="font-medium text-foreground">{card.title}</h3>
      <p className="text-sm text-muted-foreground">{card.whatGoesWrong}</p>

      <div className="h-14">
        <Sparkline controlled={card.sweeps.controlled} uncontrolled={card.sweeps.uncontrolled} />
      </div>
      <div className="flex items-center gap-4 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-0.5 w-3" style={{ background: 'var(--sim-baseline)' }} />
          left alone
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-0.5 w-3" style={{ background: 'var(--sim-controlled)' }} />
          under control
        </span>
      </div>

      <footer className="mt-auto flex flex-col gap-3 border-t border-border pt-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex gap-6">
            <div>
              <div
                className={cn(
                  'font-mono tabular-nums',
                  card.outcome === 'helped' ? 'text-success' : 'text-foreground',
                )}
              >
                {card.netPercent === null ? '—' : signedPercent(card.netPercent, 1)}
              </div>
              <div className="sc-label">passenger time</div>
            </div>
            <div>
              <div className="font-mono tabular-nums text-foreground">
                {card.excessWaitPercent === null ? '—' : cutPercent(card.excessWaitPercent)}
              </div>
              <div className="sc-label">excess wait</div>
            </div>
          </div>
          <span className={OUTCOME_CHIP[card.outcome]}>{OUTCOME_LABEL[card.outcome]}</span>
        </div>
        <p className="font-mono text-xs tabular-nums text-muted-foreground">
          {`incidents ${card.incidentsBefore.toLocaleString('en-IN')} → ${card.incidentsAfter.toLocaleString('en-IN')}`}
        </p>
      </footer>
    </motion.article>
  );
}
