import { HowProduced } from '@/components/depot/shell/HowProduced';

export interface DisclosureSection {
  readonly heading: string;
  readonly lines: readonly string[];
}

export interface FiguresDisclosureProps {
  readonly sections: readonly DisclosureSection[];
}

/**
 * The page's one closing disclosure, closed by default: the
 * definitions, assumptions and limits a page used to put before its content.
 * The disclosure is the shared one; this adds the headed sections.
 */
export function FiguresDisclosure({ sections }: FiguresDisclosureProps) {
  return (
    <HowProduced testId="depot-disclosure">
      <div className="flex flex-col gap-4">
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
    </HowProduced>
  );
}
