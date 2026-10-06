import { describe, expect, it } from 'vitest';
import type { DepotBusView } from '@/lib/depot/api';
import type { YardModel } from '@/lib/depot/yard/yardModel';
import {
  awayRows,
  noYardPanel,
  ROLL_NOTE,
  unknownRows,
  yardRoll,
} from '@/lib/depot/yard/yardRollModel';

const bus = (reg: string, over: Partial<DepotBusView> = {}): DepotBusView =>
  ({
    registrationNumber: reg,
    state: 'standing',
    gpsAgeMin: 2,
    notHeardMin: null,
    location: 'in_yard',
    distanceFromYardKm: null,
    otherDepotId: null,
    ...over,
  }) as DepotBusView;

function model(over: Partial<YardModel> = {}): YardModel {
  return {
    established: true,
    inYardGroups: [],
    allGroups: [],
    away: { buses: [], total: 0 },
    unknown: [],
    parkedWithPosition: 4,
    counts: { inYard: 0, visitors: 0, away: 0, unknown: 0 },
    ...over,
  } as YardModel;
}

describe('yardRoll', () => {
  const m = model({
    inYardGroups: [
      { state: 'standing', buses: [bus('S1'), bus('S2', { gpsAgeMin: 75 }), bus('S3')] },
      {
        state: 'dark',
        buses: [
          bus('D1', { state: 'dark', gpsAgeMin: 19991 }),
          bus('D2', { state: 'dark', gpsAgeMin: 200 }),
        ],
      },
      { state: 'off_road', buses: [bus('O1', { state: 'off_road', notHeardMin: 90 })] },
    ],
  });

  it('counts every bus in the yard by state, whatever its state', () => {
    const roll = yardRoll(m);
    expect(roll.total).toBe(6);
    expect(roll.counts.map((c) => [c.label, c.count])).toEqual([
      ['Standing', 3],
      ['Dark', 2],
      ['Off road', 1],
    ]);
  });

  it('groups only buses with a live reason, by state, longest unheard first', () => {
    const roll = yardRoll(m);
    expect(roll.groups.map((g) => [g.state, g.rows.map((r) => r.registration)])).toEqual([
      ['standing', ['S2']],
      ['dark', ['D1', 'D2']],
      ['off_road', ['O1']],
    ]);
  });

  it('prints durations in days and hours, never raw minutes above an hour', () => {
    const dark = yardRoll(m).groups.find((g) => g.state === 'dark');
    expect(dark?.rows.map((r) => r.notHeard)).toEqual(['13 d 21 h', '3 h 20 min']);
  });

  it('never repeats the state word in the reason, and drops a reason column that is empty', () => {
    const groups = yardRoll(m).groups;
    const reasons = groups.flatMap((g) => g.rows.map((r) => r.reason));
    for (const reason of reasons) expect(reason).not.toMatch(/dark|off.road/i);
    expect(groups.find((g) => g.state === 'standing')?.showReason).toBe(true);
    expect(groups.find((g) => g.state === 'standing')?.rows[0]?.reason).toBe('not heard recently');
    expect(groups.find((g) => g.state === 'dark')?.showReason).toBe(false);
    expect(groups.find((g) => g.state === 'off_road')?.rows[0]?.reason).toBe('not heard recently');
  });

  it('never lists a reason that comes from the modelled parking order', () => {
    const text = JSON.stringify(yardRoll(m));
    expect(text).not.toMatch(/lane|parking|order|placed/i);
    expect(ROLL_NOTE).not.toMatch(/lane|parking/i);
  });

  it('states the listing rule in one short line with the threshold as a duration', () => {
    expect(ROLL_NOTE).toBe('Listed: off the road, dark, or not heard for 1 h or more');
  });

  it('uses every bus by state when no yard is established', () => {
    const roll = yardRoll(
      model({ established: false, allGroups: [{ state: 'dark', buses: [bus('D9', { state: 'dark' })] }] }),
    );
    expect(roll.title).toBe('Buses by state');
    expect(roll.total).toBe(1);
    expect(yardRoll(m).title).toBe('In the yard now');
  });
});

describe('awayRows and unknownRows', () => {
  it('gives the distance as a bare number and names the other depot only when one is known', () => {
    const rows = awayRows(
      [
        bus('A1', { location: 'away', distanceFromYardKm: 12.34, gpsAgeMin: 130 }),
        bus('A2', { location: 'at_other_yard', otherDepotId: '7', distanceFromYardKm: 40 }),
        bus('A3', { location: 'away', distanceFromYardKm: null }),
      ],
      new Map([['7', 'Agra']]),
    );
    expect(rows.map((r) => [r.registration, r.km, r.atYard, r.notHeard])).toEqual([
      ['A1', '12.3', '', '2 h 10 min'],
      ['A2', '40.0', 'Agra', '2 min'],
      ['A3', '—', '', '2 min'],
    ]);
  });

  it('lists buses with no location with their state and how long unheard', () => {
    expect(unknownRows([bus('U1', { state: 'dark', gpsAgeMin: null })])).toEqual([
      { registration: 'U1', state: 'dark', notHeardMin: null, notHeard: '—', reason: '' },
    ]);
  });
});

describe('noYardPanel', () => {
  it('says the server has only just started when it has seen at most one snapshot', () => {
    for (const seen of [0, 1]) {
      const panel = noYardPanel(model({ established: false }), seen);
      expect(panel.sentence).toBe('The server has only just started, so no yard is placed yet.');
      expect(panel.remedy).toContain('may be found shortly');
    }
  });

  it('otherwise says in one sentence why no yard is established, with the parked count', () => {
    const panel = noYardPanel(model({ established: false, parkedWithPosition: 4 }), 12);
    expect(panel.sentence).toBe(
      'No yard is established yet: too few parked buses report a position together.',
    );
    expect(panel.remedy).toBe(
      'A yard appears when more of the 4 parked buses with a position stand together.',
    );
    expect(noYardPanel(model({ established: false }), undefined).sentence).toMatch(/^No yard/);
  });
});
