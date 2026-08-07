/**
 * IndexedDB-backed outbox for queued command acks — the offline half of
 * AC3 ("queued ack survive brief network interruption"). A tap on
 * ACK/UNABLE/UNSAFE writes here *before* attempting the network call
 * (src/components/ops/pilot-driver/CommandConsole.tsx), so the ack is
 * durable across a page reload or a dropped connection even if the fetch
 * itself never completes. The service worker's `sync` handler
 * (public/pilot-driver/sw.js) reads/writes this same database by name so a
 * queued ack can flush even if no tab is open when connectivity returns.
 *
 * Browser-only (uses the global `indexedDB`) — never imported from a
 * server module.
 */

export const ACK_QUEUE_DB_NAME = 'pilot-driver-command-queue';
export const ACK_QUEUE_STORE = 'ack-outbox';
const DB_VERSION = 1;

export interface QueuedAck {
  commandId: string;
  // No `vehicleId` here (and none is sent to the ack endpoint) — the server
  // derives the vehicle from the caller's own session/ops_users row
  // (src/app/api/ops/pilot-driver/commands/[id]/ack/route.ts), never from
  // client-supplied data. Keeping it out of the queued/sent payload means
  // there is no client-controlled field left that could affect which
  // vehicle's command gets acked.
  outcome: 'accept' | 'unable' | 'unsafe';
  reason: string | null;
  queuedAt: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this environment.'));
      return;
    }
    const request = indexedDB.open(ACK_QUEUE_DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ACK_QUEUE_STORE)) {
        db.createObjectStore(ACK_QUEUE_STORE, { keyPath: 'commandId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open the ack queue database.'));
  });
}

export async function enqueueAck(entry: QueuedAck): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(ACK_QUEUE_STORE, 'readwrite');
      tx.objectStore(ACK_QUEUE_STORE).put(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Failed to queue the ack.'));
    });
  } finally {
    db.close();
  }
}

export async function removeQueuedAck(commandId: string): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(ACK_QUEUE_STORE, 'readwrite');
      tx.objectStore(ACK_QUEUE_STORE).delete(commandId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Failed to clear the queued ack.'));
    });
  } finally {
    db.close();
  }
}

export async function listQueuedAcks(): Promise<QueuedAck[]> {
  const db = await openDb();
  try {
    return await new Promise<QueuedAck[]>((resolve, reject) => {
      const tx = db.transaction(ACK_QUEUE_STORE, 'readonly');
      const request = tx.objectStore(ACK_QUEUE_STORE).getAll();
      request.onsuccess = () => resolve(request.result as QueuedAck[]);
      request.onerror = () => reject(request.error ?? new Error('Failed to list queued acks.'));
    });
  } finally {
    db.close();
  }
}

/**
 * Attempts to send every queued ack via `send`, removing each on success
 * and leaving it queued (for the next retry) on failure. Called on mount,
 * on the browser's `online` event, and from the service worker's `sync`
 * event handler.
 */
export async function flushQueuedAcks(
  send: (entry: QueuedAck) => Promise<boolean>,
): Promise<{ flushed: string[]; remaining: string[] }> {
  const queued = await listQueuedAcks();
  const flushed: string[] = [];
  const remaining: string[] = [];
  for (const entry of queued) {
    try {
      const ok = await send(entry);
      if (ok) {
        await removeQueuedAck(entry.commandId);
        flushed.push(entry.commandId);
      } else {
        remaining.push(entry.commandId);
      }
    } catch {
      remaining.push(entry.commandId);
    }
  }
  return { flushed, remaining };
}
