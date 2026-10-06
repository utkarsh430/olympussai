import { flushSync } from 'react-dom';

/** The selected-unit heading in the map panel: always on the page, so a stable place for focus. */
export const PANEL_HEADING_ID = 'depot-panel-heading';

/**
 * Clears the selection and keeps keyboard focus on the page: the Clear button
 * unmounts with the selection, so focus would fall to the body. The update is
 * flushed first so the heading that stays is the one that takes focus.
 */
export function clearSelection(onClear: () => void): void {
  flushSync(onClear);
  document.getElementById(PANEL_HEADING_ID)?.focus({ preventScroll: true });
}
