/**
 * The single Google Maps JS loader for the whole application.
 *
 * `@googlemaps/js-api-loader` is a hard singleton: constructing a second Loader
 * with options that differ in any way throws, and constructing one repeatedly is
 * pointless because only one `<script>` is ever injected. Both the command
 * centre's fleet map and the bunching simulator's two maps therefore go through
 * this module, so the options can never drift apart and the SDK is fetched once
 * per session.
 *
 * The key is `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, which already exists in this
 * project's environment — read here, never hardcoded, and never logged. It is
 * public by design (browser JS can always see it) and is restricted by HTTP
 * referrer on the production key.
 */

import { Loader } from '@googlemaps/js-api-loader';

export const MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';

let instance: Loader | null = null;

/** True when a Maps key is configured for this environment. */
export function isMapsConfigured(): boolean {
  return MAPS_API_KEY.length > 0;
}

/** The shared loader. Callers use `importLibrary` and must not construct their own. */
export function getMapsLoader(): Loader {
  installAuthFailureHook();
  if (!instance) {
    instance = new Loader({ apiKey: MAPS_API_KEY, version: 'weekly' });
  }
  return instance;
}

/* ─────────────────────────────────────────────────────────────────────────
   AUTHENTICATION FAILURE
   ───────────────────────────────────────────────────────────────────────── */

/**
 * The failure mode neither map surface used to catch.
 *
 * A rejected `importLibrary` means the SDK could not be fetched, and both maps
 * handle that: they replace themselves with their own message pointing the
 * operator at the tables. But an API-key problem is not that. The script loads
 * perfectly, `importLibrary` RESOLVES, `new Map()` succeeds — and then Google
 * paints its own full-bleed white "Oops! Something went wrong" panel inside the
 * container and logs `RefererNotAllowedMapError`. From the app's point of view
 * the map is fine.
 *
 * On a dark operations console that is a large white rectangle where the fleet
 * should be, with no indication of what to do, and it is entirely reachable in
 * production: the key is referrer-restricted, so serving the console from a new
 * domain or port produces exactly this. Observed in a real browser while
 * reviewing the control room.
 *
 * `gm_authFailure` is Google's documented hook for it — a global the SDK calls
 * once on an authentication failure. It is registered here, in the one module
 * that owns the loader, so both the command centre and the ops console learn
 * about it rather than each discovering the problem separately.
 */
let authFailed = false;
const authFailureListeners = new Set<() => void>();
let hookInstalled = false;

function installAuthFailureHook(): void {
  if (hookInstalled || typeof window === 'undefined') return;
  hookInstalled = true;
  const w = window as typeof window & { gm_authFailure?: () => void };
  const existing = w.gm_authFailure;
  w.gm_authFailure = () => {
    authFailed = true;
    for (const listener of authFailureListeners) listener();
    existing?.();
  };
}

/** True once Google has reported the key as unusable for this origin. */
export function mapsAuthFailed(): boolean {
  return authFailed;
}

/**
 * Subscribe to the authentication failure. Fires immediately when it has
 * already happened, because a map mounted after the first failure would
 * otherwise wait forever for an event that has been and gone.
 */
export function onMapsAuthFailure(listener: () => void): () => void {
  installAuthFailureHook();
  if (authFailed) listener();
  authFailureListeners.add(listener);
  return () => authFailureListeners.delete(listener);
}
