import Link from 'next/link';
import { Children } from 'react';
import { figureBandGridClasses } from '@/lib/depot/shell/figureBandLayout';
import type { Provenance } from '@/lib/depot/types';
import { ProvenanceBadge } from './ProvenanceBadge';

export interface FigureBandProps {
  /** Names the band for screen readers ("Fleet figures"). */
  readonly label: string;
  /** Up to five `Figure`s. */
  readonly children: React.ReactNode;
  /**
   * ONE tag for the whole band, when every figure in it is generated and the page's default
   * is not (a MIXED or DERIVED page). The band's name and the tag then sit on a line above
   * the figures; no figure in the band carries its own tag.
   */
  readonly tag?: Provenance;
}

/**
 * A row of up to five figures separated by 1px vertical hairlines, with no box per
 * figure. Figures are a fixed width and LEFT-PACKED: 232px from
 * 1440px (five fill the 1,160px column exactly), 200px from 1280px (1,000px beside the
 * rail), 192px from 1024px (976px, no rail), so five always fit one row and a band of two to four
 * never stretches to leave wide gaps; it wraps when the column is narrower. Below 1024px
 * the band is a grid whose columns depend on how many figures it holds: two on a phone,
 * with an odd last figure spanning the row, so no figure is left alone in part of a row
 * (`figureBandLayout`). 88px tall: label 11/16, 6px, figure 24/28, 6px, caption 12/16,
 * with 8px above and below. The label row is a 16px line box (`depot-tag-row`), so a tag
 * beside a label that fits never lowers that figure; a label that does not fit wraps,
 * with its tag, onto a second line rather than being cut. A value is never cut either.
 *
 * Every figure carries a hairline on its left; the list is pulled 17px left (its 16px
 * padding plus the 1px hairline) inside a clipping wrapper, so the first figure of every
 * row, wrapped rows included, starts flush with the column and shows no hairline.
 */
export function FigureBand({ label, children, tag }: FigureBandProps) {
  return (
    <div className="depot-band mb-6 min-w-0 overflow-hidden border-y border-depot-line">
      {tag ? (
        <div data-testid="depot-figure-band-head" className="mt-2 depot-tag-row gap-2">
          <span className="depot-label truncate leading-4">{label}</span>
          <ProvenanceBadge provenance={tag} pill />
        </div>
      ) : null}
      <ul
        aria-label={label}
        data-testid="depot-figure-band"
        className={`-ml-[17px] grid w-[calc(100%+17px)] gap-y-3 py-2 lg:flex lg:flex-wrap ${figureBandGridClasses(
          Children.toArray(children).length,
        )}`}
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
  /** Makes the whole figure a link (a count that leads to its list). */
  readonly href?: string;
  /** Makes the whole figure a toggle button (a count that filters the page); see `pressed`. */
  readonly onPress?: () => void;
  /** With `onPress`: whether the toggle is on. Said to assistive technology, never colour alone. */
  readonly pressed?: boolean;
}

const INTERACTIVE =
  '-mx-2 block min-w-0 rounded-[3px] px-2 text-left hover:bg-depot-raised ' +
  'focus-visible:outline focus-visible:outline-1 focus-visible:outline-holo-glow';

/**
 * A band value: 24px on a 28px line from 640px, one step smaller (20px) on a phone, where
 * the widest values need it in half of a 360px column (`figureBandLayout`). Both sizes keep
 * the 28px line, which a size class alone would reset.
 */
const BAND_VALUE_SIZE = 'text-xl leading-7 sm:text-2xl sm:leading-7';

const clampShare = (share: number): number =>
  Number.isFinite(share) ? Math.min(1, Math.max(0, share)) : 0;

/**
 * One figure: label, value in mono 24px tabular numerals (20px on a phone), one caption line. Inside a
 * `FigureBand` it is a list item; with `hero` it may also stand alone as the page's
 * hero number.
 */
export function Figure(props: FigureProps) {
  const { label, value, caption, tag, share, hero = false, title, href, onPress, pressed } = props;
  // Inside a link or a button only phrasing content is valid, so the parts are spans there.
  const interactive = href !== undefined || onPress !== undefined;
  const Row = interactive ? 'span' : 'div';
  const Caption = interactive ? 'span' : 'p';
  const body = (
    <>
      <Row className="depot-tag-row h-auto min-h-4 flex-wrap gap-x-2 gap-y-1">
        <Row className="depot-label block min-w-0 break-words leading-4">{label}</Row>
        {tag ? <ProvenanceBadge provenance={tag} /> : null}
      </Row>
      <Row
        className={`mt-1.5 block break-words ${
          hero ? 'depot-hero-numeral' : `font-mono tabular-nums text-depot-ink ${BAND_VALUE_SIZE}`
        }`}
      >
        {value}
      </Row>
      {share !== undefined ? (
        <Row className="depot-bar-track mt-2 block min-w-0" aria-hidden>
          <Row
            className="depot-bar-fill block"
            data-testid="depot-figure-share"
            style={{ width: `${Math.round(clampShare(share) * 100)}%` }}
          />
        </Row>
      ) : null}
      {caption ? (
        <Caption className="depot-caption mt-1.5 block truncate" title={caption}>
          {caption}
        </Caption>
      ) : null}
    </>
  );
  return (
    <li
      title={title}
      className="min-w-0 list-none border-l border-depot-line px-4 lg:w-[192px] lg:flex-none xl:w-[200px] min-[1440px]:w-[232px]"
    >
      {href !== undefined ? (
        <Link href={href} className={INTERACTIVE}>
          {body}
        </Link>
      ) : onPress !== undefined ? (
        <button
          type="button"
          aria-pressed={pressed ?? false}
          onClick={onPress}
          className={`${INTERACTIVE} w-[calc(100%+1rem)] ${pressed ? 'bg-depot-raised' : ''}`}
        >
          {body}
        </button>
      ) : (
        body
      )}
      {title ? <p className="sr-only">{title}</p> : null}
    </li>
  );
}
