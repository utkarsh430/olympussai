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
 * figure (rulings, section 3; Fuel's band is the model). Two columns under 640px,
 * the full row from 640px. The hairlines are each figure's own left border, so an odd
 * count never leaves an empty tinted cell.
 */
export function FigureBand({ label, children }: FigureBandProps) {
  return (
    <ul
      aria-label={label}
      data-testid="depot-figure-band"
      className="mb-6 grid min-w-0 grid-cols-2 gap-y-4 border-y border-depot-line py-3 sm:flex sm:flex-wrap sm:gap-y-3"
    >
      {children}
    </ul>
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
      className="min-w-0 list-none px-4 max-sm:odd:pl-0 max-sm:even:border-l max-sm:even:border-depot-line sm:flex-1 sm:basis-28 sm:border-l sm:border-depot-line sm:first:border-l-0 sm:first:pl-0"
    >
      <div className="flex min-w-0 items-center gap-2">
        <div className="depot-label truncate">{label}</div>
        {tag ? <ProvenanceBadge provenance={tag} /> : null}
      </div>
      <div
        className={`mt-1 truncate ${
          hero ? 'depot-hero-numeral' : 'font-mono text-2xl leading-tight tabular-nums text-depot-ink'
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
      {caption ? <p className="depot-caption mt-1 truncate">{caption}</p> : null}
      {title ? <p className="sr-only">{title}</p> : null}
    </li>
  );
}
