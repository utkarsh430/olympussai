// UPSRTC upstream fetch helpers for the control service's network seeder.
//
// SIBLING IMPLEMENTATION: src/lib/upsrtc/client.ts in the Next.js app (repo
// root). That file is the live control-room read path; this one is the
// seeder's. They are deliberately duplicated rather than shared: the root
// tsconfig excludes control-service/ and there is no pnpm workspace, so a
// cross-package import is impossible — and keeping them apart is what stops
// CONTROL_SERVICE_DATABASE_URL from ever entering the web app's environment
// (docs/CONTROL_SERVICE_INTEGRATION.md section 3). Upstream quirks learned
// there are ported here verbatim; fix a bug in one, fix it in both.
//
// Ported upstream knowledge:
//   * The endpoints advertise `Content-Type: text/html` while returning JSON,
//     so the body is always text-then-JSON.parse'd rather than res.json()'d.
//   * A leading `<` means an HTML error page, not data.
//   * getScheduledBusInfo.php answers HTTP 200 with the bare JSON *string*
//     `" Bus Not Assigned!!! "` when a vehicle has no assignment for the
//     requested date. That is a normal, extremely common answer, not an error.

export const UPSRTC_LIVE_URL =
  process.env.UPSRTC_LIVE_URL ?? 'https://margdarshi.upsrtcvlt.com/php/getGpsLiveData.php';

export const UPSRTC_SCHEDULE_URL =
  process.env.UPSRTC_SCHEDULE_URL ?? 'https://margdarshi.upsrtcvlt.com/php/getScheduledBusInfo.php';

/**
 * The live feed is ~12 MB of JSON and regularly takes 30-60s to arrive, so
 * the seeder's default is far more generous than the web app's 10s
 * request-scoped budget. Per-call overrides keep schedule probes tight.
 */
export const LIVE_REQUEST_TIMEOUT_MS = 180_000;
export const SCHEDULE_REQUEST_TIMEOUT_MS = 45_000;

export interface UpstreamFetchResult {
  ok: boolean;
  status: number;
  contentType: string;
  payload: unknown;
  error?: string;
}

/**
 * Fetch + tolerant parse. The upstream advertises text/html even when the body
 * is JSON, so we always attempt a JSON parse of the text body ourselves.
 */
export async function fetchUpstream(
  url: string,
  timeoutMs: number = SCHEDULE_REQUEST_TIMEOUT_MS,
): Promise<UpstreamFetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // No `cache` option: Node's undici fetch types RequestInit without it
    // (TS2353), and there is no HTTP cache in the Node runtime to bypass
    // anyway. Freshness is instead requested at the protocol level.
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json, text/plain, */*',
        'Cache-Control': 'no-cache',
      },
    });

    const contentType = response.headers.get('content-type') ?? 'unknown';
    const text = await response.text();

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        contentType,
        payload: null,
        error: `HTTP ${response.status}`,
      };
    }

    // Guard against an HTML error page being parsed as data.
    const trimmed = text.trimStart();
    if (trimmed.startsWith('<')) {
      return {
        ok: false,
        status: response.status,
        contentType,
        payload: null,
        error: 'Upstream returned an HTML document instead of data',
      };
    }

    try {
      return { ok: true, status: response.status, contentType, payload: JSON.parse(text) };
    } catch {
      return {
        ok: false,
        status: response.status,
        contentType,
        payload: null,
        error: 'Upstream returned malformed JSON',
      };
    }
  } catch (error) {
    const message =
      error instanceof Error && error.name === 'AbortError'
        ? `Upstream timed out after ${timeoutMs}ms`
        : error instanceof Error
          ? error.message
          : 'Unknown upstream error';
    return { ok: false, status: 0, contentType: 'unknown', payload: null, error: message };
  } finally {
    clearTimeout(timer);
  }
}

/** Current calendar date in Asia/Kolkata as YYYY-MM-DD. */
export function indiaDate(now: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(now);
}

/** Shift a YYYY-MM-DD date string by whole days, staying on the calendar grid. */
export function shiftDate(date: string, days: number): string {
  const [year = 1970, month = 1, day = 1] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** UPSRTC registration numbers look like UP77AN2509. */
export function isValidRegistrationNumber(value: string): boolean {
  return /^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{1,4}$/i.test(value.trim());
}

export function buildScheduleUrl(regNum: string, date: string): string {
  const url = new URL(UPSRTC_SCHEDULE_URL);
  url.searchParams.set('date', date);
  url.searchParams.set('reg_num', regNum.toUpperCase());
  return url.toString();
}

export function buildLiveUrl(): string {
  return UPSRTC_LIVE_URL;
}
