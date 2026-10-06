/**
 * Limits of `POST /api/upsrtc/depot/copilot`. They protect the server, not the
 * subscription: the Claude call budget (`CLI_MAX_CALLS_PER_HOUR`/`_PER_DAY` in
 * `../config`) is spent inside the provider, on top of these. Limits key on a
 * canonical identity (`requestIdentity` in `@/lib/depot/rateLimit`), never on
 * the cookie string, which has many encodings that all verify.
 *
 * The app has one shared PIN, so a new login is a new identity. When
 * `DEPOT_TRUSTED_IP_HEADER` names a header, the address in it is limited on its
 * own as well (ruling S37), which is what stops one person who logs in again.
 * Set that variable ONLY behind a proxy that overwrites the header on every
 * request; without it the per-address limits are off and behaviour is as before.
 */

/** Requests per identity in one `RATE_WINDOW_MS`, scripted answers included. */
export const IDENTITY_REQUESTS_PER_MINUTE = 10;
export const RATE_WINDOW_MS = 60_000;
/**
 * Budgeted cost of one scripted answer on one core. NOT YET MEASURED: an
 * assumption to be replaced by a measurement on the sample feed.
 */
export const SCRIPTED_ANSWER_BUDGET_MS = 2;
/** The share of one core the copilot may use before it refuses work. */
export const PROCESS_CORE_SHARE = 0.2;
/**
 * All requests together in one `RATE_WINDOW_MS`: 6,000. It only protects the
 * process; scripted answers are limited per identity (and per address).
 * Filling it takes 600 identities each at their full rate.
 */
export const PROCESS_REQUESTS_PER_MINUTE = Math.floor(
  (RATE_WINDOW_MS * PROCESS_CORE_SHARE) / SCRIPTED_ANSWER_BUDGET_MS,
);
/**
 * Requests from one address alone in one `RATE_WINDOW_MS`, whatever the
 * session: six people behind one office address at their full rate, and a
 * hundredth of the process ceiling.
 */
export const ADDRESS_REQUESTS_PER_MINUTE = 60;
/** Bounds the per-identity limiters' memory; the least recently used is forgotten first. */
export const MAX_TRACKED_IDENTITIES = 5_000;

/**
 * Claude calls one identity may start per `CLAUDE_ALLOWANCE_WINDOW_MS`. Spent
 * only on a cache miss that would call Claude; once used up, the answer is
 * scripted with the public notice, never refused.
 */
export const IDENTITY_CLAUDE_CALLS_PER_HOUR = 5;
export const CLAUDE_ALLOWANCE_WINDOW_MS = 3_600_000;
/**
 * Claude calls from one address alone per `CLAUDE_ALLOWANCE_WINDOW_MS`, whatever the session.
 * 8 × 24 = 192, under the core's daily cap of 200 (`CLI_MAX_CALLS_PER_DAY`), so one
 * address running all day cannot use up the day's calls for everyone; 10 reached it in 20 hours.
 */
export const ADDRESS_CLAUDE_CALLS_PER_HOUR = 8;

/** The largest request is an ask with a 300-character question: a few hundred bytes. */
export const MAX_BODY_BYTES = 4_096;
/** A body still arriving after this long is refused, so a slow sender cannot hold the request. */
export const BODY_READ_MS = 5_000;

/**
 * One overall deadline per request, from the moment it is accepted. It sits
 * below the route's `maxDuration` so a scripted answer always goes out first.
 */
export const REQUEST_DEADLINE_MS = 40_000;
/** A Claude call is not started with less than this left before the deadline. */
export const MIN_CLAUDE_REMAINING_MS = 10_000;

/** A Claude-written text is reused for the same task and facts for this long. */
export const RESPONSE_CACHE_MS = 600_000;
export const RESPONSE_CACHE_ENTRIES = 256;

/** `DEPOT_COPILOT_MODEL` when unset. An alias, so it follows the CLI's own default. */
export const DEFAULT_COPILOT_MODEL = 'sonnet';

/** Scope for every log line this service writes; each line is a reason code only. */
export const LOG_SCOPE = 'copilot-api';
