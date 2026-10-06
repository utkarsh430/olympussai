/** Id of the element inside the depot shell that dialogs and drawers are portalled to. */
export const DEPOT_PORTAL_ROOT_ID = 'depot-portal-root';

/**
 * Where the module's dialogs and drawers are portalled. The module's sans typeface is a
 * CSS variable set on a wrapper inside the page, and its type defaults live on the shell;
 * a dialog portalled to `<body>` sits outside both, so its text falls back to the browser's
 * serif face. The root sits inside the shell; `<body>` is the fallback when a component is
 * rendered on its own (a test, a story).
 */
export function depotPortalRoot(doc: Document = document): HTMLElement {
  return doc.getElementById(DEPOT_PORTAL_ROOT_ID) ?? doc.body;
}
