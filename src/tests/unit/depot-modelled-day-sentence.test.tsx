import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DutyPage } from '@/components/depot/duties/DutyPage';
import type { DutyBoardResponse } from '@/lib/depot/duties/api';
import { NO_DUTIES_REASON } from '@/lib/depot/sim/operatingDayWording';

/*
 * The duty board prints the shared modelled-day sentence once, beside its
 * notice, in the words every modelled page uses (operatingDayWording).
 */

const hook = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('@/hooks/useDepotDuties', () => ({ useDepotDuties: (): unknown => hook.value }));

function duty(id: string, routeName: string): DutyBoardResponse['duties'][number] {
  return {
    id,
    routeName,
    startMin: 420,
    endMin: 900,
    serviceClass: 'express',
    registrationNumber: `UP32${id}`,
    state: 'assigned',
    blockers: null,
  } as unknown as DutyBoardResponse['duties'][number];
}

function board(duties: DutyBoardResponse['duties']): DutyBoardResponse {
  return {
    feedNow: '2026-10-06T10:00:00Z',
    fetchedAt: '2026-10-06T10:00:05.000Z',
    source: 'live',
    stale: false,
    depotId: '7',
    depotName: 'Kaushambi',
    operatingDate: '2026-10-06',
    peakRequirement: 3,
    routeCount: 2,
    duties,
    spareBuses: [],
    routesWithoutDuty: [],
    counts: {
      duties: duties.length,
      assigned: 0,
      unassigned: duties.length,
      spare: 0,
      excluded: { notInYard: 0, offRoad: 0, dark: 0 },
    },
  } as unknown as DutyBoardResponse;
}

const render = (data: DutyBoardResponse): string => {
  hook.value = { data, error: null, loading: false, refresh: () => {} };
  return renderToStaticMarkup(<DutyPage depotId="7" />).replace(/<[^>]*>/g, '');
};

describe('the duty board names the modelled day', () => {
  it('states the worked depot: 3 duties on 2 routes, once', () => {
    const body = render(
      board([duty('a', 'AGRA_EXP_1'), duty('b', 'DELHI_EXP_2'), duty('c', 'AGRA_EXP_1')]),
    );
    const sentence = 'This page is built on the modelled day: 3 duties on 2 routes.';
    expect(body).toContain(sentence);
    expect(body.split(sentence)).toHaveLength(2);
  });

  it('gives a depot with no duties the shared reason, in the words the other pages use', () => {
    const body = render(board([]));
    expect(body).toContain(`${NO_DUTIES_REASON}, so this page has no modelled day to show.`);
  });
});
