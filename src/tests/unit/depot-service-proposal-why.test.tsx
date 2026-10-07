import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProposalsTable } from '@/components/depot/service/ProposalsTable';
import { FIXTURE_PROPOSALS, routeHourlyFixture } from './depot-service-fixtures';

const actGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
const originalFetch = globalThis.fetch;
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
  globalThis.fetch = originalFetch;
});

describe("a proposal row's explanation", () => {
  it('offers a Why? button in the opened row that asks for that proposal on its route', async () => {
    const fn = vi.fn(async () => ({
      status: 200,
      ok: true,
      json: async () => ({
        headline: 'Why',
        paragraphs: ['Body.'],
        provider: 'scripted',
        notice: 'none',
        generatedAt: '2026-10-06T09:30:00.000Z',
        cached: false,
        facts: [],
      }),
    }));
    globalThis.fetch = fn as unknown as typeof fetch;
    const day = routeHourlyFixture();
    act(() => root.render(<ProposalsTable proposals={day.proposals} hours={day.hours} />));
    expect(container.querySelector('button[aria-label^="Why?"]')).toBeNull();
    const first = container.querySelector<HTMLElement>('tr[aria-expanded="false"]');
    act(() => first?.click());
    const why = container.querySelector<HTMLButtonElement>(
      '[data-testid="proposal-detail"] button[aria-label^="Why?"]',
    );
    expect(why).not.toBeNull();
    expect(fn).not.toHaveBeenCalled();
    await act(async () => why?.click());
    const init = (fn.mock.calls[0] as unknown as [string, RequestInit])[1];
    const sent = JSON.parse(String(init.body)) as { proposalId: string; routeName: string };
    expect(FIXTURE_PROPOSALS.map((p) => p.id)).toContain(sent.proposalId);
    expect(sent.routeName).toBe(day.routeName);
  });
});
