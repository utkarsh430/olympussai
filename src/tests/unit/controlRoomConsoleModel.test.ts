import { describe, it, expect } from 'vitest';
import {
  buildConsoleKpi,
  commandsHaltedFor,
  type ControlRoomOverview,
} from '@/lib/ops/controlRoomOverviewModel';
import { isObserved, readingDisplay } from '@/lib/ops/consoleReadings';
import {
  describeBasis,
  describeRejection,
  describeSampleAge,
  engineCommandSummary,
  humanOriginatedActions,
  isRecommendationExpired,
  matchingApproval,
  sampleAge,
  type PendingApproval,
} from '@/lib/ops/recommendationView';
import { COMMAND_ACTION_TYPES, ENGINE_ACTION_TYPES, type EngineCandidateAction } from '@/models/control';
import type { KillSwitchRecord } from '@/lib/auth/rbac/repo';

/**
 * The control-room console's two load-bearing claims, tested where they are
 * decided rather than where they are painted.
 *
 *   1. It never invents a number. Every upstream here degrades to an empty
 *      array plus a flag, so the difference between "no guardrail breaches
 *      today" and "the breach list could not be read" is one boolean — and
 *      getting it wrong renders a confident `0` during an outage. These tests
 *      walk each source through both states and assert the strip distinguishes
 *      them.
 *   2. It never lets the engine issue anything by itself, and never describes
 *      the engine as more capable than it is.
 */

function overview(patch: Partial<ControlRoomOverview> = {}): ControlRoomOverview {
  return {
    fetchedAt: '2026-08-13T10:00:00.000Z',
    routeDirections: [
      { routeDirectionId: 'dir-1', routeId: 'R1', directionCode: 'up', isLoop: false, totalDistanceMeters: 18000 },
    ],
    selectedRouteDirectionId: 'dir-1',
    corridors: { ok: true, mapped: 1, detecting: 1 },
    fleet: { reporting: 9170, source: 'live', stale: false, error: null },
    observability: { ok: true, stale: false, error: null, noActivePolicy: false },
    headway: {
      routeDirectionId: 'dir-1',
      sampleCount: 12,
      meanHeadwaySeconds: 540,
      stddevHeadwaySeconds: 120,
      cv: 0.22,
      ewtSeconds: 95,
      targetHeadwaySeconds: 600,
    },
    incidents: [],
    dailyKpi: { ok: true, row: null },
    guardrails: { ok: true, total: 0, critical: 0 },
    killSwitches: { ok: true, active: [] },
    ...patch,
  };
}

function tile(model: ReturnType<typeof buildConsoleKpi>, label: string) {
  const found = model.tiles.find((entry) => entry.label === label);
  if (!found) throw new Error(`no tile labelled ${label}`);
  return found;
}

describe('console status band — a zero is only ever a measured zero', () => {
  it('reports a real zero as observed when the source answered', () => {
    const model = buildConsoleKpi(overview({ guardrails: { ok: true, total: 0, critical: 0 } }));
    const breaches = tile(model, 'Guardrail breaches');
    expect(breaches.reading.availability).toBe('observed');
    expect(breaches.reading.value).toBe(0);
    expect(readingDisplay(breaches.reading)).toBe('0');
  });

  it('refuses to render a zero when the guardrail source did not answer', () => {
    const model = buildConsoleKpi(overview({ guardrails: { ok: false, total: 0, critical: 0 } }));
    const breaches = tile(model, 'Guardrail breaches');
    expect(breaches.reading.availability).toBe('unavailable');
    expect(breaches.reading.value).toBeNull();
    // The distinction has to survive all the way to the glyph: an operator
    // scanning the strip mid-incident does not read hint lines.
    expect(readingDisplay(breaches.reading)).toBe('n/a');
    expect(model.degraded).toContain('guardrail breaches');
  });

  it('refuses to report "no open incidents" when the control service is down', () => {
    const down = buildConsoleKpi(
      overview({ observability: { ok: false, stale: true, error: 'timeout', noActivePolicy: false }, incidents: [] }),
    );
    expect(tile(down, 'Open incidents').reading.availability).toBe('unavailable');
    expect(readingDisplay(tile(down, 'Open incidents').reading)).toBe('n/a');

    const up = buildConsoleKpi(overview({ observability: { ok: true, stale: false, error: null, noActivePolicy: false }, incidents: [] }));
    expect(tile(up, 'Open incidents').reading.availability).toBe('observed');
    expect(tile(up, 'Open incidents').reading.value).toBe(0);
    expect(tile(up, 'Open incidents').reading.detail).toMatch(/clear/i);
  });

  // With no corridor selected these two tiles used to read "0 / this corridor
  // is clear" and "0 / none recorded" - trivially true, and phrased as a
  // report on a corridor that does not exist. Every neighbouring tile already
  // printed `—` in that state, so they were also the only two on the strip
  // disagreeing with the rest of it.
  it('reports no corridor as no reading, not as a clear corridor', () => {
    const none = buildConsoleKpi(
      overview({ selectedRouteDirectionId: null, incidents: [], guardrails: { ok: true, total: 0, critical: 0 } }),
    );

    expect(tile(none, 'Open incidents').reading.availability).toBe('not-yet-computed');
    expect(readingDisplay(tile(none, 'Open incidents').reading)).toBe('—');
    expect(tile(none, 'Open incidents').reading.detail).toBe('no corridor selected');
    expect(tile(none, 'Open incidents').reading.detail).not.toMatch(/clear/i);

    expect(tile(none, 'Guardrail breaches').reading.availability).toBe('not-yet-computed');
    expect(readingDisplay(tile(none, 'Guardrail breaches').reading)).toBe('—');
    expect(tile(none, 'Guardrail breaches').reading.detail).toBe('no corridor selected');
    expect(tile(none, 'Guardrail breaches').reading.detail).not.toMatch(/none recorded/i);

    // Nothing failed, so nothing is reported as degraded. "No corridor" is not
    // an outage and must not be dressed as one.
    expect(none.degraded).toEqual([]);
  });

  it('still says "the control service did not answer" ahead of "no corridor"', () => {
    // Order matters: an outage is the more important fact, and a dash where
    // an `n/a` belongs would understate it.
    const down = buildConsoleKpi(
      overview({
        selectedRouteDirectionId: null,
        observability: { ok: false, stale: true, error: 'timeout', noActivePolicy: false },
        guardrails: { ok: false, total: 0, critical: 0 },
      }),
    );
    expect(tile(down, 'Open incidents').reading.availability).toBe('unavailable');
    expect(tile(down, 'Guardrail breaches').reading.availability).toBe('unavailable');
  });

  /**
   * THE DEFECT: the status band claimed an outage that did not happen.
   *
   * With no corridor chosen the console selects the first active
   * route-direction the control service lists. On the live network that
   * corridor has no active headway policy, so `GET .../headway` answers 404
   * `no_active_policy` - a deliberate, documented signal that bunching
   * detection is off for it (control-service/src/headway/repository.ts:
   * "Detection is off, and saying so out loud is the entire point"). That
   * rejected the snapshot's Promise.all, the whole read fell to
   * `source: 'unavailable'`, and every corridor tile printed `n/a - the
   * control service did not answer`.
   *
   * It did answer. Three times, twice with 200s. Reporting an outage on a page
   * whose whole premise is honest readouts is the worst available failure, and
   * it was the DEFAULT view of the console.
   */
  describe('a corridor with no active policy is not an outage', () => {
    const noPolicy = () =>
      buildConsoleKpi(
        overview({
          observability: {
            ok: false,
            stale: true,
            error: 'No active route policy for route-direction dir-1',
            noActivePolicy: true,
          },
          headway: null,
          incidents: [],
        }),
      );

    it('does not accuse the control service of failing to answer', () => {
      const model = noPolicy();
      for (const t of model.tiles) {
        expect(t.reading.detail).not.toMatch(/did not answer/i);
      }
      expect(model.degraded).not.toContain('the control service');
      expect(model.degraded).toEqual([]);
    });

    it('prints the nothing-to-report dash, not the unknown n/a', () => {
      const model = noPolicy();
      for (const label of ['Mean headway', 'Headway CV', 'Excess wait', 'Open incidents']) {
        const reading = tile(model, label).reading;
        expect(reading.availability, label).toBe('not-yet-computed');
        expect(readingDisplay(reading), label).toBe('—');
        expect(reading.detail, label).toMatch(/no active headway policy/i);
      }
    });

    it('explains the corridor in its own line, separate from the outage line', () => {
      const model = noPolicy();
      expect(model.corridorNotice).toMatch(/answered/i);
      expect(model.corridorNotice).toMatch(/no active headway policy/i);
      expect(model.corridorNotice).not.toMatch(/did not answer|unavailable|outage/i);
    });

    // A real outage must still read as one; the fix must not soften it.
    it('still reports a genuine outage as an outage', () => {
      const down = buildConsoleKpi(
        overview({
          observability: { ok: false, stale: true, error: 'timeout', noActivePolicy: false },
          headway: null,
        }),
      );
      expect(tile(down, 'Mean headway').reading.availability).toBe('unavailable');
      expect(readingDisplay(tile(down, 'Mean headway').reading)).toBe('n/a');
      expect(tile(down, 'Mean headway').reading.detail).toMatch(/did not answer/i);
      expect(down.degraded).toContain('the control service');
      expect(down.corridorNotice).toBeNull();
    });

    // The sources that answered normally are untouched: this is a per-corridor
    // fact about the headway policy, not a reason to blank the whole strip.
    it('leaves unrelated readings alone', () => {
      const model = noPolicy();
      expect(tile(model, 'Vehicles reporting').reading.availability).toBe('observed');
      expect(tile(model, 'Vehicles reporting').reading.value).toBe(9170);
      expect(tile(model, 'Guardrail breaches').reading.availability).toBe('observed');
    });

    // The one number it must NOT print is a confident zero: the incident read
    // was abandoned along with the headway read, so the console holds no
    // answer of its own even though the detector cannot have opened one.
    it('does not fabricate a clear corridor', () => {
      const incidents = tile(noPolicy(), 'Open incidents').reading;
      expect(incidents.value).toBeNull();
      expect(incidents.detail).not.toMatch(/clear/i);
    });
  });

  it('separates "no headway sample yet" from "the control service did not answer"', () => {
    const notYet = buildConsoleKpi(overview({ headway: null }));
    expect(tile(notYet, 'Mean headway').reading.availability).toBe('not-yet-computed');
    expect(readingDisplay(tile(notYet, 'Mean headway').reading)).toBe('—');

    const down = buildConsoleKpi(
      overview({ observability: { ok: false, stale: true, error: 'timeout', noActivePolicy: false } }),
    );
    expect(tile(down, 'Mean headway').reading.availability).toBe('unavailable');
    expect(readingDisplay(tile(down, 'Mean headway').reading)).toBe('n/a');
  });

  it('separates "no KPI roll-up for this corridor yet" from "the roll-up could not be read"', () => {
    const notYet = buildConsoleKpi(overview({ dailyKpi: { ok: true, row: null } }));
    expect(tile(notYet, 'Recovery rate').reading.availability).toBe('not-yet-computed');
    expect(tile(notYet, 'Recovery rate').reading.detail).toMatch(/no roll-up for this corridor yet/i);

    const down = buildConsoleKpi(overview({ dailyKpi: { ok: false, row: null } }));
    expect(tile(down, 'Recovery rate').reading.availability).toBe('unavailable');
    expect(down.degraded).toContain("today's KPI roll-up");
  });

  it('shows the recovery rate only when the roll-up actually carries one', () => {
    const row = {
      routeDirectionId: 'dir-1',
      publicName: 'R1',
      directionCode: 'up',
      snapshotDate: '2026-08-13',
      sampleCount: 40,
      meanHeadwaySeconds: 560,
      ewtSeconds: 88,
      cv: 0.2,
      incidentCount: 4,
      recoveredIncidentCount: 3,
      recoveryRate: 0.75,
      guardrailBreachCount: 0,
      complianceSampleCount: 10,
      compliancePct: 0.9,
      computedAt: '2026-08-13T09:00:00.000Z',
    };
    const model = buildConsoleKpi(overview({ dailyKpi: { ok: true, row } }));
    const recovery = tile(model, 'Recovery rate');
    expect(recovery.reading.value).toBe(0.75);
    expect(readingDisplay(recovery.reading, recovery.format)).toBe('75%');
    expect(recovery.reading.detail).toContain('3/4 incidents today');

    // A row present but with a null rate is "not computed", never 0%.
    const nullRate = buildConsoleKpi(overview({ dailyKpi: { ok: true, row: { ...row, recoveryRate: null } } }));
    expect(tile(nullRate, 'Recovery rate').reading.availability).toBe('not-yet-computed');
  });

  it('never draws a vehicle count when the fleet feed is down', () => {
    const model = buildConsoleKpi(overview({ fleet: { reporting: 0, source: 'unavailable', stale: true, error: 'x' } }));
    expect(tile(model, 'Vehicles reporting').reading.availability).toBe('unavailable');
    expect(model.fleetBadge.variant).toBe('critical');
    expect(model.degraded).toContain('the vehicle feed');
  });

  it('marks bundled demo vehicles as demo data, using the shared provenance chip', () => {
    const model = buildConsoleKpi(overview({ fleet: { reporting: 12, source: 'fixture', stale: true, error: 'x' } }));
    expect(model.fleetBadge).toEqual({ variant: 'fixture', label: 'Demo data' });
  });

  it('keeps every reading independent, so one dead source does not blank the live ones', () => {
    const model = buildConsoleKpi(
      overview({
        guardrails: { ok: false, total: 0, critical: 0 },
        dailyKpi: { ok: false, row: null },
      }),
    );
    // Headway and the fleet were fine and must still read as measured.
    expect(isObserved(tile(model, 'Mean headway').reading)).toBe(true);
    expect(isObserved(tile(model, 'Vehicles reporting').reading)).toBe(true);
    expect(isObserved(tile(model, 'Guardrail breaches').reading)).toBe(false);
    expect(model.degraded).toHaveLength(2);
  });

  it('says the kill-switch state is UNKNOWN rather than clear when the record cannot be read', () => {
    const model = buildConsoleKpi(overview({ killSwitches: { ok: false, active: [] } }));
    expect(model.killSwitchNotice).not.toBeNull();
    expect(model.killSwitchNotice?.engaged).toBe(false);
    expect(model.killSwitchNotice?.label).toMatch(/unknown/i);
  });

  it('says nothing at all when the record was read and is genuinely clear', () => {
    expect(buildConsoleKpi(overview()).killSwitchNotice).toBeNull();
  });

  it('leads with the network kill switch when one is engaged', () => {
    const network: KillSwitchRecord = {
      id: 'ks-1',
      scope: 'network',
      routeDirectionId: null,
      engagedAt: '2026-08-13T09:00:00.000Z',
      engagedBy: 'user-1',
      reason: 'depot-wide comms failure',
      disengagedAt: null,
      disengagedBy: null,
      disengageReason: null,
    };
    const model = buildConsoleKpi(overview({ killSwitches: { ok: true, active: [network] } }));
    expect(model.killSwitchNotice?.engaged).toBe(true);
    expect(model.killSwitchNotice?.detail).toContain('depot-wide comms failure');
  });
});

/**
 * Scope labelling, and the coverage pair that keeps the statewide half honest.
 *
 * THE DEFECT: six of the seven tiles described one corridor and the seventh
 * was a statewide vehicle count, with nothing on the strip distinguishing
 * them. Read together — 9,190 vehicles beside a corridor's headway — they said
 * "the whole network is monitored", on a console that could see 47 corridors
 * of a network the repository documents as roughly 650, and could detect on
 * only 14 of those. Every number was true and the impression was not.
 *
 * The fix is a scope on every tile plus a counted coverage pair, so these
 * tests care about two things: that no tile is scope-ambiguous, and that the
 * coverage figures are derived from the corridor list rather than stated.
 */
describe('console status band — scope is never ambiguous', () => {
  it('gives every tile a scope', () => {
    // An unscoped tile is the original defect returning by the back door: it
    // would render in whichever group happened to be first and quietly acquire
    // that group's meaning.
    const model = buildConsoleKpi(overview());
    for (const entry of model.tiles) {
      expect(entry.scope, `tile ${entry.label} has no scope`).toMatch(/^(network|corridor)$/);
    }
  });

  it('scopes the statewide vehicle count and the coverage pair apart from the corridor readings', () => {
    const model = buildConsoleKpi(overview());
    const scoped = (scope: string) => model.tiles.filter((entry) => entry.scope === scope).map((entry) => entry.label);

    expect(scoped('network')).toEqual(['Vehicles reporting', 'Corridor coverage']);
    // The six that describe one corridor. Named explicitly rather than counted:
    // a tile silently moving between groups is exactly the regression that
    // would restore the misleading reading.
    expect(scoped('corridor')).toEqual([
      'Mean headway',
      'Headway CV',
      'Excess wait',
      'Open incidents',
      'Recovery rate',
      'Guardrail breaches',
    ]);
  });

  it('says the vehicle count covers every depot, not every corridor', () => {
    // The count is of buses reporting GPS anywhere in the state, and it has no
    // relationship at all to the corridors below it.
    expect(tile(buildConsoleKpi(overview()), 'Vehicles reporting').reading.detail).toBe('every depot, live feed');
  });
});

describe('console status band — corridor coverage is derived, and never a network total', () => {
  const coverage = (patch: Partial<ControlRoomOverview['corridors']>) =>
    buildConsoleKpi(overview({ corridors: { ok: true, mapped: 47, detecting: 14, ...patch } }));

  it('shows how many corridors can report, out of how many are mapped', () => {
    const model = coverage({});
    const readout = tile(model, 'Corridor coverage');
    expect(readout.reading.availability).toBe('observed');
    expect(readout.reading.value).toBe(14);
    expect(readout.unit).toBe('of 47 mapped');
    expect(readout.reading.detail).toBe('can report bunching');
  });

  it('follows the numbers it is given rather than holding any of its own', () => {
    // The seeder maps more of the network while the console is open. Nothing
    // here may be a constant — including at full coverage, which must not
    // still be phrased as a shortfall.
    const early = coverage({ mapped: 3, detecting: 0 });
    expect(tile(early, 'Corridor coverage').reading.value).toBe(0);
    expect(tile(early, 'Corridor coverage').unit).toBe('of 3 mapped');

    const complete = coverage({ mapped: 651, detecting: 651 });
    expect(tile(complete, 'Corridor coverage').reading.value).toBe(651);
    expect(tile(complete, 'Corridor coverage').unit).toBe('of 651 mapped');
    expect(complete.coverageNotice).toContain('All 651 mapped corridors');
    expect(complete.coverageNotice).not.toMatch(/will show nothing/);
  });

  it('never states a network total, at any coverage level', () => {
    // The load-bearing assertion of the whole change. `route_directions` holds
    // only what has been seeded, so a ratio drawn from it would have printed
    // "47 of 47" — a claim of complete coverage — and the live feed's route
    // ids did not intersect the seeded ones at all. Neither denominator is
    // real, so the console says it does not have one.
    for (const patch of [{}, { mapped: 3, detecting: 0 }, { mapped: 651, detecting: 651 }, { mapped: 1, detecting: 1 }]) {
      const notice = coverage(patch).coverageNotice ?? '';
      expect(notice).toContain('the size of the full network is not known here');
      expect(notice).toContain('not a whole-network view');
    }
  });

  it('names the corridors that can be chosen but will show nothing', () => {
    const notice = coverage({ mapped: 47, detecting: 14 }).coverageNotice ?? '';
    expect(notice).toContain('14 of 47 mapped corridors');
    expect(notice).toContain('33 others can be selected but will show nothing');
  });

  it('refuses to print a coverage figure the console did not read', () => {
    // A stale or empty corridor list must read as unknown. `0 of 0 mapped`
    // during a control-service outage would be the same fabricated zero the
    // rest of this strip exists to prevent.
    const model = buildConsoleKpi(overview({ corridors: { ok: false, mapped: 0, detecting: 0 } }));
    const readout = tile(model, 'Corridor coverage');
    expect(readout.reading.availability).toBe('unavailable');
    expect(readingDisplay(readout.reading)).toBe('n/a');
    // And no coverage sentence at all: the degraded line already says the
    // control service did not answer, and a second sentence about coverage
    // nobody counted would be noise on top of it.
    expect(model.coverageNotice).toBeNull();
  });

  it('reports unknown detection as unknown rather than as no detection', () => {
    // `detecting: null` is a control service that does not report policy
    // state. Rendering it as 0 would accuse a healthy network of being blind.
    const model = coverage({ mapped: 47, detecting: null });
    const readout = tile(model, 'Corridor coverage');
    expect(readout.reading.value).toBe(47);
    expect(readout.unit).toBe('mapped');
    expect(readout.reading.detail).toBe('detection coverage not reported');
    expect(model.coverageNotice).toContain('does not report which of them have an active headway policy');
  });

  it('keeps the coverage line out of the way of a real fault', () => {
    // It is true on a perfectly healthy console and will be read every shift,
    // so it must never be worded or classed as a problem — the degraded line
    // is the one that has to keep its power to interrupt.
    const notice = coverage({}).coverageNotice ?? '';
    expect(notice).not.toMatch(/unavailable|did not answer|error|fail/i);
  });
});

describe('commandsHaltedFor', () => {
  const route = (routeDirectionId: string): KillSwitchRecord => ({
    id: `ks-${routeDirectionId}`,
    scope: 'route',
    routeDirectionId,
    engagedAt: '2026-08-13T09:00:00.000Z',
    engagedBy: 'user-1',
    reason: 'roadworks',
    disengagedAt: null,
    disengagedBy: null,
    disengageReason: null,
  });

  it('halts only the corridor its switch names', () => {
    const switches = { ok: true, active: [route('dir-2')] };
    expect(commandsHaltedFor(switches, 'dir-2')).not.toBeNull();
    expect(commandsHaltedFor(switches, 'dir-1')).toBeNull();
  });

  it('halts every corridor when the switch is network-wide', () => {
    const network = { ...route('dir-2'), scope: 'network' as const, routeDirectionId: null };
    expect(commandsHaltedFor({ ok: true, active: [network] }, 'dir-1')).not.toBeNull();
  });

  it('does not guess "halted" from an unreadable record — the command endpoint is the authority', () => {
    expect(commandsHaltedFor({ ok: false, active: [] }, 'dir-1')).toBeNull();
  });
});

// ---------------------------------------------------------------------------

function candidate(patch: Partial<EngineCandidateAction> = {}): EngineCandidateAction {
  return {
    actionType: 'two_way_hold',
    vehicleId: 'UP25FT4823',
    involvedVehicleIds: ['UP25FT4823', 'UP25FT7778'],
    holdSeconds: 36,
    objectiveCost: 0,
    routeDirectionId: 'dir-1',
    stateAsOf: '2026-08-13T10:00:00.000Z',
    headwayDeviationSeconds: -180,
    targetHeadwaySeconds: 600,
    ...patch,
  };
}

function approval(patch: Partial<PendingApproval> = {}): PendingApproval {
  return {
    id: 'appr-1',
    actionType: 'two_way_hold',
    vehicleId: 'UP25FT4823',
    routeDirectionId: 'dir-1',
    reason: 'bunching on the corridor',
    createdAt: '2026-08-13T09:59:00.000Z',
    decision: 'pending',
    ...patch,
  };
}

describe('engine proposal — the one-click issue never bypasses an approval', () => {
  it('matches only an approval for the exact same action, vehicle and corridor', () => {
    const action = candidate();
    expect(matchingApproval(action, [approval()])?.id).toBe('appr-1');

    // Each field on its own must break the match — this is the same triple
    // POST /commands re-checks server-side as APPROVAL_MISMATCH.
    expect(matchingApproval(action, [approval({ actionType: 'self_equalizing_hold' })])).toBeNull();
    expect(matchingApproval(action, [approval({ vehicleId: 'UP25FT9999' })])).toBeNull();
    expect(matchingApproval(action, [approval({ routeDirectionId: 'dir-2' })])).toBeNull();
  });

  it('will not match an approval that names no vehicle or no corridor', () => {
    // An approval that never named a vehicle did not authorize a command for
    // one. Exact equality including against null is the whole point.
    expect(matchingApproval(candidate(), [approval({ vehicleId: null })])).toBeNull();
    expect(matchingApproval(candidate(), [approval({ routeDirectionId: null })])).toBeNull();
  });

  it('will not match an approval that has already been spent or refused', () => {
    expect(matchingApproval(candidate(), [approval({ decision: 'approved' })])).toBeNull();
    expect(matchingApproval(candidate(), [approval({ decision: 'rejected' })])).toBeNull();
  });

  it('finds the right approval among several near-misses', () => {
    const found = matchingApproval(candidate(), [
      approval({ id: 'wrong-vehicle', vehicleId: 'UP25FT0001' }),
      approval({ id: 'wrong-action', actionType: 'stop_skip' }),
      approval({ id: 'right' }),
    ]);
    expect(found?.id).toBe('right');
  });
});

describe('engine proposal — what the operator is told', () => {
  it('treats "every candidate rejected" as a warning, not as silence', () => {
    const basis = describeBasis('all_candidates_rejected', 2);
    expect(basis.tone).toBe('critical');
    expect(basis.headline).toMatch(/refused every option/i);
    expect(basis.detail).toMatch(/not a quiet corridor/i);
  });

  it('treats "no candidates" as genuinely nothing to regulate', () => {
    const basis = describeBasis('no_candidates', 0);
    expect(basis.tone).toBe('good');
    expect(basis.detail).toMatch(/at or beyond its target headway/i);
  });

  it('explains terminal-dispatch priority as a hierarchy, not as a score', () => {
    expect(describeBasis('terminal_dispatch_priority', 0).detail).toMatch(/least disruptive/i);
  });

  it('blames the stale reading on the dependency set, not on the named bus', () => {
    // The common real case: UP25FT4823 is healthy and its LEADER stopped
    // reporting. Copy that says "this bus is stale" sends an operator to
    // inspect the wrong vehicle.
    const copy = describeRejection('stale_state', candidate(), {});
    expect(copy).toMatch(/data this depends on is stale/i);
    expect(copy).toContain('UP25FT7778');
    expect(copy).toMatch(/often the leader/i);
    // "At least one of" — the filter does not say WHICH dependency went quiet,
    // and claiming all of them did would send an operator chasing a bus that
    // is reporting perfectly well.
    expect(copy).toMatch(/at least one of the readings/i);
  });

  it('names only the bus itself when nothing else was depended on', () => {
    const solo = candidate({ involvedVehicleIds: ['UP25FT4823'] });
    const copy = describeRejection('stale_state', solo, {});
    expect(copy).toContain("UP25FT4823's own reading");
    // No leader was involved, so the leader hint would be a false lead.
    expect(copy).not.toMatch(/often the leader/i);
  });

  it('quotes the corridor policy cap when the hold was too long', () => {
    expect(describeRejection('max_hold_cap_breach', candidate(), { maxHoldSeconds: 120 })).toContain('120s');
  });

  it('says an active command conflicts, naming the bus that has one', () => {
    expect(describeRejection('conflicting_active_command', candidate(), {})).toContain('UP25FT4823');
  });
});

describe('engine scope — the six human-originated instructions are derived, not hardcoded', () => {
  it('subtracts what the engine reports it can propose from the nine dispatchable types', () => {
    const human = humanOriginatedActions(ENGINE_ACTION_TYPES);
    expect(human).toHaveLength(6);
    expect(human).not.toContain('terminal_dispatch_hold');
    expect(human).toContain('stop_skip');
    expect(human).toContain('standby_injection');
    expect(human.length + ENGINE_ACTION_TYPES.length).toBe(COMMAND_ACTION_TYPES.length);
  });

  it('stops calling an action human-originated the moment the engine can propose it', () => {
    // The claim "nothing in this system generates these" must not outlive its
    // truth. If the solver ever learns stop_skip, this console stops saying it
    // with no edit to the UI.
    const human = humanOriginatedActions([...ENGINE_ACTION_TYPES, 'stop_skip']);
    expect(human).not.toContain('stop_skip');
    expect(human).toHaveLength(5);
  });
});

describe('engine proposal — expiry and audit text', () => {
  it('expires a recommendation once its safety verdict has aged out', () => {
    const solvedAt = '2026-08-13T10:00:00.000Z';
    const at = Date.parse(solvedAt);
    expect(isRecommendationExpired(solvedAt, at + 30_000)).toBe(false);
    expect(isRecommendationExpired(solvedAt, at + 120_000)).toBe(true);
  });

  it('treats an unparseable solve time as expired rather than as current', () => {
    expect(isRecommendationExpired('not-a-date', Date.now())).toBe(true);
  });

  it('records the engine as the author, with the version and the sample it reasoned over', () => {
    // The solve itself is never persisted, so this summary is the only place
    // the engine's authorship survives into the audit record.
    const summary = engineCommandSummary(candidate(), 'terminal-two-way-self-equalizing-v1', '2026-08-13T10:00:05.000Z');
    expect(summary).toContain('terminal-two-way-self-equalizing-v1');
    expect(summary).toContain('2026-08-13T10:00:00.000Z');
    expect(summary).toContain('UP25FT4823');
    expect(summary).toMatch(/not auto-issued/i);
  });
});

/**
 * A reading stamped in the FUTURE, which the panel used to render as the most
 * reassuring number on it.
 *
 * `sampleAgeSeconds` clamped with `Math.max(0, …)`, so an `observed_at` ahead
 * of now displayed as "Reading age 0s" — permanently, since the clamp does not
 * age. A read-only query against the live control database found a
 * `vehicle_states` row at `observed_at = 2046-03-27`, ~19.6 years ahead, so
 * this is a real row on a real corridor and not a hypothetical.
 */
describe('sample age — a reading from the future is a state, not a zero', () => {
  const NOW = Date.parse('2026-08-13T10:00:00.000Z');

  it('reports an ordinary elapsed age', () => {
    expect(sampleAge('2026-08-13T09:59:15.000Z', NOW)).toEqual({ state: 'aged', ageSeconds: 45 });
    expect(describeSampleAge(sampleAge('2026-08-13T09:59:15.000Z', NOW))).toEqual({
      label: '45s',
      tone: 'default',
    });
  });

  it('warns once a reading is over a minute old', () => {
    expect(describeSampleAge(sampleAge('2026-08-13T09:58:00.000Z', NOW)).tone).toBe('warn');
  });

  it('names a future-dated reading instead of clamping it to zero', () => {
    const age = sampleAge('2046-03-27T00:00:00.000Z', NOW);
    expect(age.state).toBe('future');
    const described = describeSampleAge(age);
    // The exact thing the old code could not say. "0s" was not merely
    // imprecise here, it was the opposite of the truth.
    expect(described.label).not.toBe('0s');
    expect(described.label).toContain('ahead');
    expect(described.label).toContain('19.6 years');
    expect(described.tone).toBe('critical');
  });

  it('treats a couple of minutes ahead as clock skew, not as a defect', () => {
    // The browser clock and the clock that stamped the reading are different
    // clocks. Crying wolf on ordinary skew would train operators to ignore it.
    expect(sampleAge('2026-08-13T10:00:30.000Z', NOW)).toEqual({ state: 'aged', ageSeconds: 0 });
    expect(describeSampleAge(sampleAge('2026-08-13T10:00:30.000Z', NOW)).tone).toBe('default');
  });

  it('says a timestamp it cannot read is unknown, never fresh', () => {
    expect(sampleAge('not-a-date', NOW)).toEqual({ state: 'unreadable' });
    expect(describeSampleAge(sampleAge('not-a-date', NOW))).toEqual({
      label: 'unknown',
      tone: 'warn',
    });
  });

  it('sizes a future span so an operator can read it', () => {
    const ahead = (seconds: number) =>
      describeSampleAge(sampleAge(new Date(NOW + seconds * 1000).toISOString(), NOW)).label;
    expect(ahead(600)).toBe('dated 10m ahead');
    expect(ahead(7_200)).toBe('dated 2h ahead');
    expect(ahead(864_000)).toBe('dated 10d ahead');
  });
});
