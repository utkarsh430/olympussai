import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DepotDetailContextValue } from '@/components/depot/data/DepotDetailProvider';
import { DepotCockpit } from '@/components/depot/cockpit/DepotCockpit';
import { OutshedTracker } from '@/components/depot/cockpit/OutshedTracker';
import { AvailabilityBar } from '@/components/depot/cockpit/AvailabilityBar';
import { DepotExceptions } from '@/components/depot/cockpit/DepotExceptions';
import type { ExceptionGroup } from '@/lib/depot/cockpit/exceptionGroups';
import type { TrackerRow } from '@/lib/depot/cockpit/cockpitTypes';
import { DEPOT_NOT_FOUND_MESSAGE } from '@/lib/depot/scopeState';

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
        coverageSentence="0 of 10 buses carry a schedule for the feed date, 6 Oct 2026."
        hasSchedules={false}
        noSchedulesSentence="No bus carries a schedule for the feed date, 6 Oct 2026, so there are no departures to track."
      />,
    );
    expect(textOf(markup)).toContain('No bus carries a schedule for the feed date, 6 Oct 2026');
    expect(textOf(markup)).not.toContain('today');
    expect(markup).not.toContain('depot-table');
    // The label's "· 0" and one muted line, no coverage sentence, no box.
    expect(markup).not.toContain('depot-outshed-coverage');
    expect(textOf(markup)).not.toContain('0 of 10 buses');
  });

  it('says in one line when every departure window has ended, the table behind "Show all"', () => {
    const ended = (key: string): TrackerRow => ({
      key, registrationNumber: key, routeName: null, journeyCode: null, scheduledStart: '06:30',
      state: 'ended', label: 'Window ended', minutes: null, minutesText: '—',
    });
    const markup = renderToStaticMarkup(
      <OutshedTracker depotId="20" rows={[ended('A'), ended('B')]} coverageSentence="2 of 2." hasSchedules noSchedulesSentence="none" />,
    );
    expect(textOf(markup)).toContain('All 2 tracked departures are past their window.');
    expect(markup).not.toContain('<table');
    expect(textOf(markup)).toContain('Show all 2');
    // The status leads the section; the schedule sentence is the label's note.
    const doc = new DOMParser().parseFromString(markup, 'text/html');
    const firstAfterLabel = doc.querySelector('[data-testid="depot-outshed-ended"]');
    expect(firstAfterLabel?.previousElementSibling?.querySelector('h2')?.textContent).toContain('Outshedding');
    expect(firstAfterLabel?.previousElementSibling?.querySelector('.depot-note')?.textContent).toBe('2 of 2.');
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
    // With no yard there is no visitor or standing split, only one line and the rule's link.
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

  it('has no raw ISO date anywhere in its text or attributes', () => {
    const dated = {
      ...data,
      outshed: { rows: [], coverage: { n: 3, of: 7 } },
      exceptions: {
        ...data.exceptions,
        bus: data.exceptions.bus.map((e) => ({ ...e, lastSeen: '2026-10-05T13:02:00.000Z' })),
      },
    };
    setContext({ data: dated as unknown as DepotDetailContextValue['data'] });
    const markup = renderToStaticMarkup(<DepotCockpit />);
    expect(textOf(markup)).toContain('5 Oct 2026');
    expect(markup).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('says how many snapshots it has decided the yard on instead of "no yard" at one or none', () => {
    setContext({ data: { ...data, yardSnapshotsSeen: 1 } as unknown as DepotDetailContextValue['data'] });
    const text = textOf(renderToStaticMarkup(<DepotCockpit />));
    expect(text).toContain('yard on 1 snapshot so far; a yard may be found as more arrive.');
    expect(text).not.toContain('just started');
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
      "In the yard: 7 of ours, 2 visiting. Standing 5: 5 in the yard. Open yard ›",
    );
    expect(markup).toContain('href="/project/depots/d/20/yard"');
  });
});

describe('cockpit exception times', () => {
  const group: ExceptionGroup = {
    kind: 'long_dark',
    heading: 'Dark for a long time',
    severity: 'warning',
    severityLabel: 'Warning',
    rows: [
      { registrationNumber: 'UP13CT7020', severity: 'warning', extra: '+ Power off', lastSeen: '2026-10-05T19:45:00Z' },
      { registrationNumber: 'UP13T7118', severity: 'warning', extra: null, lastSeen: '2026-10-06T08:05:00Z' },
    ],
  };

  it('gives a bus last heard on the previous day its day, and a bus heard today its bare time', () => {
    const text = textOf(
      renderToStaticMarkup(
        <DepotExceptions depotId="20" groups={[group]} depotLines={[]} feedNow="2026-10-06T19:16:00Z" />,
      ),
    );
    expect(text).toContain('5 Oct, 19:45');
    expect(text).toContain('08:05');
    // A bare clock time later than the feed's clock never appears.
    expect(text).not.toMatch(/(?<!, )19:45/);
  });
});
