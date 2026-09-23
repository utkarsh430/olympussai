// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

/**
 * The whole /trial page over the COMMITTED generated data, with the browser
 * APIs jsdom lacks stubbed and the two things that cannot run here mocked:
 * recharts, which measures 0 in jsdom, and the Google basemap.
 */
vi.mock('@/components/showcase/Sparkline', () => ({
  Sparkline: () => <div data-testid="sparkline" />,
}));
// No Maps key in the test runner, whatever the machine's env holds: the live
// scene takes its tactical-canvas fallback, which is the path jsdom can draw.
vi.mock('@/lib/maps/loader', () => ({
  MAPS_API_KEY: '',
  isMapsConfigured: () => false,
  getMapsLoader: () => {
    throw new Error('not configured in tests');
  },
  onMapsAuthFailure: () => () => {},
}));

import TrialPage, { SHOWCASE_SCENES } from '@/app/(showcase)/trial/page';

const originalGetContext = HTMLCanvasElement.prototype.getContext;

beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: false,
      media: '',
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    })),
  );
  class NoopObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  vi.stubGlobal('IntersectionObserver', NoopObserver);
  vi.stubGlobal('ResizeObserver', NoopObserver);
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  HTMLCanvasElement.prototype.getContext = (() =>
    new Proxy(
      {},
      { get: () => () => undefined },
    )) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

afterEach(() => {
  vi.unstubAllGlobals();
  HTMLCanvasElement.prototype.getContext = originalGetContext;
});

describe('the trial showcase page', () => {
  it('renders one scene per entry in the scene list, in order, each identifiable', () => {
    const { container } = render(<TrialPage />);
    const scenes = Array.from(container.querySelectorAll('[data-scene]'));
    expect(scenes.map((scene) => scene.id)).toEqual(SHOWCASE_SCENES.map((scene) => scene.id));
    expect(scenes).toHaveLength(8);
  });

  it('opens on the trial and answers before it explains', () => {
    const { container } = render(<TrialPage />);
    expect(screen.getByText(/One controller\./)).toBeInTheDocument();
    const verdict = container.querySelector('#verdict');
    expect(verdict).not.toBeNull();
    expect(within(verdict as HTMLElement).getByText('The controller helped.')).toBeInTheDocument();
  });

  it('offers to present, and shows every scenario card off the real data', () => {
    const { container } = render(<TrialPage />);
    expect(screen.getByRole('button', { name: /present/i })).toBeInTheDocument();
    const gallery = container.querySelector('#scenarios');
    expect(gallery).not.toBeNull();
    expect(within(gallery as HTMLElement).getAllByTestId('sparkline').length).toBe(19);
  });

  it('draws the Lucknow corridors on the tactical map, all three routes offered', () => {
    render(<TrialPage />);
    expect(screen.getAllByText(/Lucknow/).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /inter-city trunk/i }).length).toBeGreaterThan(0);
  });

  it('closes on a report with a reference, every corridor row, and an export', () => {
    const { container } = render(<TrialPage />);
    const report = container.querySelector('#report');
    expect(report).not.toBeNull();
    const inReport = within(report as HTMLElement);
    expect(inReport.getByText(/^FT-\d{8}-03$/)).toBeInTheDocument();
    expect(inReport.getAllByText(/City trunk/).length).toBeGreaterThan(0);
    expect(inReport.getAllByText(/Inter-city trunk/).length).toBeGreaterThan(0);
    expect(inReport.getByRole('button', { name: /export as pdf/i })).toBeInTheDocument();
  });

  it('carries no provenance labelling anywhere', () => {
    const { container } = render(<TrialPage />);
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/PROJECTED/);
    expect(text).not.toMatch(/prototype/i);
    expect(text).not.toMatch(/illustrative/i);
    expect(text).not.toMatch(/not operational data/i);
  });
});
