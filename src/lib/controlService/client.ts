import 'server-only';

/**
 * Read-only REST client for this app -> the persistent control service
 * (docs/CONTROL_SERVICE_INTEGRATION.md §1 "Web -> control service"):
 * server-only, Zod-validated at the call site, authenticated with the
 * rotating service-token bearer header, timed out inside the existing
 * 15s poll / 10s-upstream envelope the ops dashboards already assume
 * (docs/CONTROL_SERVICE_INTEGRATION.md §5 pre-merge gate).
 *
 * Scope note: this ticket ("Compute headway/EWT/CV metrics and build the
 * live observability dashboard") is detection-and-display only — every
 * call this client makes is a GET or a metrics-compute POST, never a
 * `commands`/dispatcherActionId call. A full production client (retry
 * policy tuning, security review sign-off) remains gated per that doc's
 * §5; this module implements the two failure-isolation behaviours §2
 * actually requires for a read path — a fixed timeout and a short-lived
 * circuit breaker — so one unavailable control-service instance can never
 * hang or spam an ops dashboard render.
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

// Module-scoped circuit-breaker state — one breaker per warm process, reset
// on redeploy. Deliberately simple (a failure streak + cooldown window) per
// the failure-isolation shape docs/CONTROL_SERVICE_INTEGRATION.md §2
// describes, rather than a full library: this client only ever issues
// idempotent reads plus one detect-and-persist compute call, none of which
// need anything more sophisticated to stay safe.
let consecutiveFailures = 0;
let circuitOpenUntil = 0;

function recordFailure(now: number): void {
  consecutiveFailures += 1;
  if (consecutiveFailures >= FAILURE_THRESHOLD) {
    circuitOpenUntil = now + CIRCUIT_COOLDOWN_MS;
  }
}

function recordSuccess(): void {
  consecutiveFailures = 0;
  circuitOpenUntil = 0;
}

/** Test-only: reset breaker state between test cases. */
export function _resetControlServiceCircuitForTests(): void {
  consecutiveFailures = 0;
  circuitOpenUntil = 0;
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
  method?: 'GET' | 'POST';
  query?: Record<string, string | undefined>;
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
  if (now < circuitOpenUntil) {
    throw new ControlServiceUnavailableError(
      `control service circuit open (${Math.ceil((circuitOpenUntil - now) / 1000)}s remaining) after ${consecutiveFailures} consecutive failures`,
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
      },
      signal: controller.signal,
      cache: 'no-store',
    });

    if (!response.ok) {
      recordFailure(now);
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
    recordSuccess();
    return payload;
  } catch (error) {
    if (error instanceof ControlServiceRequestError) throw error;
    recordFailure(now);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ControlServiceUnavailableError(`control service request to ${path} timed out`);
    }
    const message = error instanceof Error ? error.message : 'Unknown control service network error';
    throw new ControlServiceUnavailableError(message);
  } finally {
    clearTimeout(timer);
  }
}
