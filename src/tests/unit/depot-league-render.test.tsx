import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LeagueGrid } from '@/components/depot/league/LeagueGrid';
import { ScoreBreakdown } from '@/components/depot/league/ScoreBreakdown';
import type { LeagueRow } from '@/lib/depot/league/leagueModel';

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

describe('ScoreBreakdown', () => {
  it("shows the unit's fleet for a ranked and for an unranked unit", () => {
    act(() => root.render(<ScoreBreakdown row={RANKED} feedNow={null} />));
    expect(container.textContent).toContain('Fleet: 123 buses.');
    act(() => root.render(<ScoreBreakdown row={SMALL} feedNow={null} />));
    expect(container.textContent).toContain('Fleet: 7 buses.');
  });
});
