/**
 * Pure arithmetic and wording for `DataTable`'s row treatment (design critique round 5,
 * section 5): the expander's chevron is the FIRST column and 24px wide; a frozen table
 * freezes that column and the first data column together; a row that opens something is
 * itself the control and carries a name. Kept out of the component so it is tested
 * without a browser.
 */

import { EXPANDER_WIDTH_PX } from '@/lib/depot/shell/tableWidth';

/** The expander column's width, from the shared table-width model so both read one number. */
export { EXPANDER_WIDTH_PX };

/**
 * The `left` offset of each frozen column, from the frozen columns' widths in order: the
 * first sticks at 0, each next one where the ones before it end. With the expander the
 * widths are `[24]` (the first data column's own width is not needed), so the first data
 * column sticks at 24px.
 */
export function frozenOffsets(widthsPx: readonly number[]): readonly number[] {
  return widthsPx.map((_width, index) =>
    widthsPx.slice(0, index).reduce((sum, width) => sum + width, 0),
  );
}

/** How many leading columns a frozen table keeps in place: the chevron's and the first data column. */
export function frozenColumnCount(hasExpander: boolean): number {
  return hasExpander ? 2 : 1;
}

/** The `left` of each frozen column, the chevron column counted when there is one. */
export function frozenLefts(hasExpander: boolean): readonly number[] {
  const widths = hasExpander ? [EXPANDER_WIDTH_PX, 0] : [0];
  return frozenOffsets(widths);
}

export type RowAction =
  | { readonly kind: 'open' }
  | { readonly kind: 'expand'; readonly open: boolean };

/**
 * The accessible name of a row that is itself the control: what the row is, then what
 * Enter does ("UP13CT7020, open"; "Duty 4, show details"). The row's cells stay readable
 * cell by cell in table navigation; this is what the row is called when it takes focus.
 */
export function rowActionName(name: string, action: RowAction): string {
  const subject = name.trim() === '' ? 'Row' : name.trim();
  if (action.kind === 'open') return `${subject}, open`;
  return `${subject}, ${action.open ? 'hide details' : 'show details'}`;
}

/**
 * The words that name a row: a string the first column renders, else that column's
 * `title`, else the row's key. Never a React node, so it can be an attribute.
 */
export function rowNameText(
  rendered: unknown,
  title: string | undefined,
  key: string,
): string {
  if (typeof rendered === 'string' && rendered.trim() !== '') return rendered;
  if (typeof rendered === 'number') return String(rendered);
  if (title !== undefined && title.trim() !== '') return title;
  return key;
}
