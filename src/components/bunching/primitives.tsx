'use client';

import type { ReactNode } from 'react';
import { Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { STATUS_META } from '@/lib/bunching/config';
import type { BunchingStatus } from '@/lib/bunching/types';

/** Semantic colour classes for the simulator, mapped onto the HUD palette. */
export const TONE_CLASS = {
  green: 'text-alert-green border-alert-green/45 bg-alert-green/10',
  teal: 'text-holo-teal border-holo-teal/45 bg-holo-teal/10',
  amber: 'text-alert-amber border-alert-amber/45 bg-alert-amber/10',
  crimson: 'text-alert-crimson border-alert-crimson/45 bg-alert-crimson/10',
  glow: 'text-holo-glow border-holo-glow/35 bg-holo-glow/[0.07]',
} as const;

export type Tone = keyof typeof TONE_CLASS;

export const TONE_TEXT: Record<Tone, string> = {
  green: 'text-alert-green',
  teal: 'text-holo-teal',
  amber: 'text-alert-amber',
  crimson: 'text-alert-crimson',
  glow: 'text-holo-glow',
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
      className="min-w-0 rounded border border-holo-glow/15 bg-void-900/60 px-2.5 py-2"
      title={hint}
    >
      <div className="hud-label flex items-center gap-1 truncate">
        <span className="truncate">{label}</span>
        {hint && <Info aria-hidden className="h-2.5 w-2.5 shrink-0 opacity-60" />}
      </div>
      <div className={cn('font-mono text-base tabular-nums leading-tight', TONE_TEXT[tone])}>
        {value}
        {unit && <span className="ml-0.5 text-[10px] opacity-70">{unit}</span>}
      </div>
      {footnote && (
        <div className="mt-0.5 truncate font-mono text-[9px] text-holo-glow/40">{footnote}</div>
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
      <h3 className="flex min-w-0 items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-holo-glow">
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
      <span className="min-w-0 truncate font-mono text-[10px] text-holo-glow/50">{label}</span>
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
