import { describe, expect, it } from 'vitest';
import type { DepotBusView } from '@/lib/depot/api';
import type { ParkingOrder } from '@/lib/depot/yard/parkingApi';
import {
  buildParkingDiagram,
  LANE_GAP_PX,
  LANE_H_PX,
  LANE_LABEL_W_PX,
  shortRegistration,
  SLOT_GAP_PX,
  SLOT_W_PX,
} from '@/lib/depot/yard/parkingDiagram';
import type { YardModel } from '@/lib/depot/yard/yardModel';
import {
  capacityFigure,
  heldSinceLine,
  mapCaption,
  visitorRows,
} from '@/lib/depot/yard/yardPageModel';

const bus = (reg: string, over: Partial<DepotBusView> = {}): DepotBusView =>
  ({
    registrationNumber: reg,
    state: 'standing',
    gpsAgeMin: 2,
    location: 'in_yard',
    ...over,
  }) as DepotBusView;

const point = (registration: string, relation: 'home' | 'visiting') => ({
  registration,
  relation,
  lat: 0,
  lng: 0,
  state: 'standing' as const,
  distanceM: 1,
});

function model(over: Partial<YardModel> = {}): YardModel {
  return {
    established: true,
    inYardGroups: [{ state: 'standing', buses: [bus('A1'), bus('A2')] }],
    allGroups: [],
    counts: { inYard: 2, visitors: 1, away: 3, unknown: 0 },
    points: [],
    beyondOwn: 0,
    beyondVisiting: 0,
    ...over,
  } as YardModel;
}

describe('capacityFigure', () => {
  it('reads "N of M" with the modelled bays and a share', () => {
    const f = capacityFigure({ inYard: 87, visiting: 70, fleet: 200, bays: 209 }, false);
    expect(f.value).toBe('157 of 209');
    expect(f.caption).toBe('modelled bays in use; 52 free');
    expect(f.share).toBeCloseTo(157 / 209);
    expect(f.title).toContain('157 of 209 modelled bays in use; 52 free.');
    expect(f.title).toContain('70 buses from other depots');
  });
  it('says over, and sets only the fleet against bays with no yard', () => {
    expect(capacityFigure({ inYard: 55, visiting: 10, fleet: 60, bays: 60 }, false).caption).toBe(
      'modelled bays in use; 5 over',
    );
    const none = capacityFigure({ inYard: null, visiting: 0, fleet: 50, bays: 60 }, false);
    expect(none.caption).toBe('fleet against modelled bays');
    expect(none.title).toContain('No yard is established');
  });
  it('shows a dash and why when the bay count is missing', () => {
    const view = { inYard: 38, visiting: 2, fleet: 50, bays: null };
    expect(capacityFigure(view, true).caption).toBe('bay count loading');
    const failed = capacityFigure(view, false);
    expect(failed.value).toBe('—');
    expect(failed.share).toBeUndefined();
    expect(failed.title).toContain('38 buses in the yard, 2 visiting.');
  });
});

describe('heldSinceLine', () => {
  it('names the time a held yard dates from, and nothing otherwise', () => {
    const yard = { heldSince: '2026-10-05T14:02:00.000Z' } as YardModel['yard'];
    expect(heldSinceLine(yard)).toBe(
      'Yard held since 14:02: this snapshot alone would not place it.',
    );
    expect(heldSinceLine({} as YardModel['yard'])).toBeNull();
    expect(heldSinceLine(null)).toBeNull();
  });
});

describe('mapCaption', () => {
  it('says what the drawn total is made of, so it reconciles with the figures', () => {
    const m = model({
      points: [point('A1', 'home'), point('B9', 'home'), point('V1', 'visiting')],
      beyondOwn: 4,
      beyondVisiting: 1,
      visitorsWithoutPosition: 2,
    });
    expect(mapCaption(m)).toBe(
      "3 buses drawn: 1 in the yard, 1 of this depot's just outside it, 1 visiting. 1 in the yard has no position. 2 visiting have no position and are listed below only. 5 more beyond the map's range are listed below.",
    );
  });
});

describe('visitorRows', () => {
  it('sorts by home depot, unknown last, then registration', () => {
    const v = (reg: string, home: string | null) =>
      ({
        registrationNumber: reg,
        homeDepotName: home,
        homeDepotId: null,
        state: 'standing',
        position: null,
      }) as const;
    expect(
      visitorRows([v('Z1', 'Agra'), v('B2', null), v('A9', 'Agra'), v('C1', 'Bareilly')]).map(
        (r) => r.registration,
      ),
    ).toEqual(['A9', 'Z1', 'C1', 'B2']);
  });
});

describe('buildParkingDiagram', () => {
  const order: ParkingOrder = {
    provenance: 'modelled',
    lanes: [
      {
        id: 'L01',
        depth: 3,
        slots: [{ position: 1, registrationNumber: 'UP78JN1770', firstDutyStartMin: 330 }],
      },
      { id: 'L02', depth: 2, slots: [] },
    ],
    overflow: [
      {
        registrationNumber: 'UP32X0009',
        firstDutyStartMin: null,
        reason: 'places_taken_by_visitors',
      },
    ],
    blocked: 0,
    parkedCount: 1,
  };

  it('lays each lane out as numbered slots from the exit, filled or free', () => {
    const d = buildParkingDiagram(order);
    const [l1, l2] = d.lanes;
    expect(l1?.slots.map((s) => s.shortReg)).toEqual(['1770', null, null]);
    expect(l1?.slots[0]?.timeText).toBe('05:30');
    expect(l1?.slots[0]?.title).toBe('Lane L01, place 1: UP78JN1770, first duty 05:30');
    expect(l1?.slots[2]?.leftPx).toBe(LANE_LABEL_W_PX + 2 * (SLOT_W_PX + SLOT_GAP_PX));
    expect(l2?.topPx).toBe(LANE_H_PX + LANE_GAP_PX);
    expect(d.widthPx).toBe(LANE_LABEL_W_PX + 3 * SLOT_W_PX + 2 * SLOT_GAP_PX);
    expect(d.heightPx).toBe(2 * LANE_H_PX + LANE_GAP_PX);
  });

  it('lists overflow with its reason, and the one status line', () => {
    const d = buildParkingDiagram(order);
    expect(d.overflow).toEqual([
      { registration: 'UP32X0009', timeText: '—', reason: 'Places taken by visiting buses' },
    ]);
    expect(d.status.text).toContain('No bus is blocked in');
    expect(d.summary).toBe('2 lanes, 1 of 5 places filled, each lane from the exit inwards.');
    expect(buildParkingDiagram({ ...order, blocked: 2 }).status.warning).toBe(true);
  });

  it('shortens a registration to its last four characters', () => {
    expect(shortRegistration(' UP78JN1770 ')).toBe('1770');
    expect(shortRegistration('AB1')).toBe('AB1');
  });
});
