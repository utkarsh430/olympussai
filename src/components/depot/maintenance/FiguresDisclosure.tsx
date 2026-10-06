export interface DisclosureSection {
  readonly heading: string;
  readonly lines: readonly string[];
}

export interface FiguresDisclosureProps {
  readonly sections: readonly DisclosureSection[];
}

/**
 * The page's one closing disclosure, closed by default (rulings, section 1): the
 * definitions, assumptions and limits a page used to put before its content.
 * A native `<details>` gives the summary a real expanded state.
 */
export function FiguresDisclosure({ sections }: FiguresDisclosureProps) {
  return (
    <details className="group min-w-0 border-t border-depot-line pt-3" data-testid="depot-disclosure">
      <summary className="flex cursor-pointer list-none items-baseline gap-2 py-1 font-mono text-[11px] uppercase tracking-[0.16em] text-depot-muted hover:text-depot-ink [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="inline-block w-3 text-depot-faint group-open:rotate-90">
          ›
        </span>
        How these figures are produced
      </summary>
      <div className="mt-2 flex max-w-2xl flex-col gap-4">
        {sections.map((section) => (
          <div key={section.heading}>
            <h3 className="font-mono text-[11px] uppercase tracking-[0.16em] text-depot-faint">
              {section.heading}
            </h3>
            {section.lines.map((line) => (
              <p key={line} className="depot-prose mt-1.5">
                {line}
              </p>
            ))}
          </div>
        ))}
      </div>
    </details>
  );
}
