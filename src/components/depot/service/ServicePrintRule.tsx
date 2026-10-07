/*
 * The print layout of a page that carries the daily brief: on paper, the brief and the
 * proposals table (its page of rows, largest first) only. The rule travels with the two
 * components rather than with a page, so it holds wherever they are mounted: anything that
 * is neither one of them, inside one, nor an ancestor of one is not printed, and the
 * buttons inside them are not printed either. A page without the brief prints as it is.
 */

/** Set on the brief's section: its presence turns the rule on. */
export const PRINT_BRIEF_ATTR = 'data-print-brief';
/** Set on the proposals' section: kept on paper beside the brief. */
export const PRINT_KEEP_ATTR = 'data-print-keep';

const KEPT = `[${PRINT_BRIEF_ATTR}], [${PRINT_KEEP_ATTR}]`;

export const SERVICE_PRINT_CSS = `@media print {
  body:has([${PRINT_BRIEF_ATTR}]) *:not(:is(${KEPT})):not(:is(${KEPT}) *):not(:has(${KEPT})) {
    display: none !important;
  }
  :is(${KEPT}) button, :is(${KEPT}) input { display: none !important; }
}`;

/**
 * The rule as a stylesheet React hoists into the head once, however many components
 * render it (same `href`).
 */
export function ServicePrintRule() {
  return (
    <style href="depot-service-print" precedence="default">
      {SERVICE_PRINT_CSS}
    </style>
  );
}
