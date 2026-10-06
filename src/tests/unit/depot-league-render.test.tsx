import { TrendCell } from '@/components/depot/league/LeagueCells';
import type { TrendTableRow } from '@/lib/depot/forecast/trendsTableModel';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LeagueGrid } from '@/components/depot/league/LeagueGrid';
import { ScoreBreakdown } from '@/components/depot/league/ScoreBreakdown';
import type { LeagueRow, ComponentCell } from '@/lib/depot/league/leagueModel';
import type { LeagueGridProps } from '@/components/depot/league/LeagueGrid';

// The grid's index-trend column polls one batch endpoint; these tests are about the grid.
vi.mock('@/hooks/useDepotTrends', () => ({
  useDepotTrends: () => ({ data: null, error: null, loading: true, refresh: () => undefined }),
}));

const actGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };

function row(id: string, overrides: Partial<LeagueRow> = {}): LeagueRow {
  return {
    depotId: id,
    name: `Depot ${id}`,
    kind: 'depot',
    fleet: 123,
    peerGroup: 'medium',
    ranked: true,
    rank: 1,
    index: 61.2,
    peerCount: 12,
    components: [],
    score: null,
    ...overrides,
  };
}

const RANKED = row('a');
const SMALL = row('b', { fleet: 7, ranked: false, rank: null, index: null, peerGroup: null });

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

function grid(props: Partial<LeagueGridProps> = {}): void {
  act(() =>
    root.render(
      <LeagueGrid rows={[RANKED, SMALL]} grouped={false} selectedId={null} onSelect={() => undefined}
        page={0} onPage={() => undefined} {...props} />,
    ),
  );
}

const SCHEDULED: ComponentCell = {
  key: 'scheduled', label: 'Schedule coverage', weight: 0.2, higherIsBetter: true,
  value: 0.235, peerMedian: 0.214, deltaPoints: 2.1, z: 0.4, contribution: 1,
};

describe('LeagueGrid: the index cell opens the breakdown', () => {
  it('makes the index value and bar one button named for the depot, pressed when selected', () => {
    grid({ selectedId: 'a' });
    const buttons = Array.from(container.querySelectorAll('tbody button'));
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Score breakdown for Depot a',
      'Score breakdown for Depot b',
    ]);
    expect(buttons[0]?.getAttribute('aria-pressed')).toBe('true');
    expect(buttons[0]?.textContent).toBe('61.2');
    expect(buttons[0]?.closest('td')).toBe(container.querySelectorAll('tbody tr')[0]?.children[2]);
    expect(container.querySelector('tr[aria-selected]')).toBeNull();
  });

  it('has no repeated Score word, and a row-end chevron per row', () => {
    grid();
    expect(container.querySelector('tbody')?.textContent).not.toMatch(/score/i);
    const rows = Array.from(container.querySelectorAll('tbody tr'));
    for (const tr of rows) {
      expect(tr.lastElementChild?.querySelector('[data-testid="depot-disclosure-chevron"]')).not.toBeNull();
      expect(tr.lastElementChild?.firstElementChild?.className).toContain('group-hover:visible');
    }
  });

  it('opens from the button (a native button, so Enter and Space work) and from a row tap', () => {
    const onSelect = vi.fn();
    grid({ onSelect });
    act(() => container.querySelector<HTMLButtonElement>('tbody button')?.click());
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(container.querySelector('tbody button')?.getAttribute('type')).toBe('button');
    act(() => container.querySelectorAll<HTMLElement>('tbody tr')[1]?.click());
    expect(onSelect).toHaveBeenLastCalledWith(SMALL);
  });

  it('opens the breakdown as an expanded row directly under the activated row, by click or Enter', () => {
    const onSelect = vi.fn();
    grid({ onSelect, selectedId: 'a', expanded: <p>breakdown of a</p> });
    const rows = Array.from(container.querySelectorAll('tbody tr'));
    expect(rows[1]?.getAttribute('data-testid')).toBe('league-breakdown-row');
    expect(rows[1]?.textContent).toBe('breakdown of a');
    expect(rows[0]?.getAttribute('tabindex')).toBe('0');
    act(() => {
      rows[2]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(onSelect).toHaveBeenLastCalledWith(SMALL);
    // The index cell's own button opens it once, not once for itself and once for the row.
    onSelect.mockClear();
    act(() => container.querySelector<HTMLButtonElement>('tbody button')?.click());
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('describes the button by its value, and an unranked one by its reason', () => {
    grid();
    const [ranked, small] = Array.from(container.querySelectorAll('tbody button'));
    const describedBy = (b: Element | undefined) =>
      document.getElementById(b?.getAttribute('aria-describedby') ?? '')?.textContent;
    expect(describedBy(ranked)).toBe('61.2');
    expect(describedBy(small)).toContain('not ranked: Needs at least');
  });
});

describe('LeagueGrid columns', () => {
  it('reads INDEX on one line and puts the short headers in order', () => {
    grid();
    const headers = Array.from(container.querySelectorAll('thead th button')).map((b) => b.textContent);
    expect(headers).toEqual(['Rank', 'Depot', 'Index', 'Schedule', 'Devices', 'On road', 'Dark', 'Off road', 'Trend', 'Fleet']);
    expect(container.querySelectorAll('thead th')[2]?.textContent).not.toContain('·');
  });

  it('gives each explained header one copy for assistive technology, not title and hidden text', () => {
    grid();
    const explained = Array.from(container.querySelectorAll('thead th')).filter((th) => th.querySelector('.sr-only'));
    expect(explained.length).toBeGreaterThan(0);
    for (const th of explained) expect(th.hasAttribute('title')).toBe(false);
  });

  it('shows the value alone in a metric cell; the difference is in its title and the breakdown', () => {
    grid({ rows: [{ ...RANKED, components: [SCHEDULED] }] });
    const cell = container.querySelectorAll('tbody tr td')[3];
    expect(cell?.querySelector('[aria-hidden]')?.textContent).toBe('23.5%');
    expect(cell?.querySelector('[title]')?.getAttribute('title')).toBe(
      'Schedule coverage 23.5%, 2.1 pp better than the peer median of 21.4%',
    );
  });

  it('shows columns from their tier up with display classes, never the hidden attribute', () => {
    grid();
    const th = Array.from(container.querySelectorAll('thead th'));
    expect(th[3]?.className).toContain('hidden sm:table-cell');
    expect(th[6]?.className).toContain('hidden xl:table-cell');
    expect(th[8]?.className).toContain('hidden min-[1424px]:table-cell');
    expect(th[0]?.className).not.toContain('hidden');
    expect(container.querySelectorAll('[hidden]')).toHaveLength(0);
  });

  it('carries MODELLED once, in the trend header cell', () => {
    grid();
    const tags = Array.from(container.querySelectorAll('[data-provenance]'));
    expect(tags.map((t) => t.getAttribute('data-provenance'))).toEqual(['modelled']);
    expect(tags[0]?.closest('th')?.textContent).toContain('Trend');
  });
});

describe('LeagueGrid frozen block, groups, marks and pages', () => {
  const many = Array.from({ length: 30 }, (_, i) => row(`r${i}`, { rank: i + 1 }));

  it('gives Rank, Depot and Index one width each from the shared arithmetic, header and body alike', () => {
    grid({ rows: [RANKED] });
    const head = Array.from(container.querySelectorAll<HTMLElement>('thead th')).slice(0, 3);
    const body = Array.from(container.querySelectorAll<HTMLElement>('tbody td')).slice(0, 3);
    const lefts = head.map((th) => th.style.getPropertyValue('--frozen-left-wide'));
    expect(lefts).toEqual(['0rem', '4.75rem', '15.75rem']);
    expect(body.map((td) => td.style.getPropertyValue('--frozen-left-wide'))).toEqual(lefts);
    for (const cell of [...head, ...body]) expect(cell.className).toContain('sticky');
    for (const td of body) expect(td.className).toContain('bg-depot-page');
  });

  it('prints each peer group once as a group row when every group is listed', () => {
    grid({ rows: [RANKED, row('c', { rank: 2 }), SMALL], grouped: true });
    const groups = Array.from(container.querySelectorAll('[data-testid="depot-table-group"]'));
    expect(groups.map((g) => g.textContent)).toEqual(['Medium fleets · 2', 'Not ranked · 1']);
  });

  it('marks a depot scored on fewer snapshots than the window with a quiet word and a title', () => {
    grid({ rows: [{ ...RANKED, samples: 1 }, { ...row('c'), samples: 8 }], windowSamples: 8 });
    const marks = Array.from(container.querySelectorAll('tbody [title^="Scored on"]'));
    expect(marks).toHaveLength(1);
    expect(marks[0]?.getAttribute('title')).toBe('Scored on 1 snapshot so far, of 8 in the window.');
    expect(marks[0]?.textContent?.startsWith('new')).toBe(true);
  });

  it('pages at 25 rows in the page flow, says the range and asks the page for the next one', () => {
    const onPage = vi.fn();
    grid({ rows: many, onPage });
    expect(container.querySelectorAll('tbody tr')).toHaveLength(25);
    expect(container.textContent).toContain('Rows 1 to 25 of 30');
    const next = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Next');
    act(() => next?.click());
    expect(onPage).toHaveBeenCalledWith(1);
  });

  it('shows a state panel, not an empty table, when no depot matches', () => {
    grid({ rows: [] });
    expect(container.querySelector('table')).toBeNull();
    expect(container.textContent).toContain('No depots match these filters.');
  });
});

describe('ScoreBreakdown', () => {
  it("shows the unit's fleet for a ranked and for an unranked unit, and no Computed stamp", () => {
    act(() => root.render(<ScoreBreakdown row={RANKED} onClose={() => undefined} />));
    expect(container.textContent).toContain('Fleet: 123 buses.');
    expect(container.textContent).not.toContain('Computed');
    act(() => root.render(<ScoreBreakdown row={SMALL} onClose={() => undefined} />));
    expect(container.textContent).toContain('Fleet: 7 buses.');
  });
});

describe('league trend cell (critique MUST 2)', () => {
  it('reads sparkline then a right-aligned signed figure, never "steady, -0.3"', () => {
    const trendRow = {
      id: 'a', name: 'GARH', href: '#', values: [1, 2], sparkLabel: 'Index, GARH',
      week: -0.1, fourWeeks: -0.3, weekText: 'steady, −0.1', fourWeeksText: 'steady, −0.3',
      weekSigned: '−0.1', fourWeeksSigned: '−0.3', weekWord: 'STEADY', fourWeeksWord: 'STEADY',
    } as unknown as TrendTableRow;
    act(() => root.render(<TrendCell name="GARH" row={trendRow} />));
    const figure = container.querySelector('[data-testid="league-trend-figure"]');
    expect(figure?.textContent).toBe('−0.3');
    expect(figure?.className).toContain('text-right');
    expect(container.textContent).not.toContain('steady');
  });
});
