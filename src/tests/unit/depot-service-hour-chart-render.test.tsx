import { act, cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HourChart } from '@/components/depot/hourChart/HourChart';
import { GapTick } from '@/components/depot/hourChart/HourPlotParts';
import {
  CASING_WIDTH,
  GAP_COLOUR,
  HOUR_COLOUR,
  LINE_WIDTH,
} from '@/components/depot/hourChart/hourChartStyle';
import { DEPOT_PALETTE } from '@/lib/depot/palette';
import { buildHourChartModel } from '@/lib/depot/service/hourChartModel';
import { bannedOnScreen } from './depot-guard-rendered';
import { routeHourlyFixture } from './depot-service-fixtures';

// jsdom lays every container out at 0 x 0; give the chart a fixed size instead.
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

/** WCAG relative luminance of a #rrggbb colour, and the contrast of two. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [
    number,
    number,
    number,
  ];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

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

const toggleButton = (): HTMLButtonElement | null =>
  container.querySelector<HTMLButtonElement>('[data-testid="hour-chart-toggle"]');

function render(body = routeHourlyFixture()): void {
  act(() => root.render(<HourChart body={body} />));
}

describe('HourChart', () => {
  it('draws 24 gap cells in step with the hours, each signed and toned', () => {
    render();
    const cells = Array.from(container.querySelectorAll('[data-testid="hour-gap-cell"]'));
    expect(cells).toHaveLength(24);
    expect(cells[7]?.textContent).toBe('+3');
    expect(cells[7]?.getAttribute('data-gap')).toBe('short');
    expect(cells[12]?.textContent).toBe('−2');
    expect(cells[12]?.getAttribute('data-gap')).toBe('over');
    expect(cells[0]?.textContent).toBe('Gap0');
  });

  it('colours a gap only for an hour seen in the feed; a modelled hour’s gap is in the axis colour', () => {
    const { columns } = buildHourChartModel({ hours: routeHourlyFixture().hours, currentHour: 11 });
    const fillAt = (hour: number): string | null | undefined => {
      act(() =>
        root.render(
          <svg>
            <GapTick x={100} y={10} width={240} column={columns[hour]} />
          </svg>,
        ),
      );
      return Array.from(container.querySelectorAll('text')).pop()?.getAttribute('fill');
    };
    expect(fillAt(7)).toBe(GAP_COLOUR.short);
    expect(fillAt(11)).toBe(GAP_COLOUR.over);
    expect(fillAt(17)).toBe(HOUR_COLOUR.axisText);
    expect(fillAt(2)).toBe(HOUR_COLOUR.axisText);
    expect(container.querySelector('[data-testid="hour-gap-cell"]')?.getAttribute('data-seen')).toBe('false');
  });

  it('says in the legend that gaps in modelled hours are modelled', () => {
    render();
    const legend = container.querySelector('[data-testid="hour-legend"]')?.textContent ?? '';
    expect(legend).toContain('gaps in modelled hours are modelled');
  });

  it('puts every other gap a line lower when the row is staggered, the first line unchanged', () => {
    const { columns } = buildHourChartModel({ hours: routeHourlyFixture().hours, currentHour: 11 });
    const baseline = (hour: number, staggered: boolean): string | null | undefined => {
      act(() =>
        root.render(
          <svg>
            <GapTick x={100} y={10} width={240} column={columns[hour]} staggered={staggered} />
          </svg>,
        ),
      );
      return Array.from(container.querySelectorAll('text')).pop()?.getAttribute('y');
    };
    expect(baseline(6, true)).toBe(baseline(6, false));
    expect(Number(baseline(7, true))).toBeGreaterThan(Number(baseline(7, false)));
    expect(baseline(7, false)).toBe(baseline(6, false));
  });

  it('names the chart for a screen reader and marks the current hour', () => {
    render();
    const plot = container.querySelector('[data-testid="hour-chart-plot"]');
    expect(plot?.getAttribute('role')).toBe('img');
    expect(plot?.getAttribute('aria-label')).toBe(
      'KANPUR-LUCKNOW by hour on 6 Oct 2026: bars for the buses deployed, lines for the buses scheduled and needed, and the gap under each hour. Show as table lists every figure.',
    );
    expect(container.textContent).toContain('Now');
    expect(container.querySelector('pattern')).not.toBeNull();
  });

  it('draws the scheduled and needed lines over a page-coloured casing that reads on a solid bar', () => {
    render();
    const strokes = Array.from(container.querySelectorAll('path.recharts-line-curve')).map((p) => [
      p.getAttribute('stroke'),
      p.getAttribute('stroke-width'),
    ]);
    expect(strokes).toEqual([
      [HOUR_COLOUR.casing, String(CASING_WIDTH)],
      [HOUR_COLOUR.scheduled, String(LINE_WIDTH)],
      [HOUR_COLOUR.casing, String(CASING_WIDTH)],
      [HOUR_COLOUR.needed, String(LINE_WIDTH)],
    ]);
    expect(HOUR_COLOUR.casing).toBe(DEPOT_PALETTE.page);
    for (const line of [HOUR_COLOUR.scheduled, HOUR_COLOUR.needed]) {
      expect(contrast(line, HOUR_COLOUR.casing)).toBeGreaterThanOrEqual(3);
    }
    // The casing itself stands out from the bar it crosses.
    expect(contrast(HOUR_COLOUR.deployed, HOUR_COLOUR.casing)).toBeGreaterThanOrEqual(3);
  });

  it('has a legend in words for every mark', () => {
    render();
    const legend = container.querySelector('[data-testid="hour-legend"]')?.textContent ?? '';
    for (const word of ['Deployed, observed', 'Deployed, modelled day', 'Not observed', 'Scheduled', 'Needed', 'Now', 'Gap row']) {
      expect(legend).toContain(word);
    }
  });

  it('never calls the current hour observed when the server has observed nothing', () => {
    render(routeHourlyFixture({ observed: null }));
    const legend = container.querySelector('[data-testid="hour-legend"]')?.textContent ?? '';
    expect(legend).toContain('Deployed now, from the feed');
    expect(legend).not.toMatch(/Deployed, observed/);
  });

  it('drops the now marker without a feed clock', () => {
    render(routeHourlyFixture({ currentHour: null }));
    const legend = container.querySelector('[data-testid="hour-legend"]')?.textContent ?? '';
    expect(legend).not.toContain('Now');
  });

  it('swaps to a 24-row table and back, the toggle saying what it will show next', () => {
    render();
    const toggle = toggleButton();
    expect(toggle?.textContent).toBe('Show as table');
    expect(toggle?.getAttribute('aria-controls')).toBeTruthy();
    act(() => toggle?.click());
    expect(toggle?.textContent).toBe('Show as chart');
    // The words change with the view, so the button carries no pressed state as well.
    expect(toggle?.hasAttribute('aria-pressed')).toBe(false);
    expect(container.querySelectorAll('tbody tr')).toHaveLength(24);
    expect(container.textContent).toContain('Not observed');
    expect(container.querySelector('[data-testid="hour-chart-plot"]')).toBeNull();
    act(() => toggle?.click());
    expect(container.querySelector('[data-testid="hour-chart-plot"]')).not.toBeNull();
  });

  it('says the gap in words, shows the needed range and the delay caveat in the table view', () => {
    render();
    act(() => toggleButton()?.click());
    const headers = Array.from(container.querySelectorAll('th')).map((th) => th.textContent ?? '');
    expect(headers.some((h) => h.startsWith('Range'))).toBe(true);
    const row8 = container.querySelectorAll('tbody tr')[8]?.textContent ?? '';
    expect(row8).toContain('+4 Short by 4');
    expect(row8).toContain('9.8 to 16.3');
    expect(container.textContent).toContain('Delay is the feed’s own figure; its unit is unconfirmed.');
  });

  it('shows no banned word or raw date, as chart or table', () => {
    render();
    expect(bannedOnScreen(container)).toEqual([]);
    act(() => toggleButton()?.click());
    expect(bannedOnScreen(container)).toEqual([]);
  });
});
