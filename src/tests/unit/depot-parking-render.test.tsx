import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ParkingPlan } from '@/components/depot/yard/ParkingPlan';
import { ParkingPlanSection } from '@/components/depot/yard/ParkingPlanSection';
import { YardFigures } from '@/components/depot/yard/YardSummary';
import type { DepotParkingState } from '@/hooks/useDepotParking';
import type { YardModel } from '@/lib/depot/yard/yardModel';
import type { ParkingCapacity, ParkingOrder, ParkingResponse } from '@/lib/depot/yard/parkingApi';
import { capacityViewOf, PLAN_NOTICE } from '@/lib/depot/yard/parkingModel';
import type { DepotDetailResponse } from '@/lib/depot/api';

const hook = vi.hoisted(() => ({ value: null as unknown, detail: null as unknown }));

vi.mock('@/components/depot/data/DepotDetailProvider', () => ({
  useDepotDetailContext: (): unknown => ({
    depotId: '20',
    data: hook.detail,
    error: null,
    loading: false,
    refresh: () => {},
  }),
}));

vi.mock('@/hooks/useDepotParking', () => ({ useDepotParking: (): unknown => hook.value }));

const CAPACITY: ParkingCapacity = {
  bays: { value: 60, provenance: 'modelled' },
  inYard: { value: 38, provenance: 'derived' },
  visiting: { value: 2, provenance: 'derived' },
  fleet: { value: 50, provenance: 'live' },
};

/** The depot detail the yard page already holds: only what the capacity panel reads. */
const detailOf = (yard: unknown, inYard: number, visitors: number): DepotDetailResponse =>
  ({
    depot: { fleet: 50 },
    yard: { value: yard },
    locationMix: { in_yard: inYard },
    visitors: new Array(visitors).fill({}),
  }) as unknown as DepotDetailResponse;

const ORDER: ParkingOrder = {
  provenance: 'modelled',
  blocked: 0,
  parkedCount: 3,
  lanes: [
    {
      id: 'L01',
      depth: 6,
      slots: [
        { position: 1, registrationNumber: 'UP32A0001', firstDutyStartMin: 330 },
        { position: 2, registrationNumber: 'UP32A0002', firstDutyStartMin: null },
      ],
    },
    { id: 'L02', depth: 8, slots: [] },
  ],
  overflow: [{ registrationNumber: 'UP32A0009', firstDutyStartMin: null, reason: 'no_lane_space' }],
};

const BASE: ParkingResponse = {
  feedNow: '2026-10-06T10:00:00Z',
  fetchedAt: '2026-10-06T10:00:05.000Z',
  source: 'live',
  stale: false,
  depot: { id: '20', name: 'Alambagh' },
  operatingDate: '2026-10-07',
  state: 'planned',
  capacity: CAPACITY,
  droppedRows: 0,
  order: ORDER,
};

const text = (markup: string): string => markup.replace(/<[^>]*>/g, '');

function setHook(partial: Record<string, unknown>): void {
  hook.value = { data: null, error: null, loading: false, refresh: () => {}, ...partial };
}

beforeEach(() => {
  setHook({});
  hook.detail = detailOf({}, 38, 2);
});

// Rewritten for the design wave: capacity is now a figure in the yard's band (the old
// capacity panel is gone); its full sentences moved to the page's closed disclosure.
const yardModel = (established: boolean): YardModel =>
  ({
    established,
    counts: { inYard: 38, visitors: 2, away: 10, unknown: 0 },
    parkedWithPosition: 12,
  }) as unknown as YardModel;

describe('YardFigures', () => {
  it('sets buses in the yard and visiting against the modelled bays, tagged MODELLED', () => {
    const html = renderToStaticMarkup(
      <YardFigures
        model={yardModel(true)}
        capacity={capacityViewOf(detailOf({}, 38, 2), 60)}
        baysPending={false}
      />,
    );
    expect(text(html)).toContain('40 of 60');
    expect(text(html)).toContain('modelled bays in use; 20 free');
    expect(html).toContain('depot-figure-share');
    expect(html).toContain('data-provenance="modelled"');
  });

  it('sets only the fleet against the bays when no yard is established', () => {
    const t = text(
      renderToStaticMarkup(
        <YardFigures
          model={yardModel(false)}
          capacity={capacityViewOf(detailOf(null, 0, 0), 60)}
          baysPending={false}
        />,
      ),
    );
    expect(t).toContain('50 of 60');
    expect(t).toContain('fleet against modelled bays');
    expect(t).not.toMatch(/In the yard/);
  });

  it('keeps the live counts and says the bay count is unavailable when it is missing', () => {
    const t = text(
      renderToStaticMarkup(
        <YardFigures
          model={yardModel(true)}
          capacity={capacityViewOf(detailOf({}, 38, 2), null)}
          baysPending={false}
        />,
      ),
    );
    expect(t).toContain('38');
    expect(t).toContain('bay count unavailable');
  });

  it('takes the counts from the depot detail and only the bays from the parking response', () => {
    const t = text(
      renderToStaticMarkup(
        <YardFigures
          model={yardModel(true)}
          capacity={capacityViewOf(detailOf({}, 55, 10), 60)}
          baysPending={false}
        />,
      ),
    );
    expect(t).toContain('65 of 60');
    expect(t).toContain('5 over');
  });
});

describe('ParkingPlan', () => {
  const html = renderToStaticMarkup(
    <ParkingPlan depotId="20" order={ORDER} operatingDate="2026-10-07" />,
  );

  it('tags the order MODELLED and carries the one-sentence notice', () => {
    expect(html).toContain('data-provenance="modelled"');
    expect(text(html)).toContain(PLAN_NOTICE);
  });

  it('lists each lane from the exit inwards with a link to the bus in the roster', () => {
    expect(text(html)).toContain('Lane L01: 2 of 6 places used');
    expect(html).toContain('href="/project/depots/d/20/roster?bus=UP32A0001"');
    expect(html.indexOf('UP32A0001')).toBeLessThan(html.indexOf('UP32A0002'));
    expect(text(html)).toContain('first duty 05:30');
    expect(text(html)).toContain('no duty');
    expect(text(html)).toContain('No bus is placed in this lane.');
  });

  it('lists the overflow with its reason and says no bus is blocked', () => {
    expect(text(html)).toContain('1 bus does not fit in the modelled lanes and is not ordered.');
    expect(text(html)).toContain('No free place in any modelled lane');
    expect(text(html)).toContain('No bus is blocked in');
  });

  it('warns in words when any bus is blocked, and omits the overflow block when none', () => {
    const warn = renderToStaticMarkup(
      <ParkingPlan
        depotId="20"
        order={{ ...ORDER, blocked: 2, overflow: [] }}
        operatingDate="2026-10-07"
      />,
    );
    expect(text(warn)).toContain('Warning: 2 buses would be blocked in');
    expect(warn).toContain('role="alert"');
    expect(warn).not.toContain('parking-overflow');
  });

  it('prints the date with the shared formatter and says departures, not tonight', () => {
    expect(text(html)).toContain('For departures on 7 Oct 2026.');
    expect(text(html)).not.toContain('2026-10-07');
    expect(text(html).toLowerCase()).not.toContain('tonight');
  });

  // Rewritten for the design wave: the lane cards became one diagram that scrolls
  // sideways in its own relative frame, so no grid of lane cards exists at any width.
  it('draws the lanes in their own scrolling frame, never a grid of lane cards', () => {
    expect(html).toContain('parking-diagram');
    expect(html).toMatch(/relative min-w-0 overflow-x-auto/);
    expect(html).not.toMatch(/grid-cols-/);
    expect(html).toContain('title="Lane L01, place 1: UP32A0001, first duty 05:30"');
  });

  it('uses no hidden attribute and never says simulated', () => {
    expect(html).not.toMatch(/\shidden[\s>=]/);
    expect(html.toLowerCase()).not.toContain('simulated');
  });
});

describe('ParkingPlanSection', () => {
  it('shows a loading placeholder while the first response is awaited', () => {
    setHook({ loading: true });
    expect(
      renderToStaticMarkup(
        <ParkingPlanSection depotId="20" parking={hook.value as DepotParkingState} />,
      ),
    ).toContain('depot-loading');
  });

  it('shows an error panel with Retry when there is no data', () => {
    setHook({ error: 'Depot data unavailable' });
    const html = renderToStaticMarkup(
      <ParkingPlanSection depotId="20" parking={hook.value as DepotParkingState} />,
    );
    expect(html).toContain('depot-error');
    expect(text(html)).toContain('Retry');
  });

  it('shows the failure with retry and no plan when the parking endpoint fails', () => {
    setHook({ error: 'Depot data unavailable' });
    const html = renderToStaticMarkup(
      <ParkingPlanSection depotId="20" parking={hook.value as DepotParkingState} />,
    );
    expect(html).toContain('depot-error');
    expect(html).not.toContain('parking-plan"');
  });

  it('shows the order with a stale strip on last-good data', () => {
    setHook({ data: { ...BASE, stale: true } });
    const html = renderToStaticMarkup(
      <ParkingPlanSection depotId="20" parking={hook.value as DepotParkingState} />,
    );
    expect(html).toContain('depot-stale');
    expect(html).toContain('parking-plan');
  });

  it('gives one sentence instead of an order when no yard is established', () => {
    setHook({
      data: {
        ...BASE,
        state: 'no_yard',
        order: null,
        capacity: { ...CAPACITY, inYard: { value: null, provenance: 'derived' } },
      },
    });
    hook.detail = detailOf(null, 0, 0);
    const html = renderToStaticMarkup(
      <ParkingPlanSection depotId="20" parking={hook.value as DepotParkingState} />,
    );
    expect(html).toContain('depot-empty');
    expect(text(html)).toContain('No yard is established for this depot');
    expect(html).not.toContain('parking-plan"');
  });
});
