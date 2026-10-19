'use client';

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';

/** How long a page may take to draw the section after its data arrives. */
const WAIT_MS = 8_000;
/** Room above the section for the sticky bar. */
const OFFSET_PX = 76;

/**
 * Opens the part of a shared page that a sidebar entry names with `?section=`: waits for
 * the element with that id (pages draw it once their data is in), then scrolls it under
 * the bar. Without the query it does nothing.
 */
export function SectionScroller() {
  const section = useSearchParams()?.get('section') ?? null;

  useEffect(() => {
    if (!section || !/^[a-z0-9-]{1,60}$/.test(section)) return undefined;
    const scroll = (el: HTMLElement): void => {
      const top = el.getBoundingClientRect().top + window.scrollY - OFFSET_PX;
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo({ top: Math.max(0, top), behavior: reduce ? 'auto' : 'smooth' });
    };
    const found = document.getElementById(section);
    if (found) {
      scroll(found);
      return undefined;
    }
    const observer = new MutationObserver(() => {
      const el = document.getElementById(section);
      if (!el) return;
      observer.disconnect();
      window.clearTimeout(timer);
      // One frame later, so the section's own content has laid out.
      window.requestAnimationFrame(() => scroll(el));
    });
    const timer = window.setTimeout(() => observer.disconnect(), WAIT_MS);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, [section]);

  return null;
}
