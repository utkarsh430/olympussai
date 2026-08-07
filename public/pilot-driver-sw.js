// Service worker for the pilot-driver PWA (/ops/pilot-driver only).
//
// Registered from src/components/ops/pilot-driver/PwaRegister.tsx with
// `scope: '/ops/pilot-driver/'`. Served from the origin root (not from
// /pilot-driver/) specifically so that scope registration is allowed — a
// service worker's registrable scope defaults to its own script's
// directory, and only a root-served script can claim a scope elsewhere on
// the origin without a `Service-Worker-Allowed` response header.
//
// Two responsibilities, matching this ticket's AC3 ("Installable as PWA;
// cached shell and queued ack survive brief network interruption"):
//   1. Cache the app shell + last-known active-command response, serving
//      the cached copy when a fetch fails (network-first-with-fallback).
//   2. Flush the ack outbox (same IndexedDB database as
//      src/lib/pilotDriver/ackQueue.ts) on a background-sync event, so a
//      queued ack is retried even if no tab is open when connectivity
//      returns.
//
// Bumping either cache name below invalidates the old cache on the next
// install — do that whenever the shell asset list changes.
const SHELL_CACHE = 'pilot-driver-shell-v1';
const RUNTIME_CACHE = 'pilot-driver-runtime-v1';
const SHELL_URLS = [
  '/ops/pilot-driver',
  '/pilot-driver/manifest.webmanifest',
  '/pilot-driver/icon-192.png',
  '/pilot-driver/icon-512.png',
];

const ACK_QUEUE_DB_NAME = 'pilot-driver-command-queue';
const ACK_QUEUE_STORE = 'ack-outbox';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      Promise.all(
        SHELL_URLS.map((url) =>
          cache.add(url).catch(() => {
            // Best-effort: an unauthenticated install (e.g. before first
            // login) can't cache the driver page itself yet — the runtime
            // cache below still fills in once the driver is signed in.
          }),
        ),
      ),
    ),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== SHELL_CACHE && key !== RUNTIME_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function isNavigationRequest(request) {
  return request.mode === 'navigate';
}

function isActiveCommandPoll(url) {
  return url.pathname === '/api/ops/pilot-driver/commands';
}

/** Network-first: try the network, cache a successful GET response, fall back to cache on failure. */
async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return; // POST (ack) is handled by the page's own IndexedDB outbox, not here.

  const url = new URL(request.url);

  if (isNavigationRequest(request) && url.pathname.startsWith('/ops/pilot-driver')) {
    event.respondWith(networkFirst(request, SHELL_CACHE));
    return;
  }

  if (isActiveCommandPoll(url)) {
    event.respondWith(networkFirst(request, RUNTIME_CACHE));
    return;
  }
});

function openAckQueueDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(ACK_QUEUE_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ACK_QUEUE_STORE)) {
        db.createObjectStore(ACK_QUEUE_STORE, { keyPath: 'commandId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function listQueued(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ACK_QUEUE_STORE, 'readonly');
    const req = tx.objectStore(ACK_QUEUE_STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function removeQueued(db, commandId) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ACK_QUEUE_STORE, 'readwrite');
    tx.objectStore(ACK_QUEUE_STORE).delete(commandId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function flushAckQueue() {
  const db = await openAckQueueDb();
  const queued = await listQueued(db);
  const flushed = [];
  for (const entry of queued) {
    try {
      // No `vehicleId` sent — the server derives the vehicle to ack against
      // from the caller's own session/ops_users row
      // (src/app/api/ops/pilot-driver/commands/[id]/ack/route.ts), never
      // from client input. Queued entries themselves carry no vehicleId
      // either (src/lib/pilotDriver/ackQueue.ts), so sending one here would
      // only ever be `undefined` — this mirrors the page's own `sendAck` in
      // CommandConsole.tsx exactly, rather than leaving a field around that
      // implies the ack endpoint still trusts a client-supplied vehicle.
      const response = await fetch(`/api/ops/pilot-driver/commands/${encodeURIComponent(entry.commandId)}/ack`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outcome: entry.outcome, reason: entry.reason }),
      });
      if (response.ok || response.status === 409) {
        await removeQueued(db, entry.commandId);
        flushed.push(entry.commandId);
      }
    } catch {
      // Still offline — leave it queued, the next sync/online event retries.
    }
  }
  db.close();
  if (flushed.length > 0) {
    const clients = await self.clients.matchAll();
    for (const client of clients) client.postMessage({ type: 'ACK_QUEUE_FLUSHED', flushed });
  }
}

// Background Sync (Chrome/Android). Safari has no SyncManager, so
// PwaRegister.tsx also asks the page itself to flush on the `online` event
// as a fallback — both paths converge on the same IndexedDB outbox.
self.addEventListener('sync', (event) => {
  if (event.tag === 'flush-ack-queue') {
    event.waitUntil(flushAckQueue());
  }
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'FLUSH_ACK_QUEUE') {
    event.waitUntil(flushAckQueue());
  }
});
