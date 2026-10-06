'use client';

import { useMemo, useState } from 'react';
import { ErrorPanel, LoadingBlock } from '@/components/depot/shell/DataStates';
import { ProvenanceBadge } from '@/components/depot/shell/ProvenanceBadge';
import { useBusSchedule } from '@/hooks/useBusSchedule';
import { feedTimeOfDay, inferNextStop, type BusPosition } from '@/lib/depot/routes/nextStop';
import type { CanonicalStop } from '@/models/canonical';

export interface BusTimetableProps {
  readonly registration: string;
  /** False for a bus with no route: nothing is fetched. */
  readonly hasRoute: boolean;
  readonly tripDate: string | null;
  readonly journeyId: string | null;
  readonly position: BusPosition | null;
  readonly feedNow: string | null;
}

const NO_ROUTE_MESSAGE = 'This bus carries no route in the feed, so there is no timetable to show.';
const NO_TIMETABLE_MESSAGE = 'No timetable was returned for this bus.';
const CLOCK_PATTERN = /^(\d{1,2}:\d{2}):\d{2}$/;

function scheduledTime(stop: CanonicalStop): string {
  const time = stop.scheduledArrival ?? stop.scheduledDeparture;
  if (time === null) return '—';
  return CLOCK_PATTERN.exec(time)?.[1] ?? time;
}

function TimetableBody({
  registration,
  hasRoute,
  tripDate,
  journeyId,
  position,
  feedNow,
  onRetry,
}: BusTimetableProps & { readonly onRetry: () => void }) {
  const { data, error, loading } = useBusSchedule(
    hasRoute ? registration : null,
    tripDate,
    journeyId,
  );
  const schedule = data?.schedule ?? null;
  const sample = data?.source === 'fixture';
  // A sample timetable belongs to no real bus, so no next stop is claimed from it.
  const next = useMemo(
    () =>
      schedule && !sample
        ? inferNextStop(schedule.stops, position, feedTimeOfDay(feedNow))
        : null,
    [schedule, sample, position, feedNow],
  );

  if (!hasRoute) return <p className="depot-prose">{NO_ROUTE_MESSAGE}</p>;
  if (loading) return <LoadingBlock rows={6} rowHeight={28} label="Loading the timetable" />;
  if (!data) {
    return (
      <ErrorPanel
        title="Timetable unavailable"
        message={error ?? NO_TIMETABLE_MESSAGE}
        onRetry={onRetry}
      />
    );
  }
  if (!schedule) return <p className="depot-prose">{data.message ?? NO_TIMETABLE_MESSAGE}</p>;

  const stops = [...schedule.stops].sort((a, b) => a.sequence - b.sequence);
  return (
    <div className="flex flex-col gap-2">
      <p className="flex flex-wrap items-center gap-2">
        {sample ? (
          <span className="depot-tag border-alert-amber/50 text-alert-amber">Sample data</span>
        ) : (
          <ProvenanceBadge provenance="live" />
        )}
        <span className="font-mono text-xs text-depot-muted">
          {schedule.routeName ?? 'Route'}
          {schedule.direction ? `, ${schedule.direction}` : ''}
        </span>
      </p>
      {sample ? (
        <p className="depot-prose" role="note">
          This is sample data, not this bus&apos;s timetable.
        </p>
      ) : null}
      {data.stale ? <p className="depot-prose">Showing the last good timetable.</p> : null}
      {next ? (
        <p className="flex flex-wrap items-center gap-2 font-mono text-xs text-depot-muted">
          <ProvenanceBadge provenance="derived" />
          {`Next stop ${next.stop.name}, worked out ${
            next.method === 'position' ? 'by position' : 'by timetable'
          }.`}
        </p>
      ) : null}
      {stops.length === 0 ? (
        <p className="depot-prose">The timetable lists no stops.</p>
      ) : (
        <ol className="m-0 list-none p-0" aria-label="Stops in order">
          {stops.map((stop) => {
            const isNext = next?.stop.id === stop.id;
            return (
              <li
                key={`${stop.sequence}-${stop.id}`}
                aria-current={isNext ? 'step' : undefined}
                className={`grid grid-cols-[2rem_minmax(0,1fr)_auto] items-baseline gap-x-3 border-b border-depot-line py-1.5 font-mono text-[13px] tabular-nums ${
                  isNext ? 'border-l-2 border-l-holo-glow bg-depot-raised pl-2' : ''
                }`}
              >
                <span className="text-depot-faint">{stop.sequence}</span>
                <span className="min-w-0">
                  <span className="break-words text-depot-ink">{stop.name}</span>
                  {isNext ? (
                    <span className="ml-2 text-[11px] uppercase tracking-[0.12em] text-holo-glow">
                      Next
                    </span>
                  ) : null}
                  {stop.latitude === null || stop.longitude === null ? (
                    <span className="block text-[11px] text-depot-faint">no surveyed position</span>
                  ) : null}
                </span>
                <span className="text-depot-muted">{scheduledTime(stop)}</span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

/** The bus's real timetable. A retry remounts the body, which fetches again. */
export function BusTimetable(props: BusTimetableProps) {
  const [attempt, setAttempt] = useState(0);
  return (
    <TimetableBody
      key={`${props.registration}-${attempt}`}
      {...props}
      onRetry={() => setAttempt((n) => n + 1)}
    />
  );
}
