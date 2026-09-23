'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { cn } from '@/lib/utils';
import type { StatFigure } from '@/lib/showcase/resolve';

/**
 * A labelled numeral on the HUD, counting up on first paint.
 *
 * Size decides the numeral class; tone decides the ink. Colour is never the
 * only encoding on this page - the label says what the number is - so a tone
 * is a weight, not a meaning.
 *
 * It carries its own count-up rather than the command centre's `CountUp`,
 * because that one prints `toFixed` digits with no grouping and the figures
 * here run to seven digits: 3200000 is a number nobody in a room can read,
 * 32,00,000 is one they can. Grouping follows `en-IN`, the audience's own.
 */
export function formatFigure(value: number, decimals = 0): string {
  return value.toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function AnimatedFigure({
  value,
  decimals = 0,
  prefix = '',
  suffix = '',
  durationMs = 1100,
  className,
}: {
  value: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  durationMs?: number;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const [display, setDisplay] = useState(reduced ? value : 0);
  const fromRef = useRef(0);

  useEffect(() => {
    const from = fromRef.current;
    if (reduced || from === value) {
      fromRef.current = value;
      setDisplay(value);
      return;
    }
    const start = performance.now();
    let frame = 0;
    let last = Number.NaN;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / durationMs);
      const eased = 1 - (1 - progress) ** 3;
      const next = from + (value - from) * eased;
      const rounded = Number(next.toFixed(decimals));
      if (rounded !== last) {
        last = rounded;
        setDisplay(next);
      }
      if (progress < 1) {
        frame = requestAnimationFrame(tick);
      } else {
        fromRef.current = value;
        setDisplay(value);
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, reduced, decimals, durationMs]);

  return (
    <span className={cn('tabular-nums', className)}>
      {prefix}
      {formatFigure(display, decimals)}
      {suffix}
    </span>
  );
}

export function StatTile({
  stat,
  size = 'md',
  tone = 'glow',
  className,
  children,
}: {
  stat: StatFigure;
  size?: 'sm' | 'md' | 'lg' | 'hero';
  tone?: 'glow' | 'foreground' | 'good' | 'warn';
  className?: string;
  children?: ReactNode;
}) {
  const numeralClass =
    size === 'hero'
      ? 'sc-numeral sc-numeral-hero'
      : size === 'lg'
        ? 'sc-numeral sc-numeral-lg'
        : size === 'md'
          ? 'sc-numeral sc-numeral-md'
          : 'sc-numeral text-xl';
  // `glow` is now the accent without a halo: the theme reserves shadows for
  // surfaces, never for type.
  const toneClass =
    tone === 'foreground'
      ? 'text-foreground'
      : tone === 'good'
        ? 'text-success'
        : tone === 'warn'
          ? 'text-warning'
          : 'text-primary';

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className={cn(numeralClass, toneClass)}>
        <AnimatedFigure
          value={stat.value}
          decimals={stat.decimals ?? 0}
          prefix={stat.prefix ?? ''}
          suffix={stat.suffix ?? ''}
        />
      </div>
      <div className="sc-label">{stat.label}</div>
      {stat.note ? <div className="text-xs text-muted-foreground">{stat.note}</div> : null}
      {children}
    </div>
  );
}
