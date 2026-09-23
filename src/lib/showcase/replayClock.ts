/**
 * The replay's clock, as a pure reducer.
 *
 * The live trial scene plays a scenario's ~25,000 simulated seconds back in
 * a few real minutes. Everything about that playback - whether it is
 * running, how fast, where it is, where it wraps - is one small state and
 * one reducer, so the transport buttons, the scrub bar and the animation
 * loop all change it the same way and a test can drive it without a
 * browser.
 *
 * The reducer returns the SAME object when an action changes nothing, so a
 * `useReducer` caller re-renders only on a real change: a `tick` while
 * paused, a `seek` to where the clock already is, or a `setSpeed` to the
 * current speed all cost nothing downstream.
 *
 * Pure: no clock of its own, no timers. The caller supplies the real-time
 * delta on every `tick`.
 */

export interface ReplayClock {
  /** Simulated seconds since the scenario started. */
  t: number;
  playing: boolean;
  /** Simulated seconds advanced per real second. */
  speed: number;
  /** The scenario's horizon in simulated seconds; `t` wraps past it. */
  horizon: number;
}

/** Simulated seconds per real second. 120x plays a 25,000 s scenario in about 3.5 minutes. */
export const REPLAY_SPEEDS = [30, 60, 120, 240] as const;
export type ReplaySpeed = (typeof REPLAY_SPEEDS)[number];

export const DEFAULT_REPLAY_SPEED: ReplaySpeed = 120;

export type ReplayAction =
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'toggle' }
  | { type: 'seek'; t: number }
  | { type: 'setSpeed'; speed: number }
  | { type: 'tick'; deltaSeconds: number }
  | { type: 'setHorizon'; horizon: number }
  | { type: 'reset' };

function clampTime(t: number, horizon: number): number {
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.min(horizon, t));
}

function sanitiseHorizon(horizon: number): number {
  return Number.isFinite(horizon) && horizon > 0 ? horizon : 0;
}

/** A clock at zero. Plays by default at 120x; the caller passes `playing: false` under reduced motion. */
export function initialReplayClock(
  horizon: number,
  options: { playing?: boolean; speed?: number } = {},
): ReplayClock {
  const speed =
    options.speed !== undefined && Number.isFinite(options.speed) && options.speed > 0
      ? options.speed
      : DEFAULT_REPLAY_SPEED;
  return {
    t: 0,
    playing: options.playing ?? true,
    speed,
    horizon: sanitiseHorizon(horizon),
  };
}

/**
 * Apply one action.
 *
 * Invariants: `0 <= t <= horizon` always holds; a `tick` advances only while
 * playing and wraps to zero past the horizon without pausing, so the replay
 * loops; nothing here can produce a NaN.
 */
export function replayReducer(clock: ReplayClock, action: ReplayAction): ReplayClock {
  switch (action.type) {
    case 'play':
      return clock.playing ? clock : { ...clock, playing: true };
    case 'pause':
      return clock.playing ? { ...clock, playing: false } : clock;
    case 'toggle':
      return { ...clock, playing: !clock.playing };
    case 'seek': {
      const t = clampTime(action.t, clock.horizon);
      return t === clock.t ? clock : { ...clock, t };
    }
    case 'setSpeed': {
      if (!Number.isFinite(action.speed) || action.speed <= 0) return clock;
      return action.speed === clock.speed ? clock : { ...clock, speed: action.speed };
    }
    case 'tick': {
      if (!clock.playing) return clock;
      if (!Number.isFinite(action.deltaSeconds) || action.deltaSeconds <= 0) return clock;
      const advanced = clock.t + action.deltaSeconds * clock.speed;
      const t = advanced > clock.horizon ? 0 : advanced;
      return t === clock.t ? clock : { ...clock, t };
    }
    case 'setHorizon': {
      const horizon = sanitiseHorizon(action.horizon);
      if (horizon === clock.horizon) return clock;
      return { ...clock, horizon, t: clampTime(clock.t, horizon) };
    }
    case 'reset':
      return clock.t === 0 ? clock : { ...clock, t: 0 };
  }
}
