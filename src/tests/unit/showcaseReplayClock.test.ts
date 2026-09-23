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