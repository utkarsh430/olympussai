'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { centredScrollLeft, pageScrollDelta, stripCue, type StripCue } from '@/lib/depot/scrollStrip';

const NO_CUE: StripCue = { before: false, after: false };
const CUE_BUTTON =
  'absolute inset-y-0 z-10 flex w-7 items-center justify-center bg-depot-page text-depot-ink ' +
  'hover:bg-depot-raised';

export interface ScrollStripProps {
  /** Changes when the active link changes (the path); the active link is then scrolled into view. */
  readonly activeKey: string;
  /** Classes of the frame. It is `relative`, so the cues stay inside it. */
  readonly className?: string;
  /** Classes of the scrolling row itself. */
  readonly scrollClassName?: string;
  /** Extra classes for the cues, e.g. to hide them where the strip stops scrolling. */
  readonly cueClassName?: string;
  readonly children: React.ReactNode;
}

/**
 * A row of links that scrolls sideways inside itself. When more links lie beyond
 * an edge a flat end cap with an arrow shows there (a hairline and a glyph, not a
 * colour), and clicking it scrolls one screenful. The cap is a mouse convenience
 * only: the links themselves are all reachable by keyboard, and focus scrolls them
 * into view. The active link is centred on load and on every route change. The
 * cues sit beside the scroller, not inside it, so they do not scroll away.
 */
export function ScrollStrip({
  activeKey,
  className = '',
  scrollClassName = '',
  cueClassName = '',
  children,
}: ScrollStripProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const [cue, setCue] = useState<StripCue>(NO_CUE);

  const measure = useCallback((): void => {
    const el = scroller.current;
    if (!el) return;
    const next = stripCue(el);
    setCue((prev) => (prev.before === next.before && prev.after === next.after ? prev : next));
  }, []);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return undefined;
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(el);
    return () => {
      el.removeEventListener('scroll', measure);
      observer?.disconnect();
    };
  }, [measure]);

  useEffect(() => {
    const el = scroller.current;
    const active = el?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!el || !active || el.scrollWidth <= el.clientWidth) return;
    el.scrollLeft = centredScrollLeft({
      itemLeft: active.offsetLeft,
      itemWidth: active.offsetWidth,
      clientWidth: el.clientWidth,
      scrollWidth: el.scrollWidth,
    });
    measure();
  }, [activeKey, measure]);

  const page = (direction: 'before' | 'after'): void => {
    const el = scroller.current;
    if (!el) return;
    el.scrollBy({ left: pageScrollDelta(el.clientWidth, direction), behavior: 'auto' });
  };

  return (
    <div className={`relative ${className}`}>
      {/* `relative`: the row is the containing block of anything absolutely positioned inside
          it (a visually hidden label, for one), so such a child scrolls and clips with the row
          instead of widening the page. */}
      <div
        ref={scroller}
        className={`relative ${scrollClassName}`}
        data-testid="depot-scroll-strip"
      >
        {children}
      </div>
      {cue.before ? (
        <button
          type="button"
          tabIndex={-1}
          aria-hidden
          data-testid="depot-strip-cue-before"
          onClick={() => page('before')}
          className={`${CUE_BUTTON} left-0 border-r border-depot-line ${cueClassName}`}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </button>
      ) : null}
      {cue.after ? (
        <button
          type="button"
          tabIndex={-1}
          aria-hidden
          data-testid="depot-strip-cue-after"
          onClick={() => page('after')}
          className={`${CUE_BUTTON} right-0 border-l border-depot-line ${cueClassName}`}
        >
          <ChevronRight className="h-4 w-4" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}
