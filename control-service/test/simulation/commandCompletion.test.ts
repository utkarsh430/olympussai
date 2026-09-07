// What the slot is actually held for, and what that does to the cooldown.
//
// `releaseSlotOnCompletion` models COMMAND_COMPLETION_SWEEP_ENABLED. Off (the
// default) the simulated slot is held for the whole TTL, which is what the
// module modelled before and is STILL more generous than production actually
// was -- in production nothing ever wrote `completed`, and
// `control_service_expire_commands()` excludes `executing`, so an accepted
// command's slot was never released at all. Measured on the live control
// database 2026-09-06: four `executing` rows aged 24-26 days.
//
// On, the slot is held for the ACTION, and the interesting consequence is not
// that more instructions get through -- it is that `cooldown_seconds` starts
// refusing them. That swap is the behaviour change this flag exists to make
// measurable, so it is asserted here directly.
import { describe, it, expect } from 'vitest';
import {
  CommandPath,
  commandLifecyclePolicyFrom,
  inertLimitsFor,
  CONSOLE_DEFAULT_TTL_SECONDS,
} from '../../src/simulation/commandLifecycle.js';

const SEEDED = { cooldownSeconds: 60, minimumActionSeconds: 0 };

function submit(path: CommandPath, over: Partial<Parameters<CommandPath['submit']>[0]> = {}) {
  return path.submit({
    vehicleId: 'BUS-1',
    atSeconds: 0,
    intendedHoldSeconds: 20,
    readyToDepartSeconds: 1_000_000,
    acceptsInstruction: true,
    ...over,
  });
}

describe('releaseSlotOnCompletion', () => {
  it('defaults to false, so an enabled trial is always a deliberate act', () => {
    expect(commandLifecyclePolicyFrom(SEEDED).releaseSlotOnCompletion).toBe(false);
  });

  it('OFF: a 20 s hold holds the slot for the full 120 s TTL', () => {
    const path = new CommandPath(commandLifecyclePolicyFrom(SEEDED));
    submit(path, { atSeconds: 0 });
    // 119 s later the action has been over for 99 s, and the vehicle is still
    // refused on the unique index rather than on the cooldown.
    expect(submit(path, { atSeconds: 119 }).blockedBy).toBe('conflicting_active_command');
  });

  it('ON: the slot is released when the ACTION ends, not when the TTL does', () => {
    const path = new CommandPath(
      commandLifecyclePolicyFrom(SEEDED, { releaseSlotOnCompletion: true }),
    );
    submit(path, { atSeconds: 0, intendedHoldSeconds: 20 });
    expect(submit(path, { atSeconds: 119 }).blockedBy).not.toBe('conflicting_active_command');
  });

  it('ON: the cooldown CAN refuse where only the unique index could before', () => {
    // The mechanism, stated as an assertion. At t=30 the 20 s action is over,
    // so the unique index no longer refuses - and `cooldown_seconds` (60) does,
    // which it could never do before because the index always refused first
    // and for longer.
    //
    // This is what the guardrail is CAPABLE of, not what it does. On every
    // fleet-trial preset a bus's shortest leg is 200 s or more, so it never
    // returns inside either window and the cooldown fires zero times either
    // way - measured, docs/COMMAND_COMPLETION.md section 3.
    const before = new CommandPath(commandLifecyclePolicyFrom(SEEDED));
    submit(before, { atSeconds: 0, intendedHoldSeconds: 20 });
    expect(submit(before, { atSeconds: 30 }).blockedBy).toBe('conflicting_active_command');

    const after = new CommandPath(
      commandLifecyclePolicyFrom(SEEDED, { releaseSlotOnCompletion: true }),
    );
    submit(after, { atSeconds: 0, intendedHoldSeconds: 20 });
    expect(submit(after, { atSeconds: 30 }).blockedBy).toBe('cooldown');
  });

  it('ON: past the cooldown, the instruction the old behaviour refused gets through', () => {
    const path = new CommandPath(
      commandLifecyclePolicyFrom(SEEDED, { releaseSlotOnCompletion: true }),
    );
    submit(path, { atSeconds: 0, intendedHoldSeconds: 20 });
    const second = submit(path, { atSeconds: 61, intendedHoldSeconds: 20 });
    expect(second.blockedBy).toBeNull();
    expect(second.deliveredHoldSeconds).toBe(20);
  });

  it('ON: a hold longer than the TTL still frees at the TTL, never after it', () => {
    // The TTL takes the instruction off the driver's screen mid-action, so it
    // can only ever SHORTEN the occupancy. A 600 s hold must not hold the slot
    // for 600 s just because the flag is on.
    const path = new CommandPath(
      commandLifecyclePolicyFrom(SEEDED, { releaseSlotOnCompletion: true, cooldownSeconds: 0 }),
    );
    submit(path, { atSeconds: 0, intendedHoldSeconds: 600 });
    expect(submit(path, { atSeconds: CONSOLE_DEFAULT_TTL_SECONDS - 1 }).blockedBy).toBe(
      'conflicting_active_command',
    );
    expect(submit(path, { atSeconds: CONSOLE_DEFAULT_TTL_SECONDS }).blockedBy).toBeNull();
  });

  it('ON: a REFUSED instruction is unaffected -- it already freed the slot at once', () => {
    const path = new CommandPath(
      commandLifecyclePolicyFrom(SEEDED, { releaseSlotOnCompletion: true }),
    );
    // `unable`/`unsafe` ends the command at `failed`, terminal and outside the
    // unique index. That was already correct and this flag must not touch it.
    expect(submit(path, { atSeconds: 0, acceptsInstruction: false }).blockedBy).toBe('ack_refused');
    expect(submit(path, { atSeconds: 1 }).blockedBy).toBe('cooldown');
  });
});

describe('what the ledger says about cooldown_seconds', () => {
  const cooldownEntry = (releaseSlotOnCompletion: boolean) =>
    inertLimitsFor(commandLifecyclePolicyFrom(SEEDED, { releaseSlotOnCompletion })).find(
      (l) => l.column === 'route_policies.cooldown_seconds',
    );

  it('OFF: reports the cooldown as inert, because the unique index dominates it', () => {
    expect(cooldownEntry(false)?.kind).toBe('inert_at_seeded_value');
  });

  it('ON: stops reporting it as inert, because that entry\'s reasoning no longer holds', () => {
    // The entry's note says the cooldown is DOMINATED by the unique index and
    // to raise it above the TTL. With the slot released for the length of the
    // action that argument has stopped applying, so publishing it would send an
    // operator to tune a dial on reasoning that no longer describes the system.
    //
    // Dropping it asserts nothing about the cooldown now biting - measured, it
    // still does not fire on any preset.
    expect(cooldownEntry(true)).toBeUndefined();
  });

  it('the three dead columns are unaffected by the flag either way', () => {
    // command_ttl_seconds / ack_timeout_seconds / retry_count are dead because
    // NO CODE READS THEM. Releasing the slot on completion does not change
    // that, and must not be reported as if it had.
    const dead = (release: boolean) =>
      inertLimitsFor(commandLifecyclePolicyFrom(SEEDED, { releaseSlotOnCompletion: release }))
        .filter((l) => l.kind === 'dead_column')
        .map((l) => l.column)
        .sort();
    expect(dead(true)).toEqual(dead(false));
    expect(dead(true)).toEqual([
      'route_policies.ack_timeout_seconds',
      'route_policies.command_ttl_seconds',
      'route_policies.retry_count',
    ]);
  });
});
