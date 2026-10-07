import { formatCount } from '@/lib/depot/format';
import { meaningTextClass, type DepotMeaning } from '@/lib/depot/palette';
import type { Provenance } from '@/lib/depot/types';
import { ProvenanceBadge } from './ProvenanceBadge';

export interface SectionLabelProps {
  readonly label: string;
  /** Shown after the label as "EXCEPTIONS · 49". */
  readonly count?: number;
  /** One line on the right, e.g. "Nearest first". Never a paragraph. */
  readonly note?: string;
  /** When the note names a severity or state ("Critical"), it is printed in that colour. */
  readonly noteTone?: DepotMeaning;
  /** Only when this section's provenance differs from the page's provenance line. */
  readonly tag?: Provenance;
  /** Heading level under the page's h1; 2 by default. */
  readonly level?: 2 | 3 | 4;
  /** For `aria-labelledby` on the section and for in-page anchors. */
  readonly id?: string;
  /**
   * The section's own controls (a view toggle, a filter), held at the right end of the
   * label row after the note. They wrap under the label when the row is too narrow.
   */
  readonly controls?: React.ReactNode;
}

/**
 * The heading of every supporting section: mono 11px uppercase,
 * tracking 0.16em, a hairline above, an optional count and an optional note on the
 * right. No paragraph under it: an explanation goes in the page's closing disclosure.
 */
export function SectionLabel({
  label,
  count,
  note,
  noteTone,
  tag,
  level = 2,
  id,
  controls,
}: SectionLabelProps) {
  const Heading = `h${level}` as const;
  return (
    <div
      data-testid="depot-section-label"
      className="mb-3 flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-depot-line pt-4"
    >
      <div className="depot-tag-fit flex min-w-0 items-baseline gap-2">
        <Heading
          id={id}
          className="min-w-0 scroll-mt-[var(--depot-anchor-mt)] font-mono text-[11px] font-normal uppercase leading-4 tracking-[0.16em] text-depot-muted"
        >
          {label}
          {count !== undefined ? <span className="tabular-nums"> · {formatCount(count)}</span> : null}
        </Heading>
        {tag ? <ProvenanceBadge provenance={tag} pill /> : null}
      </div>
      {note ? (
        <p className={noteTone ? `depot-note min-w-0 ${meaningTextClass(noteTone)}` : 'depot-note min-w-0'}>
          {note}
        </p>
      ) : null}
      {controls ? (
        <div data-testid="depot-section-controls" className="flex max-w-full shrink-0 flex-wrap items-center gap-1">
          {controls}
        </div>
      ) : null}
    </div>
  );
}
