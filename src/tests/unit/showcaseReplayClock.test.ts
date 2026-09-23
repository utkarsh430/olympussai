// @vitest-environment jsdom
//
// The replay clock's reducer, and a smoke render of the canvases that
// consume it.
//
// The reducer is pure and needs no DOM; it lives in this jsdom file only
// because vitest allows one environment per file and the canvas smoke tests
// need a document. Those exist to prove that `TacticalMap`, `ReplayLanes`
// and the whole `LiveTrialScene` mount and draw without a real 2D context
// or a ResizeObserver - which is exactly the environment a server-rendered
// page hydrates into before either arrives - and that the corridor picker
// switches the route, the scenario and the clock together.
//
// The scene mounts `CorridorMap`, which draws on Google's basemap when a key
// is configured and falls back to `TacticalMap` when it is not. The loader
// is mocked as UNCONFIGURED here, whatever the environment holds, so these
// tests exercise the fallback path and the tactical canvas is what mounts.
// The basemap path has its own suite in showcaseCorridorMap.test.tsx.

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  DEFAULT_REPLAY_SPEED,
  REPLAY_SPEEDS,
  initialReplayClock,
  replayReducer,
  type ReplayClock,
} from '@/lib/showcase/replayClock';
import { LUCKNOW_CORRIDOR, SUBURBAN_CORRIDOR } from '@/lib/showcase/corridor';
import { frameAt, type ReplayContext } from '@/lib/showcase/replayFrame';
import type {
  LiveCorridorModel,
  LiveTrialModel,
  ReplayScenarioModel,
} from '@/lib/showcase/resolve';
import { ReplayLanes, hourTickStep } from '@/components/showcase/ReplayLanes';
import { TacticalMap, labelEvery } from '@/components/showcase/TacticalMap';
import {
  LiveTrialScene,
  defaultCorridorIndex,
  formatCutPercent,
  formatSignedPercent,
  formatSimClock,
} from '@/components/showcase/LiveTrialScene';

// No basemap in this file, whatever `.env.local` holds: `CorridorMap` then
// mounts `TacticalMap` and the scene tests below see the tactical canvas.
vi.mock('@/lib/maps/loader', () => ({
  isMapsConfigured: () => false,
  mapsAuthFailed: () => false,
  onMapsAuthFailure: () => () => {},
  getMapsLoader: () => {
    throw new Error('the loader must not be constructed when no key is configured');
  },
}));

describe('replayReducer', () => {
  const start = (): ReplayClock => initialReplayClock(1000);

  it('starts at zero, playing, at the default speed', () => {
    const clock = start();
    expect(clock).toEqual({ t: 0, playing: true, speed: DEFAULT_REPLAY_SPEED, horizon: 1000 });
    expect(REPLAY_SPEEDS).toContain(clock.speed);
    expect(initialReplayClock(500, { playing: false, speed: 30 })).toEqual({
      t: 0,
      playing: false,
      speed: 30,
      horizon: 500,
    });
  });

  it('advances by delta x speed while playing, and not while paused', () => {
    const playing = replayReducer(start(), { type: 'tick', deltaSeconds: 0.5 });
    expect(playing.t).toBe(0.5 * DEFAULT_REPLAY_SPEED);

    const paused = replayReducer(start(), { type: 'pause' });
    expect(replayReducer(paused, { type: 'tick', deltaSeconds: 0.5 })).toBe(paused);
  });

  it('wraps to zero past the horizon and keeps playing', () => {
    const nearEnd = replayReducer(start(), { type: 'seek', t: 990 });
    const wrapped = replayReducer(nearEnd, { type: 'tick', deltaSeconds: 1 });
    expect(wrapped.t).toBe(0);
    expect(wrapped.playing).toBe(true);
    // Landing exactly on the horizon is not past it.
    const onEnd = replayReducer(replayReducer(start(), { type: 'setSpeed', speed: 10 }), {
      type: 'tick',
      deltaSeconds: 100,
    });
    expect(onEnd.t).toBe(1000);
  });

  it('clamps a seek to the horizon', () => {
    expect(replayReducer(start(), { type: 'seek', t: -5 }).t).toBe(0);
    expect(replayReducer(start(), { type: 'seek', t: 5000 }).t).toBe(1000);
    expect(replayReducer(start(), { type: 'seek', t: 250 }).t).toBe(250);
    expect(replayReducer(start(), { type: 'seek', t: Number.NaN }).t).toBe(0);
  });

  it('changes speed, refusing nonsense', () => {
    expect(replayReducer(start(), { type: 'setSpeed', speed: 240 }).speed).toBe(240);
    const clock = start();
    expect(replayReducer(clock, { type: 'setSpeed', speed: 0 })).toBe(clock);
    expect(replayReducer(clock, { type: 'setSpeed', speed: -1 })).toBe(clock);
  });

  it('toggles, plays and pauses', () => {
    const clock = start();
    const paused = replayReducer(clock, { type: 'toggle' });
    expect(paused.playing).toBe(false);
    expect(replayReducer(paused, { type: 'play' }).playing).toBe(true);
    expect(replayReducer(paused, { type: 'pause' })).toBe(paused);
    expect(replayReducer(clock, { type: 'play' })).toBe(clock);
  });

  it('keeps t inside a new horizon and resets to zero', () => {
    const late = replayReducer(start(), { type: 'seek', t: 900 });
    const shrunk = replayReducer(late, { type: 'setHorizon', horizon: 600 });
    expect(shrunk).toEqual({ ...late, horizon: 600, t: 600 });
    expect(replayReducer(late, { type: 'setHorizon', horizon: 1000 })).toBe(late);
    expect(replayReducer(late, { type: 'reset' }).t).toBe(0);
    const atZero = start();
    expect(replayReducer(atZero, { type: 'reset' })).toBe(atZero);
  });

  it('returns the identical object when nothing changes', () => {
    const clock = start();
    expect(replayReducer(clock, { type: 'seek', t: 0 })).toBe(clock);
    expect(replayReducer(clock, { type: 'setSpeed', speed: DEFAULT_REPLAY_SPEED })).toBe(clock);
    expect(replayReducer(clock, { type: 'tick', deltaSeconds: 0 })).toBe(clock);
    expect(replayReducer(clock, { type: 'tick', deltaSeconds: -1 })).toBe(clock);
  });

  it('never produces a NaN', () => {
    const clock = start();
    expect(replayReducer(clock, { type: 'tick', deltaSeconds: Number.NaN })).toBe(clock);
    expect(initialReplayClock(Number.NaN).horizon).toBe(0);
  });
});

describe('formatting on the scene', () => {
  it('formats the sim clock from 06:00 and rolls past midnight', () => {
    expect(formatSimClock(0)).toBe('06:00');
    expect(formatSimClock(59)).toBe('06:00');
    expect(formatSimClock(25_000)).toBe('12:56');
    expect(formatSimClock(18 * 3600 + 60)).toBe('00:01');
    // An inter-city window can run most of a day: 06:00 plus twenty hours is
    // 02:00 the next morning, never 26:00.
    expect(formatSimClock(20 * 3600)).toBe('02:00');
    expect(formatSimClock(36 * 3600 + 30 * 60)).toBe('18:30');
  });

  it('formats savings with a sign and cuts as negatives', () => {
    expect(formatSignedPercent(3.14)).toBe('+3.1%');
    expect(formatSignedPercent(-0.4)).toBe('−0.4%');
    expect(formatSignedPercent(null)).toBe('—');
    expect(formatCutPercent(40.4)).toBe('−40%');
    expect(formatCutPercent(-12)).toBe('+12%');
    expect(formatCutPercent(null)).toBe('—');
  });
});

describe('the pure layout rules', () => {
  it('opens on the city trunk wherever it sits in the list, else on the first corridor', () => {
    const at = (presetId: string) => ({ presetId }) as LiveCorridorModel;
    expect(defaultCorridorIndex([at('suburban'), at('urban'), at('intercity')])).toBe(1);
    expect(defaultCorridorIndex([at('suburban'), at('intercity')])).toBe(0);
    expect(defaultCorridorIndex([])).toBe(0);
  });

  it('names every station on a short route, every second on a medium one, and thins a long one by width', () => {
    expect(labelEvery(10, 600)).toBe(1);
    expect(labelEvery(12, 600)).toBe(1);
    expect(labelEvery(15, 600)).toBe(2);
    expect(labelEvery(16, 1400)).toBe(2);
    expect(labelEvery(25, 1400)).toBe(2);
    expect(labelEvery(25, 800)).toBe(4);
  });

  it('labels every hour on a short window and thins the ticks on a long or narrow one', () => {
    // 2.6 h across 616 px: 237 px per hour, every hour fits.
    expect(hourTickStep(2.6 * 3600, 616)).toBe(1);
    // 10 h across 616 px: 62 px per hour, still every hour.
    expect(hourTickStep(10 * 3600, 616)).toBe(1);
    // 10 h across 300 px: 30 px per hour, every second hour.
    expect(hourTickStep(10 * 3600, 300)).toBe(2);
    // 20 h across 300 px: every third hour.
    expect(hourTickStep(20 * 3600, 300)).toBe(3);
    // Degenerate inputs never divide by zero.
    expect(hourTickStep(0, 616)).toBe(1);
    expect(hourTickStep(3600, 0)).toBe(1);
  });
});

// ─── Smoke renders ────────────────────────────────────────────────────────

const SCENARIO: ReplayScenarioModel = {
  id: 'steady_variability',
  title: 'Steady variability',
  note: 'Ordinary running-time noise.',
  horizonSeconds: 4000,
  vehicleCount: 2,
  trajectories: {
    controlled: [
      {
        vehicleId: 'bus-1',
        points: [
          { t: 0, d: 0, hold: 0 },
          { t: 1000, d: 1000, hold: 0 },
          { t: 2000, d: 2000, hold: 0 },
        ],
      },
      {
        vehicleId: 'bus-2',
        points: [
          { t: 300, d: 0, hold: 0 },
          { t: 1100, d: 1000, hold: 60 },
          { t: 2000, d: 2000, hold: 0 },
        ],
      },
    ],
    uncontrolled: [
      {
        vehicleId: 'bus-1',
        points: [
          { t: 0, d: 0, hold: 0 },
          { t: 1000, d: 1000, hold: 0 },
        ],
      },
    ],
  },
  sweeps: {
    controlled: [{ atSeconds: 0, openIncidents: 1, bunchedPairs: 1, liveVehicles: 2 }],
    uncontrolled: [],
  },
  netPercent: 3.1,
  excessWaitPercent: 40,
  incidentsAvoided: 2,
};

const SECOND: ReplayScenarioModel = { ...SCENARIO, id: 'slow_bus', title: 'Slow bus' };

/** The same shape stretched over a much longer window, as a longer corridor's is. */
const LONG: ReplayScenarioModel = {
  ...SCENARIO,
  id: 'traffic_shock',
  title: 'Traffic shock',
  horizonSeconds: 40_000,
  trajectories: {
    controlled: [
      {
        vehicleId: 'bus-1',
        points: [
          { t: 0, d: 0, hold: 0 },
          { t: 4500, d: 30_000, hold: 0 },
          { t: 9000, d: 60_000, hold: 0 },
        ],
      },
    ],
    uncontrolled: [
      {
        vehicleId: 'bus-1',
        points: [
          { t: 0, d: 0, hold: 0 },
          { t: 9000, d: 60_000, hold: 0 },
        ],
      },
    ],
  },
};

const CTX: ReplayContext = {
  route: LUCKNOW_CORRIDOR,
  trialCorridorLengthMeters: 24_000,
  targetHeadwaySeconds: 360,
  bunchedThresholdRatio: 0.25,
  warningThresholdRatio: 0.5,
};

const URBAN: LiveCorridorModel = {
  presetId: 'urban',
  name: 'City trunk',
  shape: '24 km · 25 stops · 6-minute headway',
  netPercent: 2.9,
  excessWaitPercent: 46,
  route: LUCKNOW_CORRIDOR,
  trialCorridorLengthMeters: 24_000,
  targetHeadwaySeconds: 360,
  bunchedThresholdRatio: 0.25,
  warningThresholdRatio: 0.5,
  stationNames: LUCKNOW_CORRIDOR.stops.map((stop) => stop.name),
  scenarios: [SCENARIO, SECOND],
};

const SUBURBAN: LiveCorridorModel = {
  presetId: 'suburban',
  name: 'Suburban radial',
  shape: '60 km · 15 stops · 12-minute headway',
  netPercent: 0.5,
  excessWaitPercent: 38,
  route: SUBURBAN_CORRIDOR,
  trialCorridorLengthMeters: 60_000,
  targetHeadwaySeconds: 720,
  bunchedThresholdRatio: 0.25,
  warningThresholdRatio: 0.5,
  stationNames: SUBURBAN_CORRIDOR.stops.map((stop) => stop.name),
  scenarios: [LONG, SECOND],
};

// The suburban corridor is listed FIRST so that opening on the city trunk
// proves the preset rule rather than "index zero".
const MODEL: LiveTrialModel = { corridors: [SUBURBAN, URBAN] };

describe('the canvases mount without a real 2D context', () => {
  const previousGetContext = HTMLCanvasElement.prototype.getContext;
  const previousMatchMedia = window.matchMedia;
  let contextCalls = 0;

  beforeAll(() => {
    // Every context method is a no-op and every property is assignable, so a
    // draw routine runs end to end and we only learn whether it THROWS.
    const noop = () => undefined;
    const state: Record<string | symbol, unknown> = {};
    const proxy = new Proxy(state, {
      get(target, prop) {
        if (prop in target) return target[prop];
        return noop;
      },
    });
    HTMLCanvasElement.prototype.getContext = function getContext() {
      contextCalls += 1;
      return proxy as unknown as CanvasRenderingContext2D;
    } as unknown as typeof HTMLCanvasElement.prototype.getContext;

    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;

    class NoopResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', NoopResizeObserver);
    // The loops must not run between tests; a frame is never delivered.
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });

  afterEach(() => {
    contextCalls = 0;
  });

  afterAll(() => {
    HTMLCanvasElement.prototype.getContext = previousGetContext;
    window.matchMedia = previousMatchMedia;
    vi.unstubAllGlobals();
  });

  it('renders the tactical map for a frame with a hold and a bunched pair', () => {
    const frame = frameAt(SCENARIO, 'controlled', 1150, CTX);
    expect(frame.holds).toHaveLength(1);
    const onSelect = vi.fn();
    const { container } = render(
      createElement(TacticalMap, {
        route: LUCKNOW_CORRIDOR,
        frame,
        arm: 'controlled',
        followedId: 'bus-2',
        onSelect,
      }),
    );
    const canvas = container.querySelector('canvas');
    expect(canvas).not.toBeNull();
    expect(canvas?.getAttribute('aria-label')).toContain('Under control');
    expect(contextCalls).toBeGreaterThan(0);
    // A click with no bus near it selects nothing.
    fireEvent.click(canvas as HTMLCanvasElement, { clientX: -500, clientY: -500 });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('renders the lanes with both arms named and a scrub that seeks', () => {
    const onSeek = vi.fn();
    const { container } = render(
      createElement(ReplayLanes, {
        scenario: SCENARIO,
        t: 1500,
        windowStart: 600,
        windowEnd: 4000,
        trialCorridorLengthMeters: 24_000,
        stationNames: URBAN.stationNames,
        onSeek,
      }),
    );
    expect(screen.getByText('Left alone')).toBeInTheDocument();
    expect(screen.getByText('Under control')).toBeInTheDocument();
    expect(container.querySelector('.sc-panel')).not.toBeNull();
    const scrub = screen.getByLabelText('Scrub the replay') as HTMLInputElement;
    // The scrub spans the window, in absolute trial seconds.
    expect(scrub.min).toBe('600');
    expect(scrub.max).toBe('4000');
    expect(scrub.style.accentColor).toBe('hsl(var(--primary))');
    fireEvent.change(scrub, { target: { value: '2400' } });
    expect(onSeek).toHaveBeenCalledWith(2400);
  });

  it('draws a long window without throwing, ticks thinned', () => {
    render(
      createElement(ReplayLanes, {
        scenario: LONG,
        t: 20_000,
        windowStart: 0,
        windowEnd: 10 * 3600,
        trialCorridorLengthMeters: 60_000,
        stationNames: SUBURBAN.stationNames,
        onSeek: vi.fn(),
      }),
    );
    expect(contextCalls).toBeGreaterThan(0);
    expect((screen.getByLabelText('Scrub the replay') as HTMLInputElement).max).toBe('36000');
  });

  it('windows the replay to the sampled buses and shows the absolute trial time', () => {
    // Every point 7,920 s later, as the generated data has it: the window
    // opens 300 s before the first dispatch, at 08:07 on the sim clock.
    const shift = (scenario: ReplayScenarioModel): ReplayScenarioModel => ({
      ...scenario,
      trajectories: {
        controlled: scenario.trajectories.controlled.map((trajectory) => ({
          ...trajectory,
          points: trajectory.points.map((point) => ({ ...point, t: point.t + 7920 })),
        })),
        uncontrolled: scenario.trajectories.uncontrolled.map((trajectory) => ({
          ...trajectory,
          points: trajectory.points.map((point) => ({ ...point, t: point.t + 7920 })),
        })),
      },
    });
    render(
      createElement(LiveTrialScene, {
        model: { corridors: [{ ...URBAN, scenarios: [shift(SCENARIO)] }] },
      }),
    );
    expect(screen.getByText('08:07')).toBeInTheDocument();
    const scrub = screen.getByLabelText('Scrub the replay') as HTMLInputElement;
    expect(scrub.min).toBe(String(7920 - 300));
    expect(scrub.max).toBe(String(7920 + 2000 + 120));
    // Seeking to an absolute time is what the readout then shows.
    fireEvent.change(scrub, { target: { value: String(7920 + 1800) } });
    expect(screen.getByText('08:42')).toBeInTheDocument();
  });

  it('renders the whole scene on the tactical plot', () => {
    const { container } = render(createElement(LiveTrialScene, { model: MODEL }));
    expect(screen.getByText('Route 41 · Alambagh – Hazratganj – Chinhat')).toBeInTheDocument();
    expect(screen.getByText(/Live trial · Lucknow/)).toBeInTheDocument();

    const controlled = screen.getByRole('button', { name: 'Under control' });
    const alone = screen.getByRole('button', { name: 'Left alone' });
    expect(controlled).toHaveAttribute('aria-pressed', 'true');
    expect(alone).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(alone);
    expect(alone).toHaveAttribute('aria-pressed', 'true');

    const slow = screen.getByRole('button', { name: 'Slow bus' });
    expect(slow).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(slow);
    expect(slow).toHaveAttribute('aria-pressed', 'true');

    const pause = screen.getByRole('button', { name: 'Pause the replay' });
    expect(pause.className).toContain('sc-button-primary');
    fireEvent.click(pause);
    expect(screen.getByRole('button', { name: 'Play the replay' })).toBeInTheDocument();

    const fast = screen.getByRole('button', { name: '240×' });
    expect(fast).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(fast);
    expect(fast).toHaveAttribute('aria-pressed', 'true');

    expect(screen.getByText('Sim clock')).toBeInTheDocument();
    // The first dispatch is at 0, so the window is floored at 06:00 and runs
    // to 120 s after the last bus finishes.
    expect(screen.getByText('06:00')).toBeInTheDocument();
    expect((screen.getByLabelText('Scrub the replay') as HTMLInputElement).max).toBe('2120');
    // The scenario's own figures, on the transport bar...
    expect(screen.getByText('+3.1%')).toBeInTheDocument();
    expect(screen.getByText('−40%')).toBeInTheDocument();
    // ...and the corridor's, in the route panel.
    expect(screen.getByText('+2.9%')).toBeInTheDocument();
    expect(screen.getByText('−46%')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /buses on Route 41/ })).toBeInTheDocument();
    // The quiet theme's surfaces, and nothing of the console's.
    expect(container.querySelectorAll('.sc-panel').length).toBeGreaterThanOrEqual(3);
    expect(container.querySelector('canvas')).not.toBeNull();
  });

  it('lays the controls beside the plot, never over it', () => {
    render(createElement(LiveTrialScene, { model: MODEL }));
    const left = screen.getByRole('region', { name: 'Live trial' });
    const canvas = screen.getByRole('img', { name: /buses on Route 41/ });
    const mapPanel = canvas.closest('.sc-panel');
    expect(mapPanel).not.toBeNull();
    // Siblings in the layout: neither contains the other, and the map sits
    // in the column next to the panel rather than inside it.
    expect(left.contains(mapPanel as Element)).toBe(false);
    expect((mapPanel as Element).contains(left)).toBe(false);
    expect(left.nextElementSibling?.contains(mapPanel as Element)).toBe(true);
    // The lanes share the map's column, beneath it.
    const lanes = screen.getByLabelText('Scrub the replay').closest('.sc-panel');
    expect(left.nextElementSibling?.contains(lanes as Element)).toBe(true);
    expect((mapPanel as Element).contains(lanes as Element)).toBe(false);
  });

  it('offers one button per corridor and opens on the city trunk', () => {
    render(createElement(LiveTrialScene, { model: MODEL }));
    const picker = screen.getByRole('group', { name: 'Corridor' });
    const buttons = Array.from(picker.querySelectorAll('button'));
    expect(buttons).toHaveLength(2);
    const suburban = screen.getByRole('button', { name: /^Suburban radial/ });
    const urban = screen.getByRole('button', { name: /^City trunk/ });
    expect(urban).toHaveAttribute('aria-pressed', 'true');
    expect(suburban).toHaveAttribute('aria-pressed', 'false');
    // The shape rides along as the button's small label.
    expect(suburban).toHaveTextContent('60 km · 15 stops · 12-minute headway');
  });

  it('switching corridor changes the route, resets the scenario and the followed bus', () => {
    render(createElement(LiveTrialScene, { model: MODEL }));
    // Move off the first scenario on the city trunk first.
    fireEvent.click(screen.getByRole('button', { name: 'Slow bus' }));
    expect(screen.getByRole('button', { name: 'Slow bus' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    fireEvent.click(screen.getByRole('button', { name: /^Suburban radial/ }));
    expect(screen.getByRole('button', { name: /^Suburban radial/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: /^City trunk/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByText('Route 22 · Alambagh – Kanpur Road – Unnao')).toBeInTheDocument();
    expect(screen.queryByText('Route 41 · Alambagh – Hazratganj – Chinhat')).toBeNull();
    // The suburban corridor's first scenario is selected, not the second.
    expect(screen.getByRole('button', { name: 'Traffic shock' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Slow bus' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    // And the corridor's own readings follow it.
    expect(screen.getByText('+0.5%')).toBeInTheDocument();
    expect(screen.getByText('−38%')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /buses on Route 22/ })).toBeInTheDocument();
  });

  it('re-spans the scrub to the selected corridor', () => {
    render(createElement(LiveTrialScene, { model: MODEL }));
    const scrub = () => screen.getByLabelText('Scrub the replay') as HTMLInputElement;
    expect(scrub().max).toBe('2120');
    fireEvent.click(screen.getByRole('button', { name: /^Suburban radial/ }));
    expect(scrub().max).toBe(String(9000 + 120));
    expect(scrub().value).toBe('0');
    fireEvent.click(screen.getByRole('button', { name: /^City trunk/ }));
    expect(scrub().max).toBe('2120');
  });

  it('keeps the picker when a route has nothing to replay yet', () => {
    render(
      createElement(LiveTrialScene, {
        model: { corridors: [URBAN, { ...SUBURBAN, scenarios: [] }] },
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: /^Suburban radial/ }));
    expect(screen.getByText('No replay data for this route')).toBeInTheDocument();
    expect(screen.getByText('Route 22 · Alambagh – Kanpur Road – Unnao')).toBeInTheDocument();
    expect(screen.queryByLabelText('Scrub the replay')).toBeNull();
    // The way back is still on screen.
    fireEvent.click(screen.getByRole('button', { name: /^City trunk/ }));
    expect(screen.getByLabelText('Scrub the replay')).toBeInTheDocument();
  });

  it('says so quietly when there is nothing to replay', () => {
    const { container } = render(createElement(LiveTrialScene, { model: { corridors: [] } }));
    expect(screen.getByText('No replay data')).toBeInTheDocument();
    expect(container.querySelector('.sc-panel')).not.toBeNull();
  });
});
