/**
 * Present mode's state, as a pure reducer.
 *
 * Everything the keyboard, the pips, the scroll observer and the fullscreen
 * change handler can do to the showcase is one of these actions, and the
 * bounds live here rather than in each caller: `next` at the last scene
 * stays there, `prev` at the first stays there, `goto` clamps, and `sync`
 * moves the index without touching `active` so the scroll observer can keep
 * the arrows in step with what is on screen whether or not a presentation
 * is running.
 *
 * Returns the SAME object when nothing changes, so React can bail out of a
 * render and the hook's scroll effect does not fire for a no-op.
 *
 * No `'use client'`: this is plain state arithmetic and the tests run it in
 * node.
 */
export interface PresentState {
  active: boolean;
  index: number;
  paused: boolean;
}

export type PresentAction =
  | { type: 'enter'; index?: number }
  | { type: 'exit' }
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'goto'; index: number }
  | { type: 'togglePause' }
  | { type: 'sync'; index: number };

export const initialPresentState: PresentState = { active: false, index: 0, paused: false };

function clampIndex(index: number, sceneCount: number): number {
  const last = Math.max(0, sceneCount - 1);
  if (!Number.isFinite(index)) return 0;
  return Math.min(last, Math.max(0, Math.trunc(index)));
}

function settle(state: PresentState, next: PresentState): PresentState {
  return next.active === state.active && next.index === state.index && next.paused === state.paused
    ? state
    : next;
}

export function presentReducer(
  state: PresentState,
  action: PresentAction,
  sceneCount: number,
): PresentState {
  switch (action.type) {
    case 'enter':
      return settle(state, {
        active: true,
        index: clampIndex(action.index ?? state.index, sceneCount),
        paused: false,
      });
    case 'exit':
      return settle(state, { active: false, index: state.index, paused: false });
    case 'next':
      return settle(state, { ...state, index: clampIndex(state.index + 1, sceneCount) });
    case 'prev':
      return settle(state, { ...state, index: clampIndex(state.index - 1, sceneCount) });
    case 'goto':
      return settle(state, { ...state, index: clampIndex(action.index, sceneCount) });
    case 'togglePause':
      return settle(state, { ...state, paused: !state.paused });
    case 'sync':
      return settle(state, { ...state, index: clampIndex(action.index, sceneCount) });
    default:
      return state;
  }
}
