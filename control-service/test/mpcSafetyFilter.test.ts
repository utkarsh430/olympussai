// The hard safety filter (src/mpc/safety.ts), directly.
//
// It had no unit test of its own — it was only ever exercised through the
// solver, which is how a one-sided staleness test survived. `age >
// staleAfterSeconds` cannot be tripped by a reading from the FUTURE, whose
// age is negative, so such a vehicle grades as permanently, unconditionally
// fresh and the controller will vouch for a hold computed from a reading
// whose true age nobody knows.
//
// That is not hypothetical. A read-only query against the live control
// database found a `vehicle_states` row with `observed_at = 2046-03-27`,
// ~19.6 years ahead. `parseUpstreamInstant` stops new rows like it from being
// written (tests/seed/upstreamInstant.test.ts), but this filter is the
// blueprint's non-negotiable guardrail and must not depend on an upstream
// guard having always been correct.
import { describe, it, expect } from 'vitest';
import {
  applyHardSafetyFilter,
  DEFAULT_STATE_STALE_SECONDS,
  type SafetyFilterContext,
} from '../src/mpc/safety.js';
import type { CandidateAction } from '../src/mpc/types.js';

const NOW = new Date('2026-08-13T06:00:00.000Z');
const VEHICLE = 'UP25FT4823';
const LEADER = 'UP25FT7777';

function at(offsetSeconds: number): string {
  return new Date(NOW.getTime() + offsetSeconds * 1000).toISOString();
}

function candidate(overrides: Partial<CandidateAction> = {}): CandidateAction {
  return {
    actionType: 'two_way_hold',
    vehicleId: VEHICLE,
    involvedVehicleIds: [VEHICLE, LEADER],
    holdSeconds: 30,
    objectiveCost: 0,
    routeDirectionId: '11111111-2222-4333-8444-555555555555',
    stateAsOf: at(-10),
    headwayDeviationSeconds: -120,
    targetHeadwaySeconds: 600,
    ...overrides,
  };
}

function context(overrides: Partial<SafetyFilterContext> = {}): SafetyFilterContext {
  return {
    now: NOW,
    staleAfterSeconds: DEFAULT_STATE_STALE_SECONDS,
    maxHoldSeconds: 120,
    vehicleObservedAtByVehicleId: new Map([
      [VEHICLE, at(-10)],
      [LEADER, at(-12)],
    ]),
    activeCommandVehicleIds: new Set<string>(),
    ...overrides,
  };
}

describe('hard safety filter', () => {
  it('passes a candidate computed from fresh readings', () => {
    const { safe, rejected } = applyHardSafetyFilter([candidate()], context());
    expect(rejected).toEqual([]);
    expect(safe).toHaveLength(1);
  });

  it('rejects a candidate whose own sample is older than the bound', () => {
    const { safe, rejected } = applyHardSafetyFilter(
      [candidate({ stateAsOf: at(-(DEFAULT_STATE_STALE_SECONDS + 1)) })],
      context(),
    );
    expect(safe).toEqual([]);
    expect(rejected[0]?.reasons).toContain('stale_state');
  });

  it('rejects a candidate whose leader stopped reporting, even though its own reading is fresh', () => {
    const { rejected } = applyHardSafetyFilter(
      [candidate()],
      context({
        vehicleObservedAtByVehicleId: new Map([
          [VEHICLE, at(-10)],
          [LEADER, at(-600)],
        ]),
      }),
    );
    expect(rejected[0]?.reasons).toContain('stale_state');
  });

  // ─── THE FUTURE-DATED READING ────────────────────────────────────────
  it('rejects a candidate computed from a sample dated in the future', () => {
    const { safe, rejected } = applyHardSafetyFilter(
      // ~19.6 years ahead, the magnitude actually observed on the live
      // database. Under the old one-sided test this was "fresh".
      [candidate({ stateAsOf: '2046-03-27T00:00:00.000Z' })],
      context(),
    );
    expect(safe).toEqual([]);
    expect(rejected[0]?.reasons).toContain('stale_state');
  });

  it('rejects a candidate when an involved vehicle reading is dated in the future', () => {
    const { safe, rejected } = applyHardSafetyFilter(
      [candidate()],
      context({
        vehicleObservedAtByVehicleId: new Map([
          [VEHICLE, at(-10)],
          [LEADER, '2046-03-27T00:00:00.000Z'],
        ]),
      }),
    );
    expect(safe).toEqual([]);
    expect(rejected[0]?.reasons).toContain('stale_state');
  });

  // Ordinary clock drift between a unit and this service is not a data
  // defect, and rejecting on it would take real corridors offline. The
  // tolerance matches ingestion/upsrtc/normalize.ts's own.
  it('tolerates a few seconds of clock skew', () => {
    const { safe, rejected } = applyHardSafetyFilter([candidate({ stateAsOf: at(30) })], context());
    expect(rejected).toEqual([]);
    expect(safe).toHaveLength(1);
  });

  it('treats a vehicle with no reading at all as stale', () => {
    const { rejected } = applyHardSafetyFilter(
      [candidate()],
      context({ vehicleObservedAtByVehicleId: new Map([[VEHICLE, at(-10)]]) }),
    );
    expect(rejected[0]?.reasons).toContain('stale_state');
  });

  it('rejects a hold beyond the corridor cap', () => {
    const { rejected } = applyHardSafetyFilter([candidate({ holdSeconds: 999 })], context());
    expect(rejected[0]?.reasons).toContain('max_hold_cap_breach');
  });

  it('rejects a second command on a vehicle that already has one in flight', () => {
    const { rejected } = applyHardSafetyFilter(
      [candidate()],
      context({ activeCommandVehicleIds: new Set([VEHICLE]) }),
    );
    expect(rejected[0]?.reasons).toContain('conflicting_active_command');
  });
});
