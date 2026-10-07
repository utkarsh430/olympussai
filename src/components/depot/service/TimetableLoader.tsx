'use client';

import type { TimetableLoader } from '@/hooks/useTimetableLoader';
import { borrowedTimetableSentence } from '@/lib/depot/service/serviceCoverage';
import {
  busesToLoad,
  loadTimetableButtonLabel,
  loadTimetableButtonTitle,
  timetableProgressSentence,
  timetableRemainingLine,
} from '@/lib/depot/service/timetableLoader';
import type { RouteHourlyBody } from '@/lib/depot/service/types';

type TimetableBody = Pick<
  RouteHourlyBody,
  'busesOnRoute' | 'busesWithDay' | 'timetableBorrowedFrom' | 'operatingDate'
>;

export interface TimetableLoaderProps {
  readonly body: TimetableBody;
  readonly loader: TimetableLoader;
}

/** The buses a press would look up now. */
function pending(body: TimetableBody, loader: TimetableLoader): readonly string[] {
  return busesToLoad(body.busesOnRoute, body.busesWithDay, loader.answered);
}

/**
 * The chart section's control: "Load this route's full timetable" (its cost in the
 * `title`), or Cancel while a run goes. Nothing when no bus is left to load.
 */
export function TimetableLoadButton({ body, loader }: TimetableLoaderProps) {
  if (loader.running) {
    return (
      <button type="button" className="depot-filter-button" onClick={loader.cancel} data-testid="timetable-cancel">
        Cancel
      </button>
    );
  }
  const buses = pending(body, loader);
  if (buses.length === 0) return null;
  return (
    <button
      type="button"
      className="depot-filter-button"
      title={loadTimetableButtonTitle(buses.length)}
      onClick={() => loader.start(buses)}
      data-testid="timetable-load"
    >
      {loadTimetableButtonLabel()}
    </button>
  );
}

/**
 * Under the legend: the run in words while it goes and after it ends (one status line),
 * else what is left to load, and a sentence when an earlier date's timetable stands in.
 */
export function TimetableLoadStatus({ body, loader }: TimetableLoaderProps) {
  const unanswered = body.busesOnRoute.filter(
    (bus) => !body.busesWithDay.includes(bus) && !loader.answered.has(bus),
  ).length;
  const progress = timetableProgressSentence(loader.progress);
  const remaining = loader.running ? null : timetableRemainingLine(unanswered, body.busesOnRoute.length);
  const borrowed = borrowedTimetableSentence(body);
  return (
    <div className="mt-2 min-w-0" data-testid="timetable-loader">
      <p role="status" className="depot-note min-w-0" data-testid="timetable-status">
        {progress}
      </p>
      {remaining !== null ? <p className="depot-note min-w-0">{remaining}</p> : null}
      {borrowed !== null ? <p className="depot-note min-w-0">{borrowed}</p> : null}
    </div>
  );
}
