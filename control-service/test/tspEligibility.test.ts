// Regression suite for the TSP (transit signal priority) eligibility stub
// (blueprint 8.7, Appendix E Phase 5). AC: "TSP eligibility computes a
// request payload with no live signal call (stub only); passes regression
// suite before pilot use" - this file IS that regression suite. It must
// stay green before this stub is ever wired to a real signal interface.
import { describe, it, expect } from 'vitest';
import {
  evaluateTspEligibility,
  MIN_GAPPED_DEVIATION_SECONDS,
  type TspEligibilityInput,
} from '../src/tsp/eligibility.js';

function baseInput(overrides: Partial<TspEligibilityInput> = {}): TspEligibilityInput {
  return {
    vehicleId: 'veh-1',
    routeDirectionId: 'rd-1',
    intersectionId: 'int-1',
    headwayDeviationSeconds: 120,
    hasAuthorizedSignalInterface: true,
    isStateStale: false,
    ...overrides,
  };
}

describe('evaluateTspEligibility (TSP eligibility stub, no live signal call)', () => {
  it('is eligible for a gapped bus with an authorized interface and fresh state', () => {
    const result = evaluateTspEligibility(baseInput());

    expect(result.eligible).toBe(true);
    expect(result.reasons).toHaveLength(0);
    expect(result.requestPayload).toMatchObject({
      vehicleId: 'veh-1',
      routeDirectionId: 'rd-1',
      intersectionId: 'int-1',
      requestedPriority: 'conditional',
      headwayDeviationSeconds: 120,
      reason: 'headway_gap',
    });
    expect(typeof result.requestPayload?.generatedAt).toBe('string');
  });

  it('never performs a network call - the payload is computed synchronously and is plain data', () => {
    // Regression guard for the "stub only" requirement: the function
    // signature itself is synchronous (not Promise-returning), so it
    // cannot be awaiting a fetch/HTTP client internally.
    const result = evaluateTspEligibility(baseInput());
    expect(result).not.toBeInstanceOf(Promise);
    expect(JSON.parse(JSON.stringify(result.requestPayload))).toEqual(result.requestPayload);
  });

  it('rejects when no authorized signal interface exists for this route-direction/intersection', () => {
    const result = evaluateTspEligibility(baseInput({ hasAuthorizedSignalInterface: false }));

    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain('no_authorized_signal_interface');
    expect(result.requestPayload).toBeNull();
  });

  it('rejects when vehicle state is stale, even if otherwise eligible', () => {
    const result = evaluateTspEligibility(baseInput({ isStateStale: true }));

    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain('stale_state');
    expect(result.requestPayload).toBeNull();
  });

  it('rejects when headway deviation is unknown', () => {
    const result = evaluateTspEligibility(baseInput({ headwayDeviationSeconds: null }));

    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain('headway_deviation_unknown');
    expect(result.requestPayload).toBeNull();
  });

  it('rejects a bunched bus (negative deviation) - priority must not reward bunching', () => {
    const result = evaluateTspEligibility(baseInput({ headwayDeviationSeconds: -200 }));

    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain('not_gapped');
  });

  it('rejects a bus within target headway (small positive deviation below the gapped floor)', () => {
    const result = evaluateTspEligibility(
      baseInput({ headwayDeviationSeconds: MIN_GAPPED_DEVIATION_SECONDS - 1 }),
    );

    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain('not_gapped');
  });

  it('is eligible exactly at the gapped-deviation floor', () => {
    const result = evaluateTspEligibility(
      baseInput({ headwayDeviationSeconds: MIN_GAPPED_DEVIATION_SECONDS }),
    );

    expect(result.eligible).toBe(true);
  });

  it('accumulates every failing reason rather than short-circuiting on the first', () => {
    const result = evaluateTspEligibility(
      baseInput({ hasAuthorizedSignalInterface: false, isStateStale: true, headwayDeviationSeconds: -50 }),
    );

    expect(result.eligible).toBe(false);
    expect(result.reasons).toEqual(
      expect.arrayContaining(['no_authorized_signal_interface', 'stale_state', 'not_gapped']),
    );
    expect(result.requestPayload).toBeNull();
  });
});
