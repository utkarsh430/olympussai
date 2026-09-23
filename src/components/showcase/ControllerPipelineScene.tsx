'use client';

import { motion } from 'framer-motion';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import type { PipelineModel } from '@/lib/showcase/resolve';
import { SceneHeader } from './SceneHeader';
import { StatTile } from './StatTile';

/** A flat bar that grows to its share on first view, or is simply there under reduced motion. */
function GrowBar({
  percent,
  reduced,
  className,
  color,
  alpha,
}: {
  percent: number;
  reduced: boolean;
  className?: string;
  color?: string;
  alpha?: number;
}) {
  const width = `${Math.max(0, Math.min(100, percent))}%`;
  const style = { background: color, opacity: alpha };
  if (reduced) return <div className={className} style={{ ...style, width }} />;
  return (
    <motion.div
      className={className}
      style={style}
      initial={{ width: 0 }}
      whileInView={{ width }}
      viewport={{ once: true }}
      transition={{ duration: 0.9, ease: 'easeOut' }}
    />
  );
}

/**
 * Detect, decide, deliver, measure - and then which law did the work and
 * where the holds landed. Bars are relative to the busiest law or station,
 * and every bar carries its count in text beside it.
 */
export function ControllerPipelineScene({ model }: { model: PipelineModel }) {
  const reduced = useReducedMotion();
  const maxShare = Math.max(1, ...model.laws.map((law) => law.sharePercent));
  const stations = [...model.stationHolds].sort((a, b) => a.sequence - b.sequence);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-14 px-6 py-24">
      <SceneHeader eyebrow="How it works" title="Detect. Decide. Deliver. Measure." />

      <div className="relative">
        <div aria-hidden className="sc-rule absolute inset-x-0 top-0 hidden md:block" />
        <ol className="grid gap-4 pt-4 md:grid-cols-4">
          {model.stages.map((stage, index) => (
            <motion.li
              key={stage.id}
              className="sc-panel sc-lift flex flex-col gap-3 p-5"
              initial={reduced ? false : { opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: reduced ? 0 : 0.5, delay: reduced ? 0 : index * 0.1 }}
            >
              <span className="font-mono text-[11px] tracking-[0.2em] text-primary/70">
                {String(index + 1).padStart(2, '0')}
              </span>
              <h3 className="sc-display text-lg text-foreground">{stage.title}</h3>
              <p className="text-sm text-muted-foreground">{stage.body}</p>
              <StatTile
                size="sm"
                tone="foreground"
                className="mt-auto pt-2"
                stat={{
                  id: stage.id,
                  label: stage.statLabel,
                  value: stage.statValue,
                  suffix: stage.statSuffix,
                }}
              />
            </motion.li>
          ))}
        </ol>
      </div>

      <p className="text-sm text-muted-foreground">
        <span className="sc-label mr-3">
          {`Detector · every ${model.detector.sweepSeconds} s · ${model.detector.tiers.join(' + ')}`}
        </span>
        {model.detector.description}
      </p>

      <div className="grid gap-8 lg:grid-cols-2">
        <section className="flex flex-col gap-6">
          <h3 className="sc-display text-lg text-foreground">The four control laws</h3>
          <ul className="flex flex-col gap-5">
            {model.laws.map((law) => (
              <li key={law.id} className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between gap-4">
                  <span className="font-medium text-foreground">{law.name}</span>
                  <span className="font-mono text-xs tabular-nums text-foreground">
                    {`${Math.round(law.sharePercent)}%`}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">{law.oneLiner}</p>
                <div className="h-1.5 overflow-hidden rounded-full bg-primary/10">
                  <GrowBar
                    percent={(law.sharePercent / maxShare) * 100}
                    reduced={reduced}
                    className="h-full rounded-full bg-primary/60"
                  />
                </div>
                <p className="font-mono text-xs tabular-nums text-muted-foreground">
                  {`${law.decisionsGenerating.toLocaleString('en-IN')} of ${law.decisionsTotal.toLocaleString('en-IN')} decisions · ${law.holdCount.toLocaleString('en-IN')} holds`}
                </p>
              </li>
            ))}
          </ul>
        </section>

        <section className="flex flex-col gap-6">
          <h3 className="sc-display text-lg text-foreground">Where the holds landed</h3>
          {stations.length === 0 ? (
            <p className="text-sm text-muted-foreground">No holds were issued.</p>
          ) : (
            <ol className="flex flex-col gap-3">
              {stations.map((station) => (
                <li
                  key={station.sequence}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1"
                >
                  <span className="truncate text-sm text-foreground">{station.name}</span>
                  <span className="font-mono text-xs tabular-nums text-foreground">
                    {`${Math.round(station.holdSeconds / 60).toLocaleString('en-IN')} min`}
                  </span>
                  <div className="col-span-2 h-1.5 overflow-hidden rounded-full bg-primary/10">
                    <GrowBar
                      percent={station.share * 100}
                      reduced={reduced}
                      className="h-full rounded-full"
                      color="var(--sim-hold)"
                      alpha={0.8}
                    />
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}
