// Pluggable controllers for the simulator (blueprint 11.1 "Control
// plug-in" row: "Run rule, two-way, self-equalizing, MPC, and research
// controllers against the same scenario"). Anything implementing the
// `Controller` interface from `types.ts` can be swapped in via
// `engine.simulate(config, controller)` - this file ships the two needed
// for the required "no-control vs controlled comparison" AC.
//
// Deliberately independent of `../mpc/solver.ts`: that module reads the
// live `stateStore` and is wrapped in the `mpc.solve` Sentry span used by
// the real command path. Importing it here would pull simulation code
// into the live dependency graph, which is exactly what the "never touch
// the live command path" acceptance criterion rules out. The
// self-equalizing law below intentionally mirrors the same control law
// (`policy.selfEqualizingK` against headway deviation, clamped to
// `maxHoldSeconds`) so simulator results are meaningful for tuning that
// controller's gain, but the two implementations are not shared code.
import type { Controller, ControllerContext, ControllerDecision } from './types.js';

/** Baseline: never intervenes. Used as the "no control" arm of every replay/regression comparison. */
export const noControlController: Controller = {
  name: 'no-control',
  decide(_context: ControllerContext): ControllerDecision {
    return { holdSeconds: 0, actionType: 'no_control' };
  },
};

export interface SelfEqualizingOptions {
  /** Gain applied to headway deviation from target; mirrors `route_policies.self_equalizing_k`. */
  gain: number;
}

/**
 * Self-equalizing headway controller: holds a vehicle that is running
 * ahead of schedule (short gap to its leader means it left early / is
 * bunching forward) by `gain * (targetHeadway - leaderHeadway)` seconds,
 * clamped to `[0, maxHoldSeconds]`. Never issues a hold when the
 * vehicle's state is stale (`context.isStateStale`) or when the leader
 * headway is unknown - a guardrail asserted directly in
 * `test/simulation/regression.test.ts`'s GPS-dropout scenario.
 */
export function createSelfEqualizingController(options: SelfEqualizingOptions): Controller {
  return {
    name: 'self-equalizing',
    decide(context: ControllerContext): ControllerDecision {
      if (context.isStateStale || context.leaderHeadwaySeconds === null) {
        return { holdSeconds: 0, actionType: 'no_control' };
      }
      const deviation = context.targetHeadwaySeconds - context.leaderHeadwaySeconds;
      if (deviation <= 0) {
        // Vehicle is at or behind target gap already - nothing to correct.
        return { holdSeconds: 0, actionType: 'no_control' };
      }
      const raw = deviation * options.gain;
      const holdSeconds = Math.round(Math.min(Math.max(raw, 0), context.maxHoldSeconds));
      if (holdSeconds <= 0) return { holdSeconds: 0, actionType: 'no_control' };
      return { holdSeconds, actionType: 'self_equalizing_hold' };
    },
  };
}
