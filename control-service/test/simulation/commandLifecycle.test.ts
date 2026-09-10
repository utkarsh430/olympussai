// The command path, and the two compliance numbers it makes necessary.
//
// Every assertion here exists because getting it wrong would be INVISIBLE: a
// trial that still runs, still reports confident numbers, and quietly reports
// the control law's intent as though it were the rate instructions reach a
// driver.
import { describe, it, expect } from 'vitest';
import {
  CommandPath,
  commandLifecyclePolicyFrom,
  inertLimitsFor,
  limitProvenance,
  rollUpHoldSeconds,
  CONSOLE_DEFAULT_TTL_SECONDS,
  SEEDED_MAX_CONCURRENT_ACTIONS,
  DEPLOYED_DECISION_CYCLE_SECONDS,
} from '../../src/simulation/commandLifecycle.js';
import { summarizeKpis } from '../../src/simulation/kpi.js';
import type { StopVisitRecord } from '../../src/simulation/types.js';

/**
 * The values a policy row on THIS network actually carries, read from the
 * seeded control database (all 759 rows identical, 2026-09-06):
 * cooldown 60, minimum action 0, max concurrent 3.
 */
const SEEDED = commandLifecyclePolicyFrom({ cooldownSeconds: 60, minimumActionSeconds: 0 });

function submit(
  path: CommandPath,
  over: Partial<Parameters<CommandPath['submit']>[0]> = {},
) {
  return path.submit({
    vehicleId: 'BUS-1',
    atSeconds: 0,
    intendedHoldSeconds: 60,
    // Far enough out that delivery never misses the bus unless a test says so.
    readyToDepartSeconds: 1_000_000,
    acceptsInstruction: true,
    ...over,
  });
}

function visit(over: Partial<StopVisitRecord>): StopVisitRecord {
  return {
    vehicleId: 'BUS-1',
    stopId: 'S1',
    stopIndex: 1,
    arrivalSeconds: 0,
    waitWindowSeconds: 0,
    boardings: 0,
    boardingWaitPassengerSeconds: 0,
    onboardDelayPassengerSeconds: 0,
    dwellPassengerSeconds: 0,
    alightings: 0,
    deniedBoardings: 0,
    firstTimeDeniedBoardings: 0,
    boardingLimitedPassengers: 0,
    onboardAfter: 0,
    dwellSeconds: 0,
    intendedHoldSeconds: 0,
    appliedHoldSeconds: 0,
    compliant: true,
    departureSeconds: 0,
    leaderHeadwaySeconds: null,
    isStateStale: false,
    ...over,
  };
}

describe('the limits are the seeded ones, and their provenance is published', () => {
  it('takes cooldown and minimum action from the corridor and never invents them', () => {
    const built = commandLifecyclePolicyFrom({ cooldownSeconds: 45, minimumActionSeconds: 12 });
    expect(built.cooldownSeconds).toBe(45);
    expect(built.minimumActionSeconds).toBe(12);
    expect(limitProvenance().cooldownSeconds).toBe('route_policies');
    expect(limitProvenance().minimumActionSeconds).toBe('route_policies');
    expect(limitProvenance().maxConcurrentActions).toBe('route_policies');
  });

  it('declares the delivery latency as ASSUMED and defaults it to inert', () => {
    // The one number nothing in this system measures. A non-zero default would
    // put an invented value underneath a headline this whole model exists to
    // make honest.
    expect(SEEDED.deliveryLatencySeconds).toBe(0);
    expect(limitProvenance().deliveryLatencySeconds).toBe('assumed');
  });

  it('sources the TTL from the console constant, NOT from route_policies', () => {
    // `route_policies.command_ttl_seconds` is read by no code. The 120 s a
    // real driver's screen runs on is DEFAULT_TTL_SECONDS in the two consoles
    // that create commands. Both facts are true and the report must not
    // conflate them.
    expect(SEEDED.effectiveTtlSeconds).toBe(CONSOLE_DEFAULT_TTL_SECONDS);
    expect(limitProvenance().effectiveTtlSeconds).toBe('ui_constant');
  });

  it('names the three dead columns and the one that is merely inert, and keeps them apart', () => {
    const inert = inertLimitsFor(SEEDED);
    const dead = inert.filter((l) => l.kind === 'dead_column').map((l) => l.column);
    expect(dead).toEqual([
      'route_policies.command_ttl_seconds',
      'route_policies.ack_timeout_seconds',
      'route_policies.retry_count',
    ]);
    // minimum_action_seconds IS read by mpc/safety.ts. Seeded at 0 it filters
    // nothing, which is a tuning gap and not a wiring defect - reporting it as
    // a dead column would tell an operator a working guardrail is broken.
    const inertAtValue = inert.filter((l) => l.kind === 'inert_at_seeded_value').map((l) => l.column);
    expect(inertAtValue).toEqual([
      'route_policies.cooldown_seconds',
      'route_policies.minimum_action_seconds',
    ]);
  });

  it('stops calling minimum_action_seconds inert once it is set to something', () => {
    const tuned = commandLifecyclePolicyFrom({ cooldownSeconds: 60, minimumActionSeconds: 20 });
    expect(inertLimitsFor(tuned).map((l) => l.column)).not.toContain(
      'route_policies.minimum_action_seconds',
    );
  });
});

describe('each limit refuses the instruction it is there to refuse', () => {
  it('refuses a second command while the first is still live (the unique index)', () => {
    const path = new CommandPath({ ...SEEDED, cooldownSeconds: 0 });
    expect(submit(path, { atSeconds: 0, intendedHoldSeconds: 10 }).blockedBy).toBeNull();
    // The hold itself lasted TEN seconds and the cooldown is off, yet the bus
    // is still blocked at t=119. Nothing in control-service/src ever writes
    // `completed`, so an accepted command sits in `executing` - inside
    // `commands_one_active_per_vehicle_idx` - until its TTL expires it. The
    // constraint therefore costs the whole TTL, not the length of the action.
    expect(submit(path, { atSeconds: 119, vehicleId: 'BUS-1' }).blockedBy).toBe(
      'conflicting_active_command',
    );
    expect(submit(path, { atSeconds: 120, vehicleId: 'BUS-1' }).blockedBy).toBeNull();
    // A DIFFERENT bus is unaffected: the index is per vehicle.
    expect(submit(path, { atSeconds: 119, vehicleId: 'BUS-2' }).blockedBy).toBeNull();
  });

  it('frees the slot at once when the driver refuses, because `failed` is terminal', () => {
    const path = new CommandPath({ ...SEEDED, cooldownSeconds: 0 });
    expect(submit(path, { atSeconds: 0, acceptsInstruction: false }).blockedBy).toBe('ack_refused');
    // `unable`/`unsafe` ends the command at `failed`, which is outside the
    // unique index - so unlike an accepted one it does not tie the bus up for
    // the TTL. Only the cooldown would still apply, and it is off here.
    expect(submit(path, { atSeconds: 1 }).blockedBy).toBeNull();
  });

  it('refuses a driver instructed inside route_policies.cooldown_seconds', () => {
    const path = new CommandPath(SEEDED);
    // A REFUSED command is the only case the cooldown can reach at the seeded
    // values: `failed` is terminal, so it frees the unique index at once while
    // the cooldown keeps running. After an ACCEPTED one the index blocks for
    // the full 120 s TTL and the 60 s cooldown never gets a turn.
    expect(submit(path, { atSeconds: 0, acceptsInstruction: false }).blockedBy).toBe('ack_refused');
    expect(submit(path, { atSeconds: 59 }).blockedBy).toBe('cooldown');
    expect(submit(path, { atSeconds: 60 }).blockedBy).toBeNull();
  });

  it('reports the cooldown as inert while it is shorter than the TTL', () => {
    // THE FINDING THAT ONLY APPEARS WITH BOTH LIMITS IN THE LOOP. Seeded 60 s
    // against a 120 s slot, the dial an operator would reach for to space
    // instructions out is dominated by an unrelated one and does nothing.
    const inert = inertLimitsFor(SEEDED).map((l) => l.column);
    expect(inert).toContain('route_policies.cooldown_seconds');

    const raised = commandLifecyclePolicyFrom({ cooldownSeconds: 300, minimumActionSeconds: 0 });
    expect(inertLimitsFor(raised).map((l) => l.column)).not.toContain(
      'route_policies.cooldown_seconds',
    );
    // And once raised it bites where the index has already let go.
    const path = new CommandPath(raised);
    expect(submit(path, { atSeconds: 0, intendedHoldSeconds: 10 }).blockedBy).toBeNull();
    expect(submit(path, { atSeconds: 150 }).blockedBy).toBe('cooldown');
  });

  it('spends the decision cycle budget corridor-wide, not per vehicle', () => {
    const path = new CommandPath(SEEDED);
    for (let i = 0; i < SEEDED_MAX_CONCURRENT_ACTIONS; i++) {
      expect(submit(path, { vehicleId: `BUS-${i}`, atSeconds: 1 }).blockedBy).toBeNull();
    }
    // A fourth DIFFERENT bus, with no cooldown and no live command of its own,
    // in the same cycle. `max_concurrent_actions` is an operational limit on
    // the control room, so it is not per bus.
    expect(submit(path, { vehicleId: 'BUS-99', atSeconds: 1 }).blockedBy).toBe(
      'max_concurrent_actions',
    );
    // The next cycle is a fresh budget.
    expect(
      submit(path, { vehicleId: 'BUS-99', atSeconds: DEPLOYED_DECISION_CYCLE_SECONDS + 1 }).blockedBy,
    ).toBeNull();
  });

  it('refuses a hold shorter than minimum_action_seconds when one is set', () => {
    const path = new CommandPath(
      commandLifecyclePolicyFrom({ cooldownSeconds: 0, minimumActionSeconds: 30 }),
    );
    expect(submit(path, { intendedHoldSeconds: 29 }).blockedBy).toBe('below_minimum_action');
    expect(submit(path, { intendedHoldSeconds: 30, atSeconds: 100 }).blockedBy).toBeNull();
  });

  it('refuses nothing on minimum action at the seeded 0, which is the finding', () => {
    const path = new CommandPath({ ...SEEDED, cooldownSeconds: 0 });
    // A one-second hold. Seeded at 0 the guardrail excludes it, and that is
    // exactly why the column is reported as inert rather than as enforced.
    expect(submit(path, { intendedHoldSeconds: 1 }).blockedBy).toBeNull();
  });

  it('records a driver refusal as an acknowledgement, not as a path refusal', () => {
    const path = new CommandPath({ ...SEEDED, cooldownSeconds: 0 });
    const decision = submit(path, { acceptsInstruction: false });
    expect(decision.blockedBy).toBe('ack_refused');
    expect(decision.deliveredHoldSeconds).toBe(0);
    // The command still existed: it took a slot in the cycle's budget and it
    // started the cooldown. `unable`/`unsafe` ends a command at `failed`; it
    // does not un-create it.
    expect(path.result().acknowledged).toBe(0);
    expect(path.result().blockedBy.ack_refused).toBe(1);
  });

  it('drops an instruction that arrives after the bus has pulled out', () => {
    const path = new CommandPath({ ...SEEDED, cooldownSeconds: 0, deliveryLatencySeconds: 45 });
    // The bus would leave 30 s after the decision; the instruction lands at 45.
    expect(submit(path, { atSeconds: 0, readyToDepartSeconds: 30 }).blockedBy).toBe(
      'arrived_after_departure',
    );
    expect(submit(path, { atSeconds: 100, readyToDepartSeconds: 200 }).blockedBy).toBeNull();
  });
});

describe('expiry truncates a long hold rather than refusing it', () => {
  it('cuts a hold at the TTL, because the instruction leaves the screen mid-hold', () => {
    // Inter-city caps holds at 600 s and suburban at 240 s, against a 120 s
    // TTL. `lockAndExpireIfDue` expires a command that is still `executing`
    // just as readily as one merely `delivered`, and
    // `getActiveDeliveredCommandForVehicle` then returns null.
    const path = new CommandPath({ ...SEEDED, cooldownSeconds: 0 });
    const decision = submit(path, { intendedHoldSeconds: 300 });
    expect(decision.blockedBy).toBeNull();
    expect(decision.deliveredHoldSeconds).toBe(CONSOLE_DEFAULT_TTL_SECONDS);
    expect(decision.truncatedByExpiry).toBe(true);
    expect(path.result().truncatedByExpiry).toBe(1);
  });

  it('leaves a hold inside the TTL alone', () => {
    const path = new CommandPath({ ...SEEDED, cooldownSeconds: 0 });
    const decision = submit(path, { intendedHoldSeconds: 90 });
    expect(decision.deliveredHoldSeconds).toBe(90);
    expect(decision.truncatedByExpiry).toBe(false);
  });
});

describe('the ledger keeps intent and delivery apart', () => {
  it('prices every refusal in hold seconds as well as counting it', () => {
    const path = new CommandPath(SEEDED);
    submit(path, { atSeconds: 0, intendedHoldSeconds: 40 });
    submit(path, { atSeconds: 10, intendedHoldSeconds: 75 }); // conflicting active command
    const ledger = path.result();
    expect(ledger.proposals).toBe(2);
    expect(ledger.intendedHoldSeconds).toBe(115);
    expect(ledger.blockedBy.conflicting_active_command).toBe(1);
    // The COUNT says one instruction was lost; the SECONDS say how much
    // holding was lost with it, which is the ordering an operator can act on.
    expect(ledger.holdSecondsLostTo.conflicting_active_command).toBe(75);
  });
});

describe('a run with no command path modelled says so, and does not claim delivery', () => {
  it('rolls delivered up to the intent when the field is absent', () => {
    // ABSENT means "the command path was not in this loop", which is what
    // makes the result an upper bound. A zero would claim it was refused.
    const rollup = rollUpHoldSeconds([
      visit({ intendedHoldSeconds: 60, appliedHoldSeconds: 60 }),
      visit({ intendedHoldSeconds: 40, appliedHoldSeconds: 10 }),
    ]);
    expect(rollup.intendedHoldSeconds).toBe(100);
    expect(rollup.deliveredHoldSeconds).toBe(100);
    expect(rollup.servedHoldSeconds).toBe(70);
  });
});

describe('complianceRate keeps its meaning, and stops standing alone', () => {
  const controlPoints = new Set(['S1']);

  it('reports accepted instructions and served hold seconds as two figures', () => {
    // The `partial_compliance` shape in miniature: two drivers take the
    // instruction, one serves a quarter of it. Instructions accepted: 2/2.
    // Hold seconds served: (90 + 22.5) / 180.
    const kpis = summarizeKpis(
      [
        visit({ intendedHoldSeconds: 90, appliedHoldSeconds: 90, compliant: true }),
        visit({ intendedHoldSeconds: 90, appliedHoldSeconds: 22.5, compliant: true }),
      ],
      controlPoints,
      600,
      0.25,
    );
    expect(kpis.complianceRate).toBe(1);
    expect(kpis.holdSecondsServedRate).toBeCloseTo(112.5 / 180, 9);
    expect(kpis.intendedHoldSeconds).toBe(180);
    expect(kpis.deliveredHoldSeconds).toBe(180);
    expect(kpis.servedHoldSeconds).toBeCloseTo(112.5, 9);
  });

  it('does NOT dilute the driver figure with commands the control room refused', () => {
    // THE REASON THE POOL MOVED, and it moves the number the wrong way if you
    // get it wrong. One instruction reached a driver, who refused it. A second
    // was stopped by the cooldown and reached nobody - so `compliant` on that
    // visit is TRUE, because a driver cannot refuse what they were never shown.
    //
    // Pooled on `intendedHoldSeconds > 0` that reads 50% obedience on a
    // corridor where the only driver actually asked said no. Pooled on what
    // was DELIVERED it reads 0%, and the second loss is attributed to the
    // command path where it belongs.
    const kpis = summarizeKpis(
      [
        visit({
          intendedHoldSeconds: 60,
          deliveredHoldSeconds: 60,
          appliedHoldSeconds: 0,
          compliant: false,
        }),
        visit({
          intendedHoldSeconds: 60,
          deliveredHoldSeconds: 0,
          commandBlockedBy: 'cooldown',
          appliedHoldSeconds: 0,
          compliant: true,
        }),
      ],
      controlPoints,
      600,
      0.25,
    );
    expect(kpis.complianceRate).toBe(0);
    // Intent 120 s, delivered 60 s, served 0. Three numbers, three owners:
    // the laws asked for 120, the control room let 60 through, the driver
    // stood for none of it. Collapsing any pair destroys an attribution.
    expect(kpis.intendedHoldSeconds).toBe(120);
    expect(kpis.deliveredHoldSeconds).toBe(60);
    expect(kpis.servedHoldSeconds).toBe(0);
    expect(kpis.holdSecondsServedRate).toBe(0);
  });

  it('is null, not zero, when no instruction reached anybody', () => {
    const kpis = summarizeKpis([visit({})], controlPoints, 600, 0.25);
    expect(kpis.complianceRate).toBeNull();
    expect(kpis.holdSecondsServedRate).toBeNull();
  });
});
