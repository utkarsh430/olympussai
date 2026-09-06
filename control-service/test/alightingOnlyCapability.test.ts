// Making alighting-only switchable ONE CORRIDOR AT A TIME, and bounding what
// switching it on can do.
//
// ─── WHAT THESE TESTS ARE PROTECTING ─────────────────────────────────────
//
// Alighting-only is the only action in this system whose cost is paid, in
// public, by a person who is not on the bus. Measured over 16 paired
// phase-seeds on urban it makes excess wait 3.6 points worse (16/16 seeds) and
// leaves 1,295 more people behind (16/16), which is why it ships OFF - and the
// reason it ships off is not really the measurement, it is that nobody has
// decided the trade is acceptable.
//
// So the assertions here are almost all about REFUSING to act. Three failures
// would each be silent in production and each be a real harm:
//
//   1. A policy row that does not mention alighting-only acquiring it anyway.
//      That is every row on the network today, and every synthetic policy in
//      every other test file.
//   2. The tripwire reading `>` instead of `>=`, so every corridor gets one
//      refusal more than its operator configured.
//   3. The tripwire failing OPEN when its meter cannot be read - a database
//      hiccup quietly removing the bound at the moment the law is live.
import { describe, it, expect } from 'vitest';
import {
  boardingLimitAvailability,
  boardingLimitPolicy,
  DEFAULT_MAX_REFUSALS_PER_WINDOW,
  DEFAULT_REFUSAL_WINDOW_SECONDS,
} from '../src/mpc/boardingLimit.js';
import type { RoutePolicyRow } from '../src/state/store.js';

/**
 * A policy row exactly as the rest of this suite writes one: no mention of
 * alighting-only at all. That is deliberate and is the point of the first
 * test - this is also the shape of a row written before the columns existed.
 */
function policy(overrides: Partial<RoutePolicyRow> = {}): RoutePolicyRow {
  return {
    id: 'p-1',
    routeDirectionId: 'rd-1',
    operatingPeriod: 'all',
    dayType: 'all',
    targetHeadwaySeconds: 600,
    bunchedThresholdRatio: 0.25,
    warningThresholdRatio: 0.5,
    kf: 0.4,
    kb: 0.2,
    selfEqualizingK: 0.35,
    maxHoldSeconds: 600,
    cooldownSeconds: 60,
    minimumActionSeconds: 0,
    predictionHorizonControlPoints: 3,
    occupancyStaleSeconds: null,
    occupancyCapacity: null,
    ks: null,
    maxLatenessSeconds: null,
    speedBandMinKmph: null,
    speedBandMaxKmph: null,
    maxConcurrentActions: null,
    ...overrides,
  };
}

describe('alighting-only per-corridor enablement', () => {
  it('is off on a policy that does not mention it, and reports what it withheld', () => {
    const availability = boardingLimitAvailability(policy(), null, 3);

    expect(availability.offered).toBe(false);
    expect(availability.withheldReason).toBe('disabled_for_corridor');
    // Three proposals the law produced and the operator is not being shown.
    // Reported rather than dropped: an operator asked to raise the bound is
    // being asked about exactly this number.
    expect(availability.withheldCandidateCount).toBe(3);
    // Null is "the meter was not read", never "zero refusals". A disabled
    // corridor costs no database query per solve, and a surface must not be
    // able to render its silence as a clean record.
    expect(availability.refusalsInWindow).toBeNull();
    expect(availability.remainingRefusals).toBeNull();
  });

  it('is off when the column is explicitly false', () => {
    const availability = boardingLimitAvailability(
      policy({ alightingOnlyEnabled: false }),
      null,
      1,
    );
    expect(availability.offered).toBe(false);
    expect(availability.withheldReason).toBe('disabled_for_corridor');
  });

  it('turns on for one corridor without touching any other', () => {
    const on = boardingLimitPolicy(policy({ alightingOnlyEnabled: true }));
    const off = boardingLimitPolicy(policy());

    expect(on.enabled).toBe(true);
    expect(off.enabled).toBe(false);
  });

  it('falls back to the module bound and window, never to unbounded', () => {
    const config = boardingLimitPolicy(policy({ alightingOnlyEnabled: true }));

    expect(config.maxRefusals).toBe(DEFAULT_MAX_REFUSALS_PER_WINDOW);
    expect(config.windowSeconds).toBe(DEFAULT_REFUSAL_WINDOW_SECONDS);
    // There is no configuration that enables the law with no bound on it.
    expect(config.maxRefusals).toBeGreaterThan(0);
    expect(Number.isFinite(config.maxRefusals)).toBe(true);
  });
});

describe('the refusal tripwire', () => {
  const enabled = policy({
    alightingOnlyEnabled: true,
    alightingOnlyMaxRefusals: 4,
    alightingOnlyRefusalWindowSeconds: 1800,
  });

  it('offers proposals while the corridor is under its bound, and says how much is left', () => {
    const availability = boardingLimitAvailability(enabled, 1, 2);

    expect(availability.offered).toBe(true);
    expect(availability.withheldReason).toBeNull();
    expect(availability.refusalsInWindow).toBe(1);
    expect(availability.maxRefusals).toBe(4);
    expect(availability.windowSeconds).toBe(1800);
    expect(availability.remainingRefusals).toBe(3);
    expect(availability.withheldCandidateCount).toBe(0);
  });

  it('stops proposing AT the bound, not one past it', () => {
    // The distinction this pins: `maxRefusals` is the most a corridor may have
    // issued, so the proposal after the fourth is the one too many. Read as a
    // strict `>` every corridor on the network quietly gets a fifth refusal it
    // was never configured for, and the bug is invisible in every log.
    const atBound = boardingLimitAvailability(enabled, 4, 2);

    expect(atBound.offered).toBe(false);
    expect(atBound.withheldReason).toBe('refusal_tripwire');
    expect(atBound.remainingRefusals).toBe(0);
    expect(atBound.withheldCandidateCount).toBe(2);

    // One below is still offered, so the bound is 4 and not 3.
    expect(boardingLimitAvailability(enabled, 3, 2).offered).toBe(true);
  });

  it('stays tripped past the bound and never reports a negative budget', () => {
    const over = boardingLimitAvailability(enabled, 9, 0);

    expect(over.offered).toBe(false);
    expect(over.withheldReason).toBe('refusal_tripwire');
    expect(over.refusalsInWindow).toBe(9);
    expect(over.remainingRefusals).toBe(0);
  });

  it('reports the state even when nothing was proposed this cycle', () => {
    // A tripped corridor that happens to be quiet still reads as tripped. The
    // alternative - inferring the state from an empty candidate list - is the
    // exact confusion this object exists to prevent: "the law found nothing"
    // and "the law is not allowed to speak" are different facts about a
    // corridor and an operator has to be able to tell them apart.
    const quiet = boardingLimitAvailability(enabled, 4, 0);

    expect(quiet.offered).toBe(false);
    expect(quiet.withheldReason).toBe('refusal_tripwire');
    expect(quiet.withheldCandidateCount).toBe(0);
  });

  it('FAILS CLOSED when the refusal count cannot be read', () => {
    // An enabled corridor whose meter did not answer. Offering here would mean
    // a database hiccup silently removes the bound at the one moment the law
    // is actually live and refusing people, which is the worst possible time
    // for a safety control to be optimistic.
    const unreadable = boardingLimitAvailability(enabled, null, 2);

    expect(unreadable.offered).toBe(false);
    expect(unreadable.withheldReason).toBe('refusal_tripwire');
    expect(unreadable.refusalsInWindow).toBeNull();
    expect(unreadable.remainingRefusals).toBeNull();
  });
});
