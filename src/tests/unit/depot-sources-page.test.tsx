import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SourcesPage from '@/app/(protected)/project/depots/sources/page';
import { SourcesRegistry } from '@/components/depot/sources/SourcesRegistry';

/*
 * Round 2: the sources page declares REFERENCE in every state (guard X1) with the coverage
 * section's own DERIVED tag visible (M21); each feeds-table row is the expander for its
 * field list; `#feed-<id>` scrolls to that row and opens it; the GPS row carries the
 * feed-clock line when the response says rows ran ahead of the server's clock.
 */
const actGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
const net = vi.hoisted(() => ({ value: null as unknown }));

vi.mock('@/lib/auth/server', () => ({ requireProjectSession: async (): Promise<void> => {} }));
vi.mock('@/components/depot/data/DepotNetworkProvider', () => ({
  useDepotNetworkContext: (): unknown => net.value,
}));

const DATA = {
  feedNow: '2026-10-06T14:20:00.000Z',
  fetchedAt: '2026-10-06T14:20:02.000Z',
  source: 'live',
  stale: false,
  recordCount: 2,
  depots: [{ id: '7', name: 'GARH', fleet: 2 }],
  coverage: [],
};

const STATES: readonly [string, unknown][] = [
  ['loading', { data: null, error: null, loading: true, refresh: () => undefined }],
  ['error', { data: null, error: 'Depot data unavailable', loading: false, refresh: () => undefined }],
  ['data', { data: DATA, error: null, loading: false, refresh: () => undefined }],
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  net.value = STATES[2]?.[1];
  window.history.replaceState({}, '', '/project/depots/sources');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('the data sources page', () => {
  it.each(STATES)('declares REFERENCE and tags the coverage DERIVED in the %s state', async (_n, value) => {
    net.value = value;
    const page = await SourcesPage();
    act(() => root.render(page));
    const line = container.querySelector('[data-testid="depot-provenance-line"]');
    expect(line?.getAttribute('data-tone')).toBe('reference');
    expect(line?.textContent).toContain('Reference data, curated; not from the feed.');
    const coverage = container.querySelector('#coverage-title')?.closest('section');
    expect(coverage?.textContent).toContain('DERIVED');
  });

  it('opens a row for its field list; no separate field-list section and no FIELDS column', () => {
    act(() => root.render(<SourcesRegistry />));
    expect(container.textContent).not.toContain('Field lists');
    const headers = Array.from(container.querySelectorAll('thead th')).map((th) => th.textContent);
    expect(headers).not.toContain('Fields');
    const toggle = container.querySelector('button[aria-label^="Fuel"]') as HTMLButtonElement;
    expect(toggle.getAttribute('aria-label')).toMatch(/show \d+ fields? (read|expected) from this feed/);
    act(() => toggle.click());
    expect(container.querySelector('[data-testid="depot-feed-fields"]')).not.toBeNull();
  });

  it('scrolls to and opens the row a #feed-<id> link names', () => {
    const scrolled = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrolled;
    window.history.replaceState({}, '', '/project/depots/sources#feed-fuel');
    act(() => root.render(<SourcesRegistry />));
    const row = container.querySelector('#feed-fuel')?.closest('tr');
    expect(row?.querySelector('button[aria-expanded="true"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-testid="depot-feed-fields"]')).toHaveLength(1);
    expect(scrolled).toHaveBeenCalled();
    Element.prototype.scrollIntoView = original;
  });

  it('opens the hash row on first render and scrolls its anchor only once the coverage above has loaded', () => {
    const scrolled = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrolled;
    window.history.replaceState({}, '', '/project/depots/sources#feed-fuel');
    net.value = { data: null, error: null, loading: true };
    act(() => root.render(<SourcesRegistry />));
    // Open without any toggle being clicked, but not scrolled while the block above still loads.
    expect(container.querySelector('#feed-fuel')?.closest('tr')?.querySelector('button[aria-expanded="true"]')).not.toBeNull();
    expect(scrolled).not.toHaveBeenCalled();
    net.value = { data: DATA, error: null, loading: false };
    act(() => root.render(<SourcesRegistry />));
    expect(scrolled).toHaveBeenCalledTimes(1);
    expect(scrolled.mock.contexts[0]).toBe(container.querySelector('#feed-fuel'));
    // The anchor lands below the sticky layers through the shell's custom property.
    expect(container.querySelector('#feed-fuel')?.className).toContain('scroll-mt-[var(--depot-anchor-mt)]');
    Element.prototype.scrollIntoView = original;
    window.history.replaceState({}, '', '/project/depots/sources');
  });

  it('keeps each coverage figure on one line, its share in its own column, and the exclusion definition as a note', () => {
    net.value = {
      data: {
        ...DATA,
        recordCount: 10012,
        depots: [{ id: 'a', name: 'A', kind: 'depot', fleet: 10007 }],
        coverage: [{ field: 'gps', label: 'Position', populated: 10007, of: 10007 }],
      },
      error: null,
      loading: false,
    };
    act(() => root.render(<SourcesRegistry />));
    const row = container.querySelector('[data-testid="depot-coverage-bars"] li');
    const cells = Array.from(row?.children ?? []).map((c) => c.textContent);
    expect(cells).toContain('10,007 of 10,007');
    expect(cells).toContain('100%');
    const figure = Array.from(row?.children ?? []).find((c) => c.textContent === '10,007 of 10,007');
    expect(figure?.className).toContain('whitespace-nowrap');
    expect(container.querySelector('[data-testid="depot-records-sentence"]')?.textContent).toBe(
      '10,012 records received · 5 excluded · 10,007 buses counted.',
    );
    expect(container.querySelector('[data-testid="depot-exclusion-note"]')?.textContent).toMatch(
      /^Excluded: an entry that is not a record at all/,
    );
  });

  it('never prints a raw ISO date in its text or attributes', () => {
    act(() => root.render(<SourcesRegistry />));
    const attrs = Array.from(container.querySelectorAll('*')).flatMap((el) =>
      Array.from(el.attributes).map((a) => a.value),
    );
    expect([container.textContent ?? '', ...attrs].join(' ')).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('says on the GPS row, in one line, when rows ran ahead of the server clock', () => {
    net.value = { data: { ...DATA, feedClockAheadRows: 3 }, error: null, loading: false };
    act(() => root.render(<SourcesRegistry />));
    const line = container.querySelector('[data-testid="depot-clock-ahead"]');
    expect(line?.closest('tr')?.querySelector('#feed-gps-device')).not.toBeNull();
    expect(line?.textContent).toBe(
      "3 rows carried a receive time ahead of the server's clock and were ignored for the feed clock.",
    );
  });

  it('says nothing about the feed clock when no row ran ahead', () => {
    act(() => root.render(<SourcesRegistry />));
    expect(container.querySelector('[data-testid="depot-clock-ahead"]')).toBeNull();
  });
});
