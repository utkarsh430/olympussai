'use client';

import { useEffect, useRef } from 'react';

export interface CopilotTextProps {
  readonly headline: string;
  readonly paragraphs: readonly string[];
  /** Heading level of the headline, or null to render it as a bold line with no heading. */
  readonly headingLevel?: 2 | 3 | 4 | null;
  /** Move focus to the headline when the text first appears, so keyboard users land on it. */
  readonly focusOnMount?: boolean;
}

const HEADLINE_CLASS = 'font-mono text-[13px] font-semibold text-depot-ink outline-none';

/**
 * The words of a copilot answer, rendered as plain React text nodes in ordinary
 * elements. Deliberately no `dangerouslySetInnerHTML`, no Markdown, no linkifying
 * and no splitting of the text to find links or numbers: the text came from a
 * model, so nothing in it may become markup or a clickable target, and every
 * figure in it was supplied by the server and must reach the screen unaltered.
 */
export function CopilotText({
  headline,
  paragraphs,
  headingLevel = 3,
  focusOnMount = false,
}: CopilotTextProps) {
  const headlineRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (focusOnMount) headlineRef.current?.focus();
  }, [focusOnMount]);

  const Heading = headingLevel === null ? 'p' : (`h${headingLevel}` as const);
  return (
    <div data-testid="copilot-text" className="min-w-0">
      <Heading ref={(node: HTMLElement | null) => {
          headlineRef.current = node;
        }} tabIndex={-1} className={HEADLINE_CLASS}>
        {headline}
      </Heading>
      {paragraphs.map((paragraph, index) => (
        <p key={index} className="depot-prose mt-2 max-w-prose break-words text-depot-ink">
          {paragraph}
        </p>
      ))}
    </div>
  );
}
