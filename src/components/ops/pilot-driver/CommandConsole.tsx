'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { Command, CommandAckOutcome } from '@/models/control';
import { commandActionLabel, commandReason } from '@/lib/pilotDriver/commandCopy';
import { enqueueAck, flushQueuedAcks, removeQueuedAck, type QueuedAck } from '@/lib/pilotDriver/ackQueue';

const VEHICLE_ID_STORAGE_KEY = 'ops.pilotDriver.vehicleId';
const POLL_INTERVAL_MS = 4_000;

type AckPhase = 'idle' | 'sending' | 'queued' | 'sent' | 'error';

interface ActiveCommandApiResponse {
  command: Command | null;
}

function formatCountdown(seconds: number): string {
  const clamped = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(clamped / 60);
  const s = clamped % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

async function sendAck(entry: QueuedAck): Promise<boolean> {
  const response = await fetch(`/api/ops/pilot-driver/commands/${encodeURIComponent(entry.commandId)}/ack`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vehicleId: entry.vehicleId, outcome: entry.outcome, reason: entry.reason }),
  });
  // A 409 (command no longer active — already acked elsewhere, superseded,
  // or expired) is not a transient failure: retrying it forever would never
  // succeed, so treat it as "done" and drop it from the queue rather than
  // leaving it stuck.
  if (response.status === 409) return true;
  return response.ok;
}

/**
 * The driver PWA's single-instruction command interface (AC1/AC2/AC3):
 * shows at most one active command with a live countdown and plain-
 * language reason, offers single-tap ACK/UNABLE/UNSAFE, and queues an ack
 * durably (IndexedDB, via src/lib/pilotDriver/ackQueue.ts) so a brief
 * network interruption never loses it.
 */
export function CommandConsole() {
  const [vehicleId, setVehicleId] = useState('');
  const [vehicleIdDraft, setVehicleIdDraft] = useState('');
  const [command, setCommand] = useState<Command | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [ackPhase, setAckPhase] = useState<AckPhase>('idle');
  const [ackError, setAckError] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(true);

  const vehicleFieldId = useId();
  const statusRegionId = useId();
  const activeCommandRef = useRef<Command | null>(null);
  activeCommandRef.current = command;

  // Restore the remembered vehicle (same self-reported-vehicle convention
  // as DriverDashboard/ScheduleLookupForm — this RBAC schema has no
  // driver-to-vehicle assignment to read it from instead).
  useEffect(() => {
    try {
      const remembered = window.localStorage.getItem(VEHICLE_ID_STORAGE_KEY);
      if (remembered) {
        setVehicleId(remembered);
        setVehicleIdDraft(remembered);
      }
    } catch {
      // Ignore — remembering the vehicle is a convenience, never required.
    }
  }, []);

  useEffect(() => {
    setIsOnline(navigator.onLine);
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  const flushQueue = useCallback(async () => {
    const { flushed } = await flushQueuedAcks(sendAck);
    if (flushed.length > 0) {
      setAckPhase('sent');
      setAckError(null);
    }
  }, []);

  // Flush any ack queued from a previous session/network drop as soon as
  // we're back online, plus once eagerly on mount.
  useEffect(() => {
    flushQueue().catch(() => undefined);
  }, [flushQueue]);
  useEffect(() => {
    if (!isOnline) return;
    flushQueue().catch(() => undefined);
  }, [isOnline, flushQueue]);

  // Poll for the one active command (AC1). Deliberately does NOT clear the
  // last-known command on a failed poll — a dropped request should not
  // blank out a command the driver is currently reading (AC3's "cached
  // shell ... survive brief network interruption").
  useEffect(() => {
    if (!vehicleId) return;
    let cancelled = false;

    async function poll() {
      try {
        const response = await fetch(`/api/ops/pilot-driver/commands?vehicleId=${encodeURIComponent(vehicleId)}`, {
          cache: 'no-store',
        });
        if (!response.ok) throw new Error(`poll failed with status ${response.status}`);
        const data = (await response.json()) as ActiveCommandApiResponse;
        if (cancelled) return;
        setPollError(null);
        // A newly-fetched command replaces whatever was shown before,
        // including clearing a locally-expired one once the server confirms
        // it too. If the command we just acked is still being reported
        // (webhook/read lag), keep showing "acked" rather than reviving it.
        if (data.command && data.command.id === activeCommandRef.current?.id && ackPhase === 'sent') {
          return;
        }
        setCommand(data.command);
        if (data.command) setAckPhase('idle');
      } catch {
        if (!cancelled) setPollError('Could not reach the command service — showing the last known command.');
      }
    }

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // ackPhase intentionally excluded — it is read via a ref-like check
    // above but shouldn't restart the poll loop on every ack state change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicleId]);

  // Live countdown + client-side auto-expiry (AC1: "auto-expiry on TTL
  // lapse"). Ticks every second independent of the poll interval so the
  // driver sees a smooth countdown, and hides the command locally the
  // instant it lapses rather than waiting up to POLL_INTERVAL_MS for the
  // next poll to notice.
  useEffect(() => {
    if (!command) {
      setRemainingSeconds(null);
      return;
    }
    const expiresAt = new Date(command.expiresAt).getTime();
    const commandId = command.id;

    function tick() {
      const remaining = (expiresAt - Date.now()) / 1000;
      setRemainingSeconds(remaining);
      if (remaining <= 0) {
        setCommand((current) => (current?.id === commandId ? null : current));
      }
    }

    tick();
    const interval = setInterval(tick, 1_000);
    return () => clearInterval(interval);
  }, [command]);

  function handleVehicleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = vehicleIdDraft.trim();
    if (!trimmed) return;
    setVehicleId(trimmed);
    try {
      window.localStorage.setItem(VEHICLE_ID_STORAGE_KEY, trimmed);
    } catch {
      // Ignore — remembering the vehicle is a convenience, never required.
    }
  }

  async function handleAck(outcome: CommandAckOutcome) {
    if (!command || ackPhase === 'sending') return;
    const entry: QueuedAck = {
      commandId: command.id,
      vehicleId,
      outcome,
      reason: null,
      queuedAt: new Date().toISOString(),
    };

    setAckPhase('sending');
    setAckError(null);
    try {
      // Written to the durable outbox before the network call — the ack is
      // never lost even if the fetch below never resolves (AC3).
      await enqueueAck(entry);
    } catch {
      setAckPhase('error');
      setAckError('Could not save this response on this device. Please try again.');
      return;
    }

    try {
      const ok = await sendAck(entry);
      if (ok) {
        await removeQueuedAck(entry.commandId);
        setAckPhase('sent');
      } else {
        setAckPhase('queued');
      }
    } catch {
      // Offline or unreachable — stays in the outbox, retried on the next
      // `online` event or poll-triggered flush.
      setAckPhase('queued');
    }
  }

  const acknowledging = ackPhase === 'sending';
  const alreadyResolved = ackPhase === 'sent' || ackPhase === 'queued';

  return (
    <div className="space-y-6">
      {!isOnline && (
        <p role="status" className="rounded-md border border-[#c9a24d]/40 bg-[#c9a24d]/10 px-3 py-2 text-xs text-[#e0c17a]">
          Offline — showing the last known command. Any response you send will be queued and delivered
          automatically once you&rsquo;re back online.
        </p>
      )}

      <section className="rounded-md border border-[rgba(255,255,255,0.08)] p-4">
        <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-[#6f7684]">Your vehicle</h2>
        <form onSubmit={handleVehicleSubmit} className="flex flex-wrap items-end gap-3">
          <div className="flex-1">
            <label htmlFor={vehicleFieldId} className="mb-1 block text-xs text-[#9aa0ad]">
              Vehicle registration
            </label>
            <input
              id={vehicleFieldId}
              value={vehicleIdDraft}
              onChange={(e) => setVehicleIdDraft(e.target.value)}
              placeholder="e.g. UP25FT4823"
              className="w-full min-h-11 rounded-md border border-[rgba(255,255,255,0.12)] bg-[rgba(10,11,16,0.6)] px-3 py-2 text-sm text-[#e6e9ef] placeholder:text-[#707580] focus:border-[#4f8cff]/70 focus:outline-none"
            />
          </div>
          <button
            type="submit"
            className="min-h-11 rounded-md border border-[rgba(255,255,255,0.14)] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[#9aa0ad] hover:border-[#4f8cff]/60 hover:text-[#8fb4ff] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#4f8cff]"
          >
            Save
          </button>
        </form>
      </section>

      <section aria-live="polite" id={statusRegionId} className="rounded-md border border-[rgba(255,255,255,0.08)] p-4">
        <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-[#6f7684]">Active command</h2>

        {!vehicleId && <p className="text-sm text-[#9aa0ad]">Enter your vehicle above to receive commands.</p>}

        {vehicleId && !command && (
          <p className="text-sm text-[#9aa0ad]">
            No active command right now.
            {pollError && <span className="mt-1 block text-xs text-[#e0c17a]">{pollError}</span>}
          </p>
        )}

        {vehicleId && command && (
          <div className="space-y-4">
            <div>
              <p className="text-lg font-semibold text-[#e6e9ef]">{commandActionLabel(command.actionType)}</p>
              <p className="mt-1 text-sm text-[#9aa0ad]">{commandReason(command)}</p>
            </div>

            <p className="font-mono text-2xl tabular-nums text-[#8fb4ff]" aria-label="Time remaining to respond">
              {remainingSeconds !== null ? formatCountdown(remainingSeconds) : '—'}
            </p>

            {alreadyResolved ? (
              <p role="status" className="text-sm text-[#7fd9a4]">
                {ackPhase === 'sent'
                  ? 'Response sent.'
                  : "Response saved on this device — it will be sent automatically once you're back online."}
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-3">
                <button
                  type="button"
                  onClick={() => handleAck('accept')}
                  disabled={acknowledging}
                  className="min-h-11 rounded-md border border-[#7fd9a4]/50 bg-[#7fd9a4]/10 px-4 py-3 font-mono text-[12px] uppercase tracking-[0.14em] text-[#7fd9a4] hover:border-[#7fd9a4] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#7fd9a4] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Ack
                </button>
                <button
                  type="button"
                  onClick={() => handleAck('unable')}
                  disabled={acknowledging}
                  className="min-h-11 rounded-md border border-[#e0c17a]/50 bg-[#e0c17a]/10 px-4 py-3 font-mono text-[12px] uppercase tracking-[0.14em] text-[#e0c17a] hover:border-[#e0c17a] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#e0c17a] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Unable
                </button>
                <button
                  type="button"
                  onClick={() => handleAck('unsafe')}
                  disabled={acknowledging}
                  className="min-h-11 rounded-md border border-[#f0857d]/50 bg-[#f0857d]/10 px-4 py-3 font-mono text-[12px] uppercase tracking-[0.14em] text-[#f0857d] hover:border-[#f0857d] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#f0857d] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Unsafe
                </button>
              </div>
            )}

            {ackError && (
              <p role="alert" className="text-sm text-[#f0857d]">
                {ackError}
              </p>
            )}
            <p className="text-xs text-[#6f7684]">
              Unable and unsafe are recorded exactly like ack — no penalty is applied either way.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
