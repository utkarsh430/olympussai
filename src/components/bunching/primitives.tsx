'use client';

import type { ReactNode } from 'react';
import { Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { STATUS_META } from '@/lib/bunching/config';
import type { BunchingStatus } from '@/lib/bunching/types';

/**
 * Semantic colour classes for the simulator. Same semantics as the dashboard's
 * HUD tones (success / product accent / warning / danger) drawn from the `sim`
 * light palette, because this surface is white rather than void.
 */
export const TONE_CLASS = {
  green: 'text-sim-green border-sim-green/40 bg-sim-green/[0.08]',
  teal: 'text-sim-teal border-sim-teal/40 bg-sim-teal/[0.08]',
  amber: 'text-sim-amber border-sim-amber/40 bg-sim-amber/[0.08]',
  crimson: 'text-sim-crimson border-sim-crimson/40 bg-sim-crimson/[0.07]',
  glow: 'text-sim-accent border-sim-accent/35 bg-sim-accent/[0.07]',
} as const;

export type Tone = keyof typeof TONE_CLASS;

export const TONE_TEXT: Record<Tone, string> = {
  green: 'text-sim-green',
  teal: 'text-sim-teal',
  amber: 'text-sim-amber',
  crimson: 'text-sim-crimson',
  glow: 'text-sim-ink',
};

/**
 * Corridor status. Carries a shape cue as well as a colour so the state is not
 * conveyed by colour alone.
 */
export function StatusBadge({
  status,
  className,
}: {
  status: BunchingStatus;
  className?: string;
}) {
  const meta = STATUS_META[status];
  const glyph =
    status === 'stable' ? '●' : status === 'recovering' ? '▲' : status === 'watch' ? '◆' : '■';

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em]',
        TONE_CLASS[meta.tone],
        className,
      )}
      title={meta.description}
    >
      <span aria-hidden>{glyph}</span>
      {meta.label}
    </span>
  );
}

/** A single metric read-out. `hint` becomes the native tooltip. */
export function MetricTile({
  label,
  value,
  unit,
  hint,
  tone = 'glow',
  footnote,
}: {
  label: string;
  value: string;
  unit?: string;
  hint?: string;
  tone?: Tone;
  footnote?: string;
}) {
  return (
    <div
      className="sim-well min-w-0 px-2.5 py-2"
      title={hint}
    >
      <div className="sim-label flex items-center gap-1 truncate">
        <span className="truncate">{label}</span>
        {hint && <Info aria-hidden className="h-2.5 w-2.5 shrink-0 opacity-60" />}
      </div>
      <div className={cn('font-mono text-base tabular-nums leading-tight', TONE_TEXT[tone])}>
        {value}
        {unit && <span className="ml-0.5 text-[10px] opacity-70">{unit}</span>}
      </div>
      {footnote && (
        <div className="mt-0.5 truncate font-mono text-[9px] text-sim-faint">{footnote}</div>
      )}
    </div>
  );
}

/** Section heading inside a panel. */
export function SectionLabel({
  children,
  right,
  icon,
}: {
  children: ReactNode;
  right?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <h3 className="flex min-w-0 items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-sim-ink">
        {icon}
        <span className="truncate">{children}</span>
      </h3>
      {right}
    </div>
  );
}

/** Key/value row used throughout the panels. */
export function Row({
  label,
  value,
  tone = 'glow',
  mono = true,
}: {
  label: string;
  value: ReactNode;
  tone?: Tone;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="min-w-0 truncate font-mono text-[10px] text-sim-muted">{label}</span>
      {/* Not shrink-0: some values are a sentence rather than a figure, and must
          be allowed to wrap instead of pushing the panel wider than the screen. */}
      <span
        className={cn(
          'min-w-0 text-right text-[11px]',
          mono && 'font-mono tabular-nums',
          TONE_TEXT[tone],
        )}
      >
        {value}
      </span>
    </div>
  );
}
