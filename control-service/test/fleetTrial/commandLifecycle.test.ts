// What the trial must not get wrong once the command path is in the loop.
//
// Two things, and they pull in opposite directions. With the flag OFF nothing
// may change AT ALL, because every result this system has published was
// produced that way and a silent shift would invalidate every comparison
// anybody has drawn. With it ON the report must say plainly that it is now
// reporting a DELIVERED rate rather than the control law's intent, and must
// keep the two numbers apart.
import { describe, it, expect } from 'vitest';
import { runFleetTrial, DEFAULT_FLEET_TRIAL_SPEC } from '../../src/fleetTrial/run.js';
import { CORRIDOR_PRESETS } from '../../src/fleetTrial/presets.js';
import type { CorridorPresetId } from '../../src/fleetTrial/presets.js';
import { COMMAND_BLOCK_REASONS } from '../../src/simulation/commandLifecycle.js';

const PRESETS = Object.keys(CORRIDOR_PRESETS) as CorridorPresetId[];

/**
 * Small enough to run three presets twice in a test, dense enough to produce
 * holds on all three.
 *
 * Sized per scenario for the reason `fleetTrial.test.ts#SMALL` is: a flat
 * total thins out as the scenario library grows, and a corridor with two buses
 * has no trailer to measure h_bwd against.
 */
const SCENARIOS = ['slow_bus', 'traffic_shock', 'partial_compliance'] as const;
const SPEC = {
  ...DEFAULT_FLEET_TRIAL_SPEC,
  scenarios: [...SCENARIOS] as (typeof DEFAULT_FLEET_TRIAL_SPEC)['scenarios'],
  vehiclesPerPhase: SCENARIOS.length * 6,
};

describe('default OFF is not merely the old behaviour, it is the old bytes', () => {
  for (const preset of PRESETS) {
    it(`changes nothing on the ${preset} preset`, () => {
      const report = runFleetTrial({ ...SPEC, corridorPreset: preset });

      // 1. The report carries no lifecycle key at all. An ABSENT key is the
      //    statement that the command path was not in this loop; a present
      //    key holding zeros would claim it delivered nothing.
      expect('commandLifecycle' in report).toBe(false);

      // 2. No visit anywhere gained a field. `deliveredHoldSeconds` is spread
      //    onto a record only when a command path produced one, so an
      //    unmodelled run serializes exactly as it always did.
      const serialized = JSON.stringify(report);
      expect(serialized).not.toContain('deliveredHoldSeconds');
      expect(serialized).not.toContain('commandBlockedBy');

      // 3. `notExercised` still says the command lifecycle is not touched,
      //    word for word. A reader comparing against an older run must not
      //    find this sentence quietly reworded underneath them.
      expect(report.notExercised[0]).toBe(
        'The command lifecycle. Cooldown, minimum action interval, maximum concurrent actions, driver acknowledgement and command expiry all live in the command path, which this trial deliberately does not touch. A result here is the control law’s INTENT, not the rate at which instructions would actually reach a driver.',
      );
    });
  }

  it('is the default in the shipped spec, so nobody gets it by accident', () => {
    expect(DEFAULT_FLEET_TRIAL_SPEC.commandLifecycle.enabled).toBe(false);
    expect(DEFAULT_FLEET_TRIAL_SPEC.commandLifecycle.deliveryLatencySeconds).toBe(0);
  });
});

describe('with the command path on, the report keeps intent and delivery apart', () => {
  const report = runFleetTrial({
    ...SPEC,
    corridorPreset: 'urban',
    commandLifecycle: { enabled: true, deliveryLatencySeconds: 0 },
  });
  const lifecycle = report.commandLifecycle!;

  it('publishes both numbers, never one', () => {
    expect(lifecycle).toBeDefined();
    expect(lifecycle.intendedHoldSeconds).toBeGreaterThan(0);
    // THE FINDING. Delivered is strictly less than intended, because limits
    // that refuse nothing are limits worth deleting - and if this ever came
    // out equal the model would be reporting a command path that costs
    // nothing, which no operator would recognise.
    expect(lifecycle.deliveredHoldSeconds).toBeLessThan(lifecycle.intendedHoldSeconds);
    expect(lifecycle.servedHoldSeconds).toBeLessThanOrEqual(lifecycle.deliveredHoldSeconds);
    expect(lifecycle.deliveredShareOfIntent).toBeLessThan(1);
  });

  it('refuses instructions through the limits that carry a real seeded value', () => {
    const refused = COMMAND_BLOCK_REASONS.reduce((n, r) => n + lifecycle.blockedBy[r], 0);
    expect(lifecycle.proposals).toBeGreaterThan(0);
    expect(refused).toBeGreaterThan(0);
    expect(lifecycle.issued + refused).toBe(lifecycle.proposals);
    // At the default latency of 0, the only limit with an assumed value
    // behind it must refuse nothing - so the whole delivered figure rests on
    // seeded and shipped values.
    expect(lifecycle.blockedBy.arrived_after_departure).toBe(0);
    // Seeded at 0, minimum action excludes nothing. That it stays at zero
    // here is the same finding `inertLimits` states in prose.
    expect(lifecycle.blockedBy.below_minimum_action).toBe(0);
  });

  it('prices each refusal in hold seconds, not only in instructions', () => {
    for (const reason of COMMAND_BLOCK_REASONS) {
      if (lifecycle.blockedBy[reason] === 0) {
        expect(lifecycle.holdSecondsLostTo[reason]).toBe(0);
      } else {
        expect(lifecycle.holdSecondsLostTo[reason]).toBeGreaterThan(0);
      }
    }
  });

  it('names the dead columns in the report rather than implementing what they imply', () => {
    const dead = lifecycle.inertLimits.filter((l) => l.kind === 'dead_column').map((l) => l.column);
    expect(dead).toContain('route_policies.command_ttl_seconds');
    expect(dead).toContain('route_policies.ack_timeout_seconds');
    expect(dead).toContain('route_policies.retry_count');
    // And the TTL that IS applied is sourced honestly: a console constant,
    // not the column with the matching name.
    expect(lifecycle.limitProvenance.effectiveTtlSeconds).toBe('ui_constant');
    expect(lifecycle.limitProvenance.deliveryLatencySeconds).toBe('assumed');
  });

  it('rewrites the notExercised entry instead of deleting it', () => {
    // The entry does not go away when the path is modelled; it changes what it
    // says. Deleting it would leave a reader believing more is exercised than
    // is - dispatcher approval, redelivery and supersede are all still out.
    expect(report.notExercised[0]).toContain('PARTLY');
    expect(report.notExercised.slice(1)).toEqual(
      runFleetTrial({ ...SPEC, corridorPreset: 'urban' }).notExercised.slice(1),
    );
    expect(lifecycle.notModelled.length).toBeGreaterThan(0);
  });
});

describe('urban is the one preset whose hold cap the TTL cannot cut', () => {
  it('truncates on inter-city, where holds may run to 600 s against a 120 s TTL', () => {
    const intercity = runFleetTrial({
      ...SPEC,
      corridorPreset: 'intercity',
      commandLifecycle: { enabled: true, deliveryLatencySeconds: 0 },
    }).commandLifecycle!;
    const urban = runFleetTrial({
      ...SPEC,
      corridorPreset: 'urban',
      commandLifecycle: { enabled: true, deliveryLatencySeconds: 0 },
    }).commandLifecycle!;

    // Urban caps a hold at exactly the TTL, so expiry can never cut one there.
    // Inter-city caps at 600 s, so a long hold is taken off the driver's
    // screen mid-hold. Same modelled TTL, opposite exposure - which is why the
    // limit belongs in the loop rather than in a footnote.
    expect(urban.policy.effectiveTtlSeconds).toBe(120);
    expect(urban.truncatedByExpiry).toBe(0);
    expect(intercity.truncatedByExpiry).toBeGreaterThan(0);
  });
});
