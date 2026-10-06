import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LeagueGrid } from '@/components/depot/league/LeagueGrid';
import { ScoreBreakdown } from '@/components/depot/league/ScoreBreakdown';
import type { LeagueRow } from '@/lib/depot/league/leagueModel';

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

describe('LeagueGrid', () => {
  it('carries the selection on the Score button, not on the row', () => {
    act(() =>
      root.render(
        <LeagueGrid
          rows={[RANKED, SMALL]}
          showPeerGroup={false}
          selectedId="a"
          onSelect={() => undefined}
        />,
      ),
    );
    expect(container.querySelector('tr[aria-selected]')).toBeNull();
    const pressed = Array.from(container.querySelectorAll('button[aria-pressed="true"]'));
    expect(pressed.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Score breakdown for Depot a',
    ]);
  });

  it('gives each explained header one copy for assistive technology, not title and hidden text', () => {
    act(() =>
      root.render(
        <LeagueGrid
          rows={[RANKED]}
          showPeerGroup={false}
          selectedId={null}
          onSelect={() => undefined}
        />,
      ),
    );
    const headers = Array.from(container.querySelectorAll('thead th'));
    const explained = headers.filter((th) => th.querySelector('.sr-only') !== null);
    expect(explained.length).toBeGreaterThan(0);
    for (const th of explained) expect(th.hasAttribute('title')).toBe(false);
  });
});

describe('LeagueGrid frozen block, window and pages', () => {
  const many = Array.from({ length: 30 }, (_, i) => row(`r${i}`, { rank: i + 1 }));

  it('gives Rank, Depot and Index one width each from the shared arithmetic, header and body alike', () => {
    act(() =>
      root.render(
        <LeagueGrid rows={[RANKED]} showPeerGroup={false} selectedId={null} onSelect={() => undefined} />,
      ),
    );
    const head = Array.from(container.querySelectorAll<HTMLElement>('thead th')).slice(0, 3);
    const body = Array.from(container.querySelectorAll<HTMLElement>('tbody td')).slice(0, 3);
    const lefts = head.map((th) => th.style.getPropertyValue('--frozen-left-wide'));
    expect(lefts).toEqual(['0rem', '4.75rem', '17.75rem']);
    expect(body.map((td) => td.style.getPropertyValue('--frozen-left-wide'))).toEqual(lefts);
    for (const cell of [...head, ...body]) expect(cell.className).toContain('sticky');
    for (const td of body) expect(td.className).toContain('bg-depot-page');
  });

  it('orders schedule coverage and device integrity straight after the frozen block', () => {
    act(() =>
      root.render(
        <LeagueGrid rows={[RANKED]} showPeerGroup={false} selectedId={null} onSelect={() => undefined} />,
      ),
    );
    const headers = Array.from(container.querySelectorAll('thead th button')).map((b) => b.textContent);
    expect(headers.slice(0, 5)).toEqual(['Rank', 'Depot', 'Index', 'Schedule coverage', 'Device integrity']);
  });

  it('names the window under the Index header', () => {
    act(() =>
      root.render(
        <LeagueGrid
          rows={[RANKED]}
          showPeerGroup={false}
          selectedId={null}
          onSelect={() => undefined}
          indexWindow="last 20 min"
        />,
      ),
    );
    expect(container.querySelectorAll('thead th')[2]?.textContent).toContain('Index· last 20 min');
  });

  it('pages at 25 rows in the page flow and says the range', () => {
    act(() =>
      root.render(
        <LeagueGrid rows={many} showPeerGroup={false} selectedId={null} onSelect={() => undefined} />,
      ),
    );
    expect(container.querySelectorAll('tbody tr')).toHaveLength(25);
    expect(container.textContent).toContain('Rows 1 to 25 of 30');
  });

  it('shows a state panel, not an empty table, when no depot matches', () => {
    act(() =>
      root.render(<LeagueGrid rows={[]} showPeerGroup={false} selectedId={null} onSelect={() => undefined} />),
    );
    expect(container.querySelector('table')).toBeNull();
    expect(container.textContent).toContain('No depots match these filters.');
  });
});

describe('ScoreBreakdown', () => {
  it("shows the unit's fleet for a ranked and for an unranked unit", () => {
    act(() => root.render(<ScoreBreakdown row={RANKED} feedNow={null} />));
    expect(container.textContent).toContain('Fleet: 123 buses.');
    act(() => root.render(<ScoreBreakdown row={SMALL} feedNow={null} />));
    expect(container.textContent).toContain('Fleet: 7 buses.');
  });
});
