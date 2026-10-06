import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DepotDetailContextValue } from '@/components/depot/data/DepotDetailProvider';
import { DepotCockpit } from '@/components/depot/cockpit/DepotCockpit';
import { OutshedTracker } from '@/components/depot/cockpit/OutshedTracker';
import { StatusBoard } from '@/components/depot/cockpit/StatusBoard';
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
    const board = {
      fleet: 0,
      states: [],
      standing: 0,
      locations: null,
      yard: { established: false as const, sentence: 'No yard.' },
    };
    const status = { live: 0, stationary: 0, noSignal: 0, underMaintenance: 0, unknown: 0 };
    const markup = renderToStaticMarkup(<StatusBoard board={board} status={status} />);
    expect(textOf(markup)).toBe(
      'No bus is homed at this depot on this snapshot, so there is no status to show.',
    );
  });

  it('uses the feed-date sentence when no bus carries a schedule', () => {
    const markup = renderToStaticMarkup(
      <OutshedTracker
        depotId="20"
        rows={[]}
        coverage={{ n: 0, of: 10 }}
        coverageSentence="0 of 10 buses carry a schedule for the feed date, 2026-10-06."
        hasSchedules={false}
        noSchedulesSentence="No bus carries a schedule for the feed date, 2026-10-06, so there are no departures to track."
      />,
    );
    expect(textOf(markup)).toContain('No bus carries a schedule for the feed date, 2026-10-06');
    expect(textOf(markup)).not.toContain('today');
    expect(markup).not.toContain('depot-table');
  });
});
