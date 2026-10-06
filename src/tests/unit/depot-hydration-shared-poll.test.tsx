import { Suspense } from 'react';
import { act } from 'react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DepotDetailProvider,
  useDepotDetailContext,
} from '@/components/depot/data/DepotDetailProvider';
import {
  DepotNetworkProvider,
  useDepotNetworkContext,
} from '@/components/depot/data/DepotNetworkProvider';
import { RosterPage } from '@/components/depot/roster/RosterPage';
import type { DepotBusView } from '@/lib/depot/api';

/**
 * The shell's polls live in providers above each page's Suspense boundary. A boundary can
 * hydrate after the poll has answered (the browser found the roster doing so: React #418),
 * so a consumer's hydrating render must still be the server's render, which had no answer.
 * Each case renders on the server before the answer and hydrates after it.
 */

const polls = vi.hoisted(() => ({ detail: null as unknown, network: null as unknown }));

vi.mock('@/hooks/useDepotDetail', () => ({ useDepotDetail: (): unknown => polls.detail }));
vi.mock('@/hooks/useDepotNetwork', () => ({ useDepotNetwork: (): unknown => polls.network }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: (): void => {} }),
  usePathname: () => '/project/depots/d/49/roster',
  useSearchParams: () => new URLSearchParams(),
}));

const FEED_NOW = '2026-10-06T09:30:00.000Z';
const refresh = (): void => {};
const BEFORE_ANSWER = { data: null, error: null, loading: true, previous: false, refresh };

const BUS = {
  registrationNumber: 'UP14AB1000',
  state: 'in_service',
  location: 'in_yard',
  otherDepotId: null,
  distanceFromYardKm: null,
  latitude: null,
  longitude: null,
  speedKmph: null,
  gpsAgeMin: 2,
  vehicleStatus: 'moving',
  tripStatus: null,
  routeName: 'Lucknow - Kanpur',
  routeDescription: null,
  journeyId: null,
  journeyCode: null,
  scheduledStart: '2026-10-06T08:51:00.000Z',
  scheduledEnd: null,
  tripDate: null,
  delayMinutes: null,
  mainPowerOn: true,
  tamperCode: null,
} as unknown as DepotBusView;

const DETAIL_ANSWERED = {
  ...BEFORE_ANSWER,
  loading: false,
  data: { buses: [BUS], feedNow: FEED_NOW, stale: true, source: 'fixture' },
};

const NETWORK_ANSWERED = {
  ...BEFORE_ANSWER,
  loading: false,
  data: { source: 'fixture', stale: false, feedNow: FEED_NOW, fetchedAt: FEED_NOW, depots: [] },
};

const actGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
let container: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  polls.detail = BEFORE_ANSWER;
  polls.network = BEFORE_ANSWER;
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container.remove();
  actGlobal.IS_REACT_ACT_ENVIRONMENT = false;
});

/** Server-renders `tree` before the poll answers, then hydrates it after `answer()`. */
async function hydrateAfterAnswer(tree: React.ReactElement, answer: () => void): Promise<unknown[]> {
  container.innerHTML = renderToString(tree);
  answer();
  const recoverable: unknown[] = [];
  const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    await act(async () => {
      root = hydrateRoot(container, tree, { onRecoverableError: (error) => recoverable.push(error) });
    });
  } finally {
    quiet.mockRestore();
  }
  return recoverable;
}

describe('a page boundary that hydrates after the shared poll has answered', () => {
  it('the roster hydrates its loading state, then shows the buses', async () => {
    const tree = (
      <DepotDetailProvider depotId="49">
        <Suspense fallback={<p>Loading</p>}>
          <RosterPage />
        </Suspense>
      </DepotDetailProvider>
    );
    expect(renderToString(tree)).toContain('Loading the roster');

    const recoverable = await hydrateAfterAnswer(tree, () => {
      polls.detail = DETAIL_ANSWERED;
    });

    expect(recoverable).toEqual([]);
    expect(container.textContent).toContain('UP14AB1000');
    expect(container.textContent).not.toContain('Loading the roster');
  });

  it('a network feed consumer hydrates without the answer, then shows it', async () => {
    function FeedSource() {
      const { data } = useDepotNetworkContext();
      return data ? <strong>{data.source}</strong> : <span>waiting</span>;
    }
    const tree = (
      <DepotNetworkProvider>
        <Suspense fallback={<p>Loading</p>}>
          <FeedSource />
        </Suspense>
      </DepotNetworkProvider>
    );

    const recoverable = await hydrateAfterAnswer(tree, () => {
      polls.network = NETWORK_ANSWERED;
    });

    expect(recoverable).toEqual([]);
    expect(container.querySelector('strong')?.textContent).toBe('fixture');
  });

  it('a client render that is not hydrating reads the answer at once', async () => {
    polls.detail = DETAIL_ANSWERED;
    const seen: unknown[] = [];
    function Reader() {
      seen.push(useDepotDetailContext().data);
      return null;
    }
    const { createRoot } = await import('react-dom/client');
    await act(async () => {
      root = createRoot(container);
      root.render(
        <DepotDetailProvider depotId="49">
          <Reader />
        </DepotDetailProvider>,
      );
    });
    expect(seen[0]).toBe(DETAIL_ANSWERED.data);
  });
});
