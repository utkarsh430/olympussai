import { act, cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RouteHourlyPage,
  routeHourlyProvenance,
  type RouteHourlyPageProps,
} from '@/components/depot/service/RouteHourlyPage';
import { provenanceLine } from '@/lib/depot/provenanceLine';
import type { Proposal } from '@/lib/depot/service/types';
import { bannedOnScreen } from './depot-guard-rendered';
import { FIXTURE_PROPOSALS, routeHourlyFixture } from './depot-service-fixtures';

vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactNode }) =>
      isValidElement(children)
        ? cloneElement(children as ReactElement<{ width: number; height: number }>, {
            width: 960,
            height: 300,
          })
        : null,
  };
});

const actGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const LOADED: RouteHourlyPageProps = { response: routeHourlyFixture(), error: null, loading: false };

function render(props: RouteHourlyPageProps = LOADED): void {
  act(() => root.render(<RouteHourlyPage {...props} />));
}

const text = (): string => container.textContent ?? '';
const section = (id: string): Element | null => container.querySelector(`[data-testid="${id}"]`);

function expandAll(): void {
  for (const row of Array.from(container.querySelectorAll<HTMLElement>('tr[aria-expanded="false"]'))) {
    act(() => row.click());
  }
}

describe('RouteHourlyPage states', () => {
  it('holds the chart footprint while loading', () => {
    render({ response: null, error: null, loading: true });
    expect(container.querySelector('[role="status"][aria-busy="true"]')).not.toBeNull();
  });

  it('says the request failed, in its fixed words, with a retry', () => {
    const onRetry = vi.fn();
    render({ response: null, error: 'Depot data is unavailable.', loading: false, onRetry });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Route day unavailable');
    act(() => container.querySelector<HTMLButtonElement>('button')?.click());
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('says what is absent with no figures', () => {
    render({ response: routeHourlyFixture({ hours: [] }), error: null, loading: false });
    expect(text()).toContain('has no figures for today yet');
    expect(section('route-hourly-page')).toBeNull();
  });

  it('still draws the page on stale data', () => {
    render({ response: routeHourlyFixture({ stale: true }), error: null, loading: false });
    expect(section('hour-chart')).not.toBeNull();
  });
});

describe('RouteHourlyPage body', () => {
  it('runs hero chart, figure band, proposals, punctuality, then the closed disclosure', () => {
    render();
    const order = Array.from(section('route-hourly-page')?.children ?? []).map(
      (child) => child.getAttribute('data-testid') ?? child.firstElementChild?.getAttribute('data-testid') ?? child.tagName,
    );
    expect(order.slice(0, 4)).toEqual(['hour-chart', 'service-figure-band', 'service-proposals', 'service-punctuality']);
    const details = section('route-hourly-page')?.lastElementChild;
    expect(details?.tagName).toBe('DETAILS');
    expect(details?.hasAttribute('open')).toBe(false);
  });

  it('shows the current hour in four figures', () => {
    render();
    const band = section('service-figure-band')?.textContent ?? '';
    for (const words of ['Deployed now', 'Need now', 'Gap now', '−2', 'Over by 2', 'Observed since 05:02']) {
      expect(band).toContain(words);
    }
  });

  it('tags Needed and Impact as MODELLED in the proposals header, under the recommendation notice', () => {
    render();
    const proposals = section('service-proposals');
    const headers = Array.from(proposals?.querySelectorAll('th') ?? []).map((th) => th.textContent ?? '');
    expect(headers.find((h) => h.startsWith('Needed'))).toMatch(/MODELLED/i);
    expect(headers.find((h) => h.startsWith('Impact'))).toMatch(/MODELLED/i);
    // One word: the cell says its own unit, passengers for an add and bus-km for a hold.
    expect(headers.find((h) => h.startsWith('Impact'))).not.toMatch(/pax/);
    // The reason is a sentence: it lives in the expanded row, never as a clipped column.
    expect(headers.some((h) => h.startsWith('Reason'))).toBe(false);
    const source = proposals?.querySelector('tbody td[title^="Alambagh"] span');
    expect(source?.className).toContain('truncate');
    expect(proposals?.textContent).toContain('Recommendation only');
    expect(proposals?.textContent).toContain('not ticketing');
    expect(proposals?.querySelectorAll('tbody tr')).toHaveLength(3);
  });

  it('opens a row to its full reason and impact ranges', () => {
    render();
    expandAll();
    const details = Array.from(container.querySelectorAll('[data-testid="proposal-detail"]'));
    expect(details).toHaveLength(3);
    expect(details[0]?.textContent).toContain(FIXTURE_PROPOSALS[0]?.reason);
    expect(details[0]?.textContent).toContain('Revenue a day: ₹9,400 to ₹16,800');
    expect(details[2]?.textContent).toContain('No modelled impact');
  });

  it('pages a long list of proposals at 25 rows', () => {
    const many: Proposal[] = Array.from({ length: 30 }, (_, i) => ({ ...FIXTURE_PROPOSALS[0]!, id: `p-${i}` }));
    render({ ...LOADED, response: routeHourlyFixture({ proposals: many }) });
    expect(section('service-proposals')?.querySelectorAll('tbody tr')).toHaveLength(25);
    expect(section('service-proposals')?.textContent).toMatch(/of 30/);
  });

  it('says when there is no proposal', () => {
    render({ ...LOADED, response: routeHourlyFixture({ proposals: [] }) });
    expect(section('service-proposals')?.textContent).toContain('No proposal for this route today');
  });

  it('lists punctuality for the observed hours and says the delay unit is unconfirmed', () => {
    render();
    const punctuality = section('service-punctuality');
    expect(punctuality?.textContent).toContain('The delay unit is unconfirmed');
    expect(punctuality?.querySelectorAll('tbody tr')).toHaveLength(7);
  });

  it('prints an early hour with the module minus, never a hyphen', () => {
    const response = routeHourlyFixture();
    const reliability = response.reliability.map((r) =>
      r.hour === 9
        ? { hour: 9, delayMedianMin: -15.5, lateShare: 0, coverage: { n: 1, of: 1 } }
        : { hour: r.hour, delayMedianMin: null, lateShare: null, coverage: { n: 0, of: 0 } },
    );
    render({ ...LOADED, response: { ...response, reliability } });
    const text = section('service-punctuality')?.querySelector('tbody tr')?.textContent ?? '';
    expect(text).toContain('−15 min');
    expect(text).not.toMatch(/-\d/);
  });

  it('reads punctuality from the journeys the feed reported, not from the hours', () => {
    const response = routeHourlyFixture();
    const reliability = response.reliability.map((r) =>
      r.hour === 14
        ? { hour: 14, delayMedianMin: 12, lateShare: 0.5, coverage: { n: 2, of: 3 } }
        : { hour: r.hour, delayMedianMin: null, lateShare: null, coverage: { n: 0, of: 0 } },
    );
    render({ ...LOADED, response: { ...response, reliability } });
    const rows = section('service-punctuality')?.querySelectorAll('tbody tr') ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.textContent).toContain('14:00');
    expect(rows[0]?.textContent).toContain('2 of 3');
    expect(section('service-punctuality')?.textContent).toContain('Journeys with a delay');
  });

  it('says what the need rests on in the closing disclosure, durations formatted', () => {
    render();
    expect(text()).toContain('a journey of 1 h 50 min');
    expect(text()).toContain('15 min of layover');
  });
});

describe('RouteHourlyPage words', () => {
  it('shows no banned word and no raw date or feed stamp, open or closed', () => {
    render();
    expandAll();
    expect(bannedOnScreen(container)).toEqual([]);
    expect(text()).not.toMatch(/T\d{2}:\d{2}|\d{2}:\d{2}:\d{2}/);
    expect(text()).toContain('6 Oct 2026');
  });

  it('puts every sentence in a sans class', () => {
    render();
    expandAll();
    const allowed = /(^|\s)(depot-prose|depot-note|depot-caption|sr-only|font-sans)(\s|$)/;
    const mono = Array.from(container.querySelectorAll('p')).filter((p) => !allowed.test(p.className));
    expect(mono.map((p) => p.textContent)).toEqual([]);
  });

  it('declares a MIXED provenance line with the coverage sentences', () => {
    const response = routeHourlyFixture();
    const line = provenanceLine(routeHourlyProvenance(response), { data: response, error: null });
    expect(line.tag).toBe('MIXED');
    expect(line.sentence).toContain('LIVE');
    expect(line.sentence).toContain('DERIVED');
    expect(line.sentence).toContain('MODELLED');
    expect(line.sentence).toContain('Scheduled trips known for 12 of 40 buses seen on this route today.');
    expect(line.sentence).toContain('Only buses that report a route name are counted: 10 of the 14 buses in the feed report one.');
  });
});
