/**
 * The one place that decides whether bundled fixture data may ever stand in
 * for the live UPSRTC feed.
 *
 * Governing principle: every algorithm and system operates on live data
 * obtained from the APIs — never assumed or placeholder data. A dispatcher
 * looking at `/ops/dispatcher` during an upstream outage must not be shown
 * bundled demo buses that do not exist, in the same table as real ones. A
 * banner saying so is weaker than not doing it, so the substitution itself is
 * off unless someone deliberately asks for it.
 *
 * Two distinct switches, deliberately not merged:
 *
 * • NEXT_PUBLIC_DEMO_MODE=1 — an explicit, deliberate request for demo mode
 *   (presentations without connectivity). It *forces* fixtures: the upstream
 *   is not even called. Unchanged from before.
 *
 * • ALLOW_FIXTURE_FALLBACK — opt-in permission to substitute fixtures *only*
 *   when the live call has already failed and no cached real response exists.
 *   Default absent/false: the caller gets an explicit `'unavailable'` state
 *   with zero rows instead.
 *
 * Serving a recently-cached *real* response is legitimate degradation, not
 * placeholder data, and is governed by neither flag — that path is untouched.
 *
 * Both are read at call time rather than module load so a process that has its
 * environment adjusted (and every test that stubs it) sees the current value.
 */

/** Truthy spellings accepted for the opt-in flag. Anything else — including absent — is false. */
const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);

/**
 * Explicit offline demo mode: fixtures are served *instead of* calling the
 * upstream at all. Deliberately requested, never inferred from a failure.
 */
export function isDemoModeForced(): boolean {
  return process.env.NEXT_PUBLIC_DEMO_MODE === '1';
}

/**
 * Whether a failed upstream call may fall back to bundled fixture data.
 *
 * Default false. Demo mode implies it, so a demo-mode process behaves exactly
 * as it did before this flag existed.
 */
export function isFixtureFallbackAllowed(): boolean {
  if (isDemoModeForced()) return true;
  const raw = process.env.ALLOW_FIXTURE_FALLBACK;
  return typeof raw === 'string' && TRUE_VALUES.has(raw.trim().toLowerCase());
}
