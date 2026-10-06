/**
 * The laid-out width of a table: the sum of its shown columns' widths, plus the expander's
 * column when the table has one. Every page's column model sums through this one function,
 * so a column with no width is an error everywhere (it would otherwise count as 0 and let
 * a table that cuts a column pass its layout test).
 */

/** The expander column: the chevron's 24px, no padding, so the next frozen cell starts here. */
export const EXPANDER_WIDTH_PX = 24;

export interface TableWidthOptions {
  /** True when the table leads with the expander's chevron column. */
  readonly expander?: boolean;
}

export function tableWidth<K extends string>(
  widths: Readonly<Partial<Record<K, number>>>,
  keys: readonly K[],
  options: TableWidthOptions = {},
): number {
  const start = options.expander === true ? EXPANDER_WIDTH_PX : 0;
  return keys.reduce((sum, key) => {
    const width = widths[key];
    if (width === undefined) throw new Error(`table column ${key} has no width`);
    return sum + width;
  }, start);
}
