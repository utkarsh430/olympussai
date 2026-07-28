/**
 * Google Maps authentication-failure notification.
 *
 * When the Maps JS SDK loads but the key is rejected for the requesting origin
 * (referrer restriction, billing, disabled API), the SDK does not reject the
 * `importLibrary` promise — it resolves normally, the map object is created, and
 * then Google paints its own English "Oops! Something went wrong" panel inside
 * the map div. The only programmatic signal is the global `gm_authFailure`
 * callback.
 *
 * This module is strictly opt-in: the global is installed on the first
 * subscription and restored once the last subscriber goes away, so a surface
 * that does not subscribe keeps exactly its current behaviour.
 */

declare global {
  interface Window {
    gm_authFailure?: () => void;
  }
}

type Listener = () => void;

const listeners = new Set<Listener>();
let installed = false;
let previousHandler: (() => void) | undefined;

/** Subscribe to Maps auth failure. Returns an unsubscribe function. */
export function onMapsAuthFailure(listener: Listener): () => void {
  listeners.add(listener);

  if (!installed && typeof window !== 'undefined') {
    installed = true;
    // Chain rather than clobber, in case something else already installed one.
    previousHandler = window.gm_authFailure;
    window.gm_authFailure = () => {
      previousHandler?.();
      listeners.forEach((notify) => notify());
    };
  }

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && installed && typeof window !== 'undefined') {
      window.gm_authFailure = previousHandler;
      previousHandler = undefined;
      installed = false;
    }
  };
}
