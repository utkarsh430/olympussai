/**
 * How a corridor's planned gap was arrived at, said in words a reader can act
 * on.
 *
 * ─── THIS FIXES A LIVE FALSEHOOD, NOT JUST A LABEL ───────────────────────
 *
 * The rehearsal page used to render the calibration source as:
 *
 *     `measured from the ${calibrationSource.replace('_', ' ')}`
 *
 * which is wrong twice over.
 *
 * First, the word MEASURED. None of these values is a measurement. Every one
 * of them is DERIVED from published schedule data — `timetable` from the
 * published timetable, `od_timetable` from published origin-to-destination
 * times, the span sources from the spread of scheduled departures. Calling a
 * schedule-derived figure "measured" is exactly the class of claim this
 * product exists not to make: it tells an operator the number came from
 * watching buses when it came from reading a timetable. The thresholds, the
 * gap-consistency figure and the extra-wait figure are all ratios of it, so
 * the overstatement propagates into every number on the page.
 *
 * Second, `.replace('_', ' ')` has no `g` flag, so it swaps the FIRST
 * underscore only. `od_timetable` reached the screen as "od timetable" — a
 * raw enum with a cosmetic space in it, shown to a depot reader who has no
 * way to know what "od" means. A lookup cannot rot that way.
 *
 * ─── AND IT IS A TABLE, NOT A FORMATTER ──────────────────────────────────
 *
 * The source is typed `z.string()` on the wire, because the control service
 * owns the enum and may add to it. So an unknown value must degrade to
 * something honest rather than to a prettified version of itself:
 * `describeCalibrationSource` returns null, and every caller renders nothing
 * rather than inventing a provenance sentence for a value it does not
 * recognise. Silence is the correct answer to "where did this come from?"
 * when we genuinely do not know.
 */

/**
 * Reads as the tail of "the planned gap, …", e.g.
 * "worked out from the published timetable".
 */
const CALIBRATION_SOURCE_PHRASE: Readonly<Record<string, string>> = {
  timetable: 'worked out from the published timetable',
  od_timetable: 'worked out from published origin-to-destination times',
  journey_span: 'worked out from the spread of scheduled departures',
  fleet_span: 'worked out from the spread of scheduled departures',
  /**
   * Documented by the control service's own migration as NOT DERIVED, and
   * explicitly not to be presented as a measurement. It is named here rather
   * than left to fall through, because the honest sentence for it is the one
   * thing a reader most needs and is least likely to guess.
   */
  default: 'a placeholder, not worked out from this corridor at all',
  /** No planned gap. Nothing to describe, and nothing is shown. */
  none: 'no planned gap is set for this corridor',
};

/**
 * A plain-language phrase for a calibration source, or null when the value is
 * one this build does not recognise.
 */
export function describeCalibrationSource(source: string): string | null {
  return CALIBRATION_SOURCE_PHRASE[source] ?? null;
}

/**
 * Whether a source is one whose figures may be presented as derived from real
 * schedule data at all.
 *
 * `default` is excluded on the control service's own instruction, and `none`
 * because there is no figure. Anything unrecognised is excluded too — a value
 * this build has never heard of has not earned the benefit of the doubt.
 */
export function isDerivedCalibration(source: string): boolean {
  return (
    source === 'timetable' ||
    source === 'od_timetable' ||
    source === 'journey_span' ||
    source === 'fleet_span'
  );
}
