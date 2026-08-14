'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { Command, CommandAckOutcome } from '@/models/control';
import { commandActionLabel, commandReason } from '@/lib/pilotDriver/commandCopy';
import {
  enqueueAck,
  flushQueuedAcks,
  removeQueuedAck,
  type QueuedAck,
} from '@/lib/pilotDriver/ackQueue';
import { CONSOLE_COPY, NO_PENALTY, RESPONSE_CHOICES } from '@/lib/pilotDriver/driverCopy';
import { OpsBilingual, OpsIdentifier } from '@/components/ops/ui';
import { cn } from '@/lib/utils';

const POLL_INTERVAL_MS = 4_000;

/**
 * When the countdown starts reading as urgent.
 *
 * 60 s, and it changes THREE things at once — the bar's colour, the bar's
 * remaining length, and the word under it. Never colour alone: roughly one in
 * twelve male drivers cannot separate the amber/red pair by hue, and this is
 * the one number on the screen that decides whether they answer in time.
 */
const URGENT_SECONDS = 60;

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
  const response = await fetch(
    `/api/ops/pilot-driver/commands/${encodeURIComponent(entry.commandId)}/ack`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outcome: entry.outcome, reason: entry.reason }),
    },
  );
  // A 409 (command no longer active — already acked elsewhere, superseded,
  // or expired; also returned when no vehicle is assigned) is not a
  // transient failure: retrying it forever would never succeed, so treat it
  // as "done" and drop it from the queue rather than leaving it stuck.
  if (response.status === 409) return true;
  return response.ok;
}

/**
 * The one thing a driver is asked to do, and the three ways they may answer.
 *
 * ─── WHAT CHANGED IN THE REDESIGN, AND WHAT DELIBERATELY DID NOT ─────────
 *
 * The presentation and the interaction are new. The guarantees underneath are
 * byte-for-byte the same decisions as before, because every one of them was
 * put there by a defect:
 *
 *   • The ack is written to the durable IndexedDB outbox BEFORE the network
 *     call is attempted (`handleAck`), so an answer given with no signal
 *     survives the tab closing. Reordering those two lines is the single
 *     easiest way to silently lose a driver's answer, so it has its own unit
 *     test asserting the ORDER (commandConsoleAckOrder.test.tsx), not just
 *     that both happen.
 *   • A 409 is terminal, not a retry (see `sendAck`).
 *   • A failed poll never blanks a command the driver is currently reading.
 *   • The 1 s countdown tick hides a lapsed command locally without waiting
 *     for the next 4 s poll.
 *   • The vehicle is read from the caller's own session and never
 *     self-reported (the A01 fix).
 *
 * ─── WHY IT LOOKS LIKE THIS ──────────────────────────────────────────────
 *
 * Read one-handed, in a moving cab, in sunlight, by somebody whose attention
 * belongs on the road. So the screen has exactly one job at a time and says so
 * with size: when an instruction is live it is the largest thing on the
 * display, and when there is none the screen is quiet rather than busy.
 *
 * THE THREE ANSWERS ARE PEERS. The previous console gave them a
 * green/amber/crimson ramp, which reads as good/warning/alarm — "this is not
 * safe" looked like a driver confessing to something. They are now identical
 * in size, weight, and border treatment, distinguished by their words, their
 * mark, and their order. Refusing is a correct use of this screen and must not
 * look like a worse answer than agreeing, or drivers answer "yes" and then do
 * not comply, which leaves the control room reasoning about a bus it wrongly
 * believes is complying.
 *
 * BOTH LANGUAGES. See src/lib/pilotDriver/driverCopy.ts — the buttons, the
 * no-penalty reassurance and every state message carry Hindi alongside the
 * English. The dispatcher's own free-text reason is passed through verbatim
 * and NOT translated.
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
  /**
   * What the driver last answered, kept on screen after the instruction itself
   * has gone.
   *
   * ─── FOUND BY USING IT, NOT BY READING IT ────────────────────────────────
   *
   * Answering is the end of the interaction on screen but not the end of it in
   * the cab: the driver taps, then puts their attention back on the road. Four
   * seconds later the next poll reports the command is no longer active, the
   * console correctly switches to its empty state, and the confirmation they
   * were shown disappears. A driver who looks down again ten seconds after
   * answering sees "No instruction right now" and no evidence their answer was
   * ever registered — so they tap nothing (there is nothing left to tap), and
   * the reasonable conclusions are "it failed" and "call the control room".
   *
   * The empty state is TRUE and is deliberately still shown; this receipt sits
   * beside it rather than replacing it, because "there is no instruction" and
   * "you answered the last one" are two different facts and collapsing them
   * would be the same mistake this product avoids everywhere else.
   */
  const [receipt, setReceipt] = useState<{
    outcome: CommandAckOutcome;
    action: string;
    queued: boolean;
  } | null>(null);

  const statusRegionId = useId();
  const activeCommandRef = useRef<Command | null>(null);
  activeCommandRef.current = command;

  /**
   * How much time this driver had when this command first reached the screen,
   * used only to scale the countdown bar.
   *
   * Held in a ref keyed on the command id so it is captured ONCE per command:
   * recomputing it on each tick would make the denominator fall in step with
   * the numerator and the bar would sit at 100% forever. Deliberately not
   * state — it must never itself trigger a render.
   */
  const answerWindowRef = useRef<{ commandId: string | null; seconds: number | null }>({
    commandId: null,
    seconds: null,
  });
  if (command && answerWindowRef.current.commandId !== command.id) {
    const remaining = (new Date(command.expiresAt).getTime() - Date.now()) / 1000;
    answerWindowRef.current = {
      commandId: command.id,
      seconds: Number.isFinite(remaining) && remaining > 0 ? remaining : null,
    };
  }

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

  // Poll for the one active command. Deliberately does NOT clear the
  // last-known command on a failed poll — a dropped request should not
  // blank out a command the driver is currently reading.
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
        // (webhook/read lag), keep showing "answered" rather than reviving it.
        if (
          data.command &&
          data.command.id === activeCommandRef.current?.id &&
          ackPhase === 'sent'
        ) {
          return;
        }
        setCommand(data.command);
        if (data.command) {
          setAckPhase('idle');
          setReceipt(null);
        }
      } catch {
        if (!cancelled) setPollError(CONSOLE_COPY.unreachable.en);
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

  // Live countdown + client-side auto-expiry. Ticks every second independent
  // of the poll interval so the driver sees a smooth countdown, and hides the
  // command locally the instant it lapses rather than waiting up to
  // POLL_INTERVAL_MS for the next poll to notice.
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
      // ─────────────────────────────────────────────────────────────────
      // DURABLE FIRST, NETWORK SECOND. This ordering is the guarantee.
      // If the fetch below never resolves — no signal, tab killed, phone
      // asleep — the answer is already on disk and flushes on the next
      // `online` event or mount. Swapping these two blocks would still
      // pass every behavioural test that only checks the happy path,
      // which is why the ORDER has its own test.
      // ─────────────────────────────────────────────────────────────────
      await enqueueAck(entry);
    } catch {
      setAckPhase('error');
      setAckError(CONSOLE_COPY.answerNotSaved.en);
      return;
    }

    const action = commandActionLabel(command.actionType);
    try {
      const ok = await sendAck(entry);
      if (ok) {
        await removeQueuedAck(entry.commandId);
        setAckPhase('sent');
        setReceipt({ outcome, action, queued: false });
      } else {
        setAckPhase('queued');
        setReceipt({ outcome, action, queued: true });
      }
    } catch {
      // Offline or unreachable — stays in the outbox, retried on the next
      // `online` event or poll-triggered flush.
      setAckPhase('queued');
      setReceipt({ outcome, action, queued: true });
    }
  }

  const acknowledging = ackPhase === 'sending';
  const answered = ackPhase === 'sent' || ackPhase === 'queued';
  const hasInstruction = vehicleState === 'assigned' && command !== null;

  return (
    <div className="space-y-3">
      {/* The bus, as a quiet reference strip rather than a panel of its own.
          A driver knows which bus they are on; this exists so they can confirm
          an instruction is addressed to it, which takes a glance, not a card. */}
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-2.5">
        <OpsBilingual
          en={CONSOLE_COPY.yourBus.en}
          hi={CONSOLE_COPY.yourBus.hi}
          className="text-xs"
          enClassName="font-medium uppercase tracking-wide text-muted-foreground"
          hiClassName="text-subtle"
        />
        {vehicleState === 'assigned' && vehicleId ? (
          <OpsIdentifier className="text-lg font-semibold text-foreground">
            {vehicleId}
          </OpsIdentifier>
        ) : vehicleState === 'loading' ? (
          <span className="text-sm text-muted-foreground">{CONSOLE_COPY.findingBus.en}</span>
        ) : null}
      </div>

      {vehicleState === 'unassigned' && (
        <DriverNotice
          testId="driver-no-bus"
          tone="warning"
          en={CONSOLE_COPY.noBusAssigned.en}
          hi={CONSOLE_COPY.noBusAssigned.hi}
        />
      )}
      {vehicleState === 'error' && (
        <DriverNotice
          testId="driver-bus-lookup-failed"
          tone="error"
          en={CONSOLE_COPY.busLookupFailed.en}
          hi={CONSOLE_COPY.busLookupFailed.hi}
        />
      )}

      {!isOnline && (
        <DriverNotice
          testId="driver-offline"
          tone="warning"
          en={CONSOLE_COPY.offline.en}
          hi={CONSOLE_COPY.offline.hi}
        />
      )}

      {/* THE INSTRUCTION. `aria-live` so a driver using a screen reader is told
          when one arrives, rather than having to poll the screen themselves. */}
      <section
        id={statusRegionId}
        aria-live="polite"
        data-testid="driver-instruction-region"
        className={cn(
          'rounded-lg border transition-colors',
          hasInstruction
            ? 'border-primary/60 bg-card shadow-sm ring-1 ring-primary/20'
            : 'border-border bg-card',
        )}
      >
        {vehicleState !== 'assigned' && vehicleState !== 'loading' && (
          <p className="px-4 py-6 text-center text-base text-muted-foreground">
            {CONSOLE_COPY.waitingForBus.en}
          </p>
        )}

        {vehicleState === 'assigned' && !command && (
          <div className="px-4 py-8 text-center" data-testid="driver-no-instruction">
            <OpsBilingual
              en={CONSOLE_COPY.noInstruction.en}
              hi={CONSOLE_COPY.noInstruction.hi}
              className="text-base"
              enClassName="text-muted-foreground"
              hiClassName="text-subtle"
            />
            {pollError && (
              <p className="mt-3 text-sm text-warning" data-testid="driver-poll-error">
                {pollError}
              </p>
            )}

            {/* The receipt for the answer just given. Beside the empty state,
                never instead of it - see the `receipt` state's own note. */}
            {receipt && (
              <div
                role="status"
                data-testid="driver-last-answer"
                className="mx-auto mt-5 max-w-sm rounded-md border border-success/40 bg-success/10 px-4 py-3 text-left"
              >
                <p className="text-sm text-muted-foreground">
                  You answered{' '}
                  <span className="font-semibold text-foreground">{receipt.action}</span>
                </p>
                <p className="mt-1 text-lg font-semibold text-success">
                  {RESPONSE_CHOICES.find((c) => c.outcome === receipt.outcome)?.label.en}
                  {' · '}
                  <span lang="hi" className="font-normal leading-hindi">
                    {RESPONSE_CHOICES.find((c) => c.outcome === receipt.outcome)?.label.hi}
                  </span>
                </p>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  {receipt.queued ? CONSOLE_COPY.answerQueued.en : CONSOLE_COPY.answerSent.en}
                </p>
              </div>
            )}
          </div>
        )}

        {hasInstruction && command && (
          <div>
            <header className="border-b border-border px-4 py-2.5">
              <OpsBilingual
                en={CONSOLE_COPY.instructionHeading.en}
                hi={CONSOLE_COPY.instructionHeading.hi}
                className="text-xs"
                enClassName="font-semibold uppercase tracking-wide text-primary"
                hiClassName="text-subtle"
              />
            </header>

            <div className="space-y-5 px-4 py-4">
              {/* The action, at the largest size on the screen. This is the
                  whole message; everything else on the page qualifies it. */}
              <div>
                <p className="text-3xl font-semibold leading-tight text-foreground">
                  {commandActionLabel(command.actionType)}
                </p>
                {/* The dispatcher's own words, verbatim and untranslated —
                    machine-translating free text into a cab is exactly the
                    kind of confident guess this product does not make. */}
                <p className="mt-2.5 text-lg leading-relaxed text-muted-foreground">
                  {commandReason(command)}
                </p>
              </div>

              <Countdown
                seconds={remainingSeconds}
                windowSeconds={answerWindowRef.current.seconds}
              />

              {answered ? (
                <p
                  role="status"
                  data-testid={ackPhase === 'sent' ? 'driver-answer-sent' : 'driver-answer-queued'}
                  className="rounded-md border border-success/40 bg-success/10 px-4 py-4 text-base font-semibold text-success"
                >
                  <OpsBilingual
                    en={
                      ackPhase === 'sent'
                        ? CONSOLE_COPY.answerSent.en
                        : CONSOLE_COPY.answerQueued.en
                    }
                    hi={
                      ackPhase === 'sent'
                        ? CONSOLE_COPY.answerSent.hi
                        : CONSOLE_COPY.answerQueued.hi
                    }
                    hiClassName="font-normal text-success/80"
                  />
                </p>
              ) : (
                <div className="space-y-3" data-testid="driver-answer-buttons">
                  {RESPONSE_CHOICES.map((choice) => (
                    <ResponseButton
                      key={choice.outcome}
                      choice={choice}
                      disabled={acknowledging}
                      onClick={() => handleAck(choice.outcome)}
                    />
                  ))}
                </div>
              )}

              {ackError && (
                <p
                  role="alert"
                  data-testid="driver-ack-error"
                  className="text-base text-destructive"
                >
                  {ackError}
                </p>
              )}

              {/* The most important sentence here, and now in both languages.
                  Kept beside the buttons rather than in a footer. */}
              <p
                data-testid="driver-no-penalty"
                className="rounded-md border border-border bg-muted/40 px-3 py-2.5 text-sm leading-relaxed"
              >
                <OpsBilingual
                  en={NO_PENALTY.en}
                  hi={NO_PENALTY.hi}
                  enClassName="text-muted-foreground"
                  hiClassName="text-subtle"
                />
              </p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * One of the three answers.
 *
 * Every one of these is the same height (72px — well above the 44px minimum,
 * because this is tapped in a moving vehicle), the same width, the same border
 * weight and the same type size. The only differences are the words and the
 * mark, which is the point: see the module note on why a good/bad colour ramp
 * was removed.
 */
function ResponseButton({
  choice,
  disabled,
  onClick,
}: {
  choice: (typeof RESPONSE_CHOICES)[number];
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={`driver-answer-${choice.outcome}`}
      className={cn(
        'flex min-h-[4.5rem] w-full items-center gap-3 rounded-lg border-2 border-input bg-card px-4 py-3 text-left',
        'hover:border-primary hover:bg-accent',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        'active:bg-accent disabled:cursor-not-allowed disabled:opacity-60',
      )}
    >
      <ChoiceMark outcome={choice.outcome} />
      <OpsBilingual
        en={choice.label.en}
        hi={choice.label.hi}
        className="min-w-0 flex-1"
        enClassName="text-xl font-semibold text-foreground"
        hiClassName="text-base text-muted-foreground"
      />
    </button>
  );
}

/**
 * The redundant, non-colour encoding on each answer.
 *
 * Shapes rather than hues, for the same reason OpsStatusDot uses them: colour
 * is the third encoding on this product, never the first. A filled disc for
 * agreeing, a horizontal bar for "cannot", a hollow square for "not safe" —
 * three silhouettes that stay distinct in greyscale and in sunlight.
 */
function ChoiceMark({ outcome }: { outcome: 'accept' | 'unable' | 'unsafe' }) {
  return (
    <span
      aria-hidden
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-muted/60"
    >
      {outcome === 'accept' ? (
        <span className="h-4 w-4 rounded-full bg-foreground" />
      ) : outcome === 'unable' ? (
        <span className="h-1 w-4 rounded-sm bg-foreground" />
      ) : (
        <span className="h-4 w-4 rounded-[2px] border-2 border-foreground" />
      )}
    </span>
  );
}

/**
 * How long is left, said three ways at once.
 *
 * The figure keeps its original accessible name ("Time remaining to respond")
 * so assistive technology and the safety suite both still find it. The bar
 * beside it encodes the same fact as a LENGTH, which is readable in sunlight
 * at a glance and readable at all without colour vision.
 */
function Countdown({
  seconds,
  windowSeconds,
}: {
  seconds: number | null;
  windowSeconds: number | null;
}) {
  const urgent = seconds !== null && seconds <= URGENT_SECONDS;

  // The bar is scaled against the time this driver actually had — the seconds
  // remaining when this command first reached the screen — so it starts full
  // and empties as their own window runs out, whether the dispatcher allowed
  // 60 seconds or 10 minutes.
  //
  // A full bar is the fallback whenever that window is unknown, and the
  // direction of that choice matters: an empty bar on a command that has just
  // arrived would read as "you are nearly out of time" and rush a driver into
  // answering. Erring full is the honest failure here.
  const fraction =
    seconds === null || windowSeconds === null || windowSeconds <= 0
      ? 1
      : Math.max(0, Math.min(1, seconds / windowSeconds));

  return (
    <div>
      <div className="flex items-end justify-between gap-3">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <OpsBilingual
            en={CONSOLE_COPY.timeLeft.en}
            hi={CONSOLE_COPY.timeLeft.hi}
            hiClassName="text-subtle normal-case tracking-normal"
          />
        </span>
        <span
          aria-label="Time remaining to respond"
          data-testid="driver-countdown"
          className={cn(
            'font-mono text-4xl font-semibold tabular-nums leading-none',
            urgent ? 'text-destructive' : 'text-foreground',
          )}
        >
          {seconds !== null ? formatCountdown(seconds) : '—'}
        </span>
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-1000 ease-linear',
            urgent ? 'bg-instrument-danger' : 'bg-instrument-info',
          )}
          style={{ width: `${fraction * 100}%` }}
        />
      </div>
      {urgent && (
        <p className="mt-1.5 text-sm font-medium text-destructive">Answer soon · जल्दी जवाब दें</p>
      )}
    </div>
  );
}

/** A full-width, bilingual message about the state of this screen. */
function DriverNotice({
  testId,
  tone,
  en,
  hi,
}: {
  testId: string;
  tone: 'warning' | 'error';
  en: string;
  hi: string;
}) {
  return (
    <div
      role="alert"
      data-testid={testId}
      className={cn(
        'rounded-lg border px-4 py-3 text-base leading-relaxed',
        tone === 'error'
          ? 'border-destructive/50 bg-destructive/10 text-destructive'
          : 'border-warning/50 bg-warning/10 text-warning',
      )}
    >
      <OpsBilingual en={en} hi={hi} hiClassName="text-sm opacity-90" />
    </div>
  );
}
