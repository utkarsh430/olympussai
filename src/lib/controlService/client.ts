import 'server-only';

import { tryRedis } from '@/lib/redis/client';

/**
 * Read-only REST client for this app -> the persistent control service
 * (docs/CONTROL_SERVICE_INTEGRATION.md §1 "Web -> control service"):
 * server-only, Zod-validated at the call site, authenticated with the
 * rotating service-token bearer header, timed out inside the existing
 * 15s poll / 10s-upstream envelope the ops dashboards already assume
 * (docs/CONTROL_SERVICE_INTEGRATION.md §5 pre-merge gate).
 *
 * Originally scoped to detection-and-display GETs and a metrics-compute
 * POST only (the "Compute headway/EWT/CV metrics" ticket that introduced
 * this file). The driver PWA ticket ("Driver PWA: single-instruction
 * command interface") extended `options.body` so
 * src/lib/controlService/commands.ts could add the one write call this
 * client now makes — POST .../ack, which never carries a
 * dispatcherActionId (only POST /v1/commands does, and no route in this
 * app calls that yet — see src/app/api/ops/control-room/commands/route.ts).
 * A full production client (retry policy tuning, security review sign-off)
 * remains gated per that doc's §5; this module implements the two
 * failure-isolation behaviours §2 actually requires — a fixed timeout and a
 * short-lived circuit breaker — so one unavailable control-service instance
 * can never hang or spam an ops dashboard render.
 */

const DEFAULT_TIMEOUT_MS = 8_000; // fits inside the 15s poll / 10s upstream budget
const FAILURE_THRESHOLD = 3;
const CIRCUIT_COOLDOWN_MS = 30_000;

export class ControlServiceConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ControlServiceConfigError';
  }
}

export class ControlServiceRequestError extends Error {
  readonly status: number | null;
  readonly code: string | null;

  constructor(message: string, status: number | null = null, code: string | null = null) {
    super(message);
    this.name = 'ControlServiceRequestError';
    this.status = status;
    this.code = code;
  }
}

export class ControlServiceUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ControlServiceUnavailableError';
  }
}

// Circuit-breaker state. Deliberately simple (a failure streak + cooldown
// window) per the failure-isolation shape docs/CONTROL_SERVICE_INTEGRATION.md
// §2 describes, rather than a full library: this client only ever issues
// idempotent reads plus one detect-and-persist compute call, none of which
// need anything more sophisticated to stay safe.
//
// WHAT COUNTS as a failure is the part that matters, and it is not "any
// non-2xx" — see isOutageStatus() below. The breaker is shared by every
// control-service consumer in the process, so what trips it decides which
// unrelated features an error on one endpoint can take down.
//
// Two backends, same as the two rate limiters (src/lib/redis/client.ts):
//
//   - REDIS_URL unset -> the module-scoped variables below. One breaker per
//     warm process, reset on redeploy. Unchanged from before the shared store
//     existed, and the only backend local dev and the test suite need.
//   - REDIS_URL set   -> the streak and the open-until deadline live in the
//     shared store, so a control service that is down for one instance is
//     known to be down by all of them. Without that, an N-instance deploy
//     lets a dead control service absorb up to N x FAILURE_THRESHOLD requests
//     per cooldown instead of THRESHOLD, and each instance has to rediscover
//     the outage on its own.
//
// A Redis failure degrades to the per-process breaker, matching the FAILURE
// POLICY in src/lib/redis/client.ts. That is the right call here for the same
// reason as at the two limiters, and one extra one specific to this file:
// treating an unreachable Redis as "circuit open" would take every ops
// dashboard that reads the control service dark on a Redis outage, converting
// a cache-tier incident into a control-room outage. Treating it as "circuit
// closed" (skip the breaker entirely) would remove the timeout amplification
// guard exactly when infrastructure is already unhealthy. Falling back to the
// in-process breaker preserves both properties per instance.
const REDIS_FAILURES_KEY = 'cb:control-service:failures';
const REDIS_OPEN_KEY = 'cb:control-service:open';
/**
 * TTL on the shared failure counter. The in-process counter is cleared only
 * by a success or a process restart; in Redis "never expires" would mean a
 * streak from last week still counts toward a trip today, and a key that
 * lives forever. Ten cooldowns of total silence is well past the point where
 * an old streak is evidence about the service's current health.
 */
const REDIS_FAILURES_TTL_MS = CIRCUIT_COOLDOWN_MS * 10;

let consecutiveFailures = 0;
let circuitOpenUntil = 0;

/**
 * Whether a status the control service actually RETURNED is evidence that the
 * control service cannot be reached.
 *
 * ─── AN ANSWER IS NOT AN OUTAGE ──────────────────────────────────────────
 *
 * The breaker exists to stop this process hammering a service that cannot
 * answer, and to stop one slow upstream consuming every request worker. A 404
 * does neither of those things: it is a complete, cheap, authoritative
 * response proving the service is up, read the request, and is telling us that
 * route or resource does not exist. Retrying it is pointless, but so is
 * opening a circuit over it — the circuit is SHARED by every control-service
 * consumer in this process, so a 404 on one endpoint would take down all the
 * others.
 *
 * That is not a hypothetical. The driver route screen polls
 * /api/ops/pilot-driver/journey continuously. Against a control service that
 * predates the arrivals route, that is a permanent 404 stream, and counting
 * those toward the streak opened the breaker for everything — including
 * src/lib/controlService/commands.ts, the path a control room's instruction
 * takes to reach a driver. The driver's screen then read "Could not reach the
 * command service" while the control service was entirely healthy. A
 * safety-critical command path must not be takeable down by another
 * endpoint's 404.
 *
 * ─── THE TWO 4xx CODES THAT ARE OUTAGE SIGNALS ───────────────────────────
 *
 * 408 and 429 are not "your request was wrong"; they are "stop sending them".
 * Polling into either at poll rate is precisely the amplification this
 * breaker exists to prevent, so they trip it like a 5xx.
 *
 * Everything else that is not a returned status — a timeout, a DNS failure, a
 * refused connection — never reaches this function and always counts, because
 * those are the cases where nothing answered at all.
 */
function isOutageStatus(status: number): boolean {
  if (status >= 500) return true;
  return status === 408 || status === 429;
}

interface BreakerState {
  /** Milliseconds the circuit stays open for. `0` when it is closed. */
  openForMs: number;
  failures: number;
}

async function readBreaker(now: number): Promise<BreakerState> {
  const viaRedis = await tryRedis<BreakerState>(async (redis) => {
    const openForMs = await redis.pttl(REDIS_OPEN_KEY);
    if (openForMs <= 0) return { openForMs: 0, failures: 0 };
    const failures = Number((await redis.get(REDIS_FAILURES_KEY)) ?? FAILURE_THRESHOLD);
    return { openForMs, failures: Number.isFinite(failures) ? failures : FAILURE_THRESHOLD };
  });
  if (viaRedis !== null) return viaRedis;

  return {
    openForMs: now < circuitOpenUntil ? circuitOpenUntil - now : 0,
    failures: consecutiveFailures,
  };
}

async function recordFailure(now: number): Promise<void> {
  const viaRedis = await tryRedis(async (redis) => {
    const failures = await redis.incr(REDIS_FAILURES_KEY);
    await redis.pexpire(REDIS_FAILURES_KEY, REDIS_FAILURES_TTL_MS);
    if (failures >= FAILURE_THRESHOLD) {
      // SET NX plants the marker; the unconditional PEXPIRE right after is
      // what makes the pair an upsert, pushing the deadline out by a full
      // cooldown on every further failure — the same thing the in-process
      // branch does by re-assigning `circuitOpenUntil` each time. (RedisLike
      // keeps `set` NX-only so the test fake stays a trivial object.)
      await redis.set(REDIS_OPEN_KEY, failures, { nx: true, px: CIRCUIT_COOLDOWN_MS });
      await redis.pexpire(REDIS_OPEN_KEY, CIRCUIT_COOLDOWN_MS);
    }
    return true;
  });
  if (viaRedis !== null) return;

  consecutiveFailures += 1;
  if (consecutiveFailures >= FAILURE_THRESHOLD) {
    circuitOpenUntil = now + CIRCUIT_COOLDOWN_MS;
  }
}

async function recordSuccess(): Promise<void> {
  // Always clears the local pair as well as the shared one: a streak recorded
  // locally during a Redis blip must not outlive the success that disproves it.
  consecutiveFailures = 0;
  circuitOpenUntil = 0;
  await tryRedis(async (redis) => {
    await redis.del(REDIS_FAILURES_KEY, REDIS_OPEN_KEY);
    return true;
  });
}

/** Test-only: reset breaker state between test cases (both backends). */
export async function _resetControlServiceCircuitForTests(): Promise<void> {
  await recordSuccess();
}

function readConfig(): { baseUrl: string; token: string } {
  const baseUrl = process.env.CONTROL_SERVICE_BASE_URL;
  const token = process.env.CONTROL_SERVICE_SERVICE_TOKEN;
  if (!baseUrl || !token) {
    throw new ControlServiceConfigError(
      'CONTROL_SERVICE_BASE_URL / CONTROL_SERVICE_SERVICE_TOKEN are not configured',
    );
  }
  return { baseUrl, token };
}

export interface ControlServiceRequestOptions {
  method?: 'GET' | 'POST' | 'PUT';
  query?: Record<string, string | undefined>;
  /** JSON-serialized and sent as the request body. Only meaningful for `method: 'POST'` / `'PUT'`. */
  body?: unknown;
  timeoutMs?: number;
}

/**
 * Issues one request against the control service and returns the parsed
 * (but not yet Zod-validated) JSON body. Callers must validate the result
 * against the matching schema in src/models/control.ts before trusting its
 * shape — this function only guarantees valid JSON came back over a
 * successful HTTP response.
 */
export async function fetchControlService(
  path: string,
  options: ControlServiceRequestOptions = {},
): Promise<unknown> {
  const now = Date.now();
  const breaker = await readBreaker(now);
  if (breaker.openForMs > 0) {
    throw new ControlServiceUnavailableError(
      `control service circuit open (${Math.ceil(breaker.openForMs / 1000)}s remaining) after ${breaker.failures} consecutive failures`,
    );
  }

  const { baseUrl, token } = readConfig();
  const url = new URL(path, baseUrl);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, value);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
      cache: 'no-store',
    });

    if (!response.ok) {
      // Only an outage signal moves the breaker. A non-outage 4xx deliberately
      // does NOT call recordSuccess() either: the service answering one
      // malformed or unknown request is not evidence that a streak of real
      // failures has ended, and treating it as such would let a 404 poller
      // interleaved with a genuinely failing service hold the breaker
      // permanently shut. It leaves the streak exactly as it found it.
      if (isOutageStatus(response.status)) await recordFailure(now);
      let code: string | null = null;
      let message = `control service responded ${response.status}`;
      try {
        const body = (await response.json()) as { error?: { code?: string; message?: string } };
        code = body.error?.code ?? null;
        message = body.error?.message ?? message;
      } catch {
        // Non-JSON error body — fall back to the generic status message above.
      }
      throw new ControlServiceRequestError(message, response.status, code);
    }

    const payload = (await response.json()) as unknown;
    await recordSuccess();
    return payload;
  } catch (error) {
    if (error instanceof ControlServiceRequestError) throw error;
    await recordFailure(now);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ControlServiceUnavailableError(`control service request to ${path} timed out`);
    }
    const message = error instanceof Error ? error.message : 'Unknown control service network error';
    throw new ControlServiceUnavailableError(message);
  } finally {
    clearTimeout(timer);
  }
}
