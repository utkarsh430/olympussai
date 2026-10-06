import { beforeEach, describe, expect, it } from 'vitest';
import type { DepotBusRow } from '@/models/depotLive';
import type { FleetSnapshotView } from '@/lib/depot/repositories/types';
import { busLocationText } from '@/lib/depot/infer/locationText';
import { SCORE_WINDOW_MIN } from '@/lib/depot/score/window';
import { defaultScoreWindowStore } from '@/lib/depot/score/windowStore';
import { analyseSnapshot, resetAnalysisForTests } from '@/lib/depot/live/analysis';
import { buildDepotDetail } from '@/lib/depot/live/depotView';
import { buildExceptionsResponse } from '@/lib/depot/live/exceptionView';
import { buildNetworkResponse } from '@/lib/depot/live/networkView';
import { blob, busAt } from './depot-yard.fixtures';

const T0 = Date.parse('2026-10-06T08:00:00.000Z');
const at = (minutes: number): string => new Date(T0 + minutes * 60_000).toISOString();

const A = { x: 0, y: 0 };
const B = { x: 5000, y: 0 };

/** Depot 1 with a yard stand and a terminal stand, and one bus due out of the yard. */
function rowsAt(feedNow: string, a: number, b: number): DepotBusRow[] {
  const heard = { depotId: '1', gpsTimestamp: feedNow };
  const due = new Date(Date.parse(feedNow) - 30 * 60_000).toISOString();
  return [
    ...blob('A', a, A, 20, heard),
    ...blob('B', b, B, 20, heard),
    busAt('DUE', A, { ...heard, routeName: 'R1', scheduledStart: due }),
  ];
}

function viewOf(
  rows: readonly DepotBusRow[],
  feedNow: string,
  over: Partial<FleetSnapshotView> = {},
): FleetSnapshotView {
  return {
    rows,
    feedNow,
    fetchedAt: feedNow,
    source: 'live',
    stale: false,
    recordCount: rows.length,
    ...over,
  };
}

const samplesHeld = (): number => defaultScoreWindowStore().byDepot.get('1')?.length ?? 0;

describe('analysis across snapshots', () => {
  beforeEach(() => resetAnalysisForTests());

  it('adds one sample per snapshot, however often and however stale it is served', () => {
    const first = viewOf(rowsAt(at(0), 12, 6), at(0));
    const body = buildNetworkResponse(first);
    expect(buildNetworkResponse(first).scores).toBe(body.scores);
    expect(buildDepotDetail(first, '1')?.score).toBe(body.scores[0]);
    expect(samplesHeld()).toBe(1);
    // The same rows served later as stale last-good: no second sample, and it says stale.
    const stale = buildNetworkResponse({
      ...first,
      fetchedAt: at(9),
      source: 'cache',
      stale: true,
    });
    expect(stale.stale).toBe(true);
    expect(stale.scores).toBe(body.scores);
    expect(samplesHeld()).toBe(1);

    const second = buildNetworkResponse(viewOf(rowsAt(at(1), 12, 6), at(1)));
    expect(samplesHeld()).toBe(2);
    expect(second.scoreWindow).toEqual({
      lengthMin: SCORE_WINDOW_MIN,
      since: at(0),
      samples: 2,
      coveredMin: 1,
    });
    expect(second.scores[0]?.samples).toBe(2);
    // New rows with a feed time already seen (a re-fetch): that sample is replaced, not added.
    buildNetworkResponse(viewOf(rowsAt(at(1), 12, 6), at(1)));
    expect(samplesHeld()).toBe(2);
    // An older snapshot inside the window is inserted in feed-time order (S50b).
    const older = buildNetworkResponse(viewOf(rowsAt(at(0.5), 12, 6), at(0.5)));
    expect(older.scoreWindow).toMatchObject({ since: at(0), samples: 3 });
    expect(samplesHeld()).toBe(3);
    // The recorded fixture never touches the window.
    const fixture = buildNetworkResponse(
      viewOf(rowsAt(at(0.75), 12, 6), at(0.75), { source: 'fixture' }),
    );
    expect(fixture.scoreWindow).toMatchObject({ since: at(0.75), samples: 1 });
    expect(samplesHeld()).toBe(3);
  });

  it('states the window on every response that carries an index or a depot exception', () => {
    const view = viewOf(rowsAt(at(0), 12, 6), at(0));
    const window = { lengthMin: SCORE_WINDOW_MIN, since: at(0), samples: 1, coveredMin: 0 };
    expect(buildNetworkResponse(view).scoreWindow).toEqual(window);
    expect(buildNetworkResponse(view).scores[0]?.window).toEqual(window);
    expect(buildNetworkResponse(view).scores[0]?.samples).toBe(1);
    expect(buildExceptionsResponse(view).scoreWindow).toEqual(window);
    expect(buildDepotDetail(view, '1')?.scoreWindow).toEqual(window);
  });

  it('gives every page the held yard: yard figure, locations and outshed', () => {
    const before = buildDepotDetail(viewOf(rowsAt(at(0), 12, 6), at(0)), '1');
    expect(before?.yard.value?.heldSince).toBeUndefined();
    const dueBefore = before?.outshed.rows.find((r) => r.registrationNumber === 'DUE')?.state;

    const rows = rowsAt(at(1), 12, 12);
    const view = viewOf(rows, at(1));
    const analysis = analyseSnapshot(view);
    const detail = buildDepotDetail(view, '1');
    expect(detail?.yard.value).toMatchObject({ heldSince: at(1), inCluster: 13 });
    expect(detail?.yard.value).toBe(analysis.yards.get('1'));
    expect(detail?.locationMix).toEqual({ in_yard: 13, at_other_yard: 0, away: 12, unknown: 0 });
    // The row and the drawer read one bus view, and it comes from the analysis's one function.
    for (const row of rows) {
      const bus = detail?.buses.find((b) => b.registrationNumber === row.registrationNumber);
      expect(bus?.location).toBe(analysis.locate(row).location);
      expect(bus?.distanceFromYardKm).toBe(analysis.locate(row).distanceFromYardKm);
    }
    const dueNow = detail?.outshed.rows.find((r) => r.registrationNumber === 'DUE')?.state;
    expect(dueNow).toBe(dueBefore);
    expect(dueNow).not.toBe('unknown');
  });

  it('words a location in one place, with a distance only when away from a known yard', () => {
    expect(busLocationText({ location: 'away', distanceFromYardKm: 13.6 })).toBe(
      'Away, 14 km from yard',
    );
    expect(busLocationText({ location: 'away', distanceFromYardKm: null })).toBe('Away');
    expect(busLocationText({ location: 'unknown', distanceFromYardKm: null })).toBe(
      'Location unknown',
    );
    expect(busLocationText({ location: 'in_yard', distanceFromYardKm: 0.1 })).toBe('In yard');
  });

  it('needs the full rule after a restart: the same rows then have no yard', () => {
    const rows = rowsAt(at(1), 12, 12);
    const detail = buildDepotDetail(viewOf(rows, at(1)), '1');
    expect(detail?.yard.value).toBeNull();
    expect(detail?.locationMix.unknown).toBe(25);
  });

  it('flags a bus not heard for longer than the reporting window', () => {
    const quiet = busAt('Q', A, { depotId: '1', gpsTimestamp: at(-87), speedKmph: 40 });
    const rows = [...rowsAt(at(0), 12, 6), quiet];
    const buses = buildDepotDetail(viewOf(rows, at(0)), '1')?.buses ?? [];
    expect(buses.find((b) => b.registrationNumber === 'Q')).toMatchObject({
      state: 'on_road',
      notHeardMin: 87,
    });
    expect(buses.find((b) => b.registrationNumber === 'DUE')?.notHeardMin).toBeNull();
  });
});
