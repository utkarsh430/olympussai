'use client';

import { OpsPanel } from '@/components/ops/ui';
import type { JourneyStop } from '@/lib/ops/driverJourney';
import { arrivalReadout, formatScheduledClock } from '@/lib/ops/driverJourneyView';

/**
 * The stops ahead, and what can honestly be said about each one.
 *
 * ─── THE THREE KINDS, AND WHY THEY LOOK DIFFERENT ────────────────────────
 *
 * A driver glancing at this must be able to tell, without reading, which kind
 * of claim they are looking at. There are exactly three, and each has its own
 * treatment:
 *
 *   MEASURED PREDICTION - large cyan figure with its range underneath. Cyan is
 *   the console's live-instrument accent, used here and nowhere else in this
 *   list. The range is never omitted; the median band on this data is 112% of
 *   the point estimate, so the figure alone would overstate what is known.
 *
 *   PUBLISHED TIMETABLE - small amber CLOCK time, prefixed "Timetable". Never a
 *   countdown, never in the prediction's slot, never in the prediction's
 *   colour, and never used to fill a gap where a prediction is missing. It is
 *   shown because it is the only thing known about some stops, and it is
 *   labelled so it cannot be mistaken for a measurement.
 *
 *   CANNOT PREDICT - muted grey sentence saying why, and NO NUMBER AT ALL.
 *   Not a zero, not a dash, not "--:--" in the time slot. The stop keeps its
 *   name, sequence and distance, because it is still a stop on the route (rule
 *   8); what it does not get is anything that could be read as a time.
 *
 * ─── PHONE FIRST ─────────────────────────────────────────────────────────
 *
 * Read one-handed, in a cab, possibly in sunlight, by somebody who is driving
 * a bus. So: one stop per full-width row, the next stop given a heavier frame,
 * the arrival figure at text-3xl, body copy at text-base rather than the
 * console's text-sm, and no horizontal scrolling anywhere. Nothing in this list
 * is interactive - there is no tap target to miss, which is the safest control
 * on a screen used while driving.
 */
export function StopArrivalList({
  stops,
  generatedAt,
  predictionAvailable,
}: {
  stops: readonly JourneyStop[];
  generatedAt: string;
  /** False when the service declined for the whole bus; the panel above explains why. */
  predictionAvailable: boolean;
}) {
  if (stops.length === 0) {
    return (
      <OpsPanel title="Next stops" headingLevel={2}>
        <p className="py-6 text-center text-base text-ops-muted">
          {predictionAvailable
            ? 'No upcoming stops on this route.'
            : 'Upcoming stops will appear here once your bus is matched to its route.'}
        </p>
      </OpsPanel>
    );
  }

  // Read once for the whole list so every row on this render counts down from
  // the same instant. Deriving it per row would let two stops disagree by a
  // few hundred milliseconds and flicker against each other.
  const now = Date.now();

  return (
    <OpsPanel title="Next stops" headingLevel={2} padded={false}>
      <ul className="divide-y divide-ops-line">
        {stops.map((stop, index) => (
          <StopRow key={`${stop.stopId}-${stop.sequence}`} stop={stop} generatedAt={generatedAt} now={now} isNext={index === 0} />
        ))}
      </ul>
    </OpsPanel>
  );
}

function StopRow({
  stop,
  generatedAt,
  now,
  isNext,
}: {
  stop: JourneyStop;
  generatedAt: string;
  now: number;
  isNext: boolean;
}) {
  const readout = arrivalReadout(stop.arrival, generatedAt, now);
  const scheduled = formatScheduledClock(stop.scheduled?.arrival ?? null);
  const kilometres = stop.distanceRemainingMeters / 1000;

  return (
    <li className={isNext ? 'bg-holo-glow/[0.06] px-4 py-4' : 'px-4 py-4'}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          {isNext && (
            <p className="ops-eyebrow mb-1 text-holo-glow">Next stop</p>
          )}
          <p className="break-words text-lg font-semibold leading-snug text-ops-ink">
            {stop.stopName}
          </p>
          <p className="mt-1 font-mono text-sm tabular-nums text-ops-muted">
            {kilometres < 10 ? kilometres.toFixed(1) : kilometres.toFixed(0)} km away
            {stop.isControlPoint ? ' - timing point' : ''}
          </p>
        </div>

        {/* The time slot. Only a measured prediction is ever allowed to put a
            figure here; the other two branches deliberately render words. */}
        <div className="shrink-0 text-right">
          {readout.kind === 'time' ? (
            <>
              <p className="font-mono text-3xl font-semibold leading-none tabular-nums text-holo-glow">
                {readout.headline}
              </p>
              <p className="mt-1.5 font-mono text-sm tabular-nums text-ops-muted">{readout.window}</p>
            </>
          ) : readout.kind === 'due' ? (
            <p className="text-xl font-semibold leading-tight text-alert-green">{readout.reason}</p>
          ) : (
            <p className="max-w-[9rem] text-sm leading-snug text-ops-faint">{readout.reason}</p>
          )}
        </div>
      </div>

      {/* The timetable, on its own line, visibly a different kind of claim.
          Shown whether or not a prediction exists - it is never a substitute
          for one, and never merged into the figure above.

          The "published, not measured" qualifier is deliberately NOT repeated
          here. It was, and at 390px it wrapped mid-phrase on every row, six
          times down the screen - which buries the stop names it is supposed to
          be qualifying. It is stated once, under the map, where it reads as a
          fact about the amber times rather than as noise attached to each. */}
      {scheduled && (
        <p className="mt-2.5 flex items-baseline gap-2 text-sm text-ops-warn">
          <span className="ops-eyebrow text-ops-warn">Timetable</span>
          <span className="font-mono text-base tabular-nums">{scheduled}</span>
        </p>
      )}
    </li>
  );
}
