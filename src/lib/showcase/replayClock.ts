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