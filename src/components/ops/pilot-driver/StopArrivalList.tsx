'use client';

import { OpsPanel } from '@/components/ops/ui';
import type { JourneyStop } from '@/lib/ops/driverJourney';
import { arrivalReadout, formatScheduledClock } from '@/lib/ops/driverJourneyView';
import { cn } from '@/lib/utils';

/**
 * The stops ahead, and what can honestly be said about each one.
 *
 * ─── THE THREE KINDS, AND WHY THEY LOOK DIFFERENT ────────────────────────
 *
 * A driver glancing at this must be able to tell, without reading, which kind
 * of claim they are looking at. There are exactly three, and each has its own
 * treatment:
 *
 *   MEASURED PREDICTION - large figure in the console's live accent, with its
 *   range directly underneath. The range is never omitted; the median band on
 *   this data is 112% of the point estimate, so the figure alone would
 *   overstate what is known.
 *
 *   PUBLISHED TIMETABLE - small CLOCK time on its own line, tagged "Timetable".
 *   Never a countdown, never in the prediction's slot, never in the
 *   prediction's colour, and never used to fill a gap where a prediction is
 *   missing. It is shown because it is the only thing known about some stops,
 *   and it is labelled so it cannot be mistaken for a measurement.
 *
 *   CANNOT PREDICT - a muted sentence saying why, and NO NUMBER AT ALL. Not a
 *   zero, not a dash, not "--:--" in the time slot. The stop keeps its name,
 *   sequence and distance, because it is still a stop on the route; what it
 *   does not get is anything that could be read as a time.
 *
 * ─── THE DIFFERENCE IS NOT CARRIED BY COLOUR ─────────────────────────────
 *
 * It used to be: cyan figure, amber clock, grey sentence. Simulating
 * deuteranopia collapses that cyan/amber pair badly, and roughly one in twelve
 * male drivers reads this screen. So each kind now differs in THREE ways at
 * once - typeface weight and size, layout position, and an explicit word
 * ("Timetable", or the refusal sentence itself) - with hue as reinforcement
 * rather than as the signal. A driver reading this in greyscale, or in
 * sunlight that has washed the screen out, can still tell a measured time from
 * a published one.
 *
 * ─── PHONE FIRST ─────────────────────────────────────────────────────────
 *
 * Read one-handed, in a cab, possibly in sunlight, by somebody who is driving
 * a bus. So: one stop per full-width row, the next stop given a heavier frame,
 * the arrival figure large, body copy at text-base rather than the console's
 * text-sm, and no horizontal scrolling anywhere. Nothing in this list is
 * interactive - there is no tap target to miss, which is the safest control on
 * a screen used while driving.
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
        <p className="py-6 text-center text-base text-muted-foreground">
          {predictionAvailable
            ? 'No more stops on this route.'
            : 'Stops will appear here once your bus is matched to its route.'}
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
      <ul className="divide-y divide-border">
        {stops.map((stop, index) => (
          <StopRow
            key={`${stop.stopId}-${stop.sequence}`}
            stop={stop}
            generatedAt={generatedAt}
            now={now}
            isNext={index === 0}
          />
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
    <li className={cn('px-4 py-4', isNext && 'border-l-4 border-l-primary bg-accent/40')}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          {isNext && (
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-primary">
              Next stop
            </p>
          )}
          <p className="break-words text-lg font-semibold leading-snug text-foreground">
            {stop.stopName}
          </p>
          <p className="mt-1 text-sm tabular-nums text-muted-foreground">
            {kilometres < 10 ? kilometres.toFixed(1) : kilometres.toFixed(0)} km away
            {stop.isControlPoint ? ' · timing point' : ''}
          </p>
        </div>

        {/* The time slot. Only a measured prediction is ever allowed to put a
            figure here; the other two branches deliberately render words. */}
        <div className="shrink-0 text-right">
          {readout.kind === 'time' ? (
            <>
              <p className="text-3xl font-semibold tabular-nums leading-none text-primary">
                {readout.headline}
              </p>
              {/* The band, never optional. See driverJourneyView.arrivalReadout:
                  headline and window are returned together or not at all. */}
              <p className="mt-1.5 text-sm tabular-nums text-muted-foreground">{readout.window}</p>
            </>
          ) : readout.kind === 'due' ? (
            <p className="text-xl font-semibold leading-tight text-success">{readout.reason}</p>
          ) : (
            <p className="max-w-[9.5rem] text-sm leading-snug text-subtle">{readout.reason}</p>
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
          fact about the tagged times rather than as noise attached to each. */}
      {scheduled && (
        <p className="mt-2.5 flex items-baseline gap-2">
          <span className="rounded border border-warning/50 px-1.5 py-0.5 text-[0.7rem] font-semibold uppercase tracking-wide text-warning">
            Timetable
          </span>
          <span className="text-base tabular-nums text-warning">{scheduled}</span>
        </p>
      )}
    </li>
  );
}
