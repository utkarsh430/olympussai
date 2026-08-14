// @vitest-environment node
//
// The admin overview's numbers, and what it says when it cannot read one.
//
// Every tile on that screen is a claim about a control the admin owns: how
// many people hold access, how many corridors will accept a command, how much
// of the network can actually detect anything. Those are precisely the
// readings where a confident zero during an outage is the dangerous answer —
// "0 corridors accept commands" reads as a safely locked-down network, and it
// is exactly what a dead control service produces. So the degraded cases get
// as much attention here as the healthy ones.
import { describe, it, expect } from 'vitest';
import {
  buildAdminConsoleModel,
  tallyStages,
  emptyStageTally,
  type AdminConsoleFacts,
} from '@/lib/ops/adminConsoleModel';
import { readingDisplay } from '@/lib/ops/consoleReadings';
import type { RolloutStage } from '@/models/control';

function facts(overrides: Partial<AdminConsoleFacts> = {}): AdminConsoleFacts {
  return {
    roster: {
      ok: true,
      total: 18,
      active: 18,
      disabled: 0,
      activeAdmins: 2,
      depotOperatorsWithoutDepot: 0,
      driversWithoutVehicle: 0,
    },
    invites: { ok: true, pending: 0, expired: 0 },
    rollout: {
      ok: true,
      total: 759,
      permittingCommands: 18,
      byStage: { ...emptyStageTally(), observation: 741, advisory: 18 },
      permittingWithoutGeometry: 0,
    },
    network: { ok: true, mapped: 759, detecting: 198 },
    ...overrides,
  };
}

function tile(model: ReturnType<typeof buildAdminConsoleModel>, label: string) {
  const found = model.groups.flatMap((g) => g.tiles).find((t) => t.label === label);
  if (!found) throw new Error(`no tile labelled ${label}`);
  return found;
}

describe('the healthy overview', () => {
  it('reports the roster, the command authority and the coverage it measured', () => {
    const model = buildAdminConsoleModel(facts());

    expect(readingDisplay(tile(model, 'Active accounts').reading)).toBe('18');
    expect(readingDisplay(tile(model, 'Corridors accepting commands').reading)).toBe('18');
    expect(tile(model, 'Corridors accepting commands').unit).toBe('of 759 staged');
    expect(readingDisplay(tile(model, 'Can detect bunching').reading)).toBe('198');
    expect(model.unreadable).toEqual([]);
  });

  it('says in words that the corridor pair is not a whole-network view', () => {
    // The honesty claim the control room already makes about these same two
    // numbers. A second surface showing them without the caption re-introduces
    // exactly the reading the caption exists to prevent.
    const model = buildAdminConsoleModel(facts());

    expect(model.coverageNotice).toContain('198 of 759');
    expect(model.coverageNotice).toContain('observation-only');
    expect(model.coverageNotice).toContain('the size of the full network is not known here');
  });

  it('raises nothing to act on when there is nothing to act on', () => {
    expect(buildAdminConsoleModel(facts()).attention).toEqual([]);
  });
});

describe('a source that did not answer', () => {
  it('never renders an unreadable roster as zero accounts', () => {
    const model = buildAdminConsoleModel(
      facts({
        roster: {
          ok: false,
          total: 0,
          active: 0,
          disabled: 0,
          activeAdmins: 0,
          depotOperatorsWithoutDepot: 0,
          driversWithoutVehicle: 0,
        },
      }),
    );

    expect(tile(model, 'Active accounts').reading.availability).toBe('unavailable');
    expect(readingDisplay(tile(model, 'Active accounts').reading)).toBe('n/a');
    expect(model.unreadable).toContain('the operator roster');
  });

  it('never renders a dead control service as a locked-down network', () => {
    // THE DANGEROUS ONE. `permittingCommands: 0` from a dead source and
    // `permittingCommands: 0` from a live one look identical in the fact
    // object and must not look identical on screen.
    const model = buildAdminConsoleModel(
      facts({
        rollout: {
          ok: false,
          total: 0,
          permittingCommands: 0,
          byStage: emptyStageTally(),
          permittingWithoutGeometry: null,
        },
      }),
    );

    expect(readingDisplay(tile(model, 'Corridors accepting commands').reading)).toBe('n/a');
    expect(tile(model, 'Corridors accepting commands').unit).toBeUndefined();
    // And it must not then claim the network is dangerously wide open either.
    expect(model.attention.map((a) => a.id)).not.toContain('no-command-authority');
    expect(model.unreadable).toContain('rollout stages');
  });

  it('stays silent about coverage it could not count', () => {
    const model = buildAdminConsoleModel(
      facts({ network: { ok: false, mapped: 0, detecting: null } }),
    );

    expect(model.coverageNotice).toBeNull();
    expect(readingDisplay(tile(model, 'Corridors mapped').reading)).toBe('n/a');
  });

  it('distinguishes "this service does not report policies" from "no corridors detect"', () => {
    // A control service predating the flag omits it. Counting that as zero
    // would report no detection capability against a network that may be fully
    // policied — the same fabrication the wire schema keeps the field optional
    // to avoid.
    const model = buildAdminConsoleModel(
      facts({ network: { ok: true, mapped: 759, detecting: null } }),
    );

    expect(readingDisplay(tile(model, 'Can detect bunching').reading)).toBe('n/a');
    expect(model.coverageNotice).toContain('does not report which of them');
    expect(model.coverageNotice).not.toContain('0 of 759');
  });
});

describe('what an admin is asked to act on', () => {
  it('names the consequence of an unassigned depot, not the missing column', () => {
    const model = buildAdminConsoleModel(
      facts({
        roster: { ...facts().roster, depotOperatorsWithoutDepot: 3 },
      }),
    );

    const item = model.attention.find((a) => a.id === 'depot-unassigned');
    expect(item?.title).toContain('3 depot operators');
    expect(item?.detail).toMatch(/refuses fleet data/i);
    // The fail-closed posture is deliberate and must not read as the bug.
    expect(item?.detail).toMatch(/deliberate/i);
  });

  it('names the consequence of an unassigned vehicle', () => {
    const model = buildAdminConsoleModel(
      facts({ roster: { ...facts().roster, driversWithoutVehicle: 1 } }),
    );

    const item = model.attention.find((a) => a.id === 'vehicle-unassigned');
    expect(item?.title).toBe('1 driver has no vehicle assigned');
    expect(item?.detail).toMatch(/instruction stream/i);
  });

  it('flags a network where nothing can be commanded — but only when it read one', () => {
    const model = buildAdminConsoleModel(
      facts({
        rollout: {
          ok: true,
          total: 759,
          permittingCommands: 0,
          byStage: { ...emptyStageTally(), observation: 759 },
          permittingWithoutGeometry: 0,
        },
      }),
    );

    const item = model.attention.find((a) => a.id === 'no-command-authority');
    expect(item?.tone).toBe('warning');
    expect(item?.detail).toMatch(/guardrail breach/i);
  });

  it('treats a lone administrator as a standing fact, not an alarm', () => {
    const model = buildAdminConsoleModel(
      facts({ roster: { ...facts().roster, activeAdmins: 1 } }),
    );

    const item = model.attention.find((a) => a.id === 'single-admin');
    expect(item?.tone).toBe('info');
    expect(tile(model, 'Administrators').tone).toBe('warn');
  });
});

describe('tallying stages', () => {
  it('counts each stage and the subset that permits commands', () => {
    const stages: RolloutStage[] = [
      'observation',
      'observation',
      'shadow',
      'advisory',
      'limited_auto',
      'expanded',
    ];

    expect(tallyStages(stages)).toEqual({
      byStage: { observation: 2, shadow: 1, advisory: 1, limited_auto: 1, expanded: 1 },
      permittingCommands: 3,
    });
  });

  it('starts every stage at zero, so a missing stage is a zero and not undefined', () => {
    expect(tallyStages([])).toEqual({
      byStage: { observation: 0, shadow: 0, advisory: 0, limited_auto: 0, expanded: 0 },
      permittingCommands: 0,
    });
  });
});

describe('staged route-directions with no mapped geometry', () => {
  it('says how many of the commandable corridors nobody can actually see', () => {
    // MEASURED, not hypothetical. Against the live control database: 18
    // route-directions at advisory, 17 of them QA end-to-end leftovers with no
    // geometry. "18 corridors accepting commands" would have overstated the
    // live pilot eighteenfold — with a number the console genuinely counted,
    // which is the most convincing kind of wrong.
    const model = buildAdminConsoleModel(
      facts({
        rollout: {
          ok: true,
          total: 776,
          permittingCommands: 18,
          byStage: { ...emptyStageTally(), observation: 758, advisory: 18 },
          permittingWithoutGeometry: 17,
        },
      }),
    );

    const item = model.attention.find((a) => a.id === 'staged-without-geometry');
    expect(item?.tone).toBe('warning');
    expect(item?.title).toContain('17 of the 18');
    expect(item?.detail).toContain('Only 1 is a real corridor');
    // Not dismissed as cosmetic: the gate reads their stage like any other.
    expect(item?.detail).toMatch(/permitted to command and nobody is watching/i);

    // And the tile keeps the count while carrying the caveat, because a staged
    // route-direction with no geometry IS still one the gate will permit.
    expect(readingDisplay(tile(model, 'Corridors accepting commands').reading)).toBe('18');
    expect(tile(model, 'Corridors accepting commands').reading.detail).toContain('17 unmapped');
  });

  it('raises nothing when every commandable corridor is mapped', () => {
    const model = buildAdminConsoleModel(
      facts({
        rollout: {
          ok: true,
          total: 759,
          permittingCommands: 18,
          byStage: { ...emptyStageTally(), observation: 741, advisory: 18 },
          permittingWithoutGeometry: 0,
        },
      }),
    );

    expect(model.attention.map((a) => a.id)).not.toContain('staged-without-geometry');
    expect(tile(model, 'Corridors accepting commands').reading.detail).toBe('advisory or above');
  });

  it('stays silent rather than claiming an all-clear it could not check', () => {
    // The mapped list did not answer, so the comparison has no second side.
    // "0 unmapped" would be an invented reassurance.
    const model = buildAdminConsoleModel(
      facts({
        rollout: {
          ok: true,
          total: 776,
          permittingCommands: 18,
          byStage: { ...emptyStageTally(), observation: 758, advisory: 18 },
          permittingWithoutGeometry: null,
        },
        network: { ok: false, mapped: 0, detecting: null },
      }),
    );

    expect(model.attention.map((a) => a.id)).not.toContain('staged-without-geometry');
    expect(tile(model, 'Corridors accepting commands').reading.detail).toBe('advisory or above');
  });
});
