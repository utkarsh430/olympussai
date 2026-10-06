/**
 * Removes Google Maps event listeners, skipping handles the SDK never issued.
 *
 * `map.addListener` is typed to always return a handle, but it does not. When the key
 * is rejected for the page origin (referrer restriction, billing, disabled API), the
 * SDK calls `gm_authFailure` and replaces every Map/MVCObject prototype method with a
 * no-op, so from then on `addListener` returns `undefined` and registers nothing. A
 * listener added after that point (for example, when a bus is selected) has nothing to
 * remove; calling `.remove()` on the missing handle throws inside a React effect
 * cleanup and replaces the whole page with Next's application-error screen.
 */
export function removeMapListeners(
  listeners: ReadonlyArray<google.maps.MapsEventListener | undefined>,
): void {
  listeners.forEach((listener) => listener?.remove());
}
