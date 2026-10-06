import type { Provenance } from '@/lib/depot/types';
import { ProvenanceBadge } from './ProvenanceBadge';

export interface FigureBandProps {
  /** Names the band for screen readers ("Fleet figures"). */
  readonly label: string;
  /** Up to five `Figure`s. */
  readonly children: React.ReactNode;
}

/**
 * A row of up to five figures separated by 1px vertical hairlines, with no box per
 * figure (rulings, section 3). Figures are a fixed width and LEFT-PACKED: 232px from
 * 1280px (five fill a 1440 column exactly), 200px from 1024px, so a band of two to four
 * never stretches to leave wide gaps; it wraps when the column is narrower. Below 1024px
 * the band is two equal columns. 88px tall: label 11/16, 6px, figure 24/28, 6px,
 * caption 12/16, with 8px above and below.
 *
 * Every figure carries a hairline on its left; the list is pulled 17px left (its 16px
 * padding plus the 1px hairline) inside a clipping wrapper, so the first figure of every
 * row, wrapped rows included, starts flush with the column and shows no hairline.
 */
export function FigureBand({ label, children }: FigureBandProps) {
  return (
    <div className="mb-6 min-w-0 overflow-hidden border-y border-depot-line">
      <ul
        aria-label={label}
        data-testid="depot-figure-band"
        className="-ml-[17px] grid w-[calc(100%+17px)] grid-cols-2 gap-y-3 py-2 sm:grid-cols-3 lg:flex lg:flex-wrap"
      >
        {children}
      </ul>
    </div>
  );
}

export interface FigureProps {
  readonly label: string;
  /** Already formatted ("1,249", "82%", "—"). */
  readonly value: string;
  /** One line under the value. */
  readonly caption?: string;
  /** Only when this figure's provenance differs from the page's provenance line. */
  readonly tag?: Provenance;
  /** A share from 0 to 1, drawn as a thin fill bar under the value (capacity, coverage). */
  readonly share?: number;
  /** The page's single hero figure: display face at 32px. One per page at most. */
  readonly hero?: boolean;
  /**
   * The figure's one-line explanation: shown on hover and read as part of the figure by
   * assistive technology. The closing disclosure keeps the explanation too.
   */
  readonly title?: string;
}

const clampShare = (share: number): number =>
  Number.isFinite(share) ? Math.min(1, Math.max(0, share)) : 0;

/**
 * One figure: label, value in mono 24px tabular numerals, one caption line. Inside a
 * `FigureBand` it is a list item; with `hero` it may also stand alone as the page's
 * hero number.
 */
export function Figure(props: FigureProps) {
  const { label, value, caption, tag, share, hero = false, title } = props;
  return (
    <li
      title={title}
      className="min-w-0 list-none border-l border-depot-line px-4 lg:w-[200px] lg:flex-none xl:w-[232px]"
    >
      <div className="flex min-w-0 items-center gap-2">
        <div className="depot-label truncate leading-4" title={label}>
          {label}
        </div>
        {tag ? <ProvenanceBadge provenance={tag} /> : null}
      </div>
      <div
        className={`mt-1.5 truncate ${
          hero ? 'depot-hero-numeral' : 'font-mono text-2xl tabular-nums leading-7 text-depot-ink'
        }`}
      >
        {value}
      </div>
      {share !== undefined ? (
        <div className="depot-bar-track mt-2 min-w-0" aria-hidden>
          <div
            className="depot-bar-fill"
            data-testid="depot-figure-share"
            style={{ width: `${Math.round(clampShare(share) * 100)}%` }}
          />
        </div>
      ) : null}
      {caption ? (
        <p className="depot-caption mt-1.5 truncate" title={caption}>
          {caption}
        </p>
      ) : null}
      {title ? <p className="sr-only">{title}</p> : null}
    </li>
  );
}
