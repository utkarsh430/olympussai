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
  engineCommandSummary,
  humanOriginatedActions,
  isRecommendationExpired,
  matchingApproval,
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
    fleet: { reporting: 9170, source: 'live', stale: false, error: null },
    observability: { ok: true, stale: false, error: null },
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
      overview({ observability: { ok: false, stale: true, error: 'timeout' }, incidents: [] }),
    );
    expect(tile(down, 'Open incidents').reading.availability).toBe('unavailable');
    expect(readingDisplay(tile(down, 'Open incidents').reading)).toBe('n/a');

    const up = buildConsoleKpi(overview({ observability: { ok: true, stale: false, error: null }, incidents: [] }));
    expect(tile(up, 'Open incidents').reading.availability).toBe('observed');
    expect(tile(up, 'Open incidents').reading.value).toBe(0);
    expect(tile(up, 'Open incidents').reading.detail).toMatch(/clear/i);
  });

  it('separates "no headway sample yet" from "the control service did not answer"', () => {
    const notYet = buildConsoleKpi(overview({ headway: null }));
    expect(tile(notYet, 'Mean headway').reading.availability).toBe('not-yet-computed');
    expect(readingDisplay(tile(notYet, 'Mean headway').reading)).toBe('—');

    const down = buildConsoleKpi(
      overview({ observability: { ok: false, stale: true, error: 'timeout' } }),
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
