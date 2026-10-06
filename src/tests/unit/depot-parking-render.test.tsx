import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ParkingPlan } from '@/components/depot/yard/ParkingPlan';
import { ParkingPlanSection } from '@/components/depot/yard/ParkingPlanSection';
import { YardCapacity } from '@/components/depot/yard/YardCapacity';
import type {
  ParkingCapacity,
  ParkingOrder,
  ParkingResponse,
} from '@/lib/depot/yard/parkingApi';
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

describe('YardCapacity', () => {
  it('says bays in use against modelled capacity and tags each source', () => {
    const html = renderToStaticMarkup(
      <YardCapacity capacity={capacityViewOf(detailOf({}, 38, 2), 60)} />,
    );
    expect(text(html)).toContain('40 of 60 modelled bays in use; 20 free.');
    expect(text(html)).toContain('2 buses from other depots');
    expect(html).toContain('data-provenance="derived"');
    expect(html).toContain('data-provenance="modelled"');
  });

  it('sets only the fleet against the bays when no yard is established', () => {
    const t = text(
      renderToStaticMarkup(<YardCapacity capacity={capacityViewOf(detailOf(null, 0, 0), 60)} />),
    );
    expect(t).toContain('No yard is established');
    expect(t).toContain('50 buses in the fleet, 60 modelled bays');
    expect(t).not.toMatch(/in use/);
  });

  it('shows the live counts and no modelled tag when the bay count is missing', () => {
    const html = renderToStaticMarkup(
      <YardCapacity capacity={capacityViewOf(detailOf({}, 38, 2), null)} />,
    );
    expect(text(html)).toContain('38 buses in the yard, 2 visiting.');
    expect(text(html)).toContain('modelled bay count is unavailable');
    expect(html).not.toContain('data-provenance="modelled"');
  });
});

describe('ParkingPlan', () => {
  const html = renderToStaticMarkup(<ParkingPlan depotId="20" order={ORDER} operatingDate="2026-10-07" />);

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

  it('uses no hidden attribute and never says simulated', () => {
    expect(html).not.toMatch(/\shidden[\s>=]/);
    expect(html.toLowerCase()).not.toContain('simulated');
  });
});

describe('ParkingPlanSection', () => {
  it('shows a loading placeholder while the first response is awaited', () => {
    setHook({ loading: true });
    expect(renderToStaticMarkup(<ParkingPlanSection depotId="20" />)).toContain('depot-loading');
  });

  it('shows an error panel with Retry when there is no data', () => {
    setHook({ error: 'Depot data unavailable' });
    const html = renderToStaticMarkup(<ParkingPlanSection depotId="20" />);
    expect(html).toContain('depot-error');
    expect(text(html)).toContain('Retry');
  });

  it('keeps the live capacity counts on screen when the parking endpoint fails', () => {
    setHook({ error: 'Depot data unavailable' });
    const html = renderToStaticMarkup(<ParkingPlanSection depotId="20" />);
    expect(html).toContain('yard-capacity');
    expect(text(html)).toContain('38 buses in the yard, 2 visiting.');
    expect(text(html)).toContain('modelled bay count is unavailable');
    expect(html).toContain('depot-error');
    expect(html).not.toContain('parking-plan"');
  });

  it('takes the counts from the depot detail and only the bays from the parking response', () => {
    hook.detail = detailOf({}, 55, 10);
    setHook({ data: { ...BASE, capacity: { ...CAPACITY, inYard: { value: 1, provenance: 'derived' } } } });
    const t = text(renderToStaticMarkup(<ParkingPlanSection depotId="20" />));
    expect(t).toContain('65 of 60 modelled bays in use; 5 over.');
  });

  it('shows capacity and the order, with a stale strip on last-good data', () => {
    setHook({ data: { ...BASE, stale: true } });
    const html = renderToStaticMarkup(<ParkingPlanSection depotId="20" />);
    expect(html).toContain('depot-stale');
    expect(html).toContain('yard-capacity');
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
    const html = renderToStaticMarkup(<ParkingPlanSection depotId="20" />);
    expect(html).toContain('depot-empty');
    expect(text(html)).toContain('No yard is established for this depot');
    expect(html).not.toContain('parking-plan"');
  });
});
