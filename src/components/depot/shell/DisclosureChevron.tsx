export interface DisclosureChevronProps {
  /** Turned a quarter when open (a React-held open state). */
  readonly open?: boolean;
  /** Turned when an enclosing `<details className="group">` is open (no React state). */
  readonly groupOpen?: boolean;
}

/**
 * The one disclosure glyph (design critique round 4, G): the chevron "›", muted, never
 * cyan, turned a quarter when open. Every disclosure uses it: the closing disclosure, a
 * collapsed section, a table row expander and "Show all N". Decorative: the control it
 * sits in carries `aria-expanded`.
 */
export function DisclosureChevron({ open = false, groupOpen = false }: DisclosureChevronProps) {
  const turn = open ? 'rotate-90' : groupOpen ? 'group-open:rotate-90' : '';
  return (
    <span
      aria-hidden
      data-testid="depot-disclosure-chevron"
      className={`inline-block w-3 shrink-0 text-center text-depot-muted ${turn}`}
    >
      ›
    </span>
  );
}
