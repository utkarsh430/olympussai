import { act, cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HourChart } from '@/components/depot/hourChart/HourChart';
import { GapTick } from '@/components/depot/hourChart/HourPlotParts';
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
    expect(plot?.getAttribute('aria-label')).toContain('6 Oct 2026');
    expect(container.textContent).toContain('Now');
    expect(container.querySelector('pattern')).not.toBeNull();
  });

  it('has a legend in words for every mark', () => {
    render();
    const legend = container.querySelector('[data-testid="hour-legend"]')?.textContent ?? '';
    for (const word of ['Deployed, observed', 'Deployed, modelled day', 'Not observed', 'Scheduled', 'Needed', 'Now', 'Gap row']) {
      expect(legend).toContain(word);
    }
  });

  it('drops the now marker without a feed clock', () => {
    render(routeHourlyFixture({ currentHour: null }));
    const legend = container.querySelector('[data-testid="hour-legend"]')?.textContent ?? '';
    expect(legend).not.toContain('Now');
  });

  it('swaps to a 24-row table and back with one pressed toggle', () => {
    render();
    const toggle = container.querySelector<HTMLButtonElement>('button[aria-pressed]');
    expect(toggle?.textContent).toBe('Show as table');
    act(() => toggle?.click());
    expect(toggle?.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelectorAll('tbody tr')).toHaveLength(24);
    expect(container.textContent).toContain('Not observed');
    expect(container.querySelector('[data-testid="hour-chart-plot"]')).toBeNull();
    act(() => toggle?.click());
    expect(container.querySelector('[data-testid="hour-chart-plot"]')).not.toBeNull();
  });

  it('shows no banned word or raw date, as chart or table', () => {
    render();
    expect(bannedOnScreen(container)).toEqual([]);
    act(() => container.querySelector<HTMLButtonElement>('button[aria-pressed]')?.click());
    expect(bannedOnScreen(container)).toEqual([]);
  });
});
