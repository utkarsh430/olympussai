// Tiny numeric helpers shared by the decision-engine control laws
// (terminalDispatch.ts, twoWayHold.ts, selfEqualizing.ts, occupancyMpc.ts).
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * The schedule-adherence correction, in seconds, or 0 when it does not apply.
 *
 *   -Ks x epsilon      epsilon = seconds late (negative = early)
 *
 * A vehicle running EARLY (epsilon < 0) has the term ADD to its hold: the
 * delay comes out of slack it already holds, so spacing is bought at no cost
 * to the timetable. A vehicle running LATE has it SUBTRACT, shrinking or
 * cancelling the hold - the gap gets closed from the vehicle behind instead
 * of by making a late bus later.
 *
 * This is what turns a pure headway regulator into one that pursues
 * punctuality and even spacing together, and Ks is the dial between them
 * (Xuan, Argote & Daganzo 2011, "Dynamic bus holding strategies for schedule
 * reliability"). Zero whenever either input is missing, which is every
 * corridor today - `route_policies.ks` is null and no timetable is loaded -
 * so the deployed law is unchanged until both are supplied.
 *
 * Lives here rather than in one law because two laws apply it and they must
 * apply the same one; a second copy is how the two would drift.
 */
export function scheduleCorrectionSeconds(
  ks: number | null,
  deviationSeconds: number | null | undefined,
): number {
  if (ks === null || deviationSeconds === null || deviationSeconds === undefined) return 0;
  return -ks * deviationSeconds;
}
