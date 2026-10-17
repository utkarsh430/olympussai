import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RedistributionRoutePage from '@/app/(protected)/project/depots/service/page';
import { bannedOnScreen } from './depot-guard-rendered';

/*
 * The AI Redistribution Engine page from its real module: the gate, its title and
 * tagline, the six sections, the six figures, the heat map, the plan on a press and the
 * recommendations it yields, and nothing on screen that says "simulated" or prints a raw
 * date. The scenario is seeded, so the figures are the same on every run.
 */

const state = vi.hoisted(() => ({
  gates: [] as string[],
  search: '' as string,
}));

vi.mock('@/lib/auth/server', () => ({
  requireProjectSession: async (path: string): Promise<void> => {
    state.gates.push(path);
  },
}));
vi.mock('next/navigation', () => ({
  useSearchParams: (): URLSearchParams => new URLSearchParams(state.search),
}));

const actGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
let container: HTMLDivElement;
let root: Root;

async function renderPage(): Promise<void> {
  const page = await RedistributionRoutePage();
  await act(async () => root.render(page));
}

const text = (): string => container.textContent ?? '';
const button = (label: string): HTMLButtonElement => {
  const found = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim().startsWith(label));
  if (!found) throw new Error(`No button "${label}"`);
  return found;
};

beforeEach(() => {
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  state.gates.length = 0;
  state.search = '';
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe('the AI Redistribution Engine page', () => {
  it('gates on its own path and shows the title, tagline, six sections and six figures', async () => {
    await renderPage();
    expect(state.gates).toEqual(['/project/depots/service']);
    expect(container.querySelector('h1')?.textContent).toBe('AI Redistribution Engine');
    expect(text()).toContain('Right Buses. Right Routes. Right Time.');
    expect(container.querySelector('[data-testid="scenario-indicator"]')?.textContent).toContain('Demonstration Scenario');
    for (const id of ['network-overview', 'demand-supply-heatmap', 'ai-recommendations', 'impact-analysis', 'movement-timeline', 'operational-briefing']) {
      expect(container.querySelector(`[data-testid="${id}"]`), id).not.toBeNull();
    }
    expect(container.querySelectorAll('[data-testid="kpi-card"]')).toHaveLength(6);
    expect(container.querySelectorAll('[data-testid="heat-grid"] [data-testid="heat-row"]').length).toBeGreaterThan(0);
    expect(bannedOnScreen(container)).toEqual([]);
  });

  it('reads the band and depot from the address', async () => {
    state.search = 'band=evening_peak&depot=1003';
    await renderPage();
    expect(text()).toContain('Evening Peak · Agra Fort');
  });

  it('generates a plan on a press, lists transfer proposals, and excluding one changes the projection', async () => {
    vi.useFakeTimers();
    await renderPage();
    expect(container.querySelector('[data-testid="plan-idle"]')).not.toBeNull();
    await act(async () => {
      button('Generate AI Redistribution Plan').click();
    });
    expect(container.querySelector('[data-testid="plan-generating"]')).not.toBeNull();
    // Each step schedules the next after a re-render, so the timers advance one step at a time.
    for (let i = 0; i < 8; i += 1) {
      await act(async () => {
        vi.advanceTimersByTime(300);
      });
    }
    const cards = container.querySelectorAll('[data-testid="recommendation-card"]');
    expect(cards.length).toBeGreaterThan(0);
    expect(cards[0]?.textContent).toContain('Transfer Proposal #01');
    expect(container.querySelector('[data-testid="impact-comparison"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-testid="timeline-row"]').length).toBeGreaterThan(0);

    const before = container.querySelector('[data-testid="impact-comparison"]')?.textContent ?? '';
    await act(async () => {
      cards[0]?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')?.click();
    });
    expect(container.querySelector('[data-testid="recommendation-card"]')?.getAttribute('data-included')).toBe('false');
    expect(container.querySelector('[data-testid="impact-comparison"]')?.textContent).not.toBe(before);
    expect(bannedOnScreen(container)).toEqual([]);
  });

  it('writes a six-section briefing from the page', async () => {
    await renderPage();
    await act(async () => {
      button('Generate AI Service Briefing').click();
    });
    const body = container.querySelector('[data-testid="briefing-body"]');
    expect(body?.querySelectorAll('h3')).toHaveLength(6);
    expect(body?.textContent).toContain('Network Situation');
    expect(body?.textContent).toContain('Manager Attention Required');
  });
});
