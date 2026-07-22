/** Server-side only fetch helpers for the UPSRTC upstream endpoints. */

export const UPSRTC_LIVE_URL =
  process.env.UPSRTC_LIVE_URL ?? 'https://margdarshi.upsrtcvlt.com/php/getGpsLiveData.php';

export const UPSRTC_SCHEDULE_URL =
  process.env.UPSRTC_SCHEDULE_URL ?? 'https://margdarshi.upsrtcvlt.com/php/getScheduledBusInfo.php';

export const REQUEST_TIMEOUT_MS = 10_000;

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
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<UpstreamFetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json, text/plain, */*' },
      cache: 'no-store',
    });

    const contentType = response.headers.get('content-type') ?? 'unknown';
    const text = await response.text();

    if (!response.ok) {
      return { ok: false, status: response.status, contentType, payload: null, error: `HTTP ${response.status}` };
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
