/**
 * The bunching taxonomy, in words a depot supervisor can act on.
 *
 * ─── WHAT WAS ON SCREEN BEFORE ───────────────────────────────────────────
 *
 * `Cause: endogenous · Controllability: mitigable`.
 *
 * Both are wire values from the control service's own model, rendered with
 * their underscores swapped for spaces and no gloss anywhere in the product.
 * "Endogenous" and "mitigable" are transit-research vocabulary; the readers of
 * this screen are depot staff, often reading English as a second language, and
 * there is no sense in which either word tells them what to do.
 *
 * ─── WHY THE MEANING IS NOT SIMPLIFIED AWAY ──────────────────────────────
 *
 * The distinction the taxonomy draws is real and worth keeping. Whether
 * bunching is feeding itself, or is being caused by traffic outside the
 * service, or is built into the timetable, changes whether anybody can do
 * anything about it — which is exactly what the second field says. So these
 * are translations, not removals: each one names the same distinction in the
 * operator's own words, and `unknown` stays honestly unknown rather than being
 * folded into one of the three real answers.
 *
 * `structural` appears in BOTH enums and means different things in each — a
 * cause built into the timetable, versus a situation the control room cannot
 * fix. Two tables rather than one shared lookup, for that reason.
 */
import type { CauseClass, Controllability } from '@/models/control';

/** Why this is happening. */
export const CAUSE_LABEL: Record<CauseClass, string> = {
  endogenous: 'Caused by the service itself — buses closing up feeds itself.',
  exogenous: 'Caused by something outside the service, such as traffic or an event.',
  structural: 'Built into the timetable or the road, rather than caused by today.',
  unknown: 'The cause has not been established.',
};

/** What anybody can do about it, stated from the control room's side. */
export const CONTROLLABILITY_LABEL: Record<Controllability, string> = {
  controllable: 'The control room can fix this.',
  mitigable: 'The control room can reduce this, not fix it.',
  structural: 'This cannot be fixed from the control room.',
  none: 'There is nothing the control room can do about this one.',
};

export function describeCause(cause: CauseClass): string {
  return CAUSE_LABEL[cause] ?? 'The cause has not been established.';
}

export function describeControllability(controllability: Controllability): string {
  return (
    CONTROLLABILITY_LABEL[controllability] ??
    'Whether the control room can act on this is not recorded.'
  );
}
