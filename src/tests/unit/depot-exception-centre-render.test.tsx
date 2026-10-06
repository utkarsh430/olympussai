import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExceptionCentre } from '@/components/depot/exceptions/ExceptionCentre';
import type { DepotExceptionsResponse } from '@/lib/depot/api';
import type { BusPageQuery } from '@/lib/depot/exceptions/busPage';
import type { BusException, ExceptionKind } from '@/lib/depot/exceptions/types';

const actGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };

const hook = vi.hoisted(() => ({
  queries: [] as unknown[],
  result: null as unknown as (query: unknown) => unknown,
}));

vi.mock('@/hooks/useDepotExceptions', () => ({
  DEPOT_UNAVAILABLE_MESSAGE: 'Depot data unavailable',
  useDepotExceptions: (query: unknown) => {
    hook.queries.push(query);
    return hook.result(query);
  },
}));

vi.mock('@/components/depot/data/DepotNetworkProvider', () => ({
  useDepotNetworkContext: () => ({ data: null, error: null, loading: false }),
}));

const COUNTS: Record<ExceptionKind, number> = {
  emergency: 0,
  dark_share_high: 0,
  off_road_high: 0,
  on_road_low: 0,
  power_cut_cluster: 0,
  long_dark: 60,
  power_cut: 0,
  tamper_code: 0,
};

function bus(n: number): BusException {
  return {
    kind: 'long_dark',
    severity: 'warning',
    depotId: 'd1',
    registrationNumber: `MH12AB${1000 + n}`,
  } as unknown as BusException;
}

function response(query: BusPageQuery, total: number, itemCount: number): DepotExceptionsResponse {
  return {
    feedNow: '2026-10-06T07:00:00.000Z',
    stale: false,
    report: { depot: [], busTotal: total, counts: COUNTS },
    busSeverityCounts: { critical: 0, warning: total, info: 0 },
    busPage: {
      ...query,
      total,
      items: Array.from({ length: itemCount }, (_, i) => bus(query.offset + i)),
    },
  } as unknown as DepotExceptionsResponse;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  hook.queries = [];
  window.history.replaceState({}, '', '/project/depots/exceptions');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function button(label: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll('button')).find(
    (b) => b.textContent === label || b.textContent?.startsWith(label),
  );
  if (!found) throw new Error(`no button ${label}`);
  return found;
}

function pagerText(): string {
  return container.querySelector('[data-testid="depot-pager"]')?.textContent ?? '';
}

function click(el: Element): void {
  act(() => {
    (el as HTMLElement).click();
  });
}

describe('exceptions page when a new query fails', () => {
  it('keeps the last good page, the stale strip and the error sentence, and the controls', () => {
    const retry = vi.fn();
    hook.result = (q) => {
      const query = q as BusPageQuery;
      if (query.offset === 0) {
        return { data: response(query, 60, 25), error: null, loading: false, refresh: retry };
      }
      return { data: null, error: 'Depot data unavailable', loading: false, refresh: retry };
    };
    act(() => root.render(<ExceptionCentre />));
    expect(pagerText()).toContain('Rows 1 to 25 of 60');

    click(button('Next'));

    expect(container.querySelector('[data-testid="depot-error"]')).toBeNull();
    expect(container.querySelector('[data-testid="depot-stale"]')).not.toBeNull();
    expect(pagerText()).toContain('Rows 1 to 25 of 60');
    expect(container.textContent).toMatch(/could not load/i);
    expect(button('Next')).toBeDefined();
    expect(container.querySelector('select')).not.toBeNull();
    click(button('Retry'));
    expect(retry).toHaveBeenCalled();
  });

  it('shows the full error panel only when there is nothing to show', () => {
    hook.result = () => ({
      data: null,
      error: 'Depot data unavailable',
      loading: false,
      refresh: () => undefined,
    });
    act(() => root.render(<ExceptionCentre />));
    expect(container.querySelector('[data-testid="depot-error"]')).not.toBeNull();
    expect(container.textContent).toContain('Could not load exceptions');
  });
});

describe('exceptions page filters and paging', () => {
  it('writes a pressed kind tile to the URL and clears it on a second press', () => {
    hook.result = (q) => ({
      data: response(q as BusPageQuery, 60, 25),
      error: null,
      loading: false,
      refresh: () => undefined,
    });
    act(() => root.render(<ExceptionCentre />));
    const tile = Array.from(container.querySelectorAll('button[aria-pressed]')).find((b) =>
      b.textContent?.includes('Long dark'),
    ) as HTMLElement;
    click(tile);
    expect(window.location.search).toBe('?kind=long_dark');
    expect(tile.getAttribute('aria-pressed')).toBe('true');
    click(tile);
    expect(window.location.search).toBe('');
  });

  it('reads ?kind= before the first fetch, so no unfiltered request is made', () => {
    window.history.replaceState({}, '', '/project/depots/exceptions?kind=long_dark');
    hook.result = (q) => ({
      data: response(q as BusPageQuery, 60, 25),
      error: null,
      loading: false,
      refresh: () => undefined,
    });
    act(() => root.render(<ExceptionCentre />));
    expect((hook.queries[0] as BusPageQuery).kind).toBe('long_dark');
    expect(hook.queries.every((q) => (q as BusPageQuery).kind === 'long_dark')).toBe(true);
  });

  // Round 2: the pager is the only place the count appears; no "Showing…" sentence above.
  it('states the bus count once, in the pager, with separators', () => {
    hook.result = (q) => ({
      data: response(q as BusPageQuery, 1936, 25),
      error: null,
      loading: false,
      refresh: () => undefined,
    });
    act(() => root.render(<ExceptionCentre />));
    expect(pagerText()).toContain('Rows 1 to 25 of 1,936');
    expect(container.textContent).not.toMatch(/Showing/);
    expect(container.querySelector('[data-testid="bus-page-status"]')).toBeNull();
  });

  // Round 2, ruling 1: the depot cockpit links here with both parameters.
  it('honours ?kind= and ?depot= on entry, names the depot in a chip that clears it', () => {
    window.history.replaceState({}, '', '/project/depots/exceptions?kind=emergency&depot=42');
    hook.result = (q) => ({
      data: response(q as BusPageQuery, 1, 1),
      error: null,
      loading: false,
      refresh: () => undefined,
    });
    act(() => root.render(<ExceptionCentre />));
    const first = hook.queries[0] as BusPageQuery;
    expect(first.kind).toBe('emergency');
    expect(first.depotId).toBe('42');
    const figure = Array.from(container.querySelectorAll('button[aria-pressed]')).find((b) =>
      b.textContent?.includes('Emergency flag'),
    );
    expect(figure?.getAttribute('aria-pressed')).toBe('true');
    const chip = container.querySelector('[data-testid="bus-depot-chip"]') as HTMLElement;
    expect(chip.textContent).toContain('Depot 42');
    click(chip);
    expect(window.location.search).toBe('?kind=emergency');
    expect((hook.queries[hook.queries.length - 1] as BusPageQuery).depotId).toBeNull();
    expect(container.querySelector('[data-testid="bus-depot-chip"]')).toBeNull();
  });

  it('makes the whole page about the depot in ?depot=: bands, totals and group rows count that depot (R2-m23)', () => {
    window.history.replaceState({}, '', '/project/depots/exceptions?depot=49');
    hook.result = (q) => ({
      data: {
        ...response(q as BusPageQuery, 3, 3),
        report: { depot: [], busTotal: 688, counts: { ...COUNTS, long_dark: 600 } },
        depotScope: {
          depotId: '49',
          depotName: 'KAUSHAMBI',
          busCounts: { long_dark: 3, power_cut: 0, tamper_code: 0, emergency: 0 },
          busTotal: 3,
          depot: [],
        },
      } as unknown as DepotExceptionsResponse,
      error: null,
      loading: false,
      refresh: () => undefined,
    });
    act(() => root.render(<ExceptionCentre />));
    const figure = Array.from(container.querySelectorAll('button[aria-pressed]')).find((b) =>
      b.textContent?.includes('Long dark'),
    );
    expect(figure?.textContent).toContain('3');
    expect(figure?.textContent).not.toContain('600');
    const page = container.textContent ?? '';
    expect(page).toContain('Exceptions at KAUSHAMBI only.');
    expect(page).toContain('0 depot exceptions · 3 bus exceptions');
    expect(page).toContain('LONG DARK · 3 · WARNING');
    expect(page).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    // Kind and severity are said by the group row, not by a column on every row.
    const headers = Array.from(container.querySelectorAll('th')).map((th) => th.textContent);
    expect(headers.some((h) => h?.startsWith('Kind') || h?.startsWith('Severity'))).toBe(false);
  });

  it('ignores an unknown kind and a malformed depot id on entry', () => {
    window.history.replaceState({}, '', '/project/depots/exceptions?kind=fire&depot=abc');
    hook.result = (q) => ({
      data: response(q as BusPageQuery, 60, 25),
      error: null,
      loading: false,
      refresh: () => undefined,
    });
    act(() => root.render(<ExceptionCentre />));
    expect(hook.queries[0]).toMatchObject({ kind: null, depotId: null });
    expect(container.querySelector('[data-testid="depot-error"]')).toBeNull();
  });

  it('moves focus to the status line when Next becomes disabled on the last page', () => {
    hook.result = (q) => {
      const query = q as BusPageQuery;
      return {
        data: response(query, 40, query.offset === 0 ? 25 : 15),
        error: null,
        loading: false,
        refresh: () => undefined,
      };
    };
    act(() => root.render(<ExceptionCentre />));
    const next = button('Next');
    next.focus();
    click(next);
    expect(button('Next').disabled).toBe(true);
    // The shared pager owns the focus rescue: its own status line takes it.
    expect(document.activeElement).toBe(
      container.querySelector('[data-testid="depot-pager"] [role="status"]'),
    );
  });

  it('resets the offset and disables Previous when the total for a filter is zero', () => {
    hook.result = (q) => {
      const query = q as BusPageQuery;
      const empty = query.offset > 0;
      return {
        data: response(query, empty ? 0 : 60, empty ? 0 : 25),
        error: null,
        loading: false,
        refresh: () => undefined,
      };
    };
    act(() => root.render(<ExceptionCentre />));
    click(button('Next'));
    // The list emptied under the second page; the page steps back to offset zero.
    expect((hook.queries[hook.queries.length - 1] as BusPageQuery).offset).toBe(0);
    expect(button('Previous').disabled).toBe(true);
  });
});
