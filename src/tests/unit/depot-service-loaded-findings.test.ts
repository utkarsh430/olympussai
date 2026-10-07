// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { timetableFindings } from '@/lib/depot/service/timetableFindings';
import type { Proposal, ProposalKind, ScheduledTrip } from '@/lib/depot/service/types';
import { context, DATE, day, journey } from './depot-service-proposals.fixtures';

/*
 * Tier-A findings on loaded timetables: a loaded trip of a bus that reports its journeys,
 * due while this server watched, never seen, is a trip not run; the span and headway
 * findings read the feed's journeys and the loaded trips together.
 */

const kinds = (ps: readonly Proposal[], kind: ProposalKind): Proposal[] =>
  ps.filter((p) => p.kind === kind);

/** A loaded trip of bus `UP32AB<bus>` (the fixtures' journey buses), on R1. */
function trip(id: string, start: string, bus = 'a', over: Partial<ScheduledTrip> = {}): ScheduledTrip {
  return {
    forDate: DATE, answeredDate: DATE, registrationNumber: `UP32AB${bus}`, journeyId: id,
    journeyCode: null, routeName: 'R1', startTime: start, endTime: null, stops: 10, ...over,
  };
}

describe('trips_not_run from loaded trips', () => {
  // Bus UP32ABa reports its journeys: one of them ran at 07:00.
  const ledger = [journey('a', { scheduledStart: '07:00', actualStart: '07:02' })];

  it('counts a loaded trip of a reporting bus, due while watched and never seen', () => {
    const trips = [
      trip('L1', '09:10'), // missed
      trip('L2', '10:05'), // missed
      trip('L3', '11:45'), // only 15 min past the clock
      trip('a', '07:00'), // the journey the feed saw run
      trip('L4', '09:20', 'zz'), // a bus that never reports its journeys: unknown
      trip('L5', '05:30'), // before this server began watching
      trip('L6', '09:40', 'a', { routeName: 'OTHER' }), // another route
    ];
    const found = kinds(
      timetableFindings(context({ ledger, trips, observedSince: '06:00', feedMinute: 12 * 60 })),
      'trips_not_run',
    );
    expect(found.map((p) => p.band)).toEqual([{ fromHour: 9, toHour: 10 }]);
    expect(found[0]?.reason).toContain('2 scheduled journeys');
  });

  it('counts a journey once when the feed and the timetable both list it', () => {
    const notRun = [journey('x', { scheduledStart: '09:10', actualStart: null })];
    const found = kinds(
      timetableFindings(
        context({ ledger: notRun, trips: [trip('x', '09:10', 'x')], observedSince: '06:00' }),
      ),
      'trips_not_run',
    );
    expect(found[0]?.reason).toContain('1 scheduled journey');
  });

  it('says nothing of loaded trips when nothing was observed', () => {
    const found = kinds(
      timetableFindings(context({ ledger, trips: [trip('L1', '09:10')], observedSince: null })),
      'trips_not_run',
    );
    expect(found).toEqual([]);
  });
});

describe('span and headway on the merged timetable', () => {
  const hours = day({}, {}).map((h) => ({ ...h, demand: h.hour >= 6 && h.hour <= 21 ? 100 : 0 }));

  it('reads loaded trips beside the feed journeys for the span', () => {
    const ledger = [journey('a', { scheduledStart: '12:00', scheduledEnd: '13:45' })];
    const trips = [
      trip('L1', '06:00', 'a', { endTime: '07:45' }),
      trip('L2', '17:00', 'a', { endTime: '18:45' }),
    ];
    const found = kinds(timetableFindings(context({ hours, ledger, trips })), 'service_span_gap');
    expect(found.map((p) => p.band)).toEqual([{ fromHour: 19, toHour: 21 }]);
  });

  it('reads loaded trips for the headway', () => {
    const trips = ['06:10', '07:00', '07:40', '10:30', '11:00', '23:00'].map((s, i) =>
      trip(`L${i}`, s),
    );
    const found = kinds(timetableFindings(context({ hours, trips })), 'headway_gap');
    expect(found.map((p) => p.band)).toEqual([
      { fromHour: 8, toHour: 9 },
      { fromHour: 12, toHour: 21 },
    ]);
  });
});
