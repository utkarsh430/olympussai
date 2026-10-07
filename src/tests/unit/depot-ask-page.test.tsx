import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AskPage from '@/app/(protected)/project/depots/ask/page';
import type { CopilotState } from '@/hooks/useCopilot';
import type { CopilotApiResponse } from '@/lib/depot/copilot/wire';
import { bannedOnScreen } from './depot-guard-rendered';

/*
 * The ask page's real top-level component declares MIXED
 * (computed answers DERIVED, shortfalls, spares and transfers MODELLED) in every state;
 * "advisory" and the staff limit stay visible; a generated evidence column carries
 * MODELLED in its header cell; the scope chip names the scope the ANSWER used; SUGGESTED QUESTIONS
 * keeps its label after an answer; nothing is requested on mount.
 */
const actGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
const copilot = vi.hoisted(() => ({
  state: { status: 'idle' } as unknown,
  request: (() => undefined) as (body: unknown) => void,
  network: null as unknown,
}));

const FRESH = {
  data: { feedNow: '2026-10-06T14:20:00.000Z', stale: false, source: 'live', depots: [] },
  error: null,
  loading: false,
  refresh: () => undefined,
};

vi.mock('@/lib/auth/server', () => ({ requireProjectSession: async (): Promise<void> => {} }));
vi.mock('@/components/depot/data/DepotNetworkProvider', () => ({
  useDepotNetworkContext: (): unknown => copilot.network,
}));
vi.mock('@/hooks/useCopilot', () => ({
  useCopilot: (): unknown => ({
    state: copilot.state,
    request: (body: unknown) => copilot.request(body),
    reset: () => undefined,
  }),
}));

const SHORT: CopilotApiResponse = {
  headline: 'Depots short of buses',
  paragraphs: ['2 depots, 10 buses in all.'],
  provider: 'scripted',
  notice: 'none',
  generatedAt: '2026-10-06T14:20:05.000Z',
  cached: false,
  // The text cites only the count and the total: no row fact reaches the page.
  facts: [
    { id: 'list.count', label: 'Depots', text: '2 depots', provenance: 'modelled' },
    { id: 'list.total', label: 'Short by in all', text: '10 buses', provenance: 'modelled' },
  ],
  interpretedAs: 'Depots short of buses',
  table: {
    columns: ['Depot', 'Short by'],
    rows: [['GARH', '9 buses'], ['KHURJA', '1 bus']],
    provenance: [null, 'modelled'],
  },
  answerScope: { kind: 'depot', depotId: '7', depotName: 'KAUSHAMBI' },
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  copilot.state = { status: 'idle' };
  copilot.request = () => undefined;
  copilot.network = FRESH;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function renderPage(): Promise<void> {
  const page = await AskPage();
  act(() => root.render(page));
}

/** Submits a question, then returns the short-of-buses answer from the given writer. */
async function askShort(provider: CopilotApiResponse['provider']): Promise<void> {
  await renderPage();
  const box = container.querySelector('textarea') as HTMLTextAreaElement;
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  act(() => {
    setValue?.call(box, 'Which depots are short of buses at KAUSHAMBI?');
    box.dispatchEvent(new Event('input', { bubbles: true }));
  });
  act(() => {
    (container.querySelector('form') as HTMLFormElement).requestSubmit();
  });
  copilot.state = { status: 'done', response: { ...SHORT, provider } };
  await renderPage();
}

function line(): Element | null {
  return container.querySelector('[data-testid="depot-provenance-line"]');
}

const STATES: readonly [string, CopilotState | unknown][] = [
  ['idle', { status: 'idle' }],
  ['loading', { status: 'loading' }],
  ['rate-limited', { status: 'failed', kind: 'rate_limited', secondsRemaining: 5 }],
];

describe('the ask page', () => {
  it.each(STATES)('declares MIXED, naming computed and modelled answers, when %s', async (_n, state) => {
    copilot.state = state;
    await renderPage();
    expect(line()?.getAttribute('data-tone')).toBe('mixed');
    expect(line()?.textContent).toContain(
      'Rankings, depot summaries and exceptions are DERIVED; shortfalls, spare buses and transfers are MODELLED.',
    );
    const visible = container.textContent ?? '';
    expect(visible).toContain('answers are advisory');
    expect(visible).toContain('questions about staff are not answered');
  });

  it('requests nothing on mount and shows the question limit', async () => {
    const request = vi.fn();
    copilot.request = request;
    await renderPage();
    expect(request).not.toHaveBeenCalled();
    expect(container.textContent).toMatch(/of \d+ characters left/);
  });

  it.each([
    ['waiting', { data: null, error: null, loading: true }, 'shortfalls, spare buses and transfers are MODELLED.'],
    ['unavailable', { data: null, error: 'down', loading: false }, 'DERIVED from no data while the feed is unavailable'],
    ['stale', { ...FRESH, data: { ...FRESH.data, stale: true } }, 'DERIVED from the last good data'],
  ])('drives the provenance line through the %s feed state', async (_name, network, words) => {
    copilot.network = { refresh: () => undefined, ...network };
    await renderPage();
    expect(line()?.getAttribute('data-tone')).toBe('mixed');
    expect(line()?.textContent).toContain(words);
  });

  it('says in the closed disclosure that some answers rest on modelled figures, and tags only tables that exist', async () => {
    await renderPage();
    const produced = container.querySelector('[data-testid="depot-produced"]')?.textContent ?? '';
    expect(produced).not.toContain('every figure in them comes from the latest data');
    expect(produced).toContain('rest on modelled requirement figures, not on the feed');
    expect(produced).toContain('an answer about transfers has no table');
    expect(produced).not.toMatch(/\bMODELLED\b/);
  });

  it('never prints a raw ISO date or "simulated" in its text or attributes', async () => {
    await askShort('claude');
    expect(bannedOnScreen(container)).toEqual([]);
  });

  it.each(['scripted', 'claude'] as const)(
    'tags the modelled column from the response provenance on a %s answer that cites only a total',
    async (provider) => {
      await askShort(provider);
      const headers = Array.from(container.querySelectorAll('[data-testid="copilot-table"] th'));
      expect(headers.find((th) => th.textContent?.includes('Short by'))?.textContent).toContain(
        'MODELLED',
      );
    },
  );

  it('says when the answer was about a depot while the form is still on the whole network', async () => {
    await askShort('claude');
    expect(container.querySelector('[data-testid="ask-scope-mismatch"]')?.textContent).toBe(
      'The last answer was about KAUSHAMBI; the form is set to the whole network.',
    );
  });

  it('tags a generated evidence column, shows the answer scope, and keeps SUGGESTED QUESTIONS labelled', async () => {
    await renderPage();
    const box = container.querySelector('textarea') as HTMLTextAreaElement;
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    act(() => {
      setValue?.call(box, 'Which depots are short of buses?');
      box.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => {
      (container.querySelector('form') as HTMLFormElement).requestSubmit();
    });
    copilot.state = { status: 'done', response: SHORT };
    await renderPage();

    const headers = Array.from(container.querySelectorAll('[data-testid="copilot-table"] th'));
    const shortBy = headers.find((th) => th.textContent?.includes('Short by'));
    expect(shortBy?.textContent).toContain('MODELLED');
    expect(shortBy?.textContent).toContain('buses');
    expect(headers.find((th) => th.textContent?.startsWith('Depot'))?.textContent).not.toContain(
      'MODELLED',
    );
    const cells = Array.from(container.querySelectorAll('[data-testid="copilot-table"] td'));
    expect(cells.map((td) => td.textContent)).toEqual(['GARH', '9', 'KHURJA', '1']);
    expect(container.querySelector('[data-testid="ask-answer-scope"]')?.textContent).toContain(
      'KAUSHAMBI',
    );
    expect(container.querySelector('[data-testid="ask-try"]')?.textContent).toContain('Suggested questions');
  });
});
