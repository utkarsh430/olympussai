'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * The eyebrow / title / lede stack every scene opens with.
 *
 * One component so the small mono eyebrow, the light-weight title and the
 * measured lede stay the same shape from the hero to the report.
 */
export function SceneHeader({
  eyebrow,
  title,
  lede,
  align = 'left',
  className,
  children,
}: {
  eyebrow: string;
  title: ReactNode;
  lede?: ReactNode;
  align?: 'left' | 'center';
  className?: string;
  children?: ReactNode;
}) {
  return (
    <header
      className={cn(
        'flex flex-col gap-4',
        align === 'center' && 'items-center text-center',
        className,
      )}
    >
      <p className="sc-eyebrow">{eyebrow}</p>
      <h2 className="sc-display sc-h2 text-foreground">{title}</h2>
      {lede ? (
        <p className={cn('ol-body max-w-2xl', align === 'center' && 'mx-auto')}>{lede}</p>
      ) : null}
      {children}
    </header>
  );
}
