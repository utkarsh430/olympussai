'use client';

import { useCallback, useEffect, useState, type RefObject } from 'react';
import { hasColumnsToTheRight } from '@/lib/depot/tableOverflow';

/**
 * True while the frame can scroll further right. Re-measured on scroll and whenever
 * the frame or its content changes size; `hasColumnsToTheRight` decides.
 */
export function useColumnsToTheRight(
  frame: RefObject<HTMLElement | null>,
  enabled: boolean,
): boolean {
  const [more, setMore] = useState(false);
  const measure = useCallback((): void => {
    const el = frame.current;
    if (!el) return;
    setMore(hasColumnsToTheRight(el));
  }, [frame]);

  useEffect(() => {
    const el = frame.current;
    if (!enabled || !el) return undefined;
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(el);
    const table = el.firstElementChild;
    if (table) observer?.observe(table);
    return () => {
      el.removeEventListener('scroll', measure);
      observer?.disconnect();
    };
  }, [enabled, measure]);

  return enabled && more;
}

/**
 * The right-edge cue of a wide table: a fade (the one gradient the rules permit) and the
 * visible words "more columns". It sits on the non-scrolling wrapper, not inside the
 * frame, so it does not scroll away; it lets clicks through. Rendered only while the
 * frame can scroll right, so there is nothing to animate and reduced motion is honoured.
 */
export function TableOverflowCue() {
  return (
    <div
      aria-hidden
      data-testid="depot-table-more-columns"
      className="pointer-events-none absolute inset-y-px right-px flex w-24 items-end justify-end rounded-r-md bg-gradient-to-l from-depot-page via-depot-page/80 to-transparent px-2 pb-1"
    >
      <span className="whitespace-nowrap bg-depot-page px-1 font-mono text-[11px] uppercase tracking-[0.12em] text-depot-muted">
        more columns
      </span>
    </div>
  );
}
