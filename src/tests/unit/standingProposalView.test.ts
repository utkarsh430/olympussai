// @vitest-environment node
//
// What the console SAYS about a stored recommendation
// (src/lib/ops/standingProposalView.ts).
//
// Two claims are the whole reason this module exists, and both are about
// mistakes a reasonable implementation makes by default.
//
//   AN EMPTY LIST IS NOT AN ALL-CLEAR. AGENTS.md records this for the alert
//   inbox. A list of standing PROPOSALS is worse, because it empties for two
//   more reasons that render identically: the cycle looked and proposed
//   nothing, or the cycle is not running. Only `latestCreatedAt` separates
//   them.
//
//   A STORED ROW AND A LIVE SOLVE ARE NOT PEERS. Showing both and letting the
//   layout imply a ranking is the failure mode. The live solve is
//   authoritative, always, because mpc/safety.ts grades a candidate against
//   state no older than 90 s and stamps that verdict at solve time - so the
//   live one's verdict is about the clock the operator is acting on and the
//   stored one's is about a clock that has moved.
import { describe, it, expect } from 'vitest';
import {
  describeFeedEmptiness,
  describeProposalAge,
  reconcileWithLiveSolve,
} from '@/lib/ops/standingProposalView';
import type { RecommendationResult } from '@/lib/ops/recommendationView';

const NOW_ISO = '2026-09-06T09:00:00.000Z';

function emptyFeed(overrides: Record<string, unknown> = {}) {
  return {
    recommendations: [] as unknown[],
    windowSeconds: 900,
    latestCreatedAt: '2026-09-06T08:55:00.000Z',
    // The feed's own clock is what ages are measured against here - see the
    // parameter's docblock for why the reader's is the wrong one.
    generatedAt: NOW_ISO,
    ...overrides,
  };
}

describe('describeFeedEmptiness', () => {
  it('says nothing when there are rows to read', () => {
    expect(describeFeedEmptiness(emptyFeed({ recommendations: [{}] }))).toBeNull();
  });

  // Null means the cycle has never written a row. That is a statement about
  // the CONTROLLER, not about the network, and it must not be dressed as
  // "nothing needs doing".
  it('warns, not reassures, when the controller has never written a proposal', () => {
    const copy = describeFeedEmptiness(emptyFeed({ latestCreatedAt: null }))!;
    expect(copy.tone).toBe('warning');
    expect(copy.headline).toMatch(/never recorded/i);
    expect(copy.body).toMatch(/not an all-clear/i);
  });

  // A last row older than the feed's own window means the cycle had the chance
  // to repeat standing advice and did not. Either everything resolved, or the
  // cycle stopped - and the copy must not pick the comfortable one.
  it('warns when the newest row predates the window', () => {
    const copy = describeFeedEmptiness(
      emptyFeed({ latestCreatedAt: '2026-09-06T06:00:00.000Z' }),
    )!;
    expect(copy.tone).toBe('warning');
    expect(copy.body).toMatch(/not an all-clear/i);
    expect(copy.body).toMatch(/3 hours ago/);
  });

  // The genuinely ordinary case, and even here the copy refuses to claim the
  // network is fine - that is the alert list's question, not this one's.
  it('stays informational when the controller is writing and simply proposed nothing', () => {
    const copy = describeFeedEmptiness(emptyFeed())!;
    expect(copy.tone).toBe('info');
    expect(copy.body).toMatch(/not a statement that nothing is wrong/i);
  });

  // The reader's clock is deliberately not consulted: it can be minutes out,
  // and it does not exist at all during the server render - where an empty
  // list carrying no warning is exactly the all-clear this copy prevents.
  it('measures against the feed\'s own clock, not the reader\'s', () => {
    const copy = describeFeedEmptiness(
      emptyFeed({
        latestCreatedAt: '2026-09-06T06:00:00.000Z',
        generatedAt: '2026-09-06T08:00:00.000Z',
      }),
    )!;
    // Two hours by the feed's clock, whatever the machine running this thinks
    // the time is.
    expect(copy.body).toMatch(/2 hours ago/);
  });

  it('does not crash on an unparseable timestamp', () => {
    const copy = describeFeedEmptiness(emptyFeed({ latestCreatedAt: 'not a date' }))!;
    expect(copy).not.toBeNull();
    expect(copy.headline).toBeTruthy();
  });
});

describe('describeProposalAge', () => {
  it('marks a row inside the safety window as recent, and still not an offer', () => {
    const copy = describeProposalAge({ ageSeconds: 40, freshness: 'fresh' }, 90);
    expect(copy.tone).toBe('info');
    // "Fresh" must not read as "safe to act on". Nothing in this feed is.
    expect(copy.detail).toMatch(/not an offer/i);
  });

  it('marks a row past the window as unconfirmed, not as wrong', () => {
    const copy = describeProposalAge({ ageSeconds: 600, freshness: 'lapsed' }, 90);
    expect(copy.tone).toBe('warning');
    expect(copy.detail).toMatch(/unchecked/i);
    expect(copy.detail).toMatch(/10 minutes ago/);
  });
});

function live(selectedAction: RecommendationResult['selectedAction']) {
  return { selectedAction } as Pick<RecommendationResult, 'selectedAction'>;
}

const action = (overrides: Record<string, unknown> = {}) =>
  ({
    actionType: 'two_way_hold',
    vehicleId: 'UP25FT4823',
    involvedVehicleIds: ['UP25FT4823'],
    holdSeconds: 45,
    objectiveCost: -1200,
    clampResidualSeconds: 0,
    ...overrides,
  }) as unknown as NonNullable<RecommendationResult['selectedAction']>;

const stored = {
  selectedActionType: 'two_way_hold',
  selectedVehicleId: 'UP25FT4823',
  selectedHoldSeconds: 45,
};

describe('reconcileWithLiveSolve', () => {
  // Every branch names the authority. This is the assertion that stops the
  // panel regressing into two proposals shown side by side.
  it.each([
    ['no solve taken', null],
    ['a solve that agrees', live(action())],
    ['a solve that proposes something else', live(action({ vehicleId: 'UP25FT1001' }))],
    ['a solve that proposes nothing', live(null)],
  ])('always says which of the two to act on: %s', (_name, result) => {
    const copy = reconcileWithLiveSolve(stored, result);
    expect(copy.authority.length).toBeGreaterThan(0);
    expect(copy.authority).toMatch(/live solve|Do not act on the stored row/i);
  });

  it('is unavailable, and warns, when no solve has answered', () => {
    const copy = reconcileWithLiveSolve(stored, null);
    expect(copy.relation).toBe('unavailable');
    expect(copy.tone).toBe('warning');
    // A failed or untaken solve is not agreement, and must not read as one.
    expect(copy.authority).toMatch(/Do not act on the stored row/i);
  });

  it('confirms when the live solve names the same action on the same bus', () => {
    const copy = reconcileWithLiveSolve(stored, live(action()));
    expect(copy.relation).toBe('confirmed');
    expect(copy.tone).toBe('info');
  });

  // Identity is (action type, vehicle). A hold that moved is the same
  // instruction re-measured, and the live figure is the one to use - said
  // explicitly rather than left for the operator to spot.
  it('confirms but names the live hold length when it has moved', () => {
    const copy = reconcileWithLiveSolve(stored, live(action({ holdSeconds: 90 })));
    expect(copy.relation).toBe('confirmed');
    expect(copy.body).toMatch(/90s/);
    expect(copy.body).toMatch(/45s/);
    expect(copy.body).toMatch(/Use the live figure/i);
  });

  it('reports a different bus as a change, not as agreement', () => {
    const copy = reconcileWithLiveSolve(stored, live(action({ vehicleId: 'UP25FT1001' })));
    expect(copy.relation).toBe('changed');
    expect(copy.tone).toBe('warning');
    expect(copy.body).toMatch(/UP25FT1001/);
  });

  it('reports a different action type as a change', () => {
    const copy = reconcileWithLiveSolve(
      stored,
      live(action({ actionType: 'self_equalizing_hold' })),
    );
    expect(copy.relation).toBe('changed');
  });

  it('withdraws the stored row when the live solve selects nothing', () => {
    const copy = reconcileWithLiveSolve(stored, live(null));
    expect(copy.relation).toBe('withdrawn');
    expect(copy.tone).toBe('warning');
    expect(copy.body).toMatch(/nothing to issue/i);
  });

  // A pace-only row: the decision cycle writes one when the only useful advice
  // on a corridor is "ease off", so there is no selected action to compare.
  it('handles a stored row that selected no action', () => {
    const copy = reconcileWithLiveSolve(
      { selectedActionType: null, selectedVehicleId: null, selectedHoldSeconds: null },
      live(action()),
    );
    expect(copy.relation).toBe('changed');
    expect(copy.body).toMatch(/selected no action/i);
  });
});
