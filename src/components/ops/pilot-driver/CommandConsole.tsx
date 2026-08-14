'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { Command, CommandAckOutcome } from '@/models/control';
import { commandActionLabel, commandReason } from '@/lib/pilotDriver/commandCopy';
import { enqueueAck, flushQueuedAcks, removeQueuedAck, type QueuedAck } from '@/lib/pilotDriver/ackQueue';
import { OpsAlert, OpsPanel } from '@/components/ops/ui';

const POLL_INTERVAL_MS = 4_000;

type AckPhase = 'idle' | 'sending' | 'queued' | 'sent' | 'error';
type VehicleState = 'loading' | 'assigned' | 'unassigned' | 'error';

interface ActiveCommandApiResponse {
  command: Command | null;
}

interface SessionApiResponse {
  authenticated: boolean;
  vehicleId?: string | null;
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
    body: JSON.stringify({ outcome: entry.outcome, reason: entry.reason }),
  });
  // A 409 (command no longer active — already acked elsewhere, superseded,
  // or expired; also returned when no vehicle is assigned) is not a
  // transient failure: retrying it forever would never succeed, so treat it
  // as "done" and drop it from the queue rather than leaving it stuck.
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
  // The assigned vehicle is never self-reported by the driver — it comes
  // from the caller's own session/ops_users row
  // (GET /api/ops/auth/session, backed by
  // db/migrations/20260806180000__ops_users_vehicle_assignment.sql, set
  // only by an admin). This closes the A01 gap where a `pilot_driver`
  // account could previously type in any vehicleId and observe/ack that
  // vehicle's commands.
  const [vehicleState, setVehicleState] = useState<VehicleState>('loading');
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [command, setCommand] = useState<Command | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [ackPhase, setAckPhase] = useState<AckPhase>('idle');
  const [ackError, setAckError] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(true);

  const statusRegionId = useId();
  const activeCommandRef = useRef<Command | null>(null);
  activeCommandRef.current = command;

  // Look up the caller's own assigned vehicle from the session — never from
  // client input.
  useEffect(() => {
    let cancelled = false;
    async function loadVehicle() {
      try {
        const response = await fetch('/api/ops/auth/session', { cache: 'no-store' });
        if (!response.ok) throw new Error(`session lookup failed with status ${response.status}`);
        const data = (await response.json()) as SessionApiResponse;
        if (cancelled) return;
        if (data.vehicleId) {
          setVehicleId(data.vehicleId);
          setVehicleState('assigned');
        } else {
          setVehicleState('unassigned');
        }
      } catch {
        if (!cancelled) setVehicleState('error');
      }
    }
    loadVehicle();
    return () => {
      cancelled = true;
    };
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
    if (vehicleState !== 'assigned') return;
    let cancelled = false;

    async function poll() {
      try {
        // No vehicleId is sent — the server derives it from the caller's
        // own session/ops_users row (A01 fix, see the route handler).
        const response = await fetch('/api/ops/pilot-driver/commands', { cache: 'no-store' });
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
  }, [vehicleState]);

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

  async function handleAck(outcome: CommandAckOutcome) {
    if (!command || ackPhase === 'sending') return;
    const entry: QueuedAck = {
      commandId: command.id,
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
    <div className="space-y-4">
      {!isOnline && (
        <OpsAlert tone="warning">
          Offline — showing the last known command. Any response you send will be queued and delivered
          automatically once you&rsquo;re back online.
        </OpsAlert>
      )}

      <OpsPanel title="Your vehicle" headingLevel={2}>
        {vehicleState === 'loading' && <p className="text-base text-ops-muted">Loading your vehicle assignment…</p>}
        {vehicleState === 'assigned' && (
          <p className="font-mono text-xl tracking-wide text-ops-ink">{vehicleId}</p>
        )}
        {vehicleState === 'unassigned' && (
          <p className="text-base leading-relaxed text-ops-warn">
            No vehicle is assigned to your account yet. Contact your admin to be assigned one.
          </p>
        )}
        {vehicleState === 'error' && (
          <p className="text-base leading-relaxed text-ops-danger">Could not load your vehicle assignment. Try reloading.</p>
        )}
      </OpsPanel>

      <OpsPanel
        title="Active command"
        headingLevel={2}
        tone={command && vehicleState === 'assigned' ? 'accent' : 'default'}
        aria-live="polite"
        id={statusRegionId}
      >
        {vehicleState !== 'assigned' && (
          <p className="text-base text-ops-muted">Waiting for a vehicle assignment to receive commands.</p>
        )}

        {vehicleState === 'assigned' && !command && (
          <p className="text-base text-ops-muted">
            No active command right now.
            {pollError && <span className="mt-1.5 block text-sm text-ops-warn">{pollError}</span>}
          </p>
        )}

        {vehicleState === 'assigned' && command && (
          <div className="space-y-5">
            <div>
              <p className="text-2xl font-semibold leading-tight text-ops-ink">{commandActionLabel(command.actionType)}</p>
              <p className="mt-2 text-base leading-relaxed text-ops-muted">{commandReason(command)}</p>
            </div>

            <div>
              <p className="ops-eyebrow mb-1">Time to respond</p>
              <p className="font-mono text-4xl tabular-nums text-holo-glow" aria-label="Time remaining to respond">
                {remainingSeconds !== null ? formatCountdown(remainingSeconds) : '—'}
              </p>
            </div>

            {alreadyResolved ? (
              <p role="status" className="text-base font-semibold text-ops-good">
                {ackPhase === 'sent'
                  ? 'Response sent.'
                  : "Response saved on this device — it will be sent automatically once you're back online."}
              </p>
            ) : (
              /* One full-width button per row on a phone, three across from
                 `sm` up. Stacked is deliberate: three side-by-side targets on a
                 360px screen are ~100px wide each, and the difference between
                 "I can do this" and "this is not safe" is not a tap a driver
                 should be able to fumble. The min-height is raised from the
                 44px minimum to 64px for the same reason - this is operated in
                 a moving cab. */
              <div className="grid gap-3 sm:grid-cols-3">
                <button
                  type="button"
                  onClick={() => handleAck('accept')}
                  disabled={acknowledging}
                  className="min-h-16 rounded-md border border-ops-good/50 bg-ops-good/10 px-4 py-4 font-mono text-base uppercase tracking-[0.14em] text-ops-good hover:border-ops-good focus-visible:outline focus-visible:outline-2 focus-visible:outline-ops-good disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Ack
                </button>
                <button
                  type="button"
                  onClick={() => handleAck('unable')}
                  disabled={acknowledging}
                  className="min-h-16 rounded-md border border-ops-warn/50 bg-ops-warn/10 px-4 py-4 font-mono text-base uppercase tracking-[0.14em] text-ops-warn hover:border-ops-warn focus-visible:outline focus-visible:outline-2 focus-visible:outline-ops-warn disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Unable
                </button>
                <button
                  type="button"
                  onClick={() => handleAck('unsafe')}
                  disabled={acknowledging}
                  className="min-h-16 rounded-md border border-alert-crimson/50 bg-alert-crimson/10 px-4 py-4 font-mono text-base uppercase tracking-[0.14em] text-alert-crimson hover:border-alert-crimson focus-visible:outline focus-visible:outline-2 focus-visible:outline-alert-crimson disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Unsafe
                </button>
              </div>
            )}

            {ackError && (
              <p role="alert" className="text-base text-ops-danger">
                {ackError}
              </p>
            )}
            <p className="text-sm leading-relaxed text-ops-faint">
              Unable and unsafe are recorded exactly like ack — no penalty is applied either way.
            </p>
          </div>
        )}
      </OpsPanel>
    </div>
  );
}
