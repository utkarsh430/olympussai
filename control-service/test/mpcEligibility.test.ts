// Whether a hold could actually be EXECUTED by the vehicle it names.
//
// Before `mpc/eligibility.ts`, `computeTwoWayCandidates` and
// `computeSelfEqualizingCandidates` checked nothing at all: they proposed a
// hold for any pair whose headways looked wrong, whatever the follower was
// doing. A bus doing 45 km/h halfway down a link would be told to "hold 240
// seconds", and nothing downstream caught it - the hard safety filter grades
// staleness, caps, conflicts and lateness, and the command path validates
// none of it.
//
// On a network whose median planned headway is 1,800 s, buses spend most of
// their time between stops, so most proposed mid-route holds named a vehicle
// that could not act. Driver compliance is the dominant real-world failure
// mode for this class of system and the fastest way to destroy it is to send
// instructions that cannot be followed.
import { describe, it, expect } from 'vitest';
import { canExecuteHold, holdExecutionStopId } from '../src/mpc/eligibility.js';
import type { VehicleStateRow } from '../src/state/store.js';

function vehicle(overrides: Partial<VehicleStateRow> = {}): VehicleStateRow {
  return {
    vehicleId: 'UP25FT4823',
    tripId: null,
    routeDirectionId: 'rd-1',
    position: null,
    distanceAlongRouteMeters: 5000,
    speedKmph: 0,
    headingDegrees: null,
    stopState: 'dwelling_at_stop',
    currentStopId: 'stop-A',
    confidence: 1,
    isLowConfidence: false,
    observedAt: new Date().toISOString(),
    occupancyCount: null,
    occupancyLoadBand: null,
    ...overrides,
  };
}

const NO_CONTROL_POINTS: ReadonlySet<string> = new Set<string>();
const CONTROL_POINTS: ReadonlySet<string> = new Set(['stop-A', 'stop-C']);

describe('holdExecutionStopId', () => {
  it('names the stop a dwelling vehicle would be held at', () => {
    expect(holdExecutionStopId(vehicle(), NO_CONTROL_POINTS)).toBe('stop-A');
  });

  // Arguably the BEST moment to issue one: the driver gets the instruction
  // before arriving and can plan for it, rather than being asked to sit
  // still after deciding to pull away.
  it('allows a vehicle approaching the stop, not only one already sitting at it', () => {
    expect(canExecuteHold(vehicle({ stopState: 'approaching_stop' }), NO_CONTROL_POINTS)).toBe(true);
  });

  // ─── THE DEFECT THIS MODULE CLOSES ─────────────────────────────────────

  it('refuses a vehicle that has already pulled away', () => {
    expect(canExecuteHold(vehicle({ stopState: 'departed_stop' }), NO_CONTROL_POINTS)).toBe(false);
  });

  it('refuses a vehicle mid-link with no stop at all', () => {
    expect(
      canExecuteHold(vehicle({ stopState: 'departed_stop', currentStopId: null, speedKmph: 45 }), NO_CONTROL_POINTS),
    ).toBe(false);
  });

  // Stationary, but not where passengers can board - and holding here blocks
  // a running lane.
  it('refuses a vehicle stopped in traffic even though it is standing still', () => {
    expect(canExecuteHold(vehicle({ stopState: 'stopped_in_traffic' }), NO_CONTROL_POINTS)).toBe(false);
  });

  it('refuses a vehicle whose position is not trustworthy', () => {
    expect(canExecuteHold(vehicle({ stopState: 'off_route' }), NO_CONTROL_POINTS)).toBe(false);
  });

  // A second instruction on top of one in progress is the
  // `conflicting_active_command` case the safety filter already names.
  it('refuses a vehicle already being held', () => {
    expect(canExecuteHold(vehicle({ stopState: 'held_by_controller' }), NO_CONTROL_POINTS)).toBe(false);
  });

  it('refuses when there is no vehicle state at all', () => {
    expect(canExecuteHold(undefined, NO_CONTROL_POINTS)).toBe(false);
  });

  // ─── CONTROL POINT PLACEMENT ───────────────────────────────────────────

  // Placement matters more than count: holding at three stops early in a
  // 47-stop route produced route-long benefit in the CTA pilot, while
  // holding everywhere spends driver goodwill where it achieves nothing.
  it('refuses a stop the corridor has not designated as a control point', () => {
    expect(canExecuteHold(vehicle({ currentStopId: 'stop-B' }), CONTROL_POINTS)).toBe(false);
    expect(canExecuteHold(vehicle({ currentStopId: 'stop-C' }), CONTROL_POINTS)).toBe(true);
  });

  // A corridor that has never been surveyed must not be silently switched
  // off - 47 shaped corridors against 14 policied ones is the real split on
  // this network, so fail-closed here would disable most of it.
  it('treats a corridor with no designated control points as "any stop"', () => {
    expect(canExecuteHold(vehicle({ currentStopId: 'stop-ZZ' }), NO_CONTROL_POINTS)).toBe(true);
  });
});
