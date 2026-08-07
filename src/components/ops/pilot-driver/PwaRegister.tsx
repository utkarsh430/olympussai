'use client';

import { useEffect } from 'react';

const SW_URL = '/pilot-driver-sw.js';
const SW_SCOPE = '/ops/pilot-driver/';

// The Background Sync API (registration.sync) is not part of TypeScript's
// bundled DOM lib (it never shipped in the relevant W3C snapshot TS tracks)
// even though it ships in Chromium. Declared locally, as an optional
// property, rather than widening the global `ServiceWorkerRegistration`
// type app-wide.
interface SyncManager {
  register(tag: string): Promise<void>;
}
interface ServiceWorkerRegistrationWithSync extends ServiceWorkerRegistration {
  sync?: SyncManager;
}

/**
 * Registers the pilot-driver service worker (AC3: "Installable as PWA;
 * cached shell and queued ack survive brief network interruption").
 * Renders nothing — a side-effect-only component, mounted once from
 * (ops)/ops/pilot-driver/page.tsx. Scoped to `/ops/pilot-driver/` only, so
 * this never affects caching/offline behavior anywhere else in the app.
 */
export function PwaRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    let registration: ServiceWorkerRegistration | undefined;

    navigator.serviceWorker
      .register(SW_URL, { scope: SW_SCOPE })
      .then((reg) => {
        registration = reg;
        // Background Sync (no-op where unsupported, e.g. Safari — the
        // `online` listener below is the fallback for those browsers).
        const syncCapable = reg as ServiceWorkerRegistrationWithSync;
        syncCapable.sync?.register('flush-ack-queue').catch(() => undefined);
      })
      .catch(() => undefined);

    function flushViaFallback() {
      registration?.active?.postMessage({ type: 'FLUSH_ACK_QUEUE' });
    }
    window.addEventListener('online', flushViaFallback);
    return () => window.removeEventListener('online', flushViaFallback);
  }, []);

  return null;
}
