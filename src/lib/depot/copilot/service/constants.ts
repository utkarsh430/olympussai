/**
 * Limits of `POST /api/upsrtc/depot/copilot`. They protect the server, not the
 * subscription: the Claude call budget (`CLI_MAX_CALLS_PER_HOUR`/`_PER_DAY` in
 * `../config`) is spent inside the provider, on top of these. Every request is
 * counted, scripted answers included, so the route cannot be used to exhaust
 * the process with cheap work either.
 */

/** Requests per session in one `RATE_WINDOW_MS`. */
export const SESSION_REQUESTS_PER_MINUTE = 10;
/** Requests from all sessions together in one `RATE_WINDOW_MS`. */
export const GLOBAL_REQUESTS_PER_MINUTE = 60;
export const RATE_WINDOW_MS = 60_000;
/** Bounds the per-session limiter's memory; the oldest session is forgotten first. */
export const MAX_TRACKED_SESSIONS = 5_000;

/** The largest request is an ask with a 300-character question: a few hundred bytes. */
export const MAX_BODY_BYTES = 4_096;

/**
 * One overall deadline per request, from the moment it is accepted. It sits
 * below the route's `maxDuration` so a scripted answer always goes out first.
 */
export const REQUEST_DEADLINE_MS = 40_000;

/** A Claude-written text is reused for the same task and facts for this long. */
export const RESPONSE_CACHE_MS = 600_000;
export const RESPONSE_CACHE_ENTRIES = 256;

/** `DEPOT_COPILOT_MODEL` when unset. An alias, so it follows the CLI's own default. */
export const DEFAULT_COPILOT_MODEL = 'sonnet';

/** Scope for every log line this service writes; each line is a reason code only. */
export const LOG_SCOPE = 'copilot-api';
