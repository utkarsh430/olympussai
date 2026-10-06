import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DepotDetailContextValue } from '@/components/depot/data/DepotDetailProvider';
import { DepotCockpit } from '@/components/depot/cockpit/DepotCockpit';
import { OutshedTracker } from '@/components/depot/cockpit/OutshedTracker';
import { AvailabilityBar } from '@/components/depot/cockpit/AvailabilityBar';
import type { TrackerRow } from '@/lib/depot/cockpit/cockpitTypes';
import { DEPOT_NOT_FOUND_MESSAGE } from '@/hooks/useDepotDetail';

const context = vi.hoisted(() => ({ value: null as unknown }));

vi.mock('@/components/depot/data/DepotDetailProvider', () => ({
  useDepotDetailContext: (): unknown => context.value,
}));

function setContext(partial: Partial<DepotDetailContextValue>): void {
  context.value = {
    depotId: '20',
    data: null,
    error: null,
    loading: false,
    refresh: () => {},
    ...partial,
  };
}

function textOf(markup: string): string {
  return markup.replace(/<[^>]*>/g, '');
}

describe('DepotCockpit branches', () => {
  beforeEach(() => setContext({}));

  it('shows placeholders while the first response is pending', () => {
    setContext({ loading: true });
    expect(renderToStaticMarkup(<DepotCockpit />)).toContain('data-testid="depot-cockpit-loading"');
  });

  it('says a well-formed id is not in the feed, with a way back', () => {
    setContext({ error: DEPOT_NOT_FOUND_MESSAGE });
    const markup = renderToStaticMarkup(<DepotCockpit />);
    expect(textOf(markup)).toContain('No depot has the id 20 in the current feed.');
    expect(markup).toContain('href="/project/depots"');
  });

  it('shows what failed and a Retry button on any other error', () => {
    setContext({ error: 'Depot data unavailable' });
    const markup = renderToStaticMarkup(<DepotCockpit />);
    expect(markup).toContain('role="alert"');
    expect(textOf(markup)).toContain('Depot data unavailable. The cockpit will appear');
    expect(textOf(markup)).toContain('Retry');
  });
});

describe('cockpit empty states', () => {
  it('gives a depot with no buses one sentence, not five zeros', () => {
    const markup = renderToStaticMarkup(
      <AvailabilityBar fleet={0} segments={[]} text="" yard={{ kind: 'no-yard', sentence: 'No yard.' }} yardHref="/y" howId="how" />,
    );
    expect(textOf(markup)).toBe(
      'No bus is homed at this depot on this snapshot, so there is no status to show.',
    );
  });

  it('uses the feed-date sentence when no bus carries a schedule', () => {
    const markup = renderToStaticMarkup(
      <OutshedTracker
        depotId="20"
        rows={[]}
        coverageSentence="0 of 10 buses carry a schedule for the feed date, 2026-10-06."
        hasSchedules={false}
        noSchedulesSentence="No bus carries a schedule for the feed date, 2026-10-06, so there are no departures to track."
      />,
    );
    expect(textOf(markup)).toContain('No bus carries a schedule for the feed date, 2026-10-06');
    expect(textOf(markup)).not.toContain('today');
    expect(markup).not.toContain('depot-table');
  });

  it('captions the tracker for the feed date, not for today', () => {
    const row: TrackerRow = {
      key: 'b1',
      registrationNumber: 'UP 32 AB 1234',
      routeName: 'Route 1',
      journeyCode: 'J1',
      scheduledStart: '06:30',
      state: 'upcoming',
      label: 'Upcoming',
      minutes: 5,
      minutesText: 'in 5 min',
    };
    const markup = renderToStaticMarkup(
      <OutshedTracker
        depotId="20"
        rows={[row]}
        coverageSentence="1 of 1 buses carry a schedule for the feed date."
        hasSchedules
        noSchedulesSentence="none"
      />,
    );
    expect(textOf(markup)).toContain('Scheduled departures for the feed date, most urgent first');
    expect(textOf(markup)).not.toContain("Today's");
  });
});

describe('cockpit page with data', () => {
  const buses = Array.from({ length: 7 }, (_, i) => ({
    registrationNumber: `UP${i}`,
    state: i < 2 ? 'off_road' : 'standing',
    location: 'in_yard',
    mainPowerOn: i >= 6,
    tamperCode: null,
    notHeardMin: null,
  }));
  const data = {
    feedNow: '2026-10-05T14:20:00.000Z',
    stale: false,
    depot: {
      id: '20', name: 'Varanasi', kind: 'depot', fleet: 7,
      status: { live: 0, stationary: 7, noSignal: 0, underMaintenance: 0, unknown: 0 },
      states: { inService: 0, onRoad: 0, standing: 5, dark: 0, offRoad: 2 },
    },
    score: null,
    yard: { value: null, provenance: 'derived', coverage: { n: 0, of: 0 } },
    buses,
    outshed: { rows: [], coverage: { n: 0, of: 7 } },
    exceptions: {
      depot: [],
      bus: buses.slice(0, 6).map((b) => ({
        id: `power_cut:${b.registrationNumber}`, registrationNumber: b.registrationNumber, depotId: '20',
        depotName: 'Varanasi', kind: 'power_cut', severity: 'info', lastSeen: null, detail: null,
      })),
    },
    visitors: [{ registrationNumber: 'X1' }, { registrationNumber: 'X2' }],
    locationMix: { in_yard: 7, at_other_yard: 0, away: 0, unknown: 0 },
    yardSnapshotsSeen: 12,
  };

  it('leads with counted attention links, gives no yard one line and keeps the briefing collapsed', () => {
    setContext({ data: data as unknown as DepotDetailContextValue['data'] });
    const markup = renderToStaticMarkup(<DepotCockpit />);
    const text = textOf(markup);
    expect(markup.indexOf('depot-attention')).toBeLessThan(markup.indexOf('depot-status-board'));
    expect(markup).toContain('href="/project/depots/d/20/roster?flag=power_off"');
    expect(markup).toContain('href="/project/depots/d/20/roster?state=off_road"');
    // Round 2: with no yard there is no visitor or standing split, only one line and the rule's link.
    expect(text).toContain('No yard is established yet: no place where these buses park meets the yard rule.');
    expect(markup).toContain('href="#how-produced"');
    expect(markup).not.toContain('A yard is claimed only when</p>');
    expect(markup).not.toContain('data-testid="briefing-card"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toMatch(/<details[^>]*data-testid="depot-cockpit-method"/);
    expect(markup).not.toMatch(/<details[^>]* open/);
    expect(text).toContain('Show all 6');
    expect(markup).toContain('data-testid="depot-no-yard"');
  });

  it('says the server has only just started instead of "no yard" after at most one yard decision', () => {
    setContext({ data: { ...data, yardSnapshotsSeen: 1 } as unknown as DepotDetailContextValue['data'] });
    const text = textOf(renderToStaticMarkup(<DepotCockpit />));
    expect(text).toContain('The server has only just started, so no yard is placed yet');
    expect(text).not.toContain('No yard is established yet');
  });

  it('merges every bus in the yard, the visitors and the standing split into one line linked to the yard', () => {
    const yard = {
      value: { inCluster: 6, parked: 7, heldSince: null },
      provenance: 'derived',
    };
    setContext({ data: { ...data, yard } as unknown as DepotDetailContextValue['data'] });
    const markup = renderToStaticMarkup(<DepotCockpit />);
    const split = markup.slice(markup.indexOf('depot-standing-split'));
    expect(textOf(split).replace(/&#x27;/g, "'")).toContain(
      "7 of this depot's buses in the yard, with 2 visiting · 5 standing: 5 standing in the yard · Open yard ›",
    );
    expect(markup).toContain('href="/project/depots/d/20/yard"');
  });
});
