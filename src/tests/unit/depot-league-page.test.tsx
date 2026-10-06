import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DepotLeaguePage from '@/app/(protected)/project/depots/league/page';
import { EMPTY_FEED_SENTENCE } from '@/components/depot/league/LeagueTable';
import type { DepotScore } from '@/lib/depot/score/types';
import { bannedOnScreen } from './depot-guard-rendered';

/*
 * The real league page, gate mocked, in every state: the provenance line's tone and
 * sentence, the index window words on the page, and
 * the one MODELLED tag, in the trend column's header cell.
 */

const feed = vi.hoisted(() => ({ value: null as unknown }));

vi.mock('@/lib/auth/server', () => ({ requireProjectSession: async (): Promise<void> => {} }));
vi.mock('@/components/depot/data/DepotNetworkProvider', () => ({
  useDepotNetworkContext: (): unknown => feed.value,
}));
vi.mock('@/hooks/useDepotTrends', () => ({
  useDepotTrends: () => ({ data: null, error: null, loading: true, refresh: () => undefined }),
}));

// The feed's own shape: Indian digits with a `Z`, never an offset.
const FEED_NOW = '2026-10-06T15:21:00Z';
const SINCE = '2026-10-06T15:01:00Z';

function score(depotId: string, rank: number, samples: number): DepotScore {
  return {
    depotId, peerGroup: 'medium', ranked: true, reason: 'ok', index: 60 - rank, rank, peerCount: 2,
    components: [], samples,
  };
}

const DATA = {
  source: 'live',
  stale: false,
  feedNow: FEED_NOW,
  depots: [
    { id: 'a', name: 'GANGOH', kind: 'depot', fleet: 80 },
    { id: 'b', name: 'KHATAULI', kind: 'depot', fleet: 70 },
    { id: 'c', name: 'TINY', kind: 'depot', fleet: 3 },
  ],
  scores: [score('a', 1, 20), score('b', 2, 1)],
  scoreWindow: { lengthMin: 20, since: SINCE, samples: 20, coveredMin: 20 },
};

const STATES = [
  ['loading', { data: null, error: null, loading: true, refresh: () => undefined }],
  ['error', { data: null, error: 'The feed is unavailable.', loading: false, refresh: () => undefined }],
  ['empty', { data: { ...DATA, depots: [], scores: [] }, error: null, loading: false, refresh: () => undefined }],
  ['data', { data: DATA, error: null, loading: false, refresh: () => undefined }],
] as const;

async function renderPage(): Promise<string> {
  return renderToStaticMarkup(await DepotLeaguePage());
}

function text(markup: string): string {
  const frame = document.createElement('div');
  frame.innerHTML = markup;
  return frame.textContent ?? '';
}

beforeEach(() => {
  feed.value = STATES[3][1];
});

function provenanceLine(markup: string): { tone: string | null; tag: string; sentence: string } {
  const frame = document.createElement('div');
  frame.innerHTML = markup;
  const line = frame.querySelector('[data-testid="depot-provenance-line"]');
  return {
    tone: line?.getAttribute('data-tone') ?? null,
    tag: line?.firstElementChild?.textContent ?? '',
    sentence: line?.lastElementChild?.textContent ?? '',
  };
}

const SENTENCE: Readonly<Record<(typeof STATES)[number][0], string>> = {
  loading: 'Waiting for the feed.',
  error: 'The feed is unavailable.',
  empty: 'Computed from the live feed at 15:21. Efficiency index over the last 20 minutes.',
  data: 'Computed from the live feed at 15:21. Efficiency index over the last 20 minutes.',
};

describe('league page wording', () => {
  it.each(STATES)('shows no "simulated" and no raw date in the %s state', async (_name, state) => {
    feed.value = state;
    expect(bannedOnScreen(await renderPage())).toEqual([]);
  });
});

describe('league page provenance line', () => {
  it.each(STATES)('declares DERIVED and its sentence in the %s state', async (name, state) => {
    feed.value = state;
    const line = provenanceLine(await renderPage());
    expect(line.tone).toBe('derived');
    expect(line.tag).toBe('DERIVED');
    expect(line.sentence).toBe(SENTENCE[name]);
  });

  it('never says "over the last 20 minutes" of a window holding one sample', async () => {
    const window = { lengthMin: 20, since: SINCE, samples: 1, coveredMin: 0 };
    feed.value = { ...STATES[3][1], data: { ...DATA, scoreWindow: window } };
    expect(provenanceLine(await renderPage()).sentence).toBe(
      'Computed from the live feed at 15:21. Efficiency index from one snapshot at 15:01.',
    );
  });
});

describe('league page anatomy', () => {
  it('says the counts and how to open a breakdown in one section note, with no paragraph or Computed line', async () => {
    const markup = await renderPage();
    const page = text(markup);
    expect(page).toContain('2 of 3 ranked · the index cell opens how a score is made up');
    expect(page).not.toContain('Computed 1');
    expect(page).not.toContain('Select Score');
    // between the provenance line and the table: the section label's note, and no other sentence
    const afterLine = markup.indexOf('</div>', markup.indexOf('depot-provenance-line'));
    const between = markup.slice(afterLine, markup.indexOf('<table'));
    expect(between.match(/<p[\s>][^>]*>/g)).toEqual(['<p class="depot-note min-w-0">']);
  });

  it('tags MODELLED once, in the trend column header cell', async () => {
    const markup = await renderPage();
    const frame = document.createElement('div');
    frame.innerHTML = markup;
    const tags = Array.from(frame.querySelectorAll('[data-provenance="modelled"]'));
    expect(tags).toHaveLength(1);
    expect(tags[0]?.closest('th')?.textContent).toContain('Trend');
  });

  it('marks the depot scored on fewer snapshots than the window, and only that one', async () => {
    const frame = document.createElement('div');
    frame.innerHTML = await renderPage();
    const marks = Array.from(frame.querySelectorAll('[title^="Scored on"]'));
    expect(marks.map((m) => m.getAttribute('title'))).toEqual(['Scored on 1 snapshot so far, of 20 in the window.']);
    expect(marks[0]?.closest('tr')?.textContent).toContain('KHATAULI');
  });

  it('shows a state panel when the feed has no depots', async () => {
    feed.value = STATES[2][1];
    expect(text(await renderPage())).toContain(EMPTY_FEED_SENTENCE);
  });
});

describe('league filters', () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ id: `d${i}`, name: `DEPOT ${i}`, kind: 'depot', fleet: 50 }));
  const scores = many.map((d, i) => score(d.id, i + 1, 20));

  it('use the shared filter row and return the pager to page 1 when a filter changes', async () => {
    feed.value = { ...STATES[3][1], data: { ...DATA, depots: many, scores } };
    const { act } = await import('react');
    const { createRoot } = await import('react-dom/client');
    const { LeagueTable } = await import('@/components/depot/league/LeagueTable');
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(<LeagueTable />));
    expect(host.querySelector('[data-testid="depot-filter-row"]')).not.toBeNull();
    const next = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'Next');
    act(() => next?.click());
    expect(host.textContent).toContain('Rows 26 to 30 of 30');
    const unranked = host.querySelector<HTMLInputElement>('input[type="checkbox"]');
    act(() => unranked?.click());
    expect(host.textContent).toContain('Rows 1 to 25 of 30');
    act(() => root.unmount());
    host.remove();
  });
});

describe('league score breakdown focus, on the real page', () => {
  it('returns focus to the row that opened the breakdown when the expanded row closes', async () => {
    feed.value = STATES[3][1];
    const { act } = await import('react');
    const { createRoot } = await import('react-dom/client');
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })) as unknown as typeof window.matchMedia;
    const scroll = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = () => undefined;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const page = await DepotLeaguePage();
    await act(async () => root.render(page));

    const row = (): HTMLElement => host.querySelector<HTMLElement>('[data-league-row="b"]') as HTMLElement;
    const breakdown = (): Element | null => host.querySelector('[data-testid="league-breakdown-row"]');
    const enter = (): void => {
      act(() => {
        row().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      });
    };

    // Opened from the keyboard: the expanded row sits under its row and takes focus.
    row().focus();
    enter();
    expect(breakdown()).not.toBeNull();
    expect(breakdown()?.previousElementSibling).toBe(row());
    expect(breakdown()?.contains(document.activeElement)).toBe(true);

    // Closed by activating the same row with the pointer: focus is back on the row.
    act(() => row().click());
    expect(breakdown()).toBeNull();
    expect(document.activeElement).toBe(row());

    // Opened again and closed from the keyboard, Enter on the row: focus is back on it.
    enter();
    expect(breakdown()).not.toBeNull();
    // Focus is in the breakdown here, so only the page's own move can put it back on the row.
    expect(document.activeElement).not.toBe(row());
    enter();
    expect(breakdown()).toBeNull();
    expect(document.activeElement).toBe(row());

    // Escape inside the open breakdown closes it and puts focus back on its row, as the
    // economics table does.
    enter();
    expect(breakdown()?.contains(document.activeElement)).toBe(true);
    act(() => {
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(breakdown()).toBeNull();
    expect(document.activeElement).toBe(row());

    // Every row ends in one muted chevron; it turns a quarter while its breakdown is open.
    const chevrons = (): NodeListOf<Element> =>
      row().querySelectorAll('[data-testid="depot-disclosure-chevron"]');
    expect(chevrons()).toHaveLength(1);
    expect(chevrons()[0]?.className).not.toContain('rotate-90');
    enter();
    expect(chevrons()[0]?.className).toContain('rotate-90');

    act(() => root.unmount());
    host.remove();
    Element.prototype.scrollIntoView = scroll;
  });
});
