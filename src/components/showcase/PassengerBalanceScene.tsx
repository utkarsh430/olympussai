'use client';

import { motion } from 'framer-motion';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import type { BalanceModel } from '@/lib/showcase/resolve';
import { SceneHeader } from './SceneHeader';
import { StatTile } from './StatTile';

const MINUS = '−';

function hoursLabel(hours: number): string {
  return `${Math.round(hours).toLocaleString('en-IN')} h`;
}

/** One side of the diverging bar; grows from the centre line outward. */
function SideBar({
  percent,
  reduced,
  color,
  className,
}: {
  percent: number;
  reduced: boolean;
  color: string;
  className?: string;
}) {
  const width = `${Math.max(0, Math.min(100, percent))}%`;
  if (reduced) return <div className={className} style={{ background: color, width }} />;
  return (
    <motion.div
      className={className}
      style={{ background: color }}
      initial={{ width: 0 }}
      whileInView={{ width }}
      viewport={{ once: true }}
      transition={{ duration: 1, ease: 'easeOut' }}
    />
  );
}

/**
 * The passenger's bill: waiting the controller removed against time it added
 * aboard, on one centre line so the two can be read against each other, and
 * the net underneath - the one figure on this scene in the accent. Words sit
 * above every bar; the colour is a second encoding, never the only one.
 */
export function PassengerBalanceScene({ model }: { model: BalanceModel }) {
  const reduced = useReducedMotion();
  const largest = Math.max(1, model.waitingRemovedHours, model.timeAboardAddedHours);
  const holdMinutes = model.holdMinutesPerBus.toLocaleString('en-IN', {
    maximumFractionDigits: 1,
  });

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-14 px-6 py-24">
      <SceneHeader
        eyebrow="The passenger's bill"
        title="Waiting removed. Journeys counted whole."
        lede="Every second a passenger spends - at the kerb, at the door, in a hold, on the road - is counted once, and both arms are compared on the total."
      />

      <div className="relative grid grid-cols-2">
        <span
          aria-hidden
          className="absolute bottom-0 left-1/2 top-0 w-px -translate-x-1/2 bg-primary/40"
        />
        <div className="flex flex-col items-end gap-3 pr-5 text-right">
          <div>
            <div className="sc-label">Waiting removed</div>
            <div className="font-mono text-2xl tabular-nums text-foreground">
              {hoursLabel(model.waitingRemovedHours)}
            </div>
          </div>
          <div className="flex h-10 w-full justify-end">
            <SideBar
              percent={(model.waitingRemovedHours / largest) * 100}
              reduced={reduced}
              color="var(--sim-saved)"
              className="h-full rounded-l-sm"
            />
          </div>
        </div>
        <div className="flex flex-col items-start gap-3 pl-5">
          <div>
            <div className="sc-label">Time aboard added</div>
            <div className="font-mono text-2xl tabular-nums text-foreground">
              {hoursLabel(model.timeAboardAddedHours)}
            </div>
          </div>
          <div className="flex h-10 w-full justify-start">
            <SideBar
              percent={(model.timeAboardAddedHours / largest) * 100}
              reduced={reduced}
              color="var(--sim-added)"
              className="h-full rounded-r-sm"
            />
          </div>
        </div>
      </div>

      <div className="grid gap-10 sm:grid-cols-2">
        <StatTile
          size="lg"
          tone="glow"
          stat={{
            id: 'net-hours',
            label: 'Net passenger-hours saved',
            value: model.netHoursSaved,
            suffix: ' h',
          }}
        />
        <StatTile
          size="lg"
          tone="foreground"
          stat={{
            id: 'net-percent',
            label: 'of all passenger time',
            value: Math.abs(model.netPercent),
            decimals: 1,
            prefix: model.netPercent < 0 ? MINUS : '+',
            suffix: '%',
          }}
        />
      </div>

      <p className="font-mono text-sm text-muted-foreground">
        {`${holdMinutes} min of holding per bus`}
      </p>
    </div>
  );
}
