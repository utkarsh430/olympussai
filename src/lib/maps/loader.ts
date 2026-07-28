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
  if (!instance) {
    instance = new Loader({ apiKey: MAPS_API_KEY, version: 'weekly' });
  }
  return instance;
}
