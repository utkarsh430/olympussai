import { formatCount } from '@/lib/depot/format';
import type { Provenance } from '@/lib/depot/types';
import { ProvenanceBadge } from './ProvenanceBadge';

export interface SectionLabelProps {
  readonly label: string;
  /** Shown after the label as "EXCEPTIONS · 49". */
  readonly count?: number;
  /** One line on the right, e.g. "Nearest first". Never a paragraph. */
  readonly note?: string;
  /** Only when this section's provenance differs from the page's provenance line. */
  readonly tag?: Provenance;
  /** Heading level under the page's h1; 2 by default. */
  readonly level?: 2 | 3 | 4;
  /** For `aria-labelledby` on the section and for in-page anchors. */
  readonly id?: string;
}

/**
 * The heading of every supporting section (rulings, section 3): mono 11px uppercase,
 * tracking 0.16em, a hairline above, an optional count and an optional note on the
 * right. No paragraph under it: an explanation goes in the page's closing disclosure.
 */
export function SectionLabel({ label, count, note, tag, level = 2, id }: SectionLabelProps) {
  const Heading = `h${level}` as const;
  return (
    <div
      data-testid="depot-section-label"
      className="mb-3 flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-depot-line pt-3"
    >
      <div className="flex min-w-0 items-baseline gap-2">
        <Heading
          id={id}
          className="min-w-0 scroll-mt-[var(--depot-anchor-mt)] font-mono text-[11px] font-normal uppercase tracking-[0.16em] text-depot-muted"
        >
          {label}
          {count !== undefined ? <span className="tabular-nums"> · {formatCount(count)}</span> : null}
        </Heading>
        {tag ? <ProvenanceBadge provenance={tag} /> : null}
      </div>
      {note ? <p className="min-w-0 font-sans text-[13px] text-depot-muted">{note}</p> : null}
    </div>
  );
}
