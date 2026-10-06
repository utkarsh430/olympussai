export interface CopilotTextProps {
  readonly headline: string;
  readonly paragraphs: readonly string[];
  /** Heading level of the headline; pick the level that follows the surrounding heading. */
  readonly headingLevel?: 2 | 3 | 4;
}

/**
 * The words of a copilot answer, rendered as plain React text nodes in ordinary
 * elements. Deliberately no `dangerouslySetInnerHTML`, no Markdown, no linkifying
 * and no splitting of the text to find links or numbers: the text came from a
 * model, so nothing in it may become markup or a clickable target, and every
 * figure in it was supplied by the server and must reach the screen unaltered.
 */
export function CopilotText({ headline, paragraphs, headingLevel = 3 }: CopilotTextProps) {
  const Heading = `h${headingLevel}` as const;
  return (
    <div data-testid="copilot-text" className="min-w-0">
      <Heading className="font-mono text-[13px] font-semibold text-depot-ink">{headline}</Heading>
      {paragraphs.map((paragraph, index) => (
        <p key={index} className="depot-prose mt-2 max-w-prose break-words text-depot-ink">
          {paragraph}
        </p>
      ))}
    </div>
  );
}
