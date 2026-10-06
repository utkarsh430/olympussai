'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/** The summary every page's closing disclosure carries, word for word. */
export const HOW_PRODUCED_SUMMARY = 'How these figures are produced';

export interface HowProducedProps {
  /** Plain sentences, each rendered as its own paragraph (as text, never markup). */
  readonly paragraphs?: readonly string[];
  /** The page's own content, after the paragraphs. */
  readonly children?: ReactNode;
  /** An anchor: a link to `#<id>` scrolls to the disclosure and opens it. */
  readonly id?: string;
  /** Kept per page so existing page tests can find their disclosure. */
  readonly testId?: string;
  /** Outer spacing only (a top margin where the page's flow has no gap). */
  readonly className?: string;
}

/**
 * The one closing disclosure at the end of a depot page (rulings, section 1): the
 * definitions, assumptions and limits that used to sit as paragraphs above the figures.
 * A native `<details>`: closed by default, opened by keyboard without script, and its
 * summary has a real expanded state for assistive technology. The only script is the
 * anchor: browsers do not reliably open a closed `<details>` on a fragment link.
 */
export function HowProduced(props: HowProducedProps) {
  const { paragraphs = [], children, id, testId, className = '' } = props;
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    if (!id) return undefined;
    const openIfNamed = (): void => {
      if (window.location.hash === `#${id}` && ref.current) ref.current.open = true;
    };
    openIfNamed();
    window.addEventListener('hashchange', openIfNamed);
    return () => window.removeEventListener('hashchange', openIfNamed);
  }, [id]);

  return (
    <details
      ref={ref}
      id={id}
      className={`group min-w-0 scroll-mt-[var(--depot-anchor-mt)] border-t border-depot-line pt-4 ${className}`}
      data-testid={testId ?? 'depot-how-produced'}
    >
      <summary className="flex cursor-pointer list-none items-baseline gap-2 py-1 font-mono text-[11px] uppercase tracking-[0.16em] text-depot-muted hover:text-depot-ink [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="inline-block w-3 text-depot-faint group-open:rotate-90">
          ›
        </span>
        {HOW_PRODUCED_SUMMARY}
      </summary>
      <div className="depot-prose mt-2 flex min-w-0 max-w-[62ch] flex-col gap-2">
        {paragraphs.map((text) => (
          <p key={text} className="depot-prose">
            {text}
          </p>
        ))}
        {children}
      </div>
    </details>
  );
}
