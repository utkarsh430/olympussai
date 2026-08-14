/**
 * Turning an arrival prediction into words a driver can read at a glance,
 * without overstating what the model knows.
 *
 * ─── WHY THE PRESENTATION IS A TESTED MODULE ─────────────────────────────
 *
 * The arrival subsystem is careful: it refuses twelve named ways, it reports
 * its own uncertainty, and it has nowhere to put a timetable time. Every one of
 * those guarantees can be undone by a component that renders `etaSeconds` in a
 * big font and drops the band. So the decisions that would undo them are made
 * here, in pure functions with tests, and the components only lay out what
 * these return.
 *
 * The rules this enforces are the arrival subsystem's own rendering rules.
 * Three of them are structural rather than advisory:
 *
 *   • A TIME AND ITS BAND ARE ONE VALUE. `arrivalReadout` returns `headline`
 *     and `window` together or returns neither. There is deliberately no
 *     exported function that formats a point estimate alone, so "show the ETA
 *     without the range" is not something a caller can accidentally do - it is
 *     a change to this file. The measured median band width on this data is
 *     112% of the ETA; "22 min" on its own is a claim the model cannot make.
 *
 *   • ONLY A PREDICTED STOP CAN PRODUCE A TIME. The discriminated return means
 *     a withdrawn stop yields `kind: 'none'` with a reason and no `headline`
 *     field at all - not an empty string, not a zero, nothing that could be
 *     rendered into a time slot.
 *
 *   • THE CLOCK RUNS FROM `generatedAt`. Every `etaSeconds` is relative to the
 *     instant the server computed it, so this subtracts the elapsed time since
 *     then. Past `SAMPLE_TOO_OLD_SECONDS` it stops counting down altogether:
 *     the model does not track the bus between polls, and a countdown that
 *     keeps ticking on a five-minute-old response is animation, not
 *     information.
 */
import type { SpeedBasisKind, StopArrival, StopUnavailableReason } from '@/models/control';

/**
 * How old a response may get before its numbers stop being offered.
 *
 * Sized against the poll interval, not against the model: the journey view
 * re-polls every 20 s, so anything past three missed polls means the screen is
 * no longer in contact with the service and should say so rather than keep
 * subtracting seconds from a number nobody is refreshing. Deliberately far
 * tighter than control-service's own MAX_STATE_AGE_SECONDS (600), which
 * governs whether a prediction may be COMPUTED at all; this governs whether an
 * already-computed one may still be shown.
 */
export const SAMPLE_TOO_OLD_SECONDS = 90;

export type ArrivalReadout =
  | {
      kind: 'time';
      /** The point estimate, e.g. `22 min`. Never rendered without `window`. */
      headline: string;
      /** The plausible range, e.g. `15-43 min`. Always present when `headline` is. */
      window: string;
    }
  | {
      /** The bus is at or past this stop - not a zero-minute arrival. */
      kind: 'due';
      reason: string;
    }
  | {
      /** No time can honestly be shown. `reason` is what to render in its place. */
      kind: 'none';
      reason: string;
    };

/**
 * What to show in this stop's time slot, given when the response was computed
 * and what the clock says now.
 *
 * `now` is passed in rather than read from `Date.now()` so this stays pure and
 * the elapsed-time behaviour is testable without faking timers.
 */
export function arrivalReadout(
  arrival: StopArrival,
  generatedAt: string,
  now: number,
): ArrivalReadout {
  if (arrival.status !== 'predicted') {
    return { kind: 'none', reason: describeStopWithdrawal(arrival.reason) };
  }

  const generatedAtMs = Date.parse(generatedAt);
  if (Number.isNaN(generatedAtMs)) {
    // A response whose own timestamp cannot be read cannot be aged, so its
    // numbers cannot be expressed as "from now" at all.
    return { kind: 'none', reason: 'Cannot tell how old this reading is' };
  }

  const elapsedSeconds = (now - generatedAtMs) / 1000;
  if (elapsedSeconds > SAMPLE_TOO_OLD_SECONDS) {
    return { kind: 'none', reason: 'Reading is out of date - waiting for a fresh one' };
  }

  const eta = arrival.etaSeconds - elapsedSeconds;
  if (eta <= 0) return { kind: 'due', reason: 'Due now' };

  const lower = Math.max(0, arrival.lowerBoundSeconds - elapsedSeconds);
  const upper = Math.max(eta, arrival.upperBoundSeconds - elapsedSeconds);

  return {
    kind: 'time',
    headline: formatMinutes(eta),
    window: `${minutesValue(lower)}-${minutesValue(upper)} min`,
  };
}

/** `22 min`, or `Under a minute` where rounding to zero would read as "arrived". */
function formatMinutes(seconds: number): string {
  const minutes = minutesValue(seconds);
  if (minutes < 1) return 'Under a minute';
  return `${minutes} min`;
}

/**
 * Minutes, rounded DOWN.
 *
 * Down rather than nearest, on purpose: a driver planning against "20 min" who
 * gets 19.6 has lost nothing, and one planning against a rounded-up "21 min"
 * who has 20.4 has been given time they do not have. The band beside it is
 * where the real uncertainty is expressed either way.
 */
function minutesValue(seconds: number): number {
  return Math.floor(Math.max(0, seconds) / 60);
}

/** Plain language for a stop the model listed but could not time. Rule 8: the stop is still shown. */
export function describeStopWithdrawal(reason: StopUnavailableReason): string {
  switch (reason) {
    case 'beyond_prediction_horizon':
      return 'Too far ahead to time yet';
    case 'due_or_passed':
      return 'Due now or just passed';
    case 'confidence_below_floor':
      return 'Not confident enough to give a time';
  }
}

/**
 * Where the speed behind these times was measured, and whether it deserves
 * the driver's full trust.
 *
 * `weaker` exists so the component does not have to know that
 * `route_peer_median_speed` is the 0.6x-confidence, widest-band basis - it
 * just renders the weaker treatment. Rule 4: a peer speed rendered identically
 * to the bus's own would tell a driver their own bus is doing 38 kmph when the
 * measurement came from a different bus up the road.
 */
export function describeSpeedBasis(basis: SpeedBasisKind): { label: string; weaker: boolean } {
  switch (basis) {
    case 'vehicle_smoothed_speed':
      return { label: 'From this bus’s own speed', weaker: false };
    case 'route_peer_median_speed':
      return { label: 'From other buses on this stretch, not this one', weaker: true };
  }
}

/**
 * How old the underlying fix is, in a driver's words.
 *
 * Same thresholds and shape as `describeSampleAge` in recommendationView.ts,
 * which the control room uses, so the two surfaces never disagree about
 * whether a reading is fresh - rule 7. Worded for a cab rather than a console.
 */
export function freshnessNote(stateAgeSeconds: number): { label: string; tone: 'default' | 'warn' } {
  const seconds = Math.max(0, Math.round(stateAgeSeconds));
  if (seconds < 60) return { label: `Position ${seconds}s old`, tone: 'default' };
  const minutes = Math.round(seconds / 60);
  return { label: `Position ${minutes} min old`, tone: seconds > 60 ? 'warn' : 'default' };
}

/**
 * How much to trust the drawn position, in the renderer's own vocabulary.
 *
 * The fleet canvas colours a chevron by `dataQuality`, and it is the only
 * signal on the map that says how old the fix behind it is. Mapping the
 * prediction's own `stateAgeSeconds` onto it keeps the driver's bus coloured by
 * the same rule as every bus on the control room's map, rather than by a
 * second, quieter one invented here.
 *
 * The thresholds are `freshnessNote`'s: under a minute is a live reading, and
 * `MAX_STATE_AGE_SECONDS / 2` is the point past which control-service is itself
 * halfway to refusing to predict from it at all.
 */
export function fixQuality(stateAgeSeconds: number): 'good' | 'degraded' | 'stale' {
  if (stateAgeSeconds < 60) return 'good';
  if (stateAgeSeconds < 300) return 'degraded';
  return 'stale';
}

/**
 * A published timetable time, as a clock reading.
 *
 * Deliberately a CLOCK TIME and never a countdown, and that is the whole
 * distinction rule 3 turns on. A prediction is "22 min from now" because it was
 * measured from a position a moment ago; a timetable is "10:18" because it was
 * published last week and has no relationship to where the bus is. Rendering
 * the timetable as "in 18 minutes" would erase the only difference a driver has
 * to go on.
 */
export function formatScheduledClock(iso: string | null): string | null {
  if (!iso) return null;

  // THE UPSTREAM SENDS A BARE CLOCK STRING, not a timestamp. `scheduled_time`
  // arrives as "10:05:00" and src/lib/upsrtc/normalizer.ts passes it straight
  // through, so `Date.parse` on it is NaN. Handling the ISO case first and
  // stopping there is the second bug this function had: the timetable line
  // silently never rendered, because every real value returned null here.
  //
  // Same two-shape rule as `formatScheduleTime` in src/lib/formatters/index.ts,
  // which is the existing owner of "render a UPSRTC schedule time" - kept in
  // step with it deliberately rather than invented again. The difference is the
  // MISS behaviour: that one returns a dash for an operator's table, this one
  // returns null so the driver's screen omits the timetable line entirely
  // rather than printing an empty label.
  if (/^\d{2}:\d{2}(:\d{2})?$/.test(iso)) return iso.slice(0, 5);

  const at = Date.parse(iso);
  if (Number.isNaN(at)) return null;
  // 24-hour, formatted by hand rather than through `toLocaleTimeString`.
  // Locale formatting returned "10:18 AM" here, and an am/pm suffix is one
  // more thing to read wrong at a glance in a moving cab - a 22:15 departure
  // misread as 10:15 is a twelve-hour error. It also made the output depend on
  // the device's locale, so the same bus would read differently on two
  // drivers' phones.
  const atLocal = new Date(at);
  const hours = String(atLocal.getHours()).padStart(2, '0');
  const minutes = String(atLocal.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}
